/* ============================================================
   Biller — Point of Sale App (boot + router)
   ============================================================ */

// Firebase configuration (compat SDK, loaded via CDN in index.html)
const firebaseConfig = {
  apiKey: "AIzaSyDipRanbHa1buRomPAF0SZdHoW9yS4Muqg",
  authDomain: "biller-91aaf.firebaseapp.com",
  projectId: "biller-91aaf",
  storageBucket: "biller-91aaf.firebasestorage.app",
  messagingSenderId: "1095063549316",
  appId: "1:1095063549316:web:50f46fbf89724e989499d1"
};

// Initialize Firebase (compat) once the SDK is available
function initFirebase(retries = 0) {
  if (typeof window.firebase === "undefined") {
    if (retries > 120) {
      console.warn("Firebase SDK failed to load (offline or blocked). Running in local-only mode.");
      // The shop still has to be able to sell without a connection. The
      // auth gate shows an explicit offline screen instead of silently
      // pretending the user has an account.
      window.localOnlyMode = true;
      startOfflineRetry();
      render();
      return;
    }
    setTimeout(() => initFirebase(retries + 1), 50);
    return;
  }
  try {
    window.firebase.initializeApp(firebaseConfig);
    window.firebaseAuth = window.firebase.auth();
    window.Till?.cloud?.init?.();
    // The SDK is up: this device is no longer local-only.
    window.localOnlyMode = false;
    setupAuthObserver();
  } catch (e) {
    console.warn("Firebase init error:", e);
    window.localOnlyMode = true;
    startOfflineRetry();
    render();
  }
}

// --- Auth observer ---
function setupAuthObserver() {
  try {
    window.firebaseAuth.onAuthStateChanged((user) => {
      try {
        // `T` is not a global here — the core exposes itself as window.Till.
        const T = window.Till;
        if (user) {
          localStorage.setItem("biller.pos.auth", JSON.stringify({ email: user.email, uid: user.uid, at: new Date().toISOString() }));
          T.sheets?.close?.(true);
          // Each account gets its own till, so switch the shop over first.
          T.activateAccount?.(user);
          // The cloud copy of this shop belongs to the signed-in account.
          T.cloud?.attach?.(user);
          T.cloud?.onChange?.(() => updateSyncDot());
          T.sheets?.refreshStaffGate?.();
          if (!location.hash || location.hash === "#/auth") {
            // Sell is the home screen of the app.
            goHome();
          }
        } else {
          // No signed-in Firebase user — could be a real sign-out, or just a
          // boot on a flaky connection. Only a device that never signed in
          // gets bounced to the login screen; a device with a saved session
          // keeps it (the local till still works, and the owner keeps the
          // developer panel). Everything that needs the cloud stays gated by
          // Firebase Auth rules either way.
          const hadSession = Boolean(window.Till?.getSession?.()?.email);
          if (hadSession) {
            console.warn("Firebase has no user right now — keeping the saved session and running offline.");
            T.sheets?.close?.(true);
            T.cloud?.detach?.();
          } else {
            localStorage.removeItem("biller.pos.auth");
            T.sheets?.close?.(true);
            T.activateAccount?.(null);
            T.cloud?.detach?.();
            if (location.hash !== "#/auth") {
              replace("#/auth");
            }
          }
          T.sheets?.refreshStaffGate?.();
        }
      } catch (e) { console.warn("Auth observer error:", e); }
      render();
    });
  } catch (e) { console.warn("Auth observer setup error:", e); }
}

// --- Render ---

// Keep asking in the background whether the Firebase SDK became available
// (CDN unblocked later, connection restored, Firebase comes back), so a device
// that started offline is re-connected to sign-in without an app restart.
let offlineRetryTimer = null;
function startOfflineRetry() {
  if (offlineRetryTimer) return;
  offlineRetryTimer = setInterval(() => {
    if (typeof window.firebase === "undefined") return;
    clearInterval(offlineRetryTimer);
    offlineRetryTimer = null;
    initFirebase();
  }, 15000);
}

/** Show/hide the persistent offline banner to match local-only state. */
function updateOfflineBanner() {
  const el = document.getElementById("offline-banner");
  if (el) el.hidden = window.localOnlyMode !== true;
}

/**
 * The screens the shopkeeper stepped through, oldest first, with the screen
 * that is showing last. Back walks this trail, so it retraces the real path
 * instead of jumping to Sell every time.
 */
let navTrail = [];
// The route the viewport last rendered — when it changes, the page starts at
// the top instead of keeping whatever scroll offset the previous page had.
let renderedRouteKey = null;
// Fingerprint of the cloud state at the last render — used to skip no-op
// refreshes when Firestore sends an unchanged snapshot.
let cloudSyncHash = "";

/**
 * Move to another screen.
 *
 * The History API is used on purpose: changing location.hash fires a
 * popstate event too, which would look like a back gesture. pushState
 * leaves the history alone and only a real back press raises popstate.
 *
 * `user` marks a step the shopkeeper clicked; steps the app takes on its own
 * (jumping to a receipt after a sale, for instance) do not add to the trail.
 * `reset` starts the trail again from Sell.
 */
function go(hash, { user = true, reset = false } = {}) {
  if (!hash) return;
  // Leaving a screen cancels any pending demo-card sale.
  if (window.Till) {
    window.Till.ui.cardToken = (window.Till.ui.cardToken || 0) + 1;
    window.Till.ui.cardBusy = false;
  }
  if (location.hash === hash) { render(); return; }
  if (reset) {
    // The sale is done: the receipt sits on top of Sell and nothing else.
    navTrail = ["#/sell", hash];
  } else if (hash === "#/sell") {
    // Sell is home — the trail starts again from here.
    navTrail = ["#/sell"];
  } else if (user) {
    navTrail.push(hash);
  } else if (navTrail.length) {
    navTrail[navTrail.length - 1] = hash;
  } else {
    navTrail = [hash];
  }
  history.pushState(null, "", hash);
  render();
}

/** Change the screen without adding a step to the back history. */
function replace(hash) {
  if (!hash) return;
  if (window.Till) {
    window.Till.ui.cardToken = (window.Till.ui.cardToken || 0) + 1;
    window.Till.ui.cardBusy = false;
  }
  if (location.hash === hash) { render(); return; }
  history.replaceState(null, "", hash);
  navTrail = [hash];
  render();
}

/** Go back to the Sell screen, the home of the app. */
function goHome() {
  if (location.hash !== "#/sell") {
    // Replace instead of push: Sell is home, so it should not pile up
    // duplicate entries in the browser history.
    history.replaceState(null, "", "#/sell");
  }
  navTrail = ["#/sell"];
  render();
}

/** The screen the URL points at right now. */
function routeName() {
  const path = location.hash || "#/sell";
  return path.replace(/^#\/?/, "").split("/")[0];
}

/**
 * The Android back button and the swipe-back gesture land here.
 *
 * Back retraces the path the shopkeeper took: a sheet closes first, then the
 * search bar, then each screen they opened, one by one. Only when Sell — the
 * home screen — is reached does the exit prompt appear.
 */
function handleBack() {
  const T = window.Till;
  if (!T) return "handled";
  // A sheet — discount, category editor, exit prompt — closes first.
  if (T.sheets?.isOpen?.()) {
    T.sheets.close(true);
    return "handled";
  }
  const route = T.ui?.route?.name || routeName();
  // Search mode is a light layer on Sell: back closes it before the exit prompt.
  if (route === "sell" && T.ui?.searchOpen) {
    T.ui.searchOpen = false;
    T.ui.search = "";
    render();
    return "handled";
  }
  // Walk back through the screens that were opened, one step at a time.
  if (navTrail.length > 1) {
    navTrail.pop();
    const target = navTrail[navTrail.length - 1];
    // The trail is the truth for back, so the URL follows it and the screen
    // is repainted from there.
    history.replaceState(null, "", target);
    render();
    return "handled";
  }
  // Nothing left to go back to: only on the home screen, ask before closing.
  T.sheets?.openExitPrompt?.();
  return "handled";
}

/** Ask the native shell to close the app. */
function requestExit() {
  const T = window.Till;
  const plugin = window.Capacitor?.Plugins?.TillExit;
  if (plugin?.exit) {
    try {
      plugin.exit();
      return true;
    } catch (error) {
      console.warn("TillExit plugin failed:", error);
    }
  } else if (window.Capacitor?.nativePromise) {
    try {
      window.Capacitor.nativePromise("TillExit", "exit", {});
      return true;
    } catch (error) {
      console.warn("TillExit nativePromise failed:", error);
    }
  }
  try { window.close(); } catch { /* the browser may refuse to close itself */ }
  T.toast("Close this tab to leave Biller POS", "i-info");
  return false;
}

/** Make every [data-nav] button inside a root jump to its route. */
function wireNav(root) {
  if (!root) return;
  root.querySelectorAll("[data-nav]").forEach(btn => {
    if (btn.dataset.wired === "nav") return;
    btn.dataset.wired = "nav";
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      const T = window.Till;
      let target = btn.dataset.nav;
      if (!target) return;
      // Unpaid shops can only move between the pay/verify screens — every
      // other link lands on the "Your plan is due" page.
      if (T.subscriptionLocked?.()) {
        const route = String(target).replace(/^#\/?/, "").split("/")[0];
        if (!["sell", "more", "account", "auth"].includes(route)) {
          target = "#/sell";
        }
      }
      go(target);
    });
  });
}

/**
 * Make every [data-act] button inside a root run its action. Sheets are
 * rendered into #layers, outside the viewport, so both roots need wiring.
 */
function wireActions(root) {
  if (!root) return;
  root.querySelectorAll("[data-act]").forEach(btn => {
    if (btn.dataset.wired === "act") return;
    btn.dataset.wired = "act";
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      runAction(btn);
    });
  });
}

/**
 * Build the receipt PNG for a sale.
 *
 * The receipt is drawn on a canvas, so it comes back as a data URL. From that
 * we make the two things the share and download paths need: the Base64 string
 * the Android bridge wants, and a real File, so the browser can share the
 * image itself instead of the text of the receipt.
 */
async function buildReceiptFile(tx) {
  const T = window.Till;
  let dataUrl = "";
  try {
    dataUrl = T.screens?.receiptImage ? await T.screens.receiptImage(tx) : "";
  } catch (error) {
    console.warn("Could not draw the receipt", error);
  }
  const base64 = String(dataUrl || "").split(",")[1] || "";
  const fileName = `biller-receipt-${tx.receiptNo || "receipt"}.png`;
  let blob = null;
  let file = null;
  try {
    if (dataUrl) {
      const response = await fetch(dataUrl);
      blob = await response.blob();
      file = new File([blob], fileName, { type: "image/png" });
    }
  } catch (error) {
    console.warn("Could not build the receipt file", error);
  }
  return { dataUrl, base64, blob, file, fileName };
}

/** Send the receipt to the customer (WhatsApp, SMS, anything). */
async function shareReceipt(id) {
  const T = window.Till;
  const tx = T.state.transactions.find((t) => t.id === id);
  if (!tx) return;
  const text = T.screens.receiptText ? T.screens.receiptText(tx) : "";
  const file = await buildReceiptFile(tx);
  const native = window.Capacitor?.Plugins?.TillReceipt;

  // Android: the native bridge saves the PNG into the app's receipts folder
  // and hands it to the share sheet through the FileProvider.
  if (native?.shareImage && file.base64) {
    try {
      const shared = await native.shareImage({
        image: file.base64,
        fileName: file.fileName,
        text,
        title: `Receipt ${tx.receiptNo}`
      });
      if (shared?.ok) return;
    } catch (error) {
      console.warn("The native receipt share failed", error);
    }
  }

  // Browser: hand over the picture itself, so the customer gets the receipt
  // and not a wall of text.
  if (file.file && navigator.canShare?.({ files: [file.file] })) {
    try {
      await navigator.share({ title: `Receipt ${tx.receiptNo}`, text, files: [file.file] });
      return;
    } catch (error) {
      if (String(error?.name || "").toLowerCase() === "aborterror") return;
    }
  }

  // Last resort: the details as plain text, so the customer still gets them.
  try {
    const plugin = window.Capacitor?.Plugins?.Share;
    if (plugin?.share) {
      await plugin.share({ title: `Receipt ${tx.receiptNo}`, text, dialogTitle: "Send the receipt" });
      return;
    }
    if (navigator.share) {
      await navigator.share({ title: `Receipt ${tx.receiptNo}`, text });
      return;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      T.toast("Receipt copied to the clipboard", "i-check");
      return;
    }
    T.toast("Sharing is not available on this device", "i-alert");
  } catch (error) {
    // A cancelled share is not an error worth shouting about.
    if (String(error?.name || "").toLowerCase() === "aborterror") return;
    T.toast("Could not share the receipt", "i-alert");
  }
}

/** Save the receipt PNG into the device's downloads area. */
async function downloadReceipt(id) {
  const T = window.Till;
  const tx = T.state.transactions.find((t) => t.id === id);
  if (!tx) return false;
  const file = await buildReceiptFile(tx);
  const native = window.Capacitor?.Plugins?.TillReceipt;
  if (native?.saveImage && file.base64) {
    try {
      const saved = await native.saveImage({ image: file.base64, fileName: file.fileName });
      if (saved?.ok) {
        T.toast("Receipt saved to your downloads", "i-check");
        return true;
      }
    } catch (error) {
      console.warn("The native receipt save failed", error);
    }
  }
  if (!file.dataUrl) {
    T.toast("Could not build the receipt image", "i-alert");
    return false;
  }
  // A blob URL downloads the picture itself; the data URL is the fallback.
  const url = file.blob ? URL.createObjectURL(file.blob) : file.dataUrl;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  if (file.blob) setTimeout(() => URL.revokeObjectURL(url), 5000);
  T.toast("Receipt saved", "i-check");
  return true;
}

/** Turn the plan reminders on. */
/** Show whether the phone reminders are on, and offer to turn them on. */
async function updateReminderRow() {
  const T = window.Till;
  const status = document.getElementById("notify-status");
  const on = document.getElementById("notify-on");
  const test = document.getElementById("notify-test");
  if (!status || !T?.notify) return;
  const allowed = await T.notify.granted?.();
  const plan = T.planSummary?.() || {};
  const amount = T.money(plan.amountCents || 0);
  status.textContent = allowed
    ? "On - we warn you three days before the plan is due."
    : "Off - turn them on and we will warn you before the plan is due.";
  if (on) on.textContent = allowed ? "Turn off" : "Turn on";
  if (on) {
    on.dataset.act = allowed ? "notify-off" : "notify-request";
  }
  if (test) test.hidden = !allowed;
}

