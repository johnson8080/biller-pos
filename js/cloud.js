/* ============================================================
   Biller — cloud storage (Firebase Firestore)
   ------------------------------------------------------------
   The shop keeps working with no connection: everything lives in
   localStorage. When the owner is signed in, the same state is
   mirrored to Firestore so another device can pick it up, and a
   presence record shows which accounts are online right now.

   Nothing here is required for selling: if Firebase is missing,
   disabled, or unreachable, the app simply stays local.
   ============================================================ */
(() => {
  "use strict";
  const T = window.Till;
  if (!T) throw new Error("Till core must load before cloud.");

  const SHOP_COLLECTION = "billerShops";
  const PRESENCE_COLLECTION = "billerPresence";
  const PAYMENT_COLLECTION = "billerPayments";
  const ANNOUNCEMENTS_COLLECTION = "billerAnnouncements";
  const ANNOUNCEMENT_READS_COLLECTION = "billerAnnouncementReads";
  const SAVED_AT_KEY = "biller.pos.savedAt";

  // The one account that sees the developer tools: the shop owner.
  const DEV_EMAILS = (window.Till?.DEV_EMAILS || ["johnsonommala1@gmail.com"]).slice();

  const PUSH_DELAY = 1200;
  const HEARTBEAT = 60000;
  const ONLINE_WINDOW = 150000;

  let fs = null;
  let user = null;
  let pushTimer = null;
  let presenceTimer = null;
  let unsubscribers = [];
  let accounts = [];
  let accountsError = "";
  let paymentRequests = [];
  let myPayment = null;
  let paymentUnsub = null;
  let paymentRulesError = "";
  let onPaymentPrompt = null;
  // Developer announcements for every shop. Kept in memory; read receipts
  // (which shop opened which announcement) live in ANNOUNCEMENT_READS_COLLECTION.
  let announcements = [];
  let notifiedUnread = new Set();
  // A device may not push its state up until a pull has completed — an
  // empty locally-seeded till (pinHash blank, no products, My Store) must
  // never be allowed to overwrite a populated cloud shop on first sync.
  let pulledOnce = false;
  // True when the last successful pull proved the account has no cloud shop
  // yet. A fresh device must not push its blank seed just because the cloud
  // is empty: the shop may still be sitting on the owner's other phone,
  // waiting for its first sync. The seed goes up only when the shopkeeper
  // actually sets the shop up.
  let cloudEmpty = false;
  // The state this device last agreed on with the cloud. It is the base of
  // every three-way merge: "what did I change?" is only answerable against
  // the copy both sides started from.
  let lastSyncedState = null;
  let lastError = "";
  let phase = "signed-out";
  let lastSyncAt = 0;
  let online = false; // proven by a real request, never guessed from navigator.onLine
  let probePromise = null;
  let probeTimer = 0;
  const listeners = new Set();

  // A plain 204 from Google's CDN. It cannot be answered by the service
  // worker or a local server, so it tells the truth: no data, no green ring.
  const PROBE_URL = "https://www.gstatic.com/generate_204";

  function probe() {
    if (probePromise) return probePromise;
    probePromise = fetch(`${PROBE_URL}?t=${Date.now()}`, { mode: "no-cors", cache: "no-store" })
      .then(() => { setOnline(true); return true; })
      .catch(() => { setOnline(false); return false; })
      .finally(() => { probePromise = null; });
    return probePromise;
  }

  function setOnline(next) {
    if (next === online) return;
    online = next;
    // Back online: clear a stale "cannot reach the cloud" state.
    if (next && phase === "error") setPhase(fs ? "syncing" : "local");
    // Back online: pick up anything another device changed meanwhile.
    if (next && user && fs) pull({ silent: true });
    notify();
  }

  /* ---------- Small helpers ---------- */

  function setPhase(next, message = "") {
    phase = next;
    if (message) lastError = message;
    notify();
  }

  function notify() {
    const snapshot = status();
    listeners.forEach((fn) => {
      try { fn(snapshot); } catch (error) { console.warn(error); }
    });
  }

  /**
   * The developer tools belong to one account only: the shop owner. Nobody
   * else sees the panel, and there is no switch to turn it on.
   */
  function isOwner() {
    const email = String(user?.email || T.getSession()?.email || "").trim().toLowerCase();
    return DEV_EMAILS.includes(email);
  }

  /* ---------- "This device has changes the cloud has never seen" ----------
     An edit made while offline (or before the first pull finishes) never
     reaches Firestore on its own. Remember it, and flush it on the next
     successful pull so the devices stay aligned without a user doing
     anything. The hash of the last synced state breaks the "local is newer"
     tie, so flushing never ping-pongs: identical content pushes nothing. */
  function pendingKey() {
    return "biller.pos.pending." + (user?.uid || "local");
  }
  function lastHashKey() {
    return "biller.pos.hash." + (user?.uid || "local");
  }
  function markPending() {
    try { localStorage.setItem(pendingKey(), "1"); } catch { /* ignore */ }
  }
  function clearPending() {
    try { localStorage.removeItem(pendingKey()); } catch { /* ignore */ }
  }
  function hasPending() {
    try { return localStorage.getItem(pendingKey()) === "1"; } catch { return false; }
  }
  function stateHash() {
    // Hash the state exactly the way the fence hashes a cloud copy. A raw
    // seed and its normalized form are not byte-equal, and that mismatch
    // used to make every push after a fresh seed look like "the cloud
    // moved" — so the shopkeeper's setup silently never left the device.
    try {
      return stateHashOf(T.normalizeState ? T.normalizeState(T.state) : T.state);
    } catch { return ""; }
  }
  function stateHashOf(obj) {
    try {
      if (!obj || typeof obj !== "object") return "";
      const clean = JSON.parse(JSON.stringify(obj));
      // Every save rewrites these clocks: the day's stock-book stamp and
      // the shopkeeper claim heartbeat. They are not user edits, and two
      // online devices can never hold them byte-equal — excluding them is
      // what keeps "is the cloud different?" honest.
      if (clean.stockDays && typeof clean.stockDays === "object") {
        for (const day of Object.keys(clean.stockDays)) {
          const record = clean.stockDays[day];
          if (!record || typeof record !== "object") continue;
          delete record.openingAt;
          delete record.latestAt;
          delete record.closingAt;
        }
      }
      const claims = clean.store && clean.store.staffClaims;
      if (claims && typeof claims === "object") {
        for (const name of Object.keys(claims)) {
          if (claims[name] && typeof claims[name] === "object") delete claims[name].at;
        }
      }
      // The cart belongs to the device that built it — never compare it.
      delete clean.cart;
      const raw = JSON.stringify(clean);
      let h = 5381;
      for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) >>> 0;
      return raw.length + ":" + h.toString(36);
    } catch { return ""; }
  }
  function lastSyncedHash() {
    try { return localStorage.getItem(lastHashKey()) || ""; } catch { return ""; }
  }
  function rememberSyncedHash(state) {
    try {
      const source = state || T.state;
      const hash = stateHashOf(T.normalizeState ? T.normalizeState(source) : source);
      if (hash) localStorage.setItem(lastHashKey(), hash);
    } catch { /* ignore */ }
  }

  /* The last copy both sides agreed on. It is what makes a merge possible:
     "what did this device change?" can only be answered against the state the
     cloud held when this device last synced. Kept in memory and mirrored in
     localStorage so an edit made offline survives a reload and still merges
     when the connection returns. */
  function baseKey() {
    return "biller.pos.base." + (user?.uid || "local");
  }
  function rememberBase(state) {
    lastSyncedState = cloneValue(state) || null;
    try {
      const raw = lastSyncedState ? JSON.stringify(lastSyncedState) : "";
      // The cloud document stops at 1 MB; a bigger mirror cannot be the base
      // of anything that could have been written there.
      if (raw && raw.length <= 1200000) localStorage.setItem(baseKey(), raw);
      else localStorage.removeItem(baseKey());
    } catch { /* quota / private mode: merge from memory only */ }
  }
  function loadBase() {
    if (lastSyncedState) return lastSyncedState;
    try {
      const raw = localStorage.getItem(baseKey());
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const stored = lastSyncedHash();
      if (!stored) return null;
      const hash = stateHashOf(T.normalizeState ? T.normalizeState(parsed) : parsed);
      if (hash !== stored) return null;
      lastSyncedState = parsed;
      return parsed;
    } catch { return null; }
  }

  /** Remember the exact copy the cloud now holds: its hash and its content. */
  function rememberSynced(state) {
    const copy = cloneValue(state || T.state);
    if (copy && typeof copy === "object") delete copy.cart;
    rememberSyncedHash(copy);
    rememberBase(copy);
  }

  async function flushPending() {
    // Without a synced hash this device has no basis to claim its copy is
    // complete — flushing would push an unproven (possibly seeded) till over
    // the cloud shop. The hash is always set once a pull has completed, so
    // everything afterwards flushes normally.
    const stored = lastSyncedHash();
    if (!stored) return false;
    const needs = hasPending() || stateHash() !== stored;
    if (!needs) return false;
    return push({ immediate: true });
  }

  /* ---------- Merging edits from two devices ----------
     Both tills may edit the same shop. When the cloud moved under this
     device, adopting the cloud copy throws this device's work away; blindly
     pushing throws the other device's work away. The right answer is a
     three-way merge against the copy both sides last agreed on: keep every
     change either side made, and only let the device that is saving now win
     where the very same field was changed differently on both. */

  function cloneValue(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return false;
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i += 1) if (!deepEqual(a[i], b[i])) return false;
      return true;
    }
    if (typeof a === "object") {
      const aKeys = Object.keys(a);
      const bKeys = Object.keys(b);
      if (aKeys.length !== bKeys.length) return false;
      for (const key of aKeys) {
        if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
        if (!deepEqual(a[key], b[key])) return false;
      }
      return true;
    }
    return false;
  }

  function arrayItemKey(item) {
    if (isPlainObject(item)) {
      // The same payment is the same payment on every phone when its M-Pesa
      // code matches, even if each phone applied it at a slightly different
      // moment. This is what stops a confirmation buying two months.
      if (item.mpesaCode) return "code:" + String(item.mpesaCode).trim().toUpperCase();
      if (item.id != null) return "id:" + String(item.id);
      if (item.receiptNo != null) return "no:" + String(item.receiptNo);
      if (item.date != null) return "date:" + String(item.date);
      if (item.at != null) return "at:" + String(item.at);
      if (item.name != null) return "name:" + String(item.name);
    }
    try { return "value:" + JSON.stringify(item); } catch { return "value:" + String(item); }
  }

  function mergeArray(base, local, remote) {
    const b = Array.isArray(base) ? base : [];
    const l = Array.isArray(local) ? local : [];
    const r = Array.isArray(remote) ? remote : [];
    const mapOf = (list) => {
      const map = new Map();
      for (const item of list) map.set(arrayItemKey(item), item);
      return map;
    };
    const bmap = mapOf(b);
    const lmap = mapOf(l);
    const rmap = mapOf(r);
    const order = [];
    const seen = new Set();
    const addOrder = (list) => {
      for (const item of list) {
        const key = arrayItemKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        order.push(key);
      }
    };
    addOrder(l);
    addOrder(r);
    const out = [];
    for (const key of order) {
      const baseItem = bmap.get(key);
      const localItem = lmap.get(key);
      const remoteItem = rmap.get(key);
      if (localItem !== undefined && remoteItem !== undefined) {
        out.push(mergeValue(baseItem, localItem, remoteItem));
      } else if (localItem !== undefined) {
        // The other side deleted it (or never had it). An edit beats a
        // delete; an untouched item follows the delete.
        if (baseItem === undefined || !deepEqual(localItem, baseItem)) out.push(cloneValue(localItem));
      } else if (remoteItem !== undefined) {
        if (baseItem === undefined || !deepEqual(remoteItem, baseItem)) out.push(cloneValue(remoteItem));
      }
    }
    return out;
  }

  function mergeValue(base, local, remote, key = "") {
    const localChanged = !deepEqual(local, base);
    const remoteChanged = !deepEqual(remote, base);
    if (!localChanged) return cloneValue(remote);
    if (!remoteChanged) return cloneValue(local);
    if (deepEqual(local, remote)) return cloneValue(local);
    // Both tills changed the same counter. Add the two deltas, so two
    // concurrent sales do not erase each other from the stock.
    if (key === "stock" || key === "nextReceipt") {
      const b = Number(base);
      const l = Number(local);
      const r = Number(remote);
      if (Number.isFinite(b) && Number.isFinite(l) && Number.isFinite(r)) {
        return Math.max(0, b + (l - b) + (r - b));
      }
    }
    // Plan dates only ever move forward.
    if (key === "paidUntil" || key === "lastPaidAt") {
      const l = Date.parse(local) || 0;
      const r = Date.parse(remote) || 0;
      if (l || r) return cloneValue(l >= r ? local : remote);
    }
    if (key === "lastConfirmedAt") {
      const l = Number(local) || 0;
      const r = Number(remote) || 0;
      if (l || r) return Math.max(l, r);
    }
    if (Array.isArray(local) && Array.isArray(remote)) return mergeArray(base, local, remote);
    if (isPlainObject(local) && isPlainObject(remote)) return mergeObject(base, local, remote);
    // The same field was set to two different values: the device that is
    // saving now wins, exactly like editing a field twice in a row.
    return cloneValue(local);
  }

  function mergeObject(base, local, remote) {
    const b = isPlainObject(base) ? base : {};
    const l = isPlainObject(local) ? local : {};
    const r = isPlainObject(remote) ? remote : {};
    const out = {};
    const keys = new Set([...Object.keys(l), ...Object.keys(r)]);
    for (const key of keys) {
      // The cart belongs to the device that built it.
      if (key === "cart") continue;
      const value = mergeValue(b[key], l[key], r[key], key);
      if (value !== undefined) out[key] = value;
    }
    return out;
  }

  function mergeState(base, local, remote) {
    const merged = mergeObject(base, local, remote);
    // Never lose the device's own cart.
    const cart = T.state && T.state.cart ? T.state.cart : { items: [], discount: null };
    merged.cart = cloneValue(cart);
    return T.normalizeState ? T.normalizeState(merged) : merged;
  }

  /** Re-paint (quietly) unless the shopkeeper is mid-edit. Sync that lands
      behind the shopkeeper goes through Till.softRender, which waits for a
      quiet moment — the DOM they are touching is never replaced under them. */
  function maybeRepaint() {
    try {
      // Prefer the app's softRender — it defers while the shopkeeper is
      // typing or touching. Without it (stale caller), stay out of the way
      // while editing instead of yanking the screen away.
      const repaint = window.Till?.softRender;
      if (typeof repaint === "function") { repaint(); return; }
      const active = document.activeElement;
      const tag = String(active?.tagName || "").toLowerCase();
      const editing = Boolean(active) && (tag === "input" || tag === "textarea" || tag === "select" || active.isContentEditable);
      if (editing) return;
      window.render?.();
    } catch { /* ignore */ }
  }

  /* ---------- Which copy is the shop? ----------
     One account can end up holding two different shops: a second phone that
     signed in and set itself up before its first pull finished, or a cloud
     document that was wiped and replaced by a blank seed. Clocks and hashes
     cannot answer "is this the same shop?", but the content and the shop's
     permanent code can. The rules below are deliberately one-sided: a blank
     seed never wins against a shop with anything real in it. */

  function shopSubstance(state) {
    const data = state && typeof state === "object" ? state : {};
    const store = data.store && typeof data.store === "object" ? data.store : {};
    const count = (list) => (Array.isArray(list) ? list.filter((item) => item != null).length : 0);
    const roster = Array.isArray(store.staffList)
      ? store.staffList.map((name) => String(name || "").trim()).filter(Boolean)
      : (String(store.staff || "").trim() ? [String(store.staff).trim()] : []);
    const name = String(store.name || "").trim();
    const payments = Array.isArray(store.subscription?.payments) ? store.subscription.payments.length : 0;
    const named = Boolean(name) && name.toLowerCase() !== "my store";
    const products = count(data.products);
    const transactions = count(data.transactions);
    const customers = count(data.customers);
    const suppliers = count(data.suppliers);
    return {
      code: String(store.shopCode || "").trim(),
      createdAt: String(data.createdAt || "").trim().slice(0, 40),
      name,
      named,
      roster: roster.length,
      products,
      transactions,
      customers,
      suppliers,
      payments,
      score: (named ? 1 : 0) + roster.length + products + transactions + customers + suppliers + payments
    };
  }

  /** The blank till the app starts with — no shop in it at all. */
  function shopIsSeed(state) {
    const shop = shopSubstance(state);
    // shopCode and subscription.startedAt are generated automatically, so
    // they say nothing about whether a shopkeeper has set anything up.
    return !shop.named && !shop.roster && !shop.products && !shop.transactions
      && !shop.customers && !shop.suppliers && !shop.payments;
  }

  /**
   * Which copy is the shop this account has been using?
   * "same"   — same permanent code (or two blank seeds): normal sync decides.
   * "local"  — keep this device's copy and repair the cloud.
   * "remote" — adopt the cloud copy.
   */
  function shopConflict(local, remote) {
    const mine = shopSubstance(local);
    const theirs = shopSubstance(remote);
    // A reset keeps the shopCode. Same code means the same shop, so a reset
    // is an ordinary edit and must never be mistaken for a second shop.
    if (mine.code && theirs.code && mine.code === theirs.code) return "same";
    const mineSeed = shopIsSeed(local);
    const theirsSeed = shopIsSeed(remote);
    if (mineSeed && theirsSeed) return "same";
    // A blank till never beats a real shop, and a real shop never loses to
    // a blank seed — this is the wipe that must never happen again.
    if (mineSeed) return "remote";
    if (theirsSeed) return "local";
    // Two real shops under one account: the one that existed first is the
    // shop the account has been selling with. The other was created by
    // mistake on a second phone before its first pull.
    const mineAt = Date.parse(mine.createdAt) || 0;
    const theirsAt = Date.parse(theirs.createdAt) || 0;
    if (mineAt && theirsAt && mineAt !== theirsAt) return mineAt < theirsAt ? "local" : "remote";
    if (mine.score !== theirs.score) return mine.score > theirs.score ? "local" : "remote";
    return "remote";
  }

  function friendlyError(error) {
    const code = String(error?.code || "");
    const text = String(error?.message || "").toLowerCase();
    if (code === "permission-denied") return "Firebase rules are blocking this device.";
    if (code === "unavailable" || code === "deadline-exceeded") return "No connection to Firebase.";
    if (code === "failed-precondition" || code === "unimplemented") return "Firestore is not enabled for this project.";
    if (code === "not-found") return "No cloud copy found yet.";
    if (text.includes("has not been used") || text.includes("has not been enabled") || text.includes("not enabled")) {
      return "Firestore is not enabled for this project.";
    }
    return code ? code.replace(/^firestore\//, "") : "Cloud sync stopped.";
  }

  /** Is the whole service turned off, rather than just this request failing? */
  function serviceDisabled(error) {
    const code = String(error?.code || "").toLowerCase();
    const text = String(error?.message || "").toLowerCase();
    return code.includes("unimplemented")
      || code.includes("failed-precondition")
      || text.includes("has not been used")
      || text.includes("has not been enabled")
      || text.includes("not enabled");
  }

  /* ---------- Status ---------- */

  function status() {
    return {
      mode: fs ? "cloud" : "local",
      phase,
      error: lastError,
      lastSyncAt,
      accounts: accounts.slice(),
      accountsError,
      isOwner: isOwner(),
      email: user?.email || T.getSession()?.email || "",
      online
    };
  }

  function onChange(fn) {
    listeners.add(fn);
    try { fn(status()); } catch (error) { console.warn(error); }
    return () => listeners.delete(fn);
  }

  /* ---------- Start up ---------- */

  function init() {
    // Track connectivity first: the status ring must be honest even when the
    // Firebase SDK never loads.
    try {
      window.addEventListener("online", () => { probe(); });
      window.addEventListener("offline", () => setOnline(false));
    } catch { /* ignore */ }
    // Phones keep claiming they are online after data is switched off, so
    // ask the network directly, and keep asking while the app is open.
    if (!probeTimer) {
      probeTimer = setInterval(() => { probe(); }, 8000);
      try { document.addEventListener("visibilitychange", () => { if (!document.hidden) probe(); }); } catch { /* ignore */ }
      probe();
    }
    try {
      if (!window.firebase?.firestore) return false;
      fs = window.firebase.firestore();
      try { fs.settings({ ignoreUndefinedProperties: true }); } catch { /* older SDK */ }
      try { fs.enablePersistence({ synchronizeTabs: true }).catch(() => {}); } catch { /* private mode */ }
      setPhase(user ? "syncing" : "signed-out");
      return true;
    } catch (error) {
      console.warn("Cloud storage is not available:", error);
      fs = null;
      return false;
    }
  }

  /* ---------- Signing in and out ---------- */

  function attach(nextUser) {
    detach();
    user = nextUser || null;
    if (!user) {
      setPhase("signed-out");
      return;
    }
    if (!fs) {
      setPhase("local");
      return;
    }
    setPhase("syncing");
    // Say hello so the developer panel can see this device.
    beat();
    presenceTimer = setInterval(beat, HEARTBEAT);
    document.addEventListener("visibilitychange", onVisible);
    // Pull the cloud copy down, then keep the device in step.
    pull({ silent: true }).then((result) => {
      if (result?.ok) pulledOnce = true;
      notify();
    }).finally(() => {
      if (isOwner()) watchPresence();
      if (isOwner()) watchPayments();
      watchMyPayment();
      watchAnnouncements();
      watchShop();
      notify();
    });
  }

  /** Keep this till in step with the cloud in real time. Whatever the other
      device saves lands here within seconds, without a reload or a manual
      sync — same three-way merge as the pull path. */
  function watchShop() {
    if (!fs || !user) return;
    try {
      const unsub = fs.collection(SHOP_COLLECTION).doc(user.uid).onSnapshot((snap) => {
        const data = snap && snap.exists ? snap.data() : null;
        if (!data || !data.state) return;
        const remoteAt = Number(data.updatedAt) || (data.serverAt?.toMillis?.() || 0);
        let remote = null;
        try { remote = T.normalizeState(data.state); } catch { return; }
        const conflict = shopConflict(T.state, remote);
        if (conflict === "local") return; // this till holds the real shop; keep it
        if (conflict === "remote") {
          // A blank/foreign cloud seed vs this till's shop, or the account's
          // real shop arriving: adopt the cloud copy exactly like a pull.
          applyRemote(data.state, remoteAt);
          maybeRepaint();
          return;
        }
        const localHash = stateHash();
        const remoteHash = stateHashOf(remote);
        if (remoteHash && localHash === remoteHash) {
          // Identical to what this device holds — usually our own write
          // echoing back. Refresh the base so the next merge is cheap.
          rememberSynced(remote);
          return;
        }
        const base = loadBase();
        const baseHash = base ? stateHashOf(T.normalizeState ? T.normalizeState(base) : base) : "";
        const localDelta = baseHash ? localHash !== baseHash : true;
        if (base && localDelta) {
          const merged = mergeState(base, T.state, remote);
          if (stateHashOf(merged) !== remoteHash) {
            // Both sides have changes: put them together and send them up.
            T.state = merged;
            try { T.save({ quiet: true, stamp: false, sync: false }); } catch { /* ignore */ }
            push({ immediate: true }).catch(() => {});
            T.toast?.("Merged the other device's changes with yours — nothing was lost", "i-check");
            maybeRepaint();
            T.sheets?.refreshStaffGate?.();
            return;
          }
        }
        // We have nothing of our own beyond the cloud copy; take it as is.
        applyRemote(data.state, remoteAt);
        maybeRepaint();
      }, () => { /* the rules may not allow it yet; the reload path still works */ });
      unsubscribers.push(unsub);
    } catch { /* ignore */ }
  }

  function detach() {
    clearInterval(presenceTimer);
    presenceTimer = null;
    clearTimeout(pushTimer);
    pushTimer = null;
    document.removeEventListener("visibilitychange", onVisible);
    unsubscribers.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    unsubscribers = [];
    accounts = [];
    accountsError = "";
    announcements = [];
    notifiedUnread = new Set();
    pulledOnce = false;
    cloudEmpty = false;
    lastSyncedState = null;
    if (user && fs) beatOff();
    user = null;
    setPhase("signed-out");
  }

  function onVisible() {
    if (document.visibilityState !== "visible") return;
    beat();
    pull({ silent: true }).then((result) => { if (result?.ok) pulledOnce = true; });
  }

  /* ---------- Saving and loading ---------- */

  /** Write one copy of the shop to the cloud and remember it as the base. */
  async function writeSnapshot(state) {
    const snapshot = cloneValue(state);
    // The cart never leaves this device: two tills ringing up on the same
    // account must not push each other's unpaid items across.
    delete snapshot.cart;
    const size = JSON.stringify(snapshot).length;
    if (size > 900000) {
      // Firestore documents stop at 1 MB. The shop keeps working on the
      // device, but the cloud copy is left alone.
      lastError = "The shop is too large for the cloud copy — it stays on this device.";
      setPhase("error", lastError);
      return false;
    }
    await fs.collection(SHOP_COLLECTION).doc(user.uid).set({
      state: snapshot,
      // The device's own clock, so it can be compared with the stamp the
      // device keeps locally. The server time is kept alongside it.
      updatedAt: Date.now(),
      serverAt: window.firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: user.email || "",
      version: window.ASSET_VERSION || ""
    }, { merge: true });
    lastSyncAt = Date.now();
    // The device and the cloud now agree, so remember when.
    try { localStorage.setItem(SAVED_AT_KEY, String(Date.now())); } catch { /* ignore */ }
    window.Till?.setSavedAt?.(Date.now());
    cloudEmpty = false;
    clearPending();
    rememberSynced(snapshot);
    setPhase("synced");
    return true;
  }

  /**
   * Copy the shop state to the cloud. Saves are debounced so a burst of
   * changes travels as one write.
   */
  function push({ immediate = false, force = false } = {}) {
    if (!fs || !user) return Promise.resolve(false);
    if (!pulledOnce) {
      // Not allowed to write until a pull has completed — but the edit is
      // real. Remember it and send it on the next successful pull.
      markPending();
      return Promise.resolve(false);
    }
    // The cloud has no shop for this account and this till is still blank.
    // Sending the seed up would make every other device adopt an empty shop
    // — the wipe that starts on a second phone. Wait for the real shop.
    if (!force && cloudEmpty && shopIsSeed(T.state)) return Promise.resolve(false);
    clearTimeout(pushTimer);
    const run = async () => {
      try {
        // A pull may have landed between the check above and this timer:
        // never send a blank seed over an account with no cloud shop.
        if (!force && cloudEmpty && shopIsSeed(T.state)) return false;
        // Never write on top of changes this device has not seen. Read the
        // cloud copy first, then MERGE the two sides' edits instead of
        // choosing one and throwing the other away. The old fence adopted
        // the cloud copy on any movement, so a normal save on the other
        // phone made the next save here disappear.
        const fence = await fs.collection(SHOP_COLLECTION).doc(user.uid).get({ source: "server" });
        const fenceData = fence.exists ? fence.data() : null;
        if (!force && fenceData && fenceData.state) {
          const remoteAt = Number(fenceData.updatedAt) || (fenceData.serverAt?.toMillis?.() || 0);
          const remote = T.normalizeState(fenceData.state);
          const conflict = shopConflict(T.state, remote);
          if (conflict === "remote") {
            // The cloud holds the account's real shop; this till is blank or
            // was set up as a second, newer shop. Adopt the cloud copy.
            const carriedUserWork = stateHash() !== lastSyncedHash();
            if (applyRemote(fenceData.state, remoteAt)) {
              lastError = "";
              setPhase("synced");
              if (carriedUserWork) {
                T.toast?.("Your shop from the other phone is now on this device", "i-info");
              }
              return false;
            }
          }
          if (conflict === "same") {
            const storedHash = lastSyncedHash();
            const base = storedHash ? loadBase() : null;
            const baseHash = base ? stateHashOf(T.normalizeState ? T.normalizeState(base) : base) : "";
            const localDelta = baseHash ? stateHash() !== baseHash : true;
            if (base) {
              // Compare against THIS device's own base, not the shared
              // registry: a zombie copy from before a reload or a second open
              // tab of the app can be pushing from a stale in-memory state,
              // and it must merge — never overwrite the cloud with it.
              if (localDelta) {
                const merged = mergeState(base, T.state, remote);
                // The cart never syncs: compare the merged copy and the cloud
                // copy on their synced content, not on a cart this device is
                // holding.
                if (stateHashOf(merged) !== stateHashOf(remote)) {
                  // This device has changes its base does not include: keep
                  // them and put them together with the cloud copy.
                  T.state = merged;
                  try { T.save({ quiet: true, stamp: false, sync: false }); } catch { /* ignore */ }
                  maybeRepaint();
                  T.sheets?.refreshStaffGate?.();
                  T.toast?.("Merged the other device's changes with yours — nothing was lost", "i-check");
                  // fall through and write the merge below
                } else {
                  // Everything this device has is already inside the cloud
                  // copy; refresh the base and leave the cloud alone.
                  applyRemote(fenceData.state, remoteAt);
                  lastError = "";
                  setPhase("synced");
                  return false;
                }
              } else if (stateHashOf(remote) !== stateHash()) {
                // This device has no changes of its own; the cloud copy is
                // newer or different, so take it.
                applyRemote(fenceData.state, remoteAt);
                lastError = "";
                setPhase("synced");
                return false;
              } else {
                // Everything already agrees; nothing to write.
                lastSyncAt = Date.now();
                setPhase("synced");
                return true;
              }
            } else if (stateHashOf(remote) !== (storedHash || "")) {
              // No base to merge from (a fresh device): adopt the cloud copy
              // rather than overwrite it with an unprovable till.
              if (applyRemote(fenceData.state, remoteAt)) {
                lastError = "";
                setPhase("synced");
                if (stateHash() !== (storedHash || "")) {
                  T.toast?.("Another device had newer changes — your till matches it now", "i-info");
                }
                return false;
              }
            }
          }
          // conflict === "local": this device holds the real shop. Keep it
          // and repair the cloud below.
        }
        // Refresh this device's shopkeeper claim so it does not expire while
        // the shop is open.
        if (T.hasDeviceStaff?.() && T.activeStaff?.()) T.claimStaff?.(T.activeStaff());
        return await writeSnapshot(T.state);
      } catch (error) {
        lastError = friendlyError(error);
        const code = String(error?.code || "").toLowerCase();
        if (code.includes("unavailable") || code.includes("network")) setOnline(false);
        setPhase("error", lastError);
        markPending();
        return false;
      }
    };
    if (immediate) return run();
    pushTimer = setTimeout(run, PUSH_DELAY);
    return Promise.resolve(false);
  }

  /**
   * Bring the cloud copy down. The newer copy wins, so two devices that
   * both had the shop open do not fight each other.
   */
  async function pull({ silent = false, force = false } = {}) {
    if (!fs || !user) {
      if (!silent) T.toast("Sign in to sync with the cloud", "i-info");
      return { ok: false, applied: false, reason: "signed-out" };
    }
    try {
      // Always read from the server: a cached read would claim success with
      // no connection, which is exactly what must never happen here.
      const snap = await fs.collection(SHOP_COLLECTION).doc(user.uid).get({ source: "server" });
      const data = snap.exists ? snap.data() : null;
      if (!data || !data.state) {
        // The account has no cloud shop yet. Never send this device's blank
        // seed: the real shop may still be sitting on the owner's other
        // phone, waiting for its first sync. A device that already holds a
        // real shop is different — that copy belongs in the cloud now.
        pulledOnce = true;
        cloudEmpty = true;
        lastSyncAt = Date.now();
        setPhase("synced");
        const pushed = shopIsSeed(T.state) ? false : await push({ immediate: true });
        return { ok: true, applied: false, reason: "empty", pushed };
      }
      // An older build could have pushed its blank seed. That is not a shop:
      // when this device is blank too (and the code is not this shop's own),
      // wait for the owner's real shop instead of offering a blank setup.
      if (shopIsSeed(data.state) && shopIsSeed(T.state)) {
        const remoteCode = String(data.state?.store?.shopCode || "").trim();
        const localCode = String(T.state?.store?.shopCode || "").trim();
        if (!remoteCode || !localCode || remoteCode !== localCode) {
          pulledOnce = true;
          cloudEmpty = true;
          lastSyncAt = Date.now();
          setPhase("synced");
          return { ok: true, applied: false, reason: "empty-seed" };
        }
      }
      cloudEmpty = false;
      const remoteAt = Number(data.updatedAt) || (data.serverAt?.toMillis?.() || 0);
      // Decide which copy is this account's shop before comparing clocks or
      // hashes: a second phone that set itself up early, or a cloud document
      // replaced by a blank seed, must not wipe the real shop.
      const conflict = shopConflict(T.state, data.state);
      if (conflict === "local") {
        // This device holds the real shop. Keep it and repair the cloud copy
        // with it — a deliberate, authoritative write (the cloud copy was
        // just read, so this is not a blind overwrite).
        pulledOnce = true;
        lastSyncAt = Date.now();
        setPhase("synced");
        const pushed = await push({ immediate: true, force: true });
        if (pushed) {
          T.toast?.("This phone's shop is the one saved to your account — the cloud copy has been repaired", "i-check");
        }
        return { ok: true, applied: false, reason: "kept-local", pushed };
      }
      if (conflict === "remote") {
        // The cloud holds the account's real shop; this till is blank or a
        // second, newer shop started here. Adopt the cloud copy.
        const localWasSeed = shopIsSeed(T.state);
        const applied = applyRemote(data.state, remoteAt);
        pulledOnce = true;
        lastSyncAt = Date.now();
        setPhase("synced");
        if (applied && !localWasSeed) {
          T.toast?.("Your shop from the other phone is now on this device — its products and shopkeepers replaced the new shop started here", "i-info");
        }
        return { ok: true, applied, reason: "remote-shop" };
      }
      // Same shop on both sides: compare what each side changed since the
      // last agreement. The clock proves nothing (every local save stamps
      // it), so the content hashes decide.
      const stored = lastSyncedHash();
      let remoteHash = "";
      try { remoteHash = stateHashOf(T.normalizeState(data.state)); } catch { remoteHash = ""; }
      const remoteMoved = stored ? remoteHash !== stored : true;
      const localChanged = stored ? stateHash() !== stored : false;
      if (!force && !remoteMoved) {
        pulledOnce = true;
        lastSyncAt = Date.now();
        setPhase("synced");
        // The cloud is exactly what this device last synced. Send any local
        // edits up now, so the two devices converge without anyone editing.
        const flushed = localChanged ? await flushPending() : false;
        return { ok: true, applied: false, reason: localChanged ? "local-newer" : "in-sync", flushed };
      }
      if (!force && remoteMoved && localChanged) {
        const base = loadBase();
        if (base) {
          // Both sides changed the same shop: merge, then send the result
          // up. Nothing either device did is thrown away.
          const merged = mergeState(base, T.state, data.state);
          if (stateHashOf(merged) !== stateHashOf(data.state)) {
            T.state = merged;
            try { T.save({ quiet: true, stamp: false, sync: false }); } catch { /* ignore */ }
            pulledOnce = true;
            const pushed = await writeSnapshot(merged);
            lastSyncAt = Date.now();
            setPhase("synced");
            maybeRepaint();
            T.sheets?.refreshStaffGate?.();
            T.toast?.("Merged this device's changes with the other phone — nothing was lost", "i-check");
            return { ok: true, applied: true, reason: "merged", pushed };
          }
          // The merge adds nothing; the cloud copy is the full picture.
        }
        // No base to merge from: adopt the cloud copy rather than overwrite
        // it. A fresh device never has a base.
      }
      const applied = applyRemote(data.state, remoteAt);
      pulledOnce = true;
      lastSyncAt = Date.now();
      setPhase("synced");
      if (!applied) {
        // applyRemote refused (the cloud copy is a seed or a weaker shop).
        // Keep this device's shop and send it up instead of claiming the
        // cloud copy is in place.
        const pushed = await push({ immediate: true, force: true });
        return { ok: true, applied: false, reason: "kept-local", pushed };
      }
      return { ok: true, applied: true, reason: stored ? "remote-moved" : "remote-first" };
    } catch (error) {
      lastError = friendlyError(error);
      if (serviceDisabled(error)) {
        // The project has no Firestore database — stay local and say why.
        fs = null;
        setPhase("local", lastError);
      } else {
        setPhase("error", lastError);
      }
      if (!silent) T.toast(`Could not reach the cloud — ${lastError}`, "i-alert");
      return { ok: false, applied: false, error };
    }
  }

  /** Force a one-time read straight from the server — a real connectivity check. */
  async function refreshNow() {
    if (!(await probe())) {
      lastError = "No connection.";
      setPhase("error", lastError);
      return { ok: false, reason: "offline" };
    }
    if (!fs || !user) return { ok: false, reason: "signed-out" };
    try {
      const snap = await fs.collection(SHOP_COLLECTION).doc(user.uid).get({ source: "server" });
      const data = snap.exists ? snap.data() : null;
      if (data && data.state) {
        // A blank seed is not a shop. If this device is blank too, wait for
        // the owner's real shop instead of treating the seed as an answer.
        if (shopIsSeed(data.state) && shopIsSeed(T.state)) {
          const remoteCode = String(data.state?.store?.shopCode || "").trim();
          const localCode = String(T.state?.store?.shopCode || "").trim();
          if (!remoteCode || !localCode || remoteCode !== localCode) {
            pulledOnce = true;
            cloudEmpty = true;
            lastSyncAt = Date.now();
            setPhase("synced");
            return { ok: true, data, empty: true };
          }
        }
        cloudEmpty = false;
        const remoteAt = Number(data.updatedAt) || (data.serverAt?.toMillis?.() || 0);
        const remote = T.normalizeState(data.state);
        const conflict = shopConflict(T.state, remote);
        if (conflict === "local") {
          // This device holds the real shop; the cloud copy is a blank seed
          // or a different, weaker shop. Repair the cloud instead of
          // adopting the intruder.
          pulledOnce = true;
          const pushed = await push({ immediate: true, force: true });
          lastSyncAt = Date.now();
          setPhase("synced");
          return { ok: true, data, keptLocal: true, pushed };
        }
        if (conflict === "same") {
          const stored = lastSyncedHash();
          let remoteHash = "";
          try { remoteHash = stateHashOf(remote); } catch { remoteHash = ""; }
          const remoteMoved = stored ? remoteHash !== stored : true;
          const localChanged = stored ? stateHash() !== stored : false;
          if (remoteMoved && localChanged) {
            const base = loadBase();
            if (base) {
              // A manual "Sync now" must not throw away this device's edits
              // either: merge them with what the other phone wrote.
              const merged = mergeState(base, T.state, remote);
              if (stateHashOf(merged) !== stateHashOf(remote)) {
                T.state = merged;
                try { T.save({ quiet: true, stamp: false, sync: false }); } catch { /* ignore */ }
                pulledOnce = true;
                const pushed = await writeSnapshot(merged);
                lastSyncAt = Date.now();
                setPhase("synced");
                maybeRepaint();
                T.sheets?.refreshStaffGate?.();
                return { ok: true, data, merged: true, pushed };
              }
            }
          }
        }
        if (!applyRemote(data.state, remoteAt)) {
          pulledOnce = true;
          lastSyncAt = Date.now();
          setPhase("synced");
          return { ok: true, data, keptLocal: true };
        }
        pulledOnce = true;
       // Re-assert this device's claim: applying a remote copy replaced state,
       // which may have dropped our own claim.
       if (T.hasDeviceStaff?.() && T.activeStaff?.()) T.claimStaff?.(T.activeStaff());
      } else {
        // Nothing in the cloud yet. A blank seed must not be sent up.
        pulledOnce = true;
        cloudEmpty = true;
        if (!shopIsSeed(T.state)) await push({ immediate: true });
      }
      lastSyncAt = Date.now();
      setPhase("synced");
      return { ok: true, data };
    } catch (error) {
      lastError = friendlyError(error);
      const code = String(error?.code || "").toLowerCase();
      // A dead network shows up here as "unavailable" — trust it over the
      // radio's opinion.
      if (code.includes("unavailable") || code.includes("network")) setOnline(false);
      setPhase("error", lastError);
      return { ok: false, reason: error?.code || error?.message || "unknown" };
    }
  }

  /** Put the cloud copy in place on this device. */
  function applyRemote(remote, stamp = 0) {
    // The last line of defence: no path may replace a real shop with a
    // blank seed or a different, weaker shop. Callers that get false keep
    // their local copy and repair the cloud.
    if (shopConflict(T.state, remote) === "local") return false;
    const merged = T.normalizeState(remote);
    // A device with no synced hash was about to (or had just) seen a till
    // that it knows nothing about — say it out loud instead of looking
    // like the shop details "vanished".
    const freshJoin = !lastSyncedHash();
    // The till keeps its own cart no matter what the cloud copy holds —
    // another device's cart is none of this device's business.
    const localCart = T.state && T.state.cart ? T.state.cart : { items: [], discount: null };
    merged.cart = localCart;
    T.state = merged;
    cloudEmpty = false;
    // The cloud copy won; anything this device wanted to send no longer
    // exists, so forget the marker.
    clearPending();
    rememberSynced(merged);
    try {
      // Save it under the account that owns it without touching the
      // "last edited" stamp: receiving a copy is not a local change, and
      // pushing it straight back would make two devices ping-pong forever.
      T.save({ quiet: true, stamp: false, sync: false });
      T.setSavedAt?.(stamp || Date.now());
    } catch (error) {
      console.warn("Could not save the cloud copy locally:", error);
    }
    maybeRepaint();
    // A fresh sync may free (or fill) the shopkeeper slots — the gate
    // re-evaluates whether it is still needed.
    T.sheets?.refreshStaffGate?.();
    if (freshJoin && T.state?.store?.name && String(T.state.store.name) !== "My Store") {
      T.toast?.(`${T.state.store.name} loaded from the cloud — this device is in step`, "i-info");
    }
    return true;
  }

  /** The shop's payment request, if it is waiting for the developer. */
  function pendingPayment() {
    try {
      const sub = window.Till?.subscription?.() || {};
      if (!sub.awaiting) return null;
      return {
        at: Date.now(),
        amount: window.Till?.planSummary?.().amountCents || 0,
        reference: sub.reference || "",
        status: "pending"
      };
    } catch {
      return null;
    }
  }

  /**
   * The shop asks the developer to confirm a payment. The request is written
   * to its own payment document; the developer answers it from the panel.
   * The M-Pesa transaction code the shop typed in rides along, so the developer
   * can match the payment without asking the shop again.
   */
  async function requestPayment(mpesaCode = "") {
    if (!fs || !user) return { ok: false, error: "Sign in to send the request." };
    const sub = window.Till?.subscription?.() || {};
    const plan = window.Till?.planSummary?.() || {};
    const request = {
      code: window.Till?.shopCode?.() || "",
      shop: window.Till?.state?.store?.name || "",
      email: user.email || "",
      phone: String(window.Till?.state?.store?.phone || "").trim(),
      amount: plan.amountCents || 0,
      currency: plan.currency || "KES",
      reference: sub.reference || "",
      mpesaCode: String(mpesaCode || sub.mpesaCode || "").trim(),
      at: Date.now(),
      status: "pending"
    };
    try {
      try {
        await fs.collection(PAYMENT_COLLECTION).doc(user.uid).set(request, { merge: true });
      } catch (firstError) {
        // Older rules only let a shop create its request once. A shop that
        // has paid again can clear the old answered request and create a
        // fresh pending one.
        await fs.collection(PAYMENT_COLLECTION).doc(user.uid).delete();
        await fs.collection(PAYMENT_COLLECTION).doc(user.uid).set(request);
      }
      myPayment = request;
      notify();
      return { ok: true, request };
    } catch (error) {
      // The rules may not be deployed yet; the request still reaches the
      // developer through the presence record.
      return { ok: false, error: friendlyError(error) };
    }
  }

  /** The developer confirms a payment. The shop unlocks on its next poll. */
  async function confirmPayment(uid) {
    if (!fs || !user || !isOwner()) return { ok: false, error: "Not allowed." };
    try {
      const ref = fs.collection(PAYMENT_COLLECTION).doc(uid);
      const snap = await ref.get();
      // Confirming is not a renewal. A double tap (or a stale button) must
      // not add a second month to the shop.
      if (snap.exists && (snap.data() || {}).status === "confirmed") {
        return { ok: true, already: true };
      }
      // When the shop never pressed Pay in the app, there is no request doc
      // yet — build a full record from the shop's own presence record so the
      // panel card keeps its name, code, email and reference.
      if (!snap.exists) {
        const account = accounts.find((item) => item.id === uid);
        const accSub = account?.sub || {};
        const newRequest = {
          id: uid,
          status: "confirmed",
          confirmedAt: Date.now(),
          code: account?.code || "",
          shop: accSub.shop || account?.name || "",
          email: account?.name || "",
          amount: Number(accSub.amount) || 0,
          currency: accSub.currency || "KES",
          reference: accSub.reference || "",
          mpesaCode: accSub.mpesaCode || "",
          phone: accSub.phone || "",
          at: Date.now()
        };
        await ref.set(newRequest);
        paymentRequests = [newRequest, ...paymentRequests.filter((item) => item.id !== uid)];
        notify();
        return { ok: true };
      }
      await ref.set({
        status: "confirmed",
        confirmedAt: Date.now()
      }, { merge: true });
      paymentRequests = paymentRequests.map((item) => (item.id === uid ? { ...item, status: "confirmed" } : item));
      notify();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  }

  /** The developer declines a payment request. */
  async function declinePayment(uid) {
    if (!fs || !user || !isOwner()) return { ok: false, error: "Not allowed." };
    try {
      await fs.collection(PAYMENT_COLLECTION).doc(uid).set({
        status: "declined",
        declinedAt: Date.now()
      }, { merge: true });
      paymentRequests = paymentRequests.map((item) => (item.id === uid ? { ...item, status: "declined" } : item));
      notify();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  }

  /**
   * The developer takes back a confirmation: the shop's own device watches
   * this document and, on the next snapshot, wipes the plan back to unpaid.
   */
  async function revertPayment(uid) {
    if (!fs || !user || !isOwner()) return { ok: false, error: "Not allowed." };
    try {
      const ref = fs.collection(PAYMENT_COLLECTION).doc(uid);
      const snap = await ref.get();
      if (!snap.exists) {
        // No payment record yet — create one flagged as reverted so the
        // shop's next sync rolls back to unpaid. Fill in the shop's details
        // from its presence record so the developer panel keeps showing
        // its name, code, email and reference.
        const account = accounts.find((item) => item.id === uid);
        const accSub = account?.sub || {};
        const newRequest = {
          id: uid,
          status: "reverted",
          confirmedAt: 0,
          revertedAt: Date.now(),
          code: account?.code || "",
          shop: accSub.shop || account?.name || "",
          email: account?.name || "",
          amount: Number(accSub.amount) || 0,
          currency: accSub.currency || "KES",
          reference: accSub.reference || "",
          mpesaCode: accSub.mpesaCode || "",
          phone: accSub.phone || "",
          at: Date.now()
        };
        await ref.set(newRequest);
        paymentRequests = [newRequest, ...paymentRequests.filter((item) => item.id !== uid)];
        notify();
        return { ok: true, created: true };
      }
      await ref.set({
        status: "reverted",
        confirmedAt: 0,
        revertedAt: Date.now()
      }, { merge: true });
      paymentRequests = paymentRequests.map((item) => (item.id === uid ? { ...item, status: "reverted", confirmedAt: 0, revertedAt: Date.now() } : item));
      notify();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  }

  /**
   * The developer deletes an account. All four surfaces of the shop are
   * removed together so the panel no longer shows a stale details card:
   * the shop document, the payment claims for that shop, its presence
   * record, and every announcement receipt it sent back.
   */
  async function deleteAccount(uid) {
    if (!fs || !user || !isOwner()) return { ok: false, error: "Not allowed." };
    try {
      await fs.collection(SHOP_COLLECTION).doc(uid).delete();
      await fs.collection(PRESENCE_COLLECTION).doc(uid).delete();
      await fs.collection(PAYMENT_COLLECTION).doc(uid).delete();
      // Announcement receipts from this shop go too — the announcement
      // page should not leave a phantom row for the deleted account.
      try {
        const reads = await fs.collection(ANNOUNCEMENT_READS_COLLECTION).where("uid", "==", uid).get();
        const deletions = [];
        reads.forEach((doc) => deletions.push(doc.ref.delete()));
        await Promise.allSettled(deletions);
      } catch { /* best-effort; the main docs are already gone */ }
      accounts = accounts.filter((item) => item.id !== uid);
      paymentRequests = paymentRequests.filter((item) => item.id !== uid);
      notify();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  }

  /** Watch the payment requests. Only the developer reads this list. */
  function watchPayments() {
    if (!fs) return;
    try {
      const unsub = fs.collection(PAYMENT_COLLECTION).onSnapshot((snap) => {
        const list = [];
        snap.forEach((doc) => {
          const data = doc.data() || {};
          list.push({ id: doc.id, ...data });
        });
        list.sort((a, b) => (b.at || 0) - (a.at || 0));
        // Treat any request that flips TO pending as fresh — including a
        // shop whose payment was confirmed earlier and sent again after a
        // revert. Without this the developer never sees a toast prompt for
        // follow-up payments.
        const knownPending = new Set();
        for (const p of paymentRequests) if (p.status === "pending") knownPending.add(p.id);
        const fresh = list.find((item) => item.status === "pending" && !knownPending.has(item.id));
        paymentRequests = list;
        notify();
        if (fresh && onPaymentPrompt) onPaymentPrompt(fresh);
      }, (error) => {
        paymentRulesError = friendlyError(error);
        notify();
      });
      unsubscribers.push(unsub);
    } catch { /* the rules may not allow reading yet */ }
  }

  /** Watch this shop's own payment document, so a confirmation unlocks it. */
  function watchMyPayment() {
    if (!fs || !user) return;
    try {
      if (paymentUnsub) paymentUnsub();
      paymentUnsub = fs.collection(PAYMENT_COLLECTION).doc(user.uid).onSnapshot((snap) => {
        const data = snap.data() || {};
        myPayment = Object.keys(data).length ? { id: user.uid, ...data } : null;
        notify();
        if (data.status === "confirmed") {
          const confirmedAt = Number(data.confirmedAt) || 0;
          const sub = window.Till?.subscription?.() || {};
          const applied = Number(sub.lastConfirmedAt) || 0;
          const lastPaid = Date.parse(sub.lastPaidAt || "") || 0;
          // A confirmation snapshot fires on every reconnect. Only apply a
          // confirmation that has not already extended this shop's plan.
          // The lastPaidAt check also covers shops that were confirmed
          // before this guard existed.
          if (confirmedAt > applied) {
            if (confirmedAt > lastPaid + 60000) {
              const paid = window.Till?.markSubscriptionPaid?.({ method: "manual", reference: data.reference || "", mpesaCode: data.mpesaCode || "" });
              if (paid?.skipped) {
                window.Till?.toast?.("That claim was already applied — no second month is added.", "i-info");
              } else {
                window.Till?.toast?.("Your plan is on. Welcome back.", "i-check");
              }
            }
            if (window.Till?.state?.store?.subscription) {
              window.Till.state.store.subscription.lastConfirmedAt = confirmedAt;
              window.Till.save?.({ quiet: true });
              // This mutation is itself the authoritative change from the
              // developer's confirm — the fence must not stall it.
              window.Till?.cloud?.push?.({ force: true, immediate: true }).catch(() => {});
            }
            // The lock is a paint — the shop must not have to reload to see it vanish.
            window.render?.();
            // The shop just cleared its plan — send a fresh till straight into
            // the one-time setup so it can start selling. Existing shops are
            // not disturbed. If the account's shop is still on its way from
            // the cloud, show the waiting sheet instead of a blank setup.
            try {
              if (window.Till?.firstRunNeeded?.()) window.Till?.sheets?.openFirstRunGate?.();
              else if (window.Till?.cloudWaiting?.()) window.Till?.sheets?.openCloudWaiting?.();
            } catch { /* ignore */ }
          }
        }
        if (data.status === "reverted") {
          const revertedAt = Number(data.revertedAt) || 0;
          const sub = window.Till?.subscription?.() || {};
          const applied = Number(sub.revertedAt || 0);
          if (revertedAt > applied) {
            window.Till?.revertSubscription?.({ revertedAt, reason: data.reason || "" });
            // This mutation is itself the authoritative change from the
            // developer's revert — the fence must not stall it.
            window.Till?.cloud?.push?.({ force: true, immediate: true }).catch(() => {});
            // The lock is a paint — the shop must see it come back too.
            window.render?.();
          }
        }
      }, () => { /* the rules may not allow it yet */ });
    } catch { /* ignore */ }
  }

  /* ---------- Presence ---------- */

  async function beat() {
    if (!fs || !user) return;
    try {
      await fs.collection(PRESENCE_COLLECTION).doc(user.uid).set({
        name: user.email || "user",
        v: window.ASSET_VERSION || "",
        t: window.firebase.firestore.FieldValue.serverTimestamp(),
        off: false,
        // The plan state rides along so the developer can see who has paid
        // without a second collection or extra permissions.
        sub: subscriptionSummary(),
        // The shop's permanent code, so a payment can be matched to a shop.
        code: window.Till?.shopCode?.() || "",
        // A pending payment request, if the shop says it has paid.
        payment: pendingPayment(),
        // The payment request as the developer sees it.
        request: pendingPayment()
      });
      lastError = "";
    } catch (error) {
      lastError = friendlyError(error);
    }
  }

  /** A small summary of the shop's monthly plan for the developer view. */
  function subscriptionSummary() {
    try {
      const sub = window.Till?.subscription?.() || {};
      const plan = window.Till?.planSummary?.() || {};
      const txs = window.Till?.state?.transactions || [];
      const monthStart = (() => {
        const d = new Date();
        return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      })();
      let salesMonth = 0;
      let lastSaleAt = "";
      for (const tx of txs) {
        const created = tx.createdAt || "";
        if (new Date(created).getTime() >= monthStart) salesMonth++;
        if (created > lastSaleAt) lastSaleAt = created; // ISO strings compare cleanly
      }
      return {
        status: window.Till?.subscriptionStatus?.() || "active",
        amount: plan.amountCents || sub.amountCents || 0,
        currency: plan.currency || sub.currency || "KES",
        paidUntil: sub.paidUntil || "",
        awaiting: Boolean(sub.awaiting),
        reference: sub.reference || "",
        mpesaCode: sub.mpesaCode || "",
        phone: sub.phone || String(window.Till?.state?.store?.phone || ""),
        paidAt: sub.lastPaidAt || "",
        shop: window.Till?.state?.store?.name || "",
        startedAt: sub.startedAt || "",
        // Operational signal for the developer panel: how many sales the
        // shop has rung this calendar month, and when it last sold.
        salesMonth,
        lastSaleAt,
        at: Date.now()
      };
    } catch {
      return { status: "active", at: Date.now() };
    }
  }

  async function beatOff() {
    if (!fs || !user) return;
    try {
      await fs.collection(PRESENCE_COLLECTION).doc(user.uid).set({
        name: user.email || "user",
        v: window.ASSET_VERSION || "",
        t: window.firebase.firestore.FieldValue.serverTimestamp(),
        off: true
      }, { merge: true });
    } catch { /* the account may simply be gone */ }
  }

  /** Watch who else is signed in. Only the developer sees this list. */
  function watchPresence() {
    if (!fs) return;
    try {
      const unsub = fs.collection(PRESENCE_COLLECTION).onSnapshot((snap) => {
        const list = [];
        snap.forEach((doc) => {
          if (user && doc.id === user.uid) return;
          const data = doc.data() || {};
          list.push({
            id: doc.id,
            name: data.name || "user",
            v: data.v || "",
            t: data.t?.toMillis?.() || 0,
            off: Boolean(data.off),
            sub: data.sub || null,
            code: data.code || "",
            payment: data.payment || null,
            request: data.request || null
          });
        });
        list.sort((a, b) => b.t - a.t);
        accounts = list;
        accountsError = "";
        notify();
      }, (error) => {
        accountsError = friendlyError(error);
        notify();
      });
      unsubscribers.push(unsub);
    } catch (error) {
      console.warn("Could not watch the account list:", error);
    }
  }

  /* ---------- Announcements (developer -> every shop) ---------- */

  /**
   * Watch the developer announcements. Every signed-in shop watches the
   * same list; the developer writes it. Toasts ping each shop exactly once
   * per announcement it has not read yet.
   */
  function watchAnnouncements() {
    if (!fs) return;
    try {
      const unsub = fs.collection(ANNOUNCEMENTS_COLLECTION).onSnapshot((snap) => {
        const list = [];
        snap.forEach((doc) => {
          const data = doc.data() || {};
          list.push({
            id: doc.id,
            title: String(data.title || "Announcement").slice(0, 80),
            body: String(data.body || "").slice(0, 600),
            at: Number(data.at) || 0,
            createdBy: String(data.createdBy || ""),
            v: String(data.v || "")
          });
        });
        list.sort((a, b) => (b.at || 0) - (a.at || 0));
        announcements = list;
        notify();
        const unread = list.filter((item) => !notifiedUnread.has(item.id) && !(window.Till?.readAnnouncementIds?.() || []).includes(item.id));
        if (unread.length) {
          const count = unread.length;
          window.Till?.toast?.(count === 1 ? "New announcement from the developer" : `${count} new announcements from the developer`, "i-bell");
          for (const item of unread) notifiedUnread.add(item.id);
        }
      }, (error) => {
        // The rules may not be deployed yet; announcements simply stay hidden.
        console.warn("Announcement watch failed:", friendlyError(error));
      });
      unsubscribers.push(unsub);
    } catch (error) {
      console.warn("Announcements unavailable:", error);
    }
  }

  /** The developer publishes an announcement every shop can see. */
  async function sendAnnouncement(title, body) {
    if (!isOwner()) return { ok: false, error: "Only the developer account can send announcements." };
    if (!fs) return { ok: false, error: "Not connected to the cloud. Open the app while online and try again." };
    if (!user) return { ok: false, error: "You're signed in offline. Sign in to the cloud first, then send." };
    const cleanTitle = String(title || "").trim().slice(0, 80);
    const cleanBody = String(body || "").trim().slice(0, 600);
    if (!cleanTitle) return { ok: false, error: "Give the announcement a title." };
    if (!cleanBody) return { ok: false, error: "Write the message shops should see." };
    try {
      await fs.collection(ANNOUNCEMENTS_COLLECTION).add({
        title: cleanTitle,
        body: cleanBody,
        at: Date.now(),
        createdBy: user.email || "",
        v: window.ASSET_VERSION || ""
      });
      return { ok: true };
    } catch (error) {
      const text = String(error?.code || error?.message || error).toLowerCase();
      if (text.includes("permission") || text.includes("missing") || text.includes("insufficient")) {
        return { ok: false, error: "Announcements are blocked by Firebase rules. Run: firebase deploy --only firestore:rules" };
      }
      return { ok: false, error: friendlyError(error) };
    }
  }

  /** The developer removes an announcement. Read receipts are kept. */
  async function deleteAnnouncement(id) {
    if (!fs || !user || !isOwner()) return { ok: false, error: "Only the developer account can delete announcements." };
    const cleanId = String(id || "").trim();
    if (!cleanId) return { ok: false };
    try {
      await fs.collection(ANNOUNCEMENTS_COLLECTION).doc(cleanId).delete();
      announcements = announcements.filter((item) => item.id !== cleanId);
      notify();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  }

  /** The developer lists which shops opened an announcement. */
  async function announcementReaders(announcementId) {
    if (!fs || !user || !isOwner()) return { ok: false, readers: [] };
    const cleanId = String(announcementId || "").trim();
    if (!cleanId) return { ok: false, readers: [] };
    try {
      const snap = await fs.collection(ANNOUNCEMENT_READS_COLLECTION)
        .where("announcementId", "==", cleanId)
        .get();
      const readers = [];
      snap.forEach((doc) => {
        const data = doc.data() || {};
        readers.push({
          id: doc.id,
          uid: String(data.uid || ""),
          shop: String(data.shop || ""),
          email: String(data.email || ""),
          code: String(data.code || ""),
          at: Number(data.at) || 0
        });
      });
      readers.sort((a, b) => (b.at || 0) - (a.at || 0));
      return { ok: true, readers };
    } catch (error) {
      return { ok: false, error: friendlyError(error), readers: [] };
    }
  }

  /** A shop logs that it opened an announcement. One receipt per shop. */
  async function markAnnouncementRead(announcementId) {
    if (!fs || !user) return { ok: false };
    const cleanId = String(announcementId || "").trim();
    if (!cleanId) return { ok: false };
    try {
      await fs.collection(ANNOUNCEMENT_READS_COLLECTION)
        .doc(`${cleanId}_${user.uid}`)
        .set({
          announcementId: cleanId,
          uid: user.uid,
          shop: window.Till?.state?.store?.name || "",
          email: user.email || "",
          code: window.Till?.shopCode?.() || "",
          at: Date.now()
        }, { merge: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  }

  /** Is this account online right now? */
  function isOnline(account) {
    if (!account || !account.t) return false;
    if (account.off) return false;
    return Date.now() - account.t < ONLINE_WINDOW;
  }

  T.cloud = {
    init,
    attach,
    detach,
    push,
    pull,
    refreshNow,
    status,
    onChange,
    isOwner,
    isOnline,
    accounts: () => accounts.slice(),
    paymentRequests: () => paymentRequests.slice(),
    announcements: () => announcements.slice(),
    sendAnnouncement,
    deleteAnnouncement,
    announcementReaders,
    markAnnouncementRead,
    paymentRulesError: () => paymentRulesError,
    myPayment: () => myPayment,
    /** True once this device has completed a pull (or confirmed the cloud is empty) for the signed-in account. */
    hydrated: () => pulledOnce,
    /** True when the last completed pull found no cloud shop for this account. */
    empty: () => cloudEmpty,
    /** True when a state holds nothing but the app's blank starting shop. */
    isSeed: (state) => shopIsSeed(state || T.state),
    requestPayment,
    confirmPayment,
    declinePayment,
    revertPayment,
    deleteAccount,
    onPaymentPrompt: (fn) => { onPaymentPrompt = fn; },
    devEmails: () => DEV_EMAILS.slice()
  };
})();