async function requestReminders() {
  const T = window.Till;
  const ok = await T.notify?.request?.();
  if (ok) {
    T.toast("Reminders are on", "i-check");
    await T.notify?.syncPlan?.();
  } else {
    T.toast("Turn on notifications in your phone settings", "i-alert");
  }
  render();
}

/** A notification to prove they arrive. */
async function testReminder() {
  const T = window.Till;
  const ok = await T.notify?.show?.({
    id: T.notify?.ids?.test || 9009,
    title: "Biller POS reminders are on",
    body: "This is how we will warn you before the plan is due."
  });
  T.toast(ok ? "Test notification sent" : "Turn on notifications first", ok ? "i-check" : "i-alert");
}

/** Turn the plan reminders off. */
async function turnRemindersOff() {
  const T = window.Till;
  for (const key of Object.keys(T.notify?.ids || {})) {
    await T.notify?.cancel?.(T.notify.ids[key]);
  }
  try {
    localStorage.setItem("biller.pos.reminders", "off");
  } catch { /* ignore */ }
  T.toast("Reminders are off", "i-info");
  render();
}

async function confirmShopPayment(id) {
  const T = window.Till;
  const result = await T.cloud?.confirmPayment?.(id);
  T.toast(result?.ok ? "Payment confirmed. The shop unlocks now." : result?.error || "Could not confirm", result?.ok ? "i-check" : "i-alert");
  render();
}

/** The developer deletes an account. */
async function deleteShopAccount(id) {
  const T = window.Till;
  if (!confirm("Delete this shop account? This cannot be undone.")) return;
  const result = await T.cloud?.deleteAccount?.(id);
  T.toast(result?.ok ? "Account deleted." : result?.error || "Could not delete", result?.ok ? "i-check" : "i-alert");
  render();
}



/** The signed-in shop deletes itself — this till and its cloud copy. */
async function confirmDeleteThisAccount() {
  const T = window.Till;
  const session = T.getSession?.() || {};
  const uid = String(session.uid || "").trim();
  const email = String(session.email || "").trim();
  const password = String(document.getElementById("confirm-delete-password")?.value || "");
  const button = document.getElementById("confirm-delete-btn");
  const errorEl = document.getElementById("delete-account-error");
  const sayError = (message) => {
    if (errorEl) {
      errorEl.textContent = message || "";
      errorEl.classList.toggle("show", Boolean(message));
    }
  };
  const setBusy = (busy) => {
    if (!button) return;
    if (busy) {
      button.disabled = true;
      button.textContent = "Deleting…";
    } else {
      const typed = String(document.getElementById("confirm-delete-account")?.value || "").trim().toUpperCase() === "DELETE";
      button.disabled = !(typed && String(document.getElementById("confirm-delete-password")?.value || "").length > 0);
      button.textContent = "Delete this account";
    }
  };
  if (!email || !password) { sayError("Enter your password — Firebase will not delete without it."); return; }
  setBusy(true);
  // Prove it is you before anything else: a wrong password aborts everything,
  // no shop is touched and nothing is wiped.
  try {
    const auth = window.firebase?.auth?.();
    const user = auth?.currentUser;
    if (!user) throw { code: "auth/user-not-found" };
    const credential = window.firebase.auth.EmailAuthProvider.credential(email, password);
    await user.reauthenticateWithCredential(credential);
  } catch (error) {
    const code = String(error?.code || "");
    sayError(
      code === "auth/wrong-password" || code === "auth/invalid-credential" || code === "auth/invalid-login-credentials"
        ? "That password is not correct. Nothing has been deleted."
        : "Could not verify your sign-in — check your password and your connection. Nothing has been deleted."
    );
    setBusy(false);
    return;
  }
  // 1) Delete the shop's Firestore documents — best-effort, kept separate so
  //    one failure never stops the rest.
  try {
    const fs = window.firebase?.firestore?.();
    if (fs && uid) {
      try { await fs.collection("billerShops").doc(uid).delete(); } catch {}
      try { await fs.collection("billerPayments").doc(uid).delete(); } catch {}
      try { await fs.collection("billerPresence").doc(uid).delete(); } catch {}
      try {
        const reads = await fs.collection("billerAnnouncementReads").where("uid", "==", uid).get();
        const deletions = [];
        reads.forEach((doc) => deletions.push(doc.ref.delete()));
        await Promise.allSettled(deletions);
      } catch {}
    }
  } catch {}
  // 2) Delete this account's Auth user — the account ceases to exist.
  let authDeleted = false;
  try {
    const user = window.firebase?.auth?.()?.currentUser;
    if (user) { await user.delete(); authDeleted = true; }
  } catch {}
  // 3) Wipe every local artefact this app has ever written on this device.
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    for (const key of keys) if (key && key.startsWith("biller.pos")) localStorage.removeItem(key);
  } catch {}
  try { await window.firebase?.auth?.()?.signOut?.(); } catch {}
  try { await T.cloud?.detach?.(); } catch {}
  if (!authDeleted) {
    T.sheets?.confirm?.({
      title: "Cloud wiped, sign-in user remains",
      message: "Your shop, plan, staff and every setting are gone from Firestore and from this device. Firebase refused to delete the sign-in account itself (a server-side error) — remove it in the Firebase console under Authentication → Users, or try again later.",
      confirmLabel: "Got it — reload",
      danger: true,
      onConfirm: () => location.reload()
    });
    return;
  }
  location.hash = "#/auth";
  location.reload();
}

/** The developer marks a request as not paid. */
async function declineShopPayment(id) {
  const T = window.Till;
  const result = await T.cloud?.declinePayment?.(id);
  T.toast(result?.ok ? "Marked as not paid" : result?.error || "Could not update", result?.ok ? "i-info" : "i-alert");
  render();
}

/** The developer takes back a confirmation: the shop goes back to unpaid. */
async function revertShopPayment(id) {
  const T = window.Till;
  if (!confirm("Revert this shop to unpaid? On their next sync the plan is wiped back and they will have to pay again.")) return;
  const result = await T.cloud?.revertPayment?.(id);
  T.toast(result?.ok ? "Reverted to unpaid. The shop will lock on their next sync." : result?.error || "Could not revert", result?.ok ? "i-check" : "i-alert");
  render();
}

/** Copy a shop's code so the developer can read it out over the phone. */
async function copyShopCode(btn) {
  const T = window.Till;
  const code = String(btn?.dataset?.code || T.shopCode()).trim();
  try {
    await navigator.clipboard?.writeText?.(code);
    T.toast("Copied " + code, "i-check");
  } catch {
    T.toast("Shop code: " + code, "i-info");
  }
}

/** Copy any text a button carries in its data attribute (the M-Pesa number). */
async function copyPlainValue(value) {
  const T = window.Till;
  const text = String(value || "").trim();
  if (!text) return;
  try {
    await navigator.clipboard?.writeText?.(text);
    T.toast("Copied " + text, "i-check");
  } catch {
    T.toast(text, "i-info");
  }
}

// Popup shown when a till restricted to one payment mode tries to take another.
function blockedDebtNotice() {
  const T = window.Till;
  T.sheets?.openInfo?.({
    title: "No debt allowed",
    message: "This till is not allowed to sell on credit. Change this in Settings → Security → No debt allowed.",
    iconName: "i-lock",
    tone: "warn"
  });
}

function blockedPaymentNotice(method) {
  const T = window.Till;
  const label = method === "mpesa" ? "M-Pesa" : method === "card" ? "card" : "cash";
  T.sheets?.openInfo?.({
    title: "Payments restricted",
    message: `Only ${label} payments are allowed. Change this in Settings → Security → Checkout payment mode.`,
    iconName: "i-lock",
    tone: "warn"
  });
}

// opts.pinVerified is set only by the PIN sheet's onSuccess — one pass
// through verified. Every fresh user tap asks for the PIN again.
function runAction(btn, opts = {}) {
  const T = window.Till;
  if (!T) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id;
  const value = btn.dataset.value;
  // The account's shop is still on its way from the cloud. Never offer a
  // blank setup in its place — that is how a second phone used to wipe the
  // shop. The waiting sheet explains, retries, and offers an explicit "new
  // shop" path only when the cloud is known to be empty.
  const CLOUD_WAIT_ALLOW = new Set([
    "cloud-wait-retry", "cloud-wait-setup",
    "first-run-add-keeper", "first-run-save-shop", "first-run-save-mpesa", "first-run-skip-mpesa",
    "sign-out", "continue-offline", "retry-connection", "close-sheet", "exit-app",
    "pay-subscription", "subscription-sent", "open-subscription", "open-date-settings",
    "open-developer-chat", "copy-value", "cloud-sync", "refresh-data",
    "mpesa-send", "mpesa-cancel", "mpesa-test", "mpesa-demo", "mpesa-test-push"
  ]);
  if (T.cloudWaiting?.() && !CLOUD_WAIT_ALLOW.has(act)) {
    T.sheets?.openCloudWaiting?.();
    return;
  }
  // Brand-new till: nothing meaningful has been set up yet. Selling-related
  // taps bounce into the one-time setup sheet; but anything needed to pay
  // the plan or reach the developer still works, so a shop can settle the
  // subscription first and only then run through shop set-up.
  const FIRST_RUN_ALLOW = new Set([
    "first-run-add-keeper", "first-run-save-shop", "first-run-save-mpesa", "first-run-skip-mpesa",
    "sign-out", "continue-offline", "retry-connection", "close-sheet", "exit-app",
    "pay-subscription", "subscription-sent", "open-subscription", "open-date-settings",
    "open-developer-chat", "copy-value", "cloud-sync", "refresh-data",
    "mpesa-send", "mpesa-cancel", "mpesa-test", "mpesa-demo", "mpesa-test-push"
  ]);
  if (T.firstRunNeeded?.() && !FIRST_RUN_ALLOW.has(act)) {
    T.sheets?.openFirstRunGate?.();
    return;
  }
  // Somebody has to ring up the sale. If every shopkeeper name is already
  // selling on another device, nothing in the till works until this device
  // names somebody of its own — the gate is not skippable, it is the till.
  const STAFF_GATE_ALLOW = new Set([
    "add-staff-gate", "pick-staff", "choose-staff",
    "sign-out", "retry-connection", "continue-offline",
    "close-sheet"
  ]);
  if (T.staffBlocked?.() && !STAFF_GATE_ALLOW.has(act)) {
    T.sheets?.openStaffGate?.();
    return;
  }
  // A shop that has not settled its plan can only reach the screens that pay,
  // sync, verify and sign out. Every other action bounces straight back to
  // the "Your plan is due" page.
  if (T.subscriptionLocked?.()) {
    const LOCK_ALLOW = new Set([
      "pay-subscription", "subscription-sent", "cloud-sync", "refresh-data",
      "open-subscription", "open-date-settings", "open-developer-chat",
      "copy-value", "close-sheet", "exit-app", "continue-offline", "retry-connection", "sign-out"
    ]);
    if (!LOCK_ALLOW.has(act)) {
      T.toast("Your plan needs paying first", "i-alert");
      go("#/sell");
      return;
    }
  }
  // Security PIN: edits, deletes and destructive actions ask for the PIN on
  // every tap. Sales keep working — it blocks damage, not business.
  const PIN_GUARDED = new Set([
    "edit-product", "delete-product", "delete-order", "delete-customer",
    "delete-account", "open-delete-account", "confirm-delete-this-account", "delete-supplier", "edit-supplier", "edit-category", "delete-category",
    "add-stock", "stock-dec", "restock-product", "open-wastage", "start-audit",
    "set-payment-mode", "toggle-no-debt", "clear-activity-log",
    "reset-data", "import-data"
  ]);
  if (PIN_GUARDED.has(act) && T.pinEnabled?.() && !opts.pinVerified) {
    T.sheets?.openPinSheet?.({
      caption: "Records are secured — enter the shop PIN to continue.",
      onSuccess: () => runAction(btn, { pinVerified: true })
    });
    return;
  }
  // A shop that has not paid cannot change its shop: no selling, no
  // stock, no suppliers, no customers, no categories. Reading, paying the
  // plan, the appearance and the support chat all stay open, so the shop can
  // always get itself sorted out.
  const LOCKED_ACTIONS = new Set([
    // Selling
    "add-to-cart", "open-cart", "checkout", "complete-cash", "complete-debt",
    "add-to-debt", "inc-item", "dec-item", "reset-line-price", "apply-discount",
    "open-discount", "remove-discount", "set-discount-mode", "clear-cart",
    "mpesa-send", "cash-key", "cash-quick", "start-card",
    // Stock
    "add-stock", "stock-dec", "restock-product",
    // Products
    "new-product", "edit-product", "delete-product", "new-from-search",
    "add-unknown", "open-scanner", "manual-entry", "scan-again", "scan-barcode-field",
    // Suppliers
    "new-supplier", "edit-supplier", "delete-supplier", "supplier-payment", "supplier-bill",
    // Customers and debt
    "customer-payment", "delete-customer",
    // Categories
    "add-category", "edit-category", "delete-category",
    // Weighed selling and the write-off book
    "open-weigh", "open-wastage",
    // The monthly target
    "open-target", "set-target"
  ]);
  if (LOCKED_ACTIONS.has(act) && T.subscriptionLocked?.()) {
    const selling = ["add-to-cart", "open-cart", "checkout", "complete-cash", "complete-debt", "add-to-debt", "mpesa-send", "cash-key", "cash-quick", "start-card"].includes(act);
    T.toast(
      selling
        ? "Your monthly plan needs paying before you can sell"
        : "Your monthly plan needs paying before you can change your shop",
      "i-alert"
    );
    T.ui.openSubscription = true;
    go("#/more");
    return;
  }

  if (act === "open-scanner") {
    T.ui.scanReturn = location.hash || "#/sell";
    // A compact camera window, not a full-screen takeover.
    T.sheets?.openQuickScan?.();
  }
  else if (act === "toggle-search") {
    T.ui.searchOpen = !T.ui.searchOpen;
    if (!T.ui.searchOpen) T.ui.search = "";
    render();
    if (T.ui.searchOpen) {
      requestAnimationFrame(() => {
        document.getElementById("sell-search")?.focus({ preventScroll: true });
      });
    }
  }
  else if (act === "close-quick-scan") {
    T.sheets?.close?.(true);
  }
  else if (act === "close-scan") {
    go(T.ui.scanReturn || "#/sell");
  }
  else if (act === "retry-camera") {
    T.scanner?.start?.();
  }
  else if (act === "manual-entry") {
    T.sheets?.close?.(true);
    T.sheets?.openManual?.({ onClose: () => { render(); } });
  }
  else if (act === "scan-again") {
    T.sheets?.close?.(true);
    T.sheets?.openQuickScan?.();
  }
  else if (act === "add-unknown") {
    const code = btn.dataset.code || "";
    T.sheets?.close?.(true);
    T.sheets?.openProductEditor?.(null, { barcode: code, source: "scan" });
  }
  else if (act === "new-product") {
    T.sheets?.openProductEditor?.(null, { source: "inventory" });
  }
  else if (act === "new-supplier") {
    T.sheets?.openSupplierEditor?.(null);
  }
  else if (act === "edit-supplier" && id) {
    T.sheets?.openSupplierEditor?.(id);
  }
  else if (act === "supplier-payment" && id) {
    T.sheets?.openSupplierPayment?.(id);
  }
  else if (act === "supplier-bill" && id) {
    T.sheets?.openSupplierBill?.(id);
  }
  else if (act === "delete-supplier" && id) {
    const supplier = T.findSupplier?.(id);
    const onDetail = T.ui.route?.name === "supplier" && T.ui.route?.param === id;
    T.sheets?.confirm?.({
      title: "Delete this supplier?",
      message: `${supplier?.name || "This supplier"} and their contact details will be removed. Products and orders are not affected.`,
      confirmLabel: "Delete supplier",
      danger: true,
      onConfirm: () => {
        T.state.suppliers = (T.state.suppliers || []).filter((s) => s.id !== id);
        if (!T.state.suppliers.length) T.ui.supplierSearch = "";
        T.save();
        T.logActivity?.("delete", `Deleted supplier “${supplier?.name || "Unknown"}”`);
        T.toast("Supplier deleted", "i-check");
        if (onDetail) go("#/suppliers");
        else render();
      }
    });
  }
  else if (act === "clear-supplier-search") {
    T.ui.supplierSearch = "";
    render();
    requestAnimationFrame(() => document.getElementById("supplier-search")?.focus({ preventScroll: true }));
  }
  else if (act === "choose-staff") {
    T.sheets?.openStaffPicker?.();
  }
  else if (act === "pick-staff" && value) {
    if (T.staffClaimedBy?.(value)) {
      T.toast(`${value} is already selling on another device`, "i-alert");
      return;
    }
    const name = T.setActiveStaff?.(value) || value;
    // Keep the store's legacy name in step, so Store & receipts shows the
    // same shopkeeper this device is selling as.
    T.state.store.staff = String(name || "").trim();
    T.save();
    T.sheets?.close?.();
    render();
    T.toast(`Selling as ${name}`, "i-check");
  }
  else if (act === "add-staff") {
    const input = document.getElementById("new-staff-name");
    const name = String(input?.value || "").trim();
    if (!name) {
      T.toast("Type a shopkeeper name first", "i-alert");
      input?.focus({ preventScroll: true });
      return;
    }
    const list = T.state.store.staffList || [];
    if (list.some((n) => String(n).trim().toLowerCase() === name.toLowerCase())) {
      T.toast("That name is already in the list", "i-alert");
      return;
    }
    // Keep whatever is typed in the store form before the page re-renders.
    applyStoreForm(T);
    T.state.store.staffList = [...list, name];
    // First shopkeeper on the shop: also make it this device's pick, so the
    // Sell tab and the Store select agree from the start.
    if (!list.length) T.setActiveStaff?.(name);
    if (!String(T.state.store.staff || "").trim()) T.state.store.staff = name;
    T.save();
    render();
    T.toast(`${name} added to shopkeepers`, "i-check");
    requestAnimationFrame(() => document.getElementById("new-staff-name")?.focus({ preventScroll: true }));
  }
  else if (act === "remove-staff" && value) {
    applyStoreForm(T);
    T.state.store.staffList = (T.state.store.staffList || []).filter((n) => String(n).trim() !== value);
    if (String(T.state.store.staff || "").trim() === value) T.state.store.staff = "";
    T.releaseStaff?.(value);
    // If this device was selling as the removed shopkeeper, the fallback
    // name takes over automatically.
    try {
      if (String(localStorage.getItem("biller.pos.staff") || "").trim() === value) {
        localStorage.removeItem("biller.pos.staff");
      }
    } catch { /* ignore */ }
    T.save();
    render();
    T.toast(`${value} removed`, "i-check");
  }
  else if (act === "release-staff" && value) {
    applyStoreForm(T);
    T.releaseStaff?.(value);
    T.save();
    render();
    T.toast(`${value} freed from other device`, "i-check");
  }
  else if (act === "add-staff-gate") {
    // The gate only exists because no free shopkeeper does; a fresh name is
    // free by definition — this device claims it on the spot.
    const input = document.getElementById("gate-staff-name");
    const name = String(input?.value || "").trim().slice(0, 40);
    if (!name) {
      T.toast("Type a shopkeeper name first", "i-alert");
      input?.focus({ preventScroll: true });
      return;
    }
    const list = T.state.store.staffList || [];
    if (list.some((n) => String(n).trim().toLowerCase() === name.toLowerCase())) {
      T.toast("That name is already in the list", "i-alert");
      input?.focus({ preventScroll: true });
      return;
    }
    applyStoreForm(T);
    T.state.store.staffList = [...list, name];
    if (!String(T.state.store.staff || "").trim()) T.state.store.staff = name;
    T.setActiveStaff?.(name);
    T.claimStaff?.(name);
    T.save({ quiet: true });
    T.sheets?.close?.(true);
    render();
    T.toast(`Selling as ${name}`, "i-check");
  }
  else if (act === "first-run-add-keeper") {
    // A brand-new till has absolutely nobody on the roster — this is their
    // one and only shopkeeper until more are added in Settings.
    const input = document.getElementById("first-run-keeper");
    const name = String(input?.value || "").trim().slice(0, 40);
    if (!name) {
      T.toast("Type a shopkeeper name first", "i-alert");
      input?.focus({ preventScroll: true });
      return;
    }
    const list = T.state.store.staffList || [];
    if (list.some((n) => String(n).trim().toLowerCase() === name.toLowerCase())) {
      T.toast("That shopkeeper is already on the list", "i-alert");
      input?.focus({ preventScroll: true });
      return;
    }
    T.state.store.staffList = [...list, name];
    if (!String(T.state.store.staff || "").trim()) T.state.store.staff = name;
    T.setActiveStaff?.(name);
    T.claimStaff?.(name);
    T.save({ quiet: true });
    T.toast(`${name} added as the shopkeeper — now save your shop details`, "i-check");
    T.sheets?.openFirstRunGate?.({ force: true });
  }
  else if (act === "first-run-save-shop") {
    const roster = T.staffRoster ? T.staffRoster() : [];
    if (!roster.length) {
      T.toast("Add a shopkeeper first", "i-alert");
      return;
    }
    const nameInput = document.getElementById("first-run-name");
    const phoneInput = document.getElementById("first-run-phone");
    const addressInput = document.getElementById("first-run-address");
    const name = String(nameInput?.value || "").trim().slice(0, 40);
    const phone = String(phoneInput?.value || "").trim().slice(0, 20);
    const address = String(addressInput?.value || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!name) {
      T.toast("Type the shop name to save", "i-alert");
      nameInput?.focus({ preventScroll: true });
      return;
    }
    T.state.store.name = name;
    T.state.store.phone = phone;
    T.state.store.address = address;
    T.save({ quiet: true });
    // Keep the sheet open and drop focus to the optional M-Pesa step.
    const mpesaName = document.getElementById("first-run-mpesa-paybill") || document.getElementById("first-run-mpesa-till");
    mpesaName?.focus({ preventScroll: true });
    document.querySelector('[data-act="first-run-save-mpesa"]')?.scrollIntoView({ block: "center" });
    T.toast("Shop details saved — add M-Pesa or skip for now", "i-info");
  }
  else if (act === "first-run-save-mpesa") {
    const roster = T.staffRoster ? T.staffRoster() : [];
    if (!roster.length) { T.toast("Add a shopkeeper first", "i-alert"); return; }
    const mode = document.getElementById("first-run-mpesa-mode-till")?.checked ? "till" : "paybill";
    const digits = (id) => String(document.getElementById(id)?.value || "").replace(/\D/g, "").slice(0, 12);
    const paybill = digits("first-run-mpesa-paybill");
    const till = digits("first-run-mpesa-till");
    const account = String(document.getElementById("first-run-mpesa-account")?.value || "").trim().slice(0, 12);
    const consumerKey = String(document.getElementById("first-run-mpesa-consumer-key")?.value || "").trim();
    const consumerSecret = String(document.getElementById("first-run-mpesa-consumer-secret")?.value || "").trim();
    const passkey = String(document.getElementById("first-run-mpesa-passkey")?.value || "").trim();
    const filled = paybill || till || account || consumerKey || consumerSecret || passkey;
    if (filled) {
      T.state.store.mpesa = {
        paybill: mode === "paybill" ? paybill : "",
        till: mode === "till" ? till : "",
        mode,
        account: mode === "paybill" ? account : "",
        environment: "production",
        consumerKey,
        consumerSecret,
        passkey,
        backend: "",
        backendKey: ""
      };
      T.logActivity?.("edit", "M-Pesa production saved at first-run setup");
      T.save({ quiet: true });
    }
    T.sheets?.close?.(true);
    go("#/stock");
    T.toast(filled
      ? "M-Pesa production saved — save your first item to start selling"
      : "Skipped M-Pesa — save your first item to start selling", "i-check");
  }
  else if (act === "first-run-skip-mpesa") {
    T.sheets?.close?.(true);
    go("#/stock");
    T.toast("Skipped M-Pesa — add it any time in Settings → M-Pesa", "i-info");
  }
  else if (act === "set-debt-filter" && value) { T.ui.debtFilter = value; render(); }
  else if (act === "clear-debt-search") {
    T.ui.debtSearch = "";
    render();
    requestAnimationFrame(() => document.getElementById("debt-search")?.focus({ preventScroll: true }));
  }
  else if (act === "add-to-debt") {
    if (T.debtAllowed && !T.debtAllowed()) { blockedDebtNotice(); return; }
    T.sheets?.openDebtCheckout?.();
  }
  else if (act === "toggle-no-debt") {
    const next = !(T.debtAllowed ? T.debtAllowed() : true);
    if (T.setDebtAllowed?.(next)) {
      T.toast(next ? "Debt allowed at checkout" : "No debt allowed — ADD TO DEBT is disabled", "i-lock");
      render();
    }
  }
  else if (act === "customer-payment" && id) {
    T.sheets?.openCustomerPayment?.(id);
  }
  else if (act === "delete-customer" && id) {
    const customer = T.findCustomer?.(id);
    const onDetail = T.ui.route?.name === "debt" && T.ui.route?.param === id;
    T.sheets?.confirm?.({
      title: "Delete this customer?",
      message: `${customer?.name || "This customer"} and their debt account will be removed. Orders and receipts are not affected.`,
      confirmLabel: "Delete customer",
      danger: true,
      onConfirm: () => {
        T.state.customers = (T.state.customers || []).filter((c) => c.id !== id);
        if (!T.state.customers.length) T.ui.debtSearch = "";
        T.save();
        T.logActivity?.("delete", `Deleted customer “${customer?.name || "Unknown"}”`);
        T.toast("Customer deleted", "i-check");
        if (onDetail) go("#/debt");
        else render();
      }
    });
  }
  else if (act === "view-debt") {
    const target = id ? `#/debt/${id}` : "#/debt";
    if (id) T.ui.debtFilter = "due";
    T.sheets?.close(true);
    go(target);
  }
  else if (act === "new-from-search") {
    T.sheets?.openProductEditor?.(null, { source: "inventory" });
  }
  else if (act === "edit-product" && id) {
    T.sheets?.openProductEditor?.(id, { source: "inventory" });
  }
  else if (act === "delete-order" && id) {
    T.sheets?.confirm?.({
      title: "Delete this order?",
      message: "The receipt is removed and every unit goes back on the shelf. A credit linked to this sale is also cleared. This cannot be undone.",
      confirmLabel: "Delete order",
      danger: true,
      onConfirm: () => {
        const result = T.deleteOrder(id);
        if (!result.ok) { T.toast(result.error, "i-alert"); render(); return; }
        T.toast("Order deleted", "i-check");
        go("#/orders");
      }
    });
  }
  else if (act === "delete-product" && id) {
    T.sheets?.confirm?.({
      title: "Delete this product?",
      message: "It will be removed from your catalog and from any open sale.",
      confirmLabel: "Delete product",
      danger: true,
      onConfirm: () => {
        const deleted = T.state.products.find((p) => p.id === id);
        T.state.products = T.state.products.filter((p) => p.id !== id);
        T.state.cart.items = T.state.cart.items.filter((i) => i.productId !== id);
        T.save();
        T.logActivity?.("delete", `Deleted product “${deleted?.name || "Unknown"}”`);
        T.toast("Product deleted", "i-check");
        render();
      }
    });
  }
  else if (act === "restock-product" && id) {
    T.sheets?.close?.(true);
    T.sheets?.openProductEditor?.(id, { source: "inventory" });
  }
  else if (act === "scan-barcode-field") {
    // The camera opens as a small window under the field. The entry form
    // stays exactly where it is, so nothing already typed gets lost.
    T.sheets?.openMiniScan?.();
  }
  else if (act === "close-mini-scan") {
    T.sheets?.closeMiniScan?.();
  }
  else if (act === "close-sheet") {
    T.sheets?.close?.();
  }
  else if (act === "set-pin") { T.sheets?.openPinSheet?.({ mode: "set", onSuccess: () => { T.toast("PIN set", "i-lock"); render(); } }); }
  else if (act === "change-pin") { T.sheets?.openPinSheet?.({ mode: "change", onSuccess: () => { T.toast("PIN changed", "i-lock"); render(); } }); }
  else if (act === "remove-pin") { T.sheets?.openPinSheet?.({ mode: "remove", onSuccess: () => { T.toast("PIN removed", "i-info"); render(); } }); }
  else if (act === "unlock-audit") { T.sheets?.openPinSheet?.({ caption: "Audit report is protected — enter the shop PIN to continue.", onSuccess: () => { T.ui.auditUnlocked = true; render(); } }); }
  else if (act === "unlock-mpesa") { T.sheets?.openPinSheet?.({ caption: "M-Pesa settings are protected — enter the shop PIN to continue.", onSuccess: () => { T.ui.mpesaUnlocked = true; render(); } }); }
  else if (act === "clear-activity-log") {
    T.clearActivityLog?.();
    T.toast("History cleared", "i-trash");
    render();
  }
  else if (act === "send-announcement") {
    if (!T.isDeveloperAccount?.()) { T.toast("Only the developer account can send announcements", "i-alert"); return; }
    const titleEl = document.getElementById("announce-title");
    const bodyEl = document.getElementById("announce-body");
    const errorEl = document.getElementById("announce-error");
    const fail = (msg) => { if (errorEl) { errorEl.textContent = msg; errorEl.hidden = false; } };
    if (errorEl) errorEl.hidden = true;
    const send = T.cloud?.sendAnnouncement?.bind(T.cloud);
    if (!send) { const message = "Not connected to the cloud. Open the app while online and sign in — then try again."; fail(message); T.toast(message, "i-alert"); return; }
    send(titleEl?.value, bodyEl?.value).then((result) => {
      if (!result?.ok) {
        const message = result?.error || "Could not send the announcement.";
        fail(message);
        T.toast(message, "i-alert");
        return;
      }
      if (titleEl) titleEl.value = "";
      if (bodyEl) bodyEl.value = "";
      T.toast("Announcement sent to every shop", "i-bell");
      render();
    });
  }
  else if (act === "delete-announcement" && id) {
    if (!T.isDeveloperAccount?.()) { T.toast("Only the developer account can delete announcements", "i-alert"); return; }
    T.sheets?.confirm?.({
      title: "Delete this announcement?",
      message: "It disappears from every shop's Announcements page. Shops that already opened it keep their receipt.",
      confirmLabel: "Delete announcement",
      danger: true,
      onConfirm: () => { T.cloud?.deleteAnnouncement?.(id)?.then(() => render()); }
    });
  }
  else if (act === "toggle-announce-reads" && value) {
    T.ui.announcementOpen = T.ui.announcementOpen || {};
    T.ui.announcementOpen[value] = !T.ui.announcementOpen[value];
    if (T.ui.announcementOpen[value]) {
      T.ui.announcementReads = T.ui.announcementReads || {};
      if (!Object.prototype.hasOwnProperty.call(T.ui.announcementReads, value)) {
        T.ui.announcementReads[value] = null; // loading
        T.cloud?.announcementReaders?.(value)?.then((result) => {
          T.ui.announcementReads[value] = result?.ok ? result.readers : [];
          render();
        });
      }
    }
    render();
  }
  else if (act === "confirm-sheet") {
    T.sheets?.runConfirm?.();
  }
  else if (act === "open-discount") {
    T.sheets?.openDiscount?.();
  }
  else if (act === "set-discount-mode" && value) {
    T.sheets?.setDiscountMode?.(value);
  }
  else if (act === "apply-discount") {
    const type = btn.dataset.type || "percent";
    const amount = Number(btn.dataset.value || 0);
    T.state.cart.discount = { type, value: amount };
    T.save();
    T.sheets?.close?.(true);
    T.toast(`${type === "percent" ? amount + "%" : T.money(amount)} discount applied`, "i-tag");
    render();
  }
  else if (act === "remove-discount") {
    T.state.cart.discount = null;
    T.save();
    T.sheets?.close?.(true);
    render();
  }
  else if (act === "new-sale") { T.ui.justPaidId = null; go("#/sell"); }
  else if (act === "clear-cart") {
    T.sheets?.confirm?.({
      title: "Clear this sale?",
      message: "The items and the discount are removed from the current sale.",
      confirmLabel: "Clear sale",
      danger: true,
      onConfirm: () => {
        T.state.cart.items = [];
        T.state.cart.discount = null;
        T.save();
        go("#/sell");
        T.toast("Sale cleared", "i-check");
      }
    });
  }
  else if (act === "open-cart") {
    if (!T.itemCount()) {
      T.toast("Your cart is empty — add an item to start a sale", "i-bag");
      return;
    }
    go("#/cart");
  }
  else if (act === "checkout") { go("#/payment"); }
  else if (act === "add-to-cart" && id) {
    const product = T.findProduct(id);
    // Before the very first item of a sale can be added: the owner needs the
    // shop details saved and at least one shopkeeper on the roster.
    if (!T.itemCount()) {
      const needsStaff = !(T.staffRoster ? T.staffRoster() : []).length;
      const needsStore = !(T.state.store.name || "").trim();
      if (needsStaff || needsStore) {
        T.toast(
          needsStaff && needsStore
            ? "Add a shopkeeper and save the shop details before your first sale"
            : needsStaff ? "Add a shopkeeper before your first sale" : "Save the shop details before your first sale",
          "i-alert"
        );
        if (needsStaff || needsStore) go("#/store");
        return;
      }
    }
    // Variants choose before anything else (e.g. 500 ml vs 1 L), they work
    // for single items and bundles alike. Tapping an item with variants
    // always opens the picker so the shopkeeper picks what to sell.
    if ((product?.variants || []).length) {
      T.sheets?.openVariantPicker?.(product);
      return;
    }
    // Weight is measured on the scale, like a pack is picked by piece.
    if (product?.soldByMass || product?.soldBy === "mass") {
      T.sheets?.openWeigh?.(product);
      return;
    }
    // A bundle (dozen / crate / pack) counts by pieces at the sale, the
    // shopkeeper picks how many, just like reading the scale for weight.
    if (typeof T.isBundle === "function" && T.isBundle(product)) {
      T.sheets?.openPackPicker?.(product);
      return;
    }
    if (T.addToCart(product, 1)) resetSellSearch();
  }
  else if (act === "pick-variant-qty" && id) {
    const product = T.findProduct(id);
    const variantId = btn.dataset.variant || null;
    const variant = product ? T.findVariant(product, variantId) : null;
    if (!product || !variant) { T.toast("That variant is no longer available", "i-alert"); T.sheets?.close?.(true); return; }
    const unit = T.stockCountUnit(product);
    const scope = btn.closest?.(".variant-pick-qty");
    const typed = scope?.querySelector(".step-input");
    const pieces = Math.max(1, Math.min(999999, Math.floor(Number(typed?.value) || 1)));
    const ok = T.addToCart(product, pieces, variant.id);
    if (ok) T.toast(`${product.name} · ${variant.label} — ${pieces} ${unit} added`, "i-check");
    resetSellSearch();
  }
  else if (act === "pick-parent-qty" && id) {
    const product = T.findProduct(id);
    if (!product || product.sellParent !== true) return;
    const unit = T.stockCountUnit(product);
    const scope = btn.closest?.(".variant-pick-qty");
    const typed = scope?.querySelector(".step-input");
    const pieces = Math.max(1, Math.min(999999, Math.floor(Number(typed?.value) || 1)));
    const ok = T.addToCart(product, pieces);
    if (ok) T.toast(`${product.name} — ${pieces} ${unit} added`, "i-check");
    resetSellSearch();
  }
  else if (act === "step-qty") {
    const scope = btn.closest?.(".variant-pick-qty");
    const input = scope?.querySelector(".step-input");
    if (!input) return;
    const max = Number(input.dataset.max) || 999999;
    const current = Math.max(1, Math.floor(Number(input.value) || 1));
    const next = Math.max(1, Math.min(max, current + (Number(btn.dataset.delta) || 0)));
    input.value = String(next);
    const addBtn = scope?.querySelector(".step-add");
    if (addBtn) addBtn.textContent = `Add ${next}`;
  }
  else if (act === "pick-variant" && id && btn.dataset.variant) {
    const product = T.findProduct(id);
    const variant = product ? T.findVariant(product, btn.dataset.variant) : null;
    if (!product || !variant) { T.toast("That variant is no longer available", "i-alert"); T.sheets?.close?.(true); return; }
    if (T.addToCart(product, 1, variant.id)) T.toast(`${product.name} · ${variant.label} added`, "i-check");
    resetSellSearch();
  }
  else if (act === "open-weigh" && id) {
    const variantId = btn.dataset.variant || null;
    const product = T.findProduct(id);
    if (product?.soldByMass) T.sheets?.openWeigh?.(product, { editLine: btn.dataset.edit === "1", editVariant: variantId });
  }
  else if (act === "dec-item" && id) {
    const variantId = btn.dataset.variant || null;
    const item = T.state.cart.items.find(i => i.productId === id && String(i.variantId || "") === String(variantId || ""));
    if (!item) return;
    const product = T.state.products.find(p => p.id === id);
    if (product?.soldByMass) {
      // Weighed lines move in grams: 100 g at a time, gone at nothing.
      item.qty = Math.max(0, item.qty - 100);
      if (item.qty <= 0) T.state.cart.items = T.state.cart.items.filter(i => !(i.productId === id && String(i.variantId || "") === String(variantId || "")));
    } else {
      item.qty--;
      if (item.qty <= 0) T.state.cart.items = T.state.cart.items.filter(i => !(i.productId === id && String(i.variantId || "") === String(variantId || "")));
    }
    T.save();
    render();
  }
  else if (act === "inc-item" && id) {
    const variantId = btn.dataset.variant || null;
    const product = T.state.products.find(p => p.id === id);
    const item = T.state.cart.items.find(i => i.productId === id && String(i.variantId || "") === String(variantId || ""));
    if (!item || !product) return;
    if (product.soldByMass) {
      const wanted = item.qty + 100;
      if (wanted <= product.stock) { item.qty = wanted; T.save(); render(); }
    } else if (item.qty < T.lineStock(product, variantId)) {
      item.qty++;
      T.save();
      render();
    }
  }
  else if (act === "complete-cash") {
    if (T.paymentAllows && !T.paymentAllows("cash")) { blockedPaymentNotice("cash"); return; }
    // The keypad types whole shillings, while every amount inside the app is
    // stored in cents.
    const tendered = Math.round((Number(T.ui.cash) || 0) * 100);
    const tx = T.completeSale({ method: "cash", tendered });
    if (!tx) { T.toast("There is nothing to sell", "i-alert"); return; }
    T.ui.cash = "";
    T.ui.justPaidId = tx.id;
    // The app jumps to the receipt on its own, so it is not a step the
    // shopkeeper clicked: back from the receipt goes to Sell.
    go(`#/receipt/${tx.id}`, { user: false, reset: true });
  }
  else if (act === "start-card") {
    if (T.paymentAllows && !T.paymentAllows("card")) { blockedPaymentNotice("card"); return; }
    const token = (T.ui.cardToken || 0) + 1;
    T.ui.cardToken = token;
    T.ui.cardBusy = true; render();
    setTimeout(() => {
      // The cashier may have left the payment screen while the reader was
      // "processing". Never complete a sale from a screen they abandoned.
      if (T.ui.cardToken !== token) return;
      if (T.ui.route?.name !== "payment") {
        T.ui.cardBusy = false;
        render();
        return;
      }
      T.ui.cardBusy = false;
      const tx = T.completeSale({ method: "card" });
      if (!tx) { go("#/sell"); return; }
      T.ui.justPaidId = tx.id;
      go(`#/receipt/${tx.id}`, { user: false, reset: true });
    }, 2000);
  }
  else if (act === "set-category" && value) { T.ui.category = value; render(); }
  else if (act === "open-sell-sort") {
    T.sheets?.openSellSort?.();
  }
  else if (act === "set-sell-sort" && value) {
    T.sheets?.close?.(true);
    if (T.setSellSort?.(value)) {
      render();
      const label = value === "az" ? "A to Z" : value === "za" ? "Z to A" : "Newest first";
      T.toast(`Sorted: ${label}`, "i-check");
    }
  }
  else if (act === "set-stock-filter" && value) { T.ui.stockFilter = value; render(); }
  else if (act === "set-order-filter" && value) { T.ui.ordersFilter = value; render(); }
  else if (act === "set-payment" && value) {
    const wanted = ["cash", "mpesa", "card"].includes(String(value)) ? String(value) : "cash";
    if (T.paymentAllows && !T.paymentAllows(wanted)) {
      blockedPaymentNotice(wanted);
      return;
    }
    if ((T.ui.mpesa.stage === "sending" || T.ui.mpesa.stage === "waiting") && wanted !== "mpesa") {
      T.toast("Finish or cancel the M-Pesa request first", "i-alert");
      return;
    }
    T.ui.payment = wanted; render();
  }
  else if (act === "set-payment-mode" && value) {
    const mode = String(value || "all").trim().toLowerCase();
    if (!["all", "cash", "mpesa", "card"].includes(mode)) return;
    if (T.setPaymentMode?.(mode)) {
      // Keep the till on a method it is still allowed to take.
      const allowed = ["cash", "mpesa", "card"].filter((m) => T.paymentAllows?.(m));
      if (allowed.length && !T.paymentAllows?.(T.ui.payment)) T.ui.payment = allowed[0];
      const label = mode === "all" ? "all payments" : `${mode === "mpesa" ? "M-Pesa" : mode.charAt(0).toUpperCase() + mode.slice(1)} only`;
      T.toast(`Checkout now allows ${label}`, "i-lock");
      render();
    }
  }
  else if (act === "mpesa-send") {
    if (T.paymentAllows && !T.paymentAllows("mpesa")) { blockedPaymentNotice("mpesa"); return; }
    startMpesaPayment();
  }
  else if (act === "mpesa-cancel") {
    T.mpesa?.cancel?.();
    T.ui.mpesa = { stage: "idle", phone: T.ui.mpesa.phone, account: T.ui.mpesa.account, error: "", checkoutId: "", startedAt: 0 };
    render();
    T.toast("M-Pesa request cancelled", "i-info");
  }
  else if (act === "mpesa-test") { testMpesaConnection(); }
  else if (act === "mpesa-demo") { applyMpesaSandboxDemo(); }
  else if (act === "mpesa-test-push") { testMpesaPush(); }
  else if (act === "confirm-payment" && id) { confirmShopPayment(id); }
  else if (act === "decline-payment" && id) { declineShopPayment(id); }
  else if (act === "revert-payment" && id) { revertShopPayment(id); }
  else if (act === "delete-account" && id) { deleteShopAccount(id); }

  else if (act === "copy-shop-code") { copyShopCode(btn); }
  else if (act === "copy-value" && value) { copyPlainValue(value); }

  else if (act === "notify-request") { requestReminders(); }
  else if (act === "notify-test") { testReminder(); }
  else if (act === "notify-off") { turnRemindersOff(); }

  else if (act === "open-developer-chat") { openDeveloperChat({ code: btn.dataset.code, amountCents: btn.dataset.amount, mpesaCode: btn.dataset.mpesa }); }
  else if (act === "open-date-settings") {
    const cap = window.Capacitor;
    if (cap?.Plugins?.App?.openUrl) {
      cap.Plugins.App.openUrl({ url: "package:com.android.settings" }).catch(() => {
        alert("Please open your device settings -> System -> Date & time and enable 'Automatic Date & Time'.");
      });
    } else {
      alert("Please open your device settings -> System -> Date & time and enable 'Automatic Date & Time'.");
    }
  }
  else if (act === "exit-app") {
    T.sheets?.close?.(true);
    requestExit();
  }
  else if (act === "pay-subscription") { T.sheets?.openSubscriptionPayment?.(); }
  else if (act === "subscription-sent") {
    const ref = btn.dataset.ref || T.subscriptionReference();
    const codeField = document.getElementById("subscription-mpesa-code");
    const mpesaCode = String(codeField?.value || "").trim().toUpperCase();
    if (!mpesaCode) {
      T.toast("Enter the M-Pesa transaction code first", "i-alert");
      try { codeField?.focus({ preventScroll: true }); } catch { /* ignore */ }
      return;
    }
    const submitPayment = () => {
      T.state.store.subscription = { ...(T.state.store.subscription || {}), mpesaCode: mpesaCode || T.state.store.subscription?.mpesaCode || "" };
      T.setSubscriptionAwaiting(ref);
      if (mpesaCode) T.rememberSubscriptionCode?.(mpesaCode);
      T.sheets?.close?.(true);
      T.toast("Thanks - we will switch your plan on once it arrives", "i-check");
      render();
      // Tell the developer so they can confirm it, with the M-Pesa code attached.
      T.cloud?.requestPayment?.(mpesaCode).then((result) => {
        if (!result?.ok) T.toast("We could not reach the developer. Please call us.", "i-alert");
      });
    };
    // One M-Pesa code is one payment. If this code was already sent, the
    // shop is told before it asks the developer to look twice.
    const dup = T.subscriptionCodeSeen?.(mpesaCode);
    if (dup) {
      const when = dup.at ? ` on ${T.shortDateFmt.format(new Date(dup.at))}` : " before";
      T.sheets?.confirm?.({
        title: "This M-Pesa code was already sent",
        message: `You already sent this code to the developer${when}. One code is one payment — check that the money was not sent twice, then continue only if this really is a new payment.`,
        confirmLabel: "Send it anyway",
        danger: true,
        onConfirm: submitPayment
      });
    } else {
      submitPayment();
    }
  }
  else if (act === "open-subscription") {
    T.ui.openSubscription = true;
    go("#/more");
  }
  else if (act === "set-theme" && value) {
    if (T.setTheme(value)) {
      render();
      const name = T.THEMES.find((theme) => theme.id === value)?.name || "New";
      T.toast(`${name} theme applied`, "i-check");
    }
  }
  else if (act === "toggle-settings-group" && value) {
    const groups = T.ui.settingsOpen && typeof T.ui.settingsOpen === "object" ? { ...T.ui.settingsOpen } : {};
    const nextOpen = !groups[value];
    const nextMap = { ...groups };
    if (nextOpen) for (const key of Object.keys(nextMap)) if (key !== value) nextMap[key] = false;
    nextMap[value] = nextOpen;
    T.ui.settingsOpen = nextMap;
    render();
    // The group just expanded below the fold: bring its head and the start of
    // its content onto the screen instead of making the shopkeeper scroll.
    // Re-pin to the target for a short window so Chrome's scroll anchoring
    // (which prefers the old position after the DOM re-render) gets undone.
    if (nextOpen) {
      const start = performance.now();
      const pin = () => {
        const target = document.querySelector(`.settings-group[data-group="${String(value).replace(/[^a-z-]/gi, "")}"]`);
        const v = document.getElementById("viewport");
        if (target && v) {
          const padTop = parseFloat(getComputedStyle(v).paddingTop) || 0;
          const docTop = target.getBoundingClientRect().top - v.getBoundingClientRect().top + v.scrollTop;
          const want = docTop - padTop - 8;
          if (Math.abs(v.scrollTop - want) > 1) v.scrollTo({ top: want, behavior: "instant" });
        }
        if (performance.now() - start < 600) requestAnimationFrame(pin);
      };
      requestAnimationFrame(pin);
    }
  }
  else if (act === "set-text-size" && value) {
    const size = ["small", "medium", "large"].includes(String(value)) ? String(value) : T.textSizeId();
    if (T.setTextSize(size)) {
      render();
      const names = { small: "Small text", medium: "Medium text", large: "Large text" };
      T.toast(`${names[size] || size} applied`, "i-check");
    }
  }
  else if (act === "set-color-scheme" && value) {
    const scheme = value === "dark" ? "dark" : "light";
    if (T.setColorScheme(scheme)) {
      render();
      T.toast(scheme === "dark" ? "Dark theme applied" : "Light theme applied", "i-check");
    }
  }
  else if (act === "clear-search") {
    T.ui.search = "";
    render();
    if (T.ui.searchOpen) requestAnimationFrame(() => document.getElementById("sell-search")?.focus({ preventScroll: true }));
  }
  else if (act === "clear-stock-search") { T.ui.stockSearch = ""; render(); }
  else if (act === "add-category") {
    T.sheets?.openCategoryEditor?.("");
  }
  else if (act === "edit-category" && value) {
    T.sheets?.openCategoryEditor?.(value);
  }
  else if (act === "delete-category" && value) {
    const count = T.countInCategory(value);
    T.sheets?.confirm?.({
      title: `Delete “${value}”?`,
      message: count
        ? `${count} ${count === 1 ? "product is" : "products are"} in this category. ${count === 1 ? "It moves" : "They move"} to another category.`
        : "This category has no products in it.",
      confirmLabel: "Delete category",
      danger: true,
      onConfirm: () => {
        const result = T.removeCategory(value);
        if (!result.ok) { T.toast(result.error, "i-alert"); return; }
        T.toast("Category deleted", "i-check");
        render();
      }
    });
  }
  else if (act === "exit-app") {
    T.sheets?.close?.(true);
    requestExit();
  }
  else if (act === "open-account") {
    T.sheets?.openAccount?.();
  }
  else if (act === "open-account-settings") {
    T.sheets?.close?.(true);
    go("#/account");
  }
  else if (act === "open-auth") {
    // Sign in with a different email — go to the login screen itself.
    T.sheets?.close?.(true);
    go("#/auth");
  }
  else if (act === "cloud-wait-retry") {
    // Ask the server again. A real answer either lands the shop (and the
    // staff gate) or proves the account has no cloud copy yet.
    T.toast("Checking the cloud…", "i-refresh");
    Promise.resolve(T.cloud?.pull?.({ silent: true })).then((result) => {
      if (T.cloudWaiting?.()) {
        T.sheets?.openCloudWaiting?.(); // re-render with the fresh answer
        return;
      }
      T.sheets?.close?.(true);
      render();
      if (T.staffBlocked?.()) {
        T.sheets?.openStaffGate?.();
      } else {
        T.toast(result?.applied ? "Your shop is here — loaded from the cloud" : "Your shop is already on this phone", "i-check");
      }
    });
  }
  else if (act === "cloud-wait-setup") {
    // The shopkeeper confirmed this is a brand-new shop, not a second phone
    // for an existing one. Only now may the blank setup open.
    T.sheets?.openFirstRunGate?.({ force: true });
  }
  else if (act === "continue-offline") {
    // The user chose the offline shop on purpose: this phone keeps the
    // local copy, and the persistent banner on screen keeps saying so.
    window.localOnlyMode = true;
    goHome();
    render();
  }
  else if (act === "retry-connection") {
    // Re-probe the CDN; if Firebase becomes available the retry path in
    // initFirebase will switch the device back to signed-in mode.
    window.localOnlyMode = false;
    location.reload();
  }
  else if (act === "sign-out") {
    // Sign out of Firebase for real, otherwise the auth observer would
    // silently sign the user straight back in.
    T.sheets?.close?.(true);
    T.clearSession();
    // The shop stays safe under the account that owned it.
    T.activateAccount?.(null);
    const goToAuth = () => {
      T.auth?.reset?.();
      replace("#/auth");
    };
    if (window.firebaseAuth?.signOut) {
      window.firebaseAuth.signOut().then(goToAuth, goToAuth);
    } else {
      goToAuth();
    }
  }
  else if (act === "save-info") { T.sheets?.openSaveInfo?.(); }
  else if (act === "open-delete-account") {
    T.sheets?.openDeleteAccount?.();
  }
  else if (act === "confirm-delete-this-account") {
    confirmDeleteThisAccount();
  }
  else if (act === "reset-data") {
    T.sheets?.confirm?.({
      title: "Reset all data?",
      message: "Every product, order and setting is cleared, and the app goes back to an empty shop. This cannot be undone.",
      confirmLabel: "Reset everything",
      danger: true,
      onConfirm: () => {
        // Keep the plan,Appearance, and shopkeeper claims intact — this reset
        // wipes the till, not the subscription the shop already paid for.
        const prevSub = JSON.parse(JSON.stringify(T.state.store.subscription || {}));
        const prevTheme = T.state.store.theme;
        const prevColor = T.state.store.colorScheme;
        const prevText = T.state.store.textSize;
        const prevView = T.state.store.sellView;
        const prevSort = T.state.store.sellSort;
        const prevCode = T.state.store.shopCode;
        T.state = T.seedState();
        T.state.store.subscription = prevSub;
        T.state.store.theme = prevTheme;
        T.state.store.colorScheme = prevColor;
        T.state.store.textSize = prevText;
        T.state.store.sellView = prevView;
        T.state.store.sellSort = prevSort;
        T.state.store.shopCode = prevCode;
        T.save({ quiet: true, force: true });
        T.logActivity?.("reset", "All data reset — shop kept plans, theme and shopCode");
        T.ui.category = "All";
        T.ui.search = "";
        T.ui.stockSearch = "";
        T.ui.justPaidId = null;
        go("#/sell");
        T.toast("Everything cleared", "i-check");
      }
    });
  }
  else if (act === "export-data") {
    T.saveFile("biller-backup.json", JSON.stringify(T.state, null, 2), "application/json")
      .then((result) => announceCsv(result, "Backup"));
  }
  else if (act === "import-data") {
    T.sheets?.confirm?.({
      title: "Restore from backup?",
      message: "Every product, order and setting on this phone is replaced by the backup file you pick. Current data is overwritten.",
      confirmLabel: "Choose file",
      danger: true,
      onConfirm: () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.onchange = (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (evt) => {
            try {
              const data = JSON.parse(evt.target.result);
              T.state = T.normalizeState ? T.normalizeState(data) : data;
              T.save({ quiet: true });
              T.logActivity?.("reset", "Restored from a backup file");
              render();
              T.toast("Restored from backup successfully", "i-check");
            } catch (err) {
              T.toast("Could not read backup file: " + err.message, "i-alert");
            }
          };
          reader.readAsText(file);
        };
        input.click();
      }
    });
  }
  else if (act === "cloud-sync") {
    const cloud = T.cloud;
    if (!cloud) { T.toast("Cloud sync is not available here", "i-alert"); return; }
    T.toast("Syncing with the cloud…", "i-refresh");
    cloud.pull({ silent: true }).then((result) => {
      if (result?.applied) {
        render();
        T.toast("Updated from the cloud", "i-check");
      } else if (result?.ok) {
        cloud.push({ immediate: true }).then((saved) => {
          render();
          T.toast(saved ? "Shop saved to Firebase" : "Everything is up to date", "i-check");
        });
      } else {
        T.toast("Could not reach the cloud — saved on this device", "i-alert");
      }
    });
  }
  else if (act === "add-mpesa-code" && id) { T.sheets?.openMpesaCode?.(id); }
  else if (act === "stock-dec" && id) {
    const product = T.state.products.find((p) => p.id === id);
    if (product && product.stock > 0) {
      // Weighed stock steps down 100 g at a time; everything else by one.
      product.stock = Math.max(0, product.stock - (product.soldByMass ? 100 : 1));
      T.save();
      render();
    }
  }
  else if (act === "add-stock" && id) {    T.sheets?.openStockIn?.(id);
  }
  else if (act === "open-wastage") { T.sheets?.openWastage?.(); }
  else if (act === "open-target") { T.sheets?.openTarget?.(); }
  else if (act === "refresh-data") {
    Promise.resolve(T.cloud?.refreshNow?.()).then((result) => {
      if (result?.ok) {
        T.toast("Refreshed from the cloud", "i-check");
      } else {
        const live = T.cloud?.status?.().online === true;
        T.toast(live ? "Not refreshed — cloud unreachable" : "Not refreshed — no connection", "i-alert", "bad");
      }
      render();
    });
  }
  else if (act === "open-stock-day" && value) { T.sheets?.openStockDay?.(value); }
  else if (act === "open-stock-days") { T.sheets?.openStockDays?.(); }
  else if (act === "set-mix-period" && value) {
    T.ui.reportMixPeriod = ["today", "week", "month", "all"].includes(value) ? value : "today";
    render();
  }
  else if (act === "set-top-period" && value) {
    T.ui.topSellersPeriod = value === "30" ? "30" : "7";
    render();
  }
  else if (act === "set-seller-period" && value) {
    T.ui.sellerPeriod = value === "30" ? "30" : "7";
    render();
  }
  else if (act === "set-wastage-period" && value) {
    T.ui.wastagePeriod = ["7", "30", "all"].includes(value) ? value : "30";
    render();
  }
  else if (act === "start-audit") {
    T.ui.auditInProgress = true;
    T.ui.auditChecks = {};
    (T.state.products || []).forEach((p) => { T.ui.auditChecks[p.id] = false; });
    render();
  }
  else if (act === "toggle-audit-mark" && id) {
    if (!T.ui.auditChecks) T.ui.auditChecks = {};
    T.ui.auditChecks[id] = T.ui.auditChecks[id] === true ? false : true;
    render();
  }
  else if (act === "submit-audit") {
    const products = T.state.products || [];
    const checks = T.ui.auditChecks || {};
    let unchecked = 0;
    const items = products.map((p) => {
      const match = checks[p.id] === true;
      if (!match) unchecked++;
      return { productId: p.id, name: p.name, recorded: p.stock, actual: p.stock, match };
    });
    const passed = unchecked === 0;
    T.state.audits = T.state.audits || [];
    T.state.audits.push({
      id: "audit_" + Date.now(),
      at: new Date().toISOString(),
      passed,
      mismatches: unchecked,
      items,
      note: ""
    });
    T.save();
    T.ui.auditInProgress = false;
    T.ui.auditChecks = {};
    T.toast(passed ? "Audit passed" : `Audit failed — ${unchecked} unchecked`, passed ? "i-check" : "i-alert", passed ? "" : "bad");
    render();
  }
  else if (act === "cancel-audit") {
    T.ui.auditInProgress = false;
    T.ui.auditChecks = {};
    render();
  }
  else if (act === "export-csv-sales") { exportSalesCsv(); }
  else if (act === "export-csv-items") { exportItemsCsv(); }
  else if (act === "export-csv-wastage") { exportWastageCsv(); }
  else if (act === "reset-line-price" && id) {
    T.setCartPrice?.(id, null, btn.dataset.variant || null);
    T.sheets?.close?.(true);
    T.toast("Back to the set price", "i-check");
    render();
  }
  else if (act === "share-receipt" && id) { shareReceipt(id); }
  else if (act === "download-receipt" && id) { downloadReceipt(id); }
  else if (act === "toggle-torch") { T.scanner?.toggleTorch?.(); }
}

/* ---------- CSV exports ---------- */

/** Tell the shop where the file went, in this app's usual voice. */
function announceCsv(result, what) {
  const T = window.Till;
  if (!result?.ok) {
    T.toast(result?.error || "The file could not be saved on this phone", "i-alert");
    return;
  }
  T.toast(
    result.where === "download" ? `${what} downloading…` : `${what} saved to ${result.where}`,
    "i-check"
  );
}

/** One row per receipt, oldest first — the day book a spreadsheet wants. */
async function exportSalesCsv() {
  const T = window.Till;
  const rows = [["Date", "Receipt", "Method", "Items", "Subtotal", "Discount", "Tax", "Total", "Profit"]];
  for (const tx of [...(T.state.transactions || [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))) {
    rows.push([
      `${T.isoDay(tx.createdAt)} ${T.timeFmt.format(new Date(tx.createdAt))}`,
      tx.receiptNo,
      tx.payment?.method || "",
      (tx.items || []).reduce((n, item) => n + (item.soldByMass ? 1 : item.qty), 0),
      ((tx.subtotal || 0) / 100).toFixed(2),
      ((tx.discountAmount || 0) / 100).toFixed(2),
      ((tx.tax || 0) / 100).toFixed(2),
      ((tx.total || 0) / 100).toFixed(2),
      ((T.txProfit(tx).profit || 0) / 100).toFixed(2)
    ]);
  }
  announceCsv(await T.exportCsv(`biller-sales-${T.isoDay()}.csv`, rows), "Sales report");
}

/** One row per line item sold — what moved off the shelf. */
async function exportItemsCsv() {
  const T = window.Till;
  const rows = [["Date", "Receipt", "Product", "Detail", "Qty", "Unit", "Unit price", "Revenue"]];
  for (const tx of [...(T.state.transactions || [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))) {
    for (const item of tx.items || []) {
      rows.push([
        T.isoDay(tx.createdAt),
        tx.receiptNo,
        item.name || "",
        item.detail || "",
        item.soldByMass ? (item.qty / 1000).toFixed(3) : item.qty,
        item.soldByMass ? "kg" : (item.unit || "pcs"),
        ((item.price || 0) / 100).toFixed(2),
        (T.itemRevenue(item) / 100).toFixed(2)
      ]);
    }
  }
  announceCsv(await T.exportCsv(`biller-items-${T.isoDay()}.csv`, rows), "Sold items");
}

/** One row per wastage record — what left the shelf without a sale. */
async function exportWastageCsv() {
  const T = window.Till;
  const rows = [["Date", "Product", "Qty", "Unit", "Reason", "Recorded by", "Note"]];
  for (const entry of [...(T.state.wastage || [])].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const product = T.findProduct(entry.productId);
    const mass = entry.unit === "kg" && product?.soldByMass;
    rows.push([
      entry.date,
      entry.name,
      mass ? (entry.qty / 1000).toFixed(3) : entry.qty,
      mass ? "kg" : entry.unit,
      entry.reason || "",
      entry.employee || "",
      entry.note || ""
    ]);
  }
  announceCsv(await T.exportCsv(`biller-wastage-${T.isoDay()}.csv`, rows), "Wastage report");
}

/** Read the M-Pesa fields out of the store settings form. */
function readMpesaForm(form) {
  const data = new FormData(form);
  const digits = (value) => String(value || "").replace(/\D/g, "").slice(0, 12);
  const paybill = digits(data.get("mpesaPaybill"));
  const till = digits(data.get("mpesaTill"));
  let mode = data.get("mpesaMode") === "till" ? "till" : "paybill";
  if (mode === "till" && !till && paybill) mode = "paybill";
  if (mode === "paybill" && !paybill && till) mode = "till";
  // Credentials shipped inside the app fill any blank connection field. The
  // sandbox preset is used in sandbox, the top level values in production.
  const bundled = (typeof window !== "undefined" && window.TillDaraja) || {};
  const environment = data.get("mpesaEnv") === "production" ? "production" : "sandbox";
  const preset = environment === "sandbox" ? (bundled.sandbox || {}) : bundled;
  const pick = (value, key) => String(value || preset[key] || "").trim();
  return {
    paybill,
    till,
    mode,
    shortcode: mode === "till" ? till : paybill,
    account: String(data.get("mpesaAccount") || "").trim().slice(0, 12),
    environment,
    consumerKey: pick(data.get("mpesaConsumerKey"), "consumerKey"),
    consumerSecret: pick(data.get("mpesaConsumerSecret"), "consumerSecret"),
    passkey: pick(data.get("mpesaPasskey"), "passkey"),
    backend: String(data.get("mpesaBackend") || bundled.backend || "").trim(),
    backendKey: String(data.get("mpesaBackendKey") || bundled.backendKey || "").trim()
  };
}

/** Grey out the Paybill or Till field that is not in use. */
function syncMpesaModeFields(form) {
  if (!form) return;
  const mode = form.querySelector('input[name="mpesaMode"]:checked')?.value || "paybill";
  const setState = (input, active) => {
    if (!input) return;
    // readonly instead of disabled so the number is still saved with the form.
    input.readOnly = !active;
    input.setAttribute("aria-disabled", active ? "false" : "true");
    input.classList.toggle("is-dimmed", !active);
  };
  setState(document.getElementById("mpesa-paybill"), mode === "paybill");
  setState(document.getElementById("mpesa-till"), mode === "till");
  // Paybill is linked to the account reference: an account number only
  // makes sense with a paybill shortcode. A Till shortcode does not use one.
  setState(document.getElementById("mpesa-account"), mode === "paybill");
}

/** Send one STK prompt and follow it until Safaricom settles it. */
async function startMpesaPayment() {
  const T = window.Till;
  if (!T?.mpesa) { T.toast("M-Pesa is not available", "i-alert"); return; }
  if (T.ui.mpesa.stage === "sending" || T.ui.mpesa.stage === "waiting") return;
  const input = document.getElementById("mpesa-phone");
  const phone = String(input?.value || T.ui.mpesa.phone || "");
  const check = T.mpesa.normalizePhone(phone);
  if (!check.ok) {
    T.toast(check.error, "i-alert");
    input?.focus?.();
    return;
  }
  const totals = T.cartTotals();
  if (!totals.lines.length) { T.toast("There is nothing to sell", "i-alert"); return; }
  const cfg = T.mpesaConfig();
  // Paybill sales carry an account number; Till sales use the receipt number.
  const accountInput = document.getElementById("mpesa-account");
  let accountRef = "";
  if (cfg.mode === "paybill") {
    accountRef = String(accountInput?.value ?? T.ui.mpesa.account ?? cfg.account ?? "").trim().slice(0, 12);
    if (!accountRef) {
      accountRef = `POS-${T.state.nextReceipt || ""}`;
    }
    if (accountInput) accountInput.value = accountRef;
  } else {
    accountRef = `POS-${T.state.nextReceipt || ""}`;
  }
  T.ui.mpesa = { stage: "sending", phone, account: accountRef, error: "", checkoutId: "", startedAt: 0 };
  render();

  const result = await T.mpesa.collect({
    phone,
    amountCents: totals.total,
    accountRef,
    description: `${T.state.store.name || "Biller"} sale`.slice(0, 13),
    onStage: (stage) => {
      if (stage.stage !== "waiting") return;
      T.ui.mpesa.stage = "waiting";
      T.ui.mpesa.checkoutId = stage.checkoutId || "";
      T.ui.mpesa.startedAt = stage.startedAt || Date.now();
      if (T.ui.route?.name === "payment") render();
    }
  });

  if (result.ok) {
    const tx = T.completeSale({
      method: "mpesa",
      amountCents: result.amountCents || 0,
      reference: result.reference,
      checkoutId: result.checkoutId,
      accountRef: cfg.mode === "paybill" ? accountRef : "",
      customerPhone: result.phone || phone,
      note: cfg.mode === "till" ? `Till ${cfg.shortcode}` : `Paybill ${cfg.shortcode}`
    });
    T.ui.mpesa = { stage: "idle", phone: "", account: "", error: "", checkoutId: "", startedAt: 0 };
    if (!tx) { T.toast("M-Pesa says paid, but the cart was empty", "i-alert"); return; }
    T.ui.justPaidId = tx.id;
    T.toast("M-Pesa payment received", "i-check");
    go(`#/receipt/${tx.id}`, { user: false, reset: true });
    return;
  }
  if (result.stage === "cancelled") return;
  T.ui.mpesa.stage = result.stage === "timeout" ? "timeout" : "failed";
  T.ui.mpesa.error = result.message || "The payment was not completed.";
  if (T.ui.route?.name === "payment") render();
  else T.toast(T.ui.mpesa.error, "i-alert");
}

/** "Test connection" in M-Pesa settings — checks the fields as typed. */
async function testMpesaConnection() {
  const T = window.Till;
  const form = document.getElementById("settings-form");
  const note = document.getElementById("mpesa-test-note");
  if (!form || !T?.mpesa) return;
  const cfg = readMpesaForm(form);
  if (note) {
    note.textContent = "Testing…";
    note.className = "mpesa-test-note";
  }
  const result = await T.mpesa.testConnection(cfg);
  if (note) {
    note.textContent = result.message;
    note.className = `mpesa-test-note ${result.ok ? "is-ok" : "is-bad"}`;
  }
  T.toast(result.ok ? "M-Pesa connection works" : "M-Pesa test failed", result.ok ? "i-check" : "i-alert");
}

/**
 * Fill the M-Pesa form with the Safaricom sandbox demo values, so a new user
 * can try the PIN prompt without their own Daraja account.
 */
function applyMpesaSandboxDemo() {
  const T = window.Till;
  const form = document.getElementById("settings-form");
  const note = document.getElementById("mpesa-demo-note");
  if (!form) return;
  const demo = (window.TillDaraja && window.TillDaraja.sandbox) || {};
  const setValue = (id, value) => {
    const input = document.getElementById(id);
    if (input) input.value = value == null ? "" : String(value);
  };
  const mode = demo.till ? "till" : "paybill";
  const radio = form.querySelector(`input[name="mpesaMode"][value="${mode}"]`);
  if (radio) radio.checked = true;
  const env = form.querySelector('input[name="mpesaEnv"][value="sandbox"]');
  if (env) env.checked = true;
  setValue("mpesa-paybill", demo.paybill);
  setValue("mpesa-till", demo.till);
  setValue("mpesa-consumer-key", demo.consumerKey);
  setValue("mpesa-consumer-secret", demo.consumerSecret);
  setValue("mpesa-passkey", demo.passkey);
  syncMpesaModeFields(form);
  const missing = [];
  if (!demo.consumerKey || !demo.consumerSecret) missing.push("sandbox consumer key and secret");
  if (note) {
    note.textContent = missing.length
      ? `Add the ${missing.join(" and ")} in js/daraja.js to enable the demo.`
      : "Sandbox values filled in. Save, then send a KES 1 test prompt.";
    note.className = `mpesa-test-note ${missing.length ? "is-bad" : "is-ok"}`;
  }
  T.toast(missing.length ? "Sandbox demo needs a consumer key" : "Sandbox demo filled in", missing.length ? "i-alert" : "i-check");
}

/**
 * Open a chat with the app developer. On the Android build this hands over to
 * WhatsApp itself; in a browser it opens the wa.me chat link.
 * The number is never shown in the app - the tap is the whole point.
 */
const DEVELOPER_WHATSAPP = "254724067632";

/**
 * Open a chat with the app developer. On the Android build this hands over to
 * WhatsApp itself; in a browser it opens the wa.me chat link.
 * The number is never shown in the app - the tap is the whole point of the button.
 *
 * The context carries what the shop is trying to do - its shop code, the plan
 * amount, the M-Pesa code - so the developer starts the conversation with the
 * facts already in place instead of the shop having to type them again.
 */
function openDeveloperChat(context = {}) {
  const T = window.Till;
  const number = DEVELOPER_WHATSAPP;
  const code = String(context.code || T.shopCode?.() || "").trim();
  const amountCents = Number(context.amountCents || T.planSummary?.().amountCents || 0);
  const amountText = Number.isFinite(amountCents) && amountCents > 0 ? `KES ${(amountCents / 100).toFixed(2)}` : "";
  const mpesaCode = String(context.mpesaCode || T.state?.store?.subscription?.mpesaCode || "").trim();
  const awaiting = Boolean(T.subscription?.()?.awaiting);
  const messageLines = ["Hi, I need help with Biller POS."];
  if (code) messageLines.push(`Shop code: ${code}`);
  if (amountText) messageLines.push(`Monthly plan: ${amountText}`);
  if (mpesaCode) messageLines.push(`M-Pesa transaction code: ${mpesaCode}`);
  if (awaiting) messageLines.push("Payment status: sent, waiting for the developer to confirm.");
  const message = messageLines.join("\n");
  const native = window.Capacitor?.Plugins?.TillContact;
  if (native?.whatsapp) {
    native.whatsapp({ number, message });
    return;
  }
  const url = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
  try {
    const opened = window.open(url, "_blank", "noopener");
    if (!opened) location.href = url;
  } catch {
    location.href = url;
  }
  T?.toast?.("Opening your chat with the developer", "i-chat");
}

/** Send a KES 1 prompt to the shopkeeper's own phone to prove the setup. */
async function testMpesaPush() {
  const T = window.Till;
  const form = document.getElementById("settings-form");
  const note = document.getElementById("mpesa-push-note");
  const phoneInput = document.getElementById("mpesa-test-phone");
  if (!form || !T?.mpesa) return;
  const cfg = readMpesaForm(form);
  if (note) {
    note.textContent = "Sending the test prompt.";
    note.className = "mpesa-test-note";
  }
  const result = await T.mpesa.testPush(cfg, { phone: phoneInput?.value });
  if (note) {
    note.textContent = result.message;
    note.className = `mpesa-test-note ${result.ok ? "is-ok" : "is-bad"}`;
  }
  T.toast(result.ok ? "Test prompt sent" : "Test prompt failed", result.ok ? "i-check" : "i-alert");
}

// Read the store form into state. Used by the Save button, and before any
// re-render that would otherwise throw away half-typed details.
function applyStoreForm(Till) {
  const form = document.getElementById("store-settings-form");
  if (!form) return false;
  const data = new FormData(form);
  const store = Till.state.store;
  store.name = String(data.get("name") || "").trim() || "My Store";
  store.address = String(data.get("address") || "").trim();
  store.phone = String(data.get("phone") || "").trim();
  store.staff = String(data.get("staff") || "").trim();
  store.footer = String(data.get("footer") || "").trim();
  store.taxRate = Math.min(30, Math.max(0, Number(data.get("taxRate")) || 0));
  const currency = String(data.get("currency") || "KES").toUpperCase();
  if (["KES", "USD", "EUR", "GBP", "UGX", "TZS", "GHS", "NGN", "INR", "AUD", "CAD"].includes(currency)) {
    store.currency = currency;
  }
  return true;
}

function updateSyncDot() {
  const brand = document.querySelector(".brand");
  if (!brand) return;
  // `T` is not a module-level name in this file: the core lives on window.Till.
  const cs = window.Till?.cloud?.status?.() || {};
  // Green only once a real request to the network has succeeded.
  brand.classList.toggle("sync-synced", cs.online === true);
}

// Keep the ring honest even when the Firebase SDK never loads.
setInterval(() => { try { updateSyncDot(); } catch { /* ignore */ } }, 2000);

/** Rebuild just the bottom tab bar — used when the cloud moves and only the
 *  Settings badge on it can change (e.g. a new developer announcement lands
 *  while the shopkeeper is mid-sale). */
/** A cheap fingerprint of the cloud state the "live" screens display. */
function cloudSyncStateHash() {
  try {
    const T = window.Till;
    if (!T) return "none";
    const parts = [];
    for (const account of T.cloud?.accounts?.() || []) {
      parts.push(`a:${account.id}:${account.t || 0}:${account.off ? 1 : 0}:${account.sub?.status || ""}`);
    }
    for (const request of T.cloud?.paymentRequests?.() || []) {
      parts.push(`p:${request.id}:${request.status}:${request.at || 0}`);
    }
    for (const item of T.cloud?.announcements?.() || []) {
      parts.push(`n:${item.id}:${item.at || 0}`);
    }
    return parts.join("|");
  } catch {
    return "none";
  }
}

function refreshTabBadge() {
  const tabbarEl = document.getElementById("tabbar");
  if (!tabbarEl) return;
  const route = window.Till?.ui?.route || { name: "sell" };
  const showTabs = ["sell", "orders", "debt", "stock", "suppliers", "reports", "audit", "more"].includes(route.name) && !(route.name === "debt" && route.param);
  const html = showTabs ? window.Till.screens.tabbar(route) : "";
  if (tabbarEl.innerHTML !== html) {
    tabbarEl.innerHTML = html;
    tabbarEl.classList.toggle("is-hidden", !showTabs);
    wireNav(tabbarEl);
    wireActions(tabbarEl);
  }
}

// Clearing the search query after an item is added to the sale, so the
// shopkeeper can scan/type the next item right away. The search bar stays
// open until they close it themselves (the search button toggles it).
function resetSellSearch() {
  const T = window.Till;
  if (!T) return;
  T.ui.search = "";
  const input = document.getElementById("sell-search");
  if (T.ui.searchOpen && input) {
    // Patch in place instead of re-rendering: the input element stays the
    // same, so Android keeps the keyboard open and the cursor in the field.
    input.value = "";
    const wrap = document.getElementById("sell-search-wrap");
    wrap?.classList.remove("has-value");
    const results = document.getElementById("sell-results");
    if (results) {
      results.innerHTML = T.screens.sellResults();
      wireNav(results);
      wireActions(results);
    }
    // The cart hero lives outside #sell-results — sync it in place too.
    const count = T.itemCount();
    const hero = document.querySelector(".cart-hero");
    if (hero) {
      hero.setAttribute("aria-label", `Checkout, ${count} ${count === 1 ? "item" : "items"} in the cart`);
      let badge = hero.querySelector(".cart-hero-count");
      if (count > 0) {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "cart-hero-count";
          hero.appendChild(badge);
        }
        badge.textContent = String(count);
      } else if (badge) {
        badge.remove();
      }
    }
    input.focus({ preventScroll: true });
    return;
  }
  render();
}
window.resetSellSearch = resetSellSearch;

function render() {
  const T = window.Till;
  if (!T || !T.screens) {
    console.warn("Biller core not ready yet");
    return;
  }

  updateOfflineBanner();

  const viewport = document.getElementById("viewport");
  const appbarEl = document.getElementById("appbar");
  const dockEl = document.getElementById("dock");
  const tabbarEl = document.getElementById("tabbar");
  const layersEl = document.getElementById("layers");

  if (!viewport) return;

  const path = location.hash || "#/auth";

  // Parse route name and optional param (e.g. #/receipt/abc123).
  // location.hash looks like "#/sell" — drop the "#" and the leading "/".
  let route = { name: "", param: null };
  const afterHash = path.replace(/^#\/?/, "");
  const slash = afterHash.indexOf("/");
  if (slash > 0) {
    route.name = afterHash.slice(0, slash);
    route.param = afterHash.slice(slash + 1);
  } else {
    route.name = afterHash;
    route.param = null;
  }
  const previousRouteName = T.ui.route?.name;
  T.ui.route = route;
  const routeKey = `${route.name}/${route.param || ""}`;
  if (renderedRouteKey !== routeKey) {
    renderedRouteKey = routeKey;
    // The scroll container is .viewport, not the window.
    viewport.scrollTop = 0;
  }

  // Opening the Settings tab starts with every category dropdown closed.
  if (route.name === "more") {
    if (T.ui.openSubscription) {
      // Arrived from the plan banner: open that category straight away.
      T.ui.openSubscription = false;
      T.ui.settingsOpen = { ...(T.ui.settingsOpen || {}), subscription: true };
    } else if (previousRouteName !== "more") {
      T.ui.settingsOpen = {};
    }
  }

  // Leave the checkout screen and any pending M-Pesa request stops polling.
  if (route.name !== "payment" && (T.ui.mpesa.stage === "sending" || T.ui.mpesa.stage === "waiting")) {
    const wasWaiting = T.ui.mpesa.stage === "waiting";
    T.mpesa?.cancel?.();
    T.ui.mpesa = { stage: "idle", phone: "", account: "", error: "", checkoutId: "", startedAt: 0 };
    if (wasWaiting) T.toast("Stopped waiting - check M-Pesa messages before retrying", "i-info");
  }

  // Leaving Sell closes the search bar, so it never lingers on another screen.
  if (route.name !== "sell" && T.ui.searchOpen) {
    T.ui.searchOpen = false;
    T.ui.search = "";
  }
  // Leaving Audit or M-Pesa locks it again — the PIN is asked next time it opens.
  if (route.name !== "audit" && T.ui.auditUnlocked) {
    T.ui.auditUnlocked = false;
  }
  if (route.name !== "mpesa" && T.ui.mpesaUnlocked) {
    T.ui.mpesaUnlocked = false;
  }

  // The "payment complete" state belongs to the receipt that was just paid.
  if (route.name !== "receipt" || route.param !== T.ui.justPaidId) {
    T.ui.justPaidId = null;
  }

  // Update UI chrome
  const isAuthRoute = route.name === "auth";
  if (appbarEl) {
    appbarEl.innerHTML = T.screens.appbar(route);
    // The login screen carries its own branding, and the scanner is a
    // full-screen camera view — neither needs the app bar.
    appbarEl.classList.toggle("is-hidden", isAuthRoute || route.name === "scan");
    // Refresh the sync status dot on the brand.
    updateSyncDot();
  }
  if (dockEl) {
    // The cart is in the hero bar now; there is no bottom cart banner.
    dockEl.innerHTML = "";
    dockEl.classList.add("is-empty");
  }
  if (tabbarEl) {
    // The bottom tabs stay on the four main screens, and get out of the way
    // on the one-off flows (login, cart, payment, receipt, scanner).
    const showTabs = ["sell", "orders", "debt", "stock", "suppliers", "reports", "audit", "more"].includes(route.name) && !(route.name === "debt" && route.param);

    tabbarEl.innerHTML = showTabs ? T.screens.tabbar(route) : "";
    tabbarEl.classList.toggle("is-hidden", !showTabs);
  }

  // Render screen content
  let html = "";
  const screenName = route.name;
  if (screenName === "auth") html = T.screens.auth();
  else if (screenName === "sell") html = T.screens.sell();
  else if (screenName === "orders") html = T.screens.orders();
  else if (screenName === "stock") html = T.screens.stock();
  else if (screenName === "suppliers") html = T.screens.suppliers();
  else if (screenName === "debt") html = route.param ? T.screens.customerDebt(route.param) : T.screens.debt();
  else if (screenName === "supplier") html = T.screens.supplierDetail(route.param);
  else if (screenName === "reports") html = T.screens.reports();
  else if (screenName === "history") html = T.screens.history();
  else if (screenName === "announcements") {
    // Capture what was unread *before* this page marks it — the shop sees
    // the NEW badge on exactly those entries, once.
    const alreadyRead = new Set(T.readAnnouncementIds?.() || []);
    const freshIds = (T.cloud?.announcements?.() || []).map((item) => item.id).filter((id) => id && !alreadyRead.has(id));
    html = T.screens.announcements(freshIds);
    if (freshIds.length) {
      T.markAnnouncementsRead?.(freshIds);
      freshIds.forEach((id) => { T.cloud?.markAnnouncementRead?.(id); });
    }
  }
  else if (screenName === "audit") {
    // No PIN sheet here on purpose: it opens only from the "Enter PIN" button
    // below, so someone who does not want to enter the PIN can just leave.
    html = (T.pinEnabled?.() && !T.ui.auditUnlocked)
      ? T.screens.pinLocked("Audit report", "unlock-audit")
      : T.screens.audit();
  }
  else if (screenName === "more") html = T.screens.more();
  else if (screenName === "plans") html = T.screens.plans();
  else if (screenName === "store") html = T.screens.storeSettings();
  else if (screenName === "mpesa") {
    html = (T.pinEnabled?.() && !T.ui.mpesaUnlocked)
      ? T.screens.pinLocked("M-Pesa settings", "unlock-mpesa")
      : T.screens.mpesaSettings();
  }
  else if (screenName === "account") html = T.screens.accountSettings();
  else if (screenName === "cart") html = T.screens.cart();
  else if (screenName === "payment") html = T.screens.payment();
  else if (screenName === "scan") html = T.screens.scan();
  else if (screenName === "receipt" && route.param) {
    const tx = T.state.transactions.find(t => t.id === route.param);
    html = tx ? T.screens.receipt(tx, T.ui.justPaidId === tx.id) : `<section class="screen">Receipt not found</section>`;
  } else {
    html = T.screens.auth();
  }

  // Plan gating: an unpaid shop sees only the "Your plan is due" page
  // everywhere, except the screens needed to pay, sync and sign out.
  const LOCKED_SCREENS_EXCEPT = new Set(["auth", "account", "announcements"]);
  if (T.subscriptionLocked?.() && !LOCKED_SCREENS_EXCEPT.has(screenName)) {
    html = T.screens.lockedScreen();
  }

  viewport.innerHTML = html;
  viewport.classList.toggle("is-auth", screenName === "auth");
  // Keep the cloud fingerprint in step with what the shop actually sees, so
  // the next snapshot only re-renders when something genuinely changed.
  cloudSyncHash = cloudSyncStateHash();

  // The plan card shows whether the phone reminders are on.
  if (document.getElementById("notify-status")) updateReminderRow();

  // The login screen wires its own form and segmented control.
  if (screenName === "auth") {
    T.auth?.attach?.(viewport);
  }

  // Wire up data-nav buttons. The app bar, the cart dock and the bottom tab
  // bar all live outside the viewport, so every chrome element needs wiring —
  // not just the screen content.
  wireNav(viewport);
  wireNav(appbarEl);
  wireNav(dockEl);
  wireNav(tabbarEl);

  // Wire up data-act buttons — in the screen, in the chrome and in any open
  // sheet.
  wireActions(viewport);
  wireActions(appbarEl);
  wireActions(dockEl);
  wireActions(tabbarEl);
  wireActions(layersEl);

  // Two or more shopkeepers on the roster and this device has not picked one
  // yet: ask who is selling, exactly once per device (not per visit), so the
  // right name lands on the receipts rung up here.
  if (screenName === "sell" && !T.ui.staffAsked && (T.staffRoster?.() || []).length >= 2 && !T.hasDeviceStaff?.()) {
    T.ui.staffAsked = true;
    T.sheets?.openStaffPicker?.();
  }

  // Wire up search inputs
  const sellSearch = document.getElementById("sell-search");
  if (sellSearch) {
    sellSearch.addEventListener("input", (e) => {
      T.ui.search = e.target.value;
      const wrap = document.getElementById("sell-search-wrap");
      wrap?.classList.toggle("has-value", Boolean(T.ui.search));
      // Update just the results so the field keeps focus and the keyboard stays up.
      const results = document.getElementById("sell-results");
      if (results) {
        results.innerHTML = T.screens.sellResults();
        wireNav(results);
        wireActions(results);
      }
    });
  }
  const stockSearch = document.getElementById("stock-search");
  if (stockSearch) {
    stockSearch.addEventListener("input", (e) => {
      T.ui.stockSearch = e.target.value;
      // Repaint only the list, so the search field keeps focus and the
      // keyboard stays up while the shopkeeper types.
      const wrap = document.getElementById("stock-search-wrap");
      wrap?.classList.toggle("has-value", Boolean(T.ui.stockSearch));
      const list = document.getElementById("inventory-list");
      if (list) {
        list.innerHTML = T.screens.stockFilterRow() + T.screens.inventoryRows();
        wireActions(list);
        wireNav(list);
      }
    });
  }

  // Debt search filters in place, so the keyboard stays up.
  const debtSearch = document.getElementById("debt-search");
  if (debtSearch) {
    debtSearch.addEventListener("input", (e) => {
      T.ui.debtSearch = e.target.value;
      const wrap = document.getElementById("debt-search-wrap");
      wrap?.classList.toggle("has-value", Boolean(T.ui.debtSearch));
      const results = document.getElementById("debt-results");
      if (results) {
        results.innerHTML = T.screens.debtResults();
        wireActions(results);
        wireNav(results);
      }
    });
  }
  const supplierSearch = document.getElementById("supplier-search");
  if (supplierSearch) {
    supplierSearch.addEventListener("input", (e) => {
      T.ui.supplierSearch = e.target.value;
      const wrap = document.getElementById("supplier-search-wrap");
      wrap?.classList.toggle("has-value", Boolean(T.ui.supplierSearch));
      const results = document.getElementById("supplier-results");
      if (results) {
        results.innerHTML = T.screens.supplierResults();
        wireActions(results);
      }
    });
  }

  // Wire up the store settings form on the More tab
  const settingsForm = document.getElementById("settings-form");
  const storeSettingsForm = document.getElementById("store-settings-form");
  if (storeSettingsForm) {
    storeSettingsForm.addEventListener("submit", (event) => {
      event.preventDefault();
      applyStoreForm(T);
      T.save();
      T.toast("Store settings saved", "i-check");
      render();
    });
    // The shopkeeper select is the same choice the Sell tab makes: picking it
    // here changes who is selling on this device, and vice versa.
    document.getElementById("store-staff")?.addEventListener("change", (event) => {
      const value = event.target.value;
      if (T.staffClaimedBy?.(value)) {
        T.toast(`${value} is already selling on another device`, "i-alert");
        render();
        return;
      }
      const name = T.setActiveStaff?.(value) || value;
      T.state.store.staff = String(name || "").trim();
      T.save();
      render();
      T.toast(`Selling as ${name}`, "i-check");
    });
  }
  if (settingsForm) {
    updateReminderRow();
    settingsForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(settingsForm);
      const store = T.state.store;
      // M-Pesa settings: keep the numbers clean and the credentials trimmed.
      const mpesa = readMpesaForm(settingsForm);
      if (mpesa.backend && !/^https:\/\//i.test(mpesa.backend) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(mpesa.backend)) {
        T.toast("The backend URL must start with https://", "i-alert");
        return;
      }
      store.mpesa = {
        paybill: mpesa.paybill,
        till: mpesa.till,
        mode: mpesa.mode,
        account: mpesa.account,
        environment: mpesa.environment,
        consumerKey: mpesa.consumerKey,
        consumerSecret: mpesa.consumerSecret,
        passkey: mpesa.passkey,
        backend: mpesa.backend,
        backendKey: mpesa.backendKey
      };
      T.save();
      T.toast("M-Pesa settings saved", "i-check");
      render();
    });
    // Paybill and Till are alternatives: the one that is not in use is greyed
    // out so it is obvious which number the till actually charges.
    syncMpesaModeFields(settingsForm);
    settingsForm.addEventListener("change", (event) => {
      if (event.target && event.target.name === "mpesaMode") syncMpesaModeFields(settingsForm);
    });
  }

  // Wire up cash keypad
  viewport.querySelectorAll("[data-act='cash-key']").forEach(btn => {
    btn.addEventListener("click", () => {
      if (T.subscriptionLocked?.()) {
        T.toast("Your monthly plan needs paying before you can sell", "i-alert");
        return;
      }
      const key = btn.dataset.key;
      if (key === "del") {
        T.ui.cash = String(T.ui.cash || "").slice(0, -1);
      } else {
        // The keypad types shillings ("500" is KES 500), not cents.
        const next = (String(T.ui.cash || "") + key).replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
        T.ui.cash = next.slice(0, 9);
      }
      render();
    });
  });

  // Wire up cash quick buttons
  viewport.querySelectorAll("[data-act='cash-quick']").forEach(btn => {
    btn.addEventListener("click", () => {
      // Quick values are stored in cents, but the keypad works in shillings.
      T.ui.cash = String(Math.max(0, Math.round(Number(btn.dataset.value || 0) / 100)));
      render();
    });
  });

  // The M-Pesa phone field keeps its text between renders, and Enter sends.
  const mpesaPhone = document.getElementById("mpesa-phone");
  if (mpesaPhone) {
    mpesaPhone.addEventListener("input", () => { T.ui.mpesa.phone = mpesaPhone.value; });
    mpesaPhone.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      document.querySelector("[data-act='mpesa-send']")?.click();
    });
  }

  // The Paybill account number is remembered while the cashier types.
  const mpesaAccount = document.getElementById("mpesa-account");
  if (mpesaAccount) {
    mpesaAccount.addEventListener("input", () => { T.ui.mpesa.account = mpesaAccount.value; });
    mpesaAccount.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      document.querySelector("[data-act='mpesa-send']")?.click();
    });
  }

  // The camera only runs while the scanner screen is on show. The little
  // camera window inside the product form keeps running on its own.
  if (screenName === "scan") {
    T.scanner?.start?.();
  } else {
    T.scanner?.stopScreen?.();
  }
}

// --- Sync ---
//
// There is no pull-to-refresh gesture: the app pushes every change to the
// cloud by itself and pulls the cloud copy when it starts. A shop that wants
// to fetch the latest copy by hand uses "Sync now" in the Account screen.


// --- Boot ---
function boot() {
  // Paint the saved palette before the first render so the shell does not
  // flash the default one.
  window.Till?.applyTheme?.();
  window.Till?.applyTextSize?.();
  window.Till?.applyColorScheme?.();
  // A shop asking for its plan to be confirmed reaches the developer here.
  window.Till?.cloud?.onPaymentPrompt?.((request) => {
    const who = request?.shop || request?.code || "A shop";
    window.Till?.toast?.(who + " says it has paid - open Subscriptions", "i-alert");
    window.Till?.notify?.show?.({
      id: window.Till?.notify?.ids?.request || 9007,
      title: who + " has paid",
      body: "Open the subscription panel and tap Confirm payment to switch their shop on."
    });
  });
  if (!location.hash || !/^#\//.test(location.hash)) {
    history.replaceState(null, "", "#/auth");
  }
  // Check for saved session on startup - if user is already signed in,
  // redirect to sell screen immediately rather than showing login page.
  const savedSession = (() => {
    try { return JSON.parse(localStorage.getItem("biller.pos.auth") || "null"); } catch { return null; }
  })();
  if (savedSession?.email) {
    // Already signed in on this device — set the session and open Sell at
    // once instead of flashing the login screen. The auth observer also
    // fires later and keeps the two in step.
    window.Till.setSession(savedSession.email, savedSession.uid);
    // Load the shop that belongs to this account, not the local one.
    if (savedSession.uid) {
      window.Till.activateAccount?.({ email: savedSession.email, uid: savedSession.uid });
    }
    if (location.hash !== "#/sell") history.replaceState(null, "", "#/sell");
  }
  // A guard entry, so the very first back gesture stays inside the app
  // instead of leaving it.
  history.pushState(null, "", location.hash);
  // The trail starts on the screen the app opens on.
  navTrail = [location.hash || "#/sell"];
  // When the cloud reports something new, the Account screen follows it.
  // Never re-render while the shopkeeper is typing — a re-render replaces
  // the viewport and wipes whatever they were writing (the announcement
  // composer was losing its text mid-sentence). Refresh only the badge.
  window.Till?.cloud?.onChange?.(() => {
    // The waiting sheet has an answer now: get out of its way.
    if (!window.Till?.cloudWaiting?.()) window.Till?.sheets?.closeCloudWaiting?.();
    updateSyncDot();
    const name = window.Till?.ui?.route?.name;
    const active = document.activeElement;
    const editing = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);
    if (editing || name === "announcements") { refreshTabBadge(); return; }
    if (["account", "more", "plans"].includes(name)) {
      // Firestore sends a snapshot every heartbeat (60s) — almost always
      // with zero change. Only re-paint the screen when something actually
      // moved; that kills the periodic flash while the app is open.
      const hash = cloudSyncStateHash();
      if (hash !== cloudSyncHash) {
        cloudSyncHash = hash;
        render();
        return;
      }
    }
    refreshTabBadge();
  });
  // Start the connectivity probe even if the Firebase SDK never loads.
  window.Till?.cloud?.init?.();
  // Ask the internet what time it actually is (Africa/Nairobi, EAT). The
  // subscription tamper check uses this instead of the device clock, which a
  // cheater can roll back freely.
  window.Till?.checkInternetClock?.();
  initFirebase();
  // Signing in does not authorise work: if every shopkeeper is already
  // selling on another device, nothing runs until this one names somebody.
  // The auth observer applies the gate too; this fallback covers a boot in
  // which Firebase never loads and the observer never settles.
  setTimeout(() => { try { window.Till?.sheets?.refreshStaffGate?.(); } catch { /* ignore */ } }, 700);
  // This device's shopkeeper announces itself to the other devices.
  const _bootStaff = window.Till?.activeStaff?.();
  if (_bootStaff) window.Till?.claimStaff?.(_bootStaff);
  render();
  // Plan the reminders for the monthly plan once the app is up.
  setTimeout(() => { window.Till?.notify?.syncPlan?.(); }, 2500);
  setTimeout(() => {
    try {
      const T = window.Till;
      if (!T?.getSession?.()) return;
      if (T.sheets?.isOpen?.()) return;
      if (T.debtReminderSeenToday?.()) return;
      if (!T.debtReminders?.().length) return;
      T.sheets?.openDebtReminder?.();
    } catch (error) { console.warn(error); }
  }, 900);
}

window.render = render;
window.Till = window.Till || {};
window.Till.confirmDeleteThisAccount = confirmDeleteThisAccount;

// The search bar stays open until the shopkeeper closes it themselves
// (the search button toggles it). Tapping outside no longer dismisses it.

// Enter in a picker qty field commits it, the same as tapping Add.
document.addEventListener("keydown", (event) => {
  const input = event.target?.closest?.(".variant-pick-qty .step-input");
  if (!input || event.key !== "Enter") return;
  event.preventDefault();
  input.closest(".variant-pick-qty")?.querySelector(".step-add")?.click();
});

// The Add button on a picker row shows the running quantity as it changes.
document.addEventListener("input", (event) => {
  const input = event.target?.closest?.(".variant-pick-qty .step-input");
  if (!input || event.target !== input) return;
  const addBtn = input.closest(".variant-pick-qty")?.querySelector(".step-add");
  if (addBtn) addBtn.textContent = `Add ${Math.max(1, Math.floor(Number(input.value) || 1))}`;
});

// The price of a line in the open sale is typed straight into the cart.
// The change is saved when the field is left or Enter is pressed.
document.addEventListener("change", (event) => {
  const T = window.Till;
  const input = event.target?.closest?.("[data-price-input]");
  if (!T || !input) return;
  if (T.subscriptionLocked?.()) {
    T.toast("Your monthly plan needs paying before you can change a sale", "i-alert");
    render();
    return;
  }
  const variantId = input.dataset.variant || null;
  const id = input.dataset.id;
  const cents = T.parsePriceToCents(input.value);
  const line = T.cartLines?.().find((entry) => entry.product.id === id && String(entry.variantId || "") === String(variantId || ""));
  if (!Number.isFinite(cents) || cents <= 0) {
    T.toast("Enter a price greater than zero", "i-alert");
    if (line) input.value = (line.price / 100).toFixed(2);
    return;
  }
  if (!line || cents === line.price) return;
  T.setCartPrice(id, cents, variantId);
  render();
});

// Enter in a price field commits it, the same as leaving the field.
document.addEventListener("keydown", (event) => {
  const input = event.target?.closest?.("[data-price-input]");
  if (!input || event.key !== "Enter") return;
  event.preventDefault();
  input.blur();
});

// Sheets open outside a render pass, so they wire their own buttons through
// this hook - see sheets.js.
window.TillActions = { wireActions, wireNav, runAction, buildReceiptFile, shareReceipt, downloadReceipt };

// The Android shell calls these when the back button or the swipe-back
// gesture is used.
if (window.Till) {
  window.Till.handleBack = handleBack;
  window.Till.requestExit = requestExit;
  window.Till.goHome = goHome;
  window.Till.go = go;
}

// Keep the view in step with the hash — the Android back button changes the
// hash, and without this the screen would not follow.
window.addEventListener("hashchange", () => render());

// A browser back press (or the web back gesture) moves the URL on its own.
// Keep the trail in step with it so the app's own back button stays in sync.
window.addEventListener("popstate", () => {
  const hash = location.hash || "#/sell";
  const index = navTrail.lastIndexOf(hash);
  navTrail = index >= 0 ? navTrail.slice(0, index + 1) : [hash];
  render();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  setTimeout(() => {
    try {
      const T = window.Till;
      if (!T?.getSession?.()) return;
      if (T.sheets?.isOpen?.()) return;
      if (T.debtReminderSeenToday?.()) return;
      if (!T.debtReminders?.().length) return;
      T.sheets?.openDebtReminder?.();
    } catch (error) { console.warn(error); }
  }, 600);
});

// Android sends the hardware back button and the back gesture to
// MainActivity, which calls window.Till.handleBack() directly. The popstate
// listener above only repaints the screen, so the back rule is never run
// twice and the exit prompt cannot open by itself.

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
