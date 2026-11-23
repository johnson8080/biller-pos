/* ============================================================
   Till — the guided tour
   A short, chart-styled coach-mark tour for a brand-new shop:
   one floating card per stop, a spotlight on the real control,
   and a mini bar chart that doubles as the step progress.
   ============================================================ */
(() => {
  "use strict";
  const T = window.Till;
  if (!T) throw new Error("Till core must load before tour.");

  const esc = T.esc;
  const icon = (name) => `<svg class="ico" aria-hidden="true"><use href="#${name}"></use></svg>`;

  // Bumping this number re-offers the tour once, even to shops that saw
  // the old one.
  const TOUR_VERSION = 1;
  const SEEN_PREFIX = "biller.pos.tour.seen.";

  // Decorative bar heights for the card chart. The current stop lights its
  // bar; earlier stops stay filled, later stops stay muted. The line rises
  // with the bars, so the card reads like a tiny sales chart.
  const CHART = [24, 34, 29, 44, 38, 52, 46, 61, 55, 70, 80];

  const STEP_DEFS = {
    welcome: {
      id: "welcome",
      icon: "i-store",
      title: "Your till, in one minute",
      body: "A quick look at selling, stock, debts and reports. You can skip at any time.",
      next: "Show me around"
    },
    sell: {
      id: "sell",
      route: "#/sell",
      target: ['#tabbar .tab[data-nav="#/sell"]', "#sell-results"],
      icon: "i-bag",
      title: "Start a sale",
      body: "Tap any product to add it to the sale. Everything you tap stays in the cart until you take payment."
    },
    scan: {
      id: "scan",
      route: "#/sell",
      target: [".hero-scan"],
      icon: "i-scan",
      title: "Scan or search",
      body: "Point the camera at a barcode, or tap the search glass to find an item by name."
    },
    cart: {
      id: "cart",
      route: "#/sell",
      target: ['#tabbar .tab[data-nav="#/orders"]', ".cart-hero"],
      icon: "i-bag",
      title: "Take payment",
      body: "The cart lives here. Review the sale, add a discount, then take cash, M-Pesa or card."
    },
    orders: {
      id: "orders",
      route: "#/orders",
      target: [".orders-list .order-row", ".orders-list", ".empty-state", '#tabbar .tab[data-nav="#/orders"]'],
      icon: "i-receipt",
      title: "Every sale is saved",
      body: "Orders keeps each receipt with its time, items and payment method. Tap one to view or share it."
    },
    stock: {
      id: "stock",
      route: "#/stock",
      target: ['[data-act="new-product"]', "#stock-title"],
      icon: "i-box",
      title: "Add and count stock",
      body: "Add products, record deliveries, log wastage and count what is on the shelf."
    },
    "stock-first": {
      id: "stock-first",
      route: "#/stock",
      target: ['[data-act="new-product"]', "#stock-title"],
      icon: "i-box",
      title: "Add your first product",
      body: "Tap Add to save an item, its price and how many you have. It appears on Sell straight away."
    },
    debt: {
      id: "debt",
      route: "#/debt",
      target: ['#tabbar .tab[data-nav="#/debt"]', "#debt-title", ".empty-state"],
      icon: "i-user",
      title: "Keep track of debts",
      body: "When a customer pays later, their balance waits here with a due date and a reminder."
    },
    suppliers: {
      id: "suppliers",
      route: "#/suppliers",
      target: ['#tabbar .tab[data-nav="#/suppliers"]', "#suppliers-title", ".empty-state"],
      icon: "i-truck",
      title: "Restock contacts",
      body: "Keep supplier balances and payments together, so you always know what you owe."
    },
    reports: {
      id: "reports",
      route: "#/reports",
      target: ['#tabbar .tab[data-nav="#/reports"]', ".report-chart", "#reports-title"],
      icon: "i-chart",
      title: "See the week at a glance",
      body: "The chart shows each day's sales. Scroll on for best sellers, profit and payment mix."
    },
    settings: {
      id: "settings",
      route: "#/more",
      target: ['#tabbar .tab[data-nav="#/more"]', "#more-title"],
      icon: "i-more",
      title: "Make it yours",
      body: "Shop details, staff, PIN, M-Pesa, appearance and backups all live in Settings."
    },
    done: {
      id: "done",
      icon: "i-check",
      title: "You're ready to sell",
      body: "That's the whole till. Take the tour again any time from Settings.",
      next: "Start selling",
      finishTo: "#/sell"
    },
    "done-first": {
      id: "done-first",
      icon: "i-check",
      title: "Now add your first product",
      body: "You have seen the till. Add what you sell and it appears on the Sell screen, ready to tap.",
      next: "Add my first product",
      finishTo: "#/stock"
    }
  };

  let layer = null;
  let active = false;
  let steps = [];
  let index = 0;
  let startHash = "";
  let lastFocus = null;
  let stepToken = 0;
  let waitTimer = 0;
  let positionFrame = 0;
  let autoTryAt = 0;

  function storageKey() {
    let who = "local";
    try {
      who = T.getSession?.()?.uid || T.state?.store?.shopCode || "local";
    } catch { /* ignore */ }
    return `${SEEN_PREFIX}${TOUR_VERSION}.${who}`;
  }

  function seen() {
    try { return localStorage.getItem(storageKey()) === "1"; } catch { return false; }
  }

  function markSeen() {
    try { localStorage.setItem(storageKey(), "1"); } catch { /* ignore */ }
  }

  function noProducts() {
    return !(T.state?.products || []).length;
  }

  function buildSteps() {
    const ids = ["welcome"];
    if (noProducts()) {
      // A brand-new shop is on the Stock screen after first-run setup, so
      // the tour starts where the first real task is: adding an item.
      ids.push("stock-first", "sell", "scan", "cart", "orders", "debt", "suppliers", "reports", "settings");
    } else {
      ids.push("sell", "scan", "cart", "orders", "debt", "stock", "suppliers", "reports", "settings");
    }
    ids.push(noProducts() ? "done-first" : "done");
    return ids.map((id) => ({ ...STEP_DEFS[id] }));
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findTarget(step) {
    const selectors = Array.isArray(step.target) ? step.target : step.target ? [step.target] : [];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (isVisible(el)) return el;
    }
    return null;
  }

  function ensureLayer() {
    const app = document.getElementById("app");
    if (!app) return null;
    let el = document.getElementById("tour-layer");
    if (!el) {
      el = document.createElement("div");
      el.id = "tour-layer";
      el.className = "tour-layer";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-modal", "true");
      el.setAttribute("aria-labelledby", "tour-title");
      app.appendChild(el);
    }
    return el;
  }

  function paint() {
    const step = steps[index];
    const last = index === steps.length - 1;
    const count = steps.length;
    const bars = CHART.slice(0, count).map((height, i) => {
      const state = last || i < index ? "is-done" : i === index ? "is-now" : "";
      return `<span class="tour-bar ${state}" data-height="${height}" style="height:0%"></span>`;
    }).join("");
    const points = CHART.slice(0, count).map((height, i) => {
      const x = (((i + 0.5) / count) * 100).toFixed(2);
      return `${x},${100 - height}`;
    }).join(" ");

    layer.innerHTML = `
      <div class="tour-dim" aria-hidden="true"></div>
      <div class="tour-spot" aria-hidden="true"></div>
      <article class="tour-card${step.target ? "" : " is-center"}">
        <span class="tour-caret" aria-hidden="true"></span>
        <div class="tour-card-head">
          <span class="tour-kicker">${icon("i-chart")} QUICK TOUR</span>
          <span class="tour-count"><strong>${String(index + 1).padStart(2, "0")}</strong><span>/ ${String(count).padStart(2, "0")}</span></span>
        </div>
        <div class="tour-chart" aria-hidden="true">
          <svg class="tour-trend" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.4" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"></polyline>
          </svg>
          <div class="tour-bars">${bars}</div>
        </div>
        <div class="tour-copy">
          <span class="tour-badge">${icon(step.icon)}</span>
          <div class="tour-text">
            <h2 id="tour-title">${esc(step.title)}</h2>
            <p>${esc(step.body)}</p>
          </div>
        </div>
        <div class="tour-foot">
          <button type="button" class="tour-skip" data-tour="skip">Skip tour</button>
          <div class="tour-nav">
            ${index ? `<button type="button" class="tour-back" data-tour="back">Back</button>` : ""}
            <button type="button" class="tour-next" data-tour="next">${esc(step.next || (last ? "Finish" : "Next"))} ${icon("i-arrow")}</button>
          </div>
        </div>
      </article>`;

    layer.classList.remove("is-ready", "has-spot", "is-center");
    if (!step.target) layer.classList.add("is-center");

    // Let the bars grow from the baseline once the card is in the DOM.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      layer?.querySelectorAll(".tour-bar").forEach((bar) => {
        bar.style.height = `${bar.dataset.height}%`;
      });
    }));

    requestAnimationFrame(() => {
      layer?.querySelector(".tour-next")?.focus({ preventScroll: true });
    });
  }

  function scrollTargetIntoView(target) {
    const viewport = document.getElementById("viewport");
    if (!viewport || !viewport.contains(target)) return;
    const vr = viewport.getBoundingClientRect();
    const tr = target.getBoundingClientRect();
    const margin = 18;
    if (tr.top >= vr.top + margin && tr.bottom <= vr.bottom - margin) return;
    const delta = (tr.top + tr.height / 2) - (vr.top + vr.height / 2);
    viewport.scrollTop = Math.max(0, viewport.scrollTop + delta);
  }

  function centerCard() {
    const card = layer?.querySelector(".tour-card");
    const spot = layer?.querySelector(".tour-spot");
    if (!card) return;
    card.classList.add("is-center");
    card.style.top = "";
    card.style.left = "";
    card.removeAttribute("data-side");
    if (spot) spot.style.cssText = "";
    layer.classList.remove("has-spot");
    layer.classList.add("is-center", "is-ready");
  }

  function positionCard(target) {
    if (!active || !layer) return;
    const card = layer.querySelector(".tour-card");
    const app = document.getElementById("app");
    if (!card || !app) return;
    if (!target) { centerCard(); return; }

    const ar = app.getBoundingClientRect();
    scrollTargetIntoView(target);
    const r = target.getBoundingClientRect();
    const pad = 6;
    const spot = layer.querySelector(".tour-spot");
    const box = {
      left: Math.max(2, r.left - ar.left - pad),
      top: Math.max(2, r.top - ar.top - pad),
      width: Math.min(ar.width - 4, r.width + pad * 2),
      height: Math.min(ar.height - 4, r.height + pad * 2)
    };
    if (spot) {
      spot.style.left = `${box.left}px`;
      spot.style.top = `${box.top}px`;
      spot.style.width = `${box.width}px`;
      spot.style.height = `${box.height}px`;
    }
    layer.classList.add("has-spot");
    layer.classList.remove("is-center");
    card.classList.remove("is-center");

    const cardWidth = card.offsetWidth;
    const cardHeight = card.offsetHeight;
    const gap = 14;
    const targetCenterY = box.top + box.height / 2;
    let side = targetCenterY > ar.height / 2 ? "top" : "bottom";
    let top = side === "top" ? box.top - cardHeight - gap : box.top + box.height + gap;
    if (top < 8) {
      side = "bottom";
      top = box.top + box.height + gap;
    } else if (top + cardHeight > ar.height - 8) {
      side = "top";
      top = box.top - cardHeight - gap;
    }
    top = Math.max(8, Math.min(top, ar.height - cardHeight - 8));
    const left = Math.max(12, Math.min(box.left + box.width / 2 - cardWidth / 2, ar.width - cardWidth - 12));

    card.style.top = `${Math.round(top)}px`;
    card.style.left = `${Math.round(left)}px`;
    card.dataset.side = side;
    const caret = card.querySelector(".tour-caret");
    if (caret) {
      const caretX = Math.max(20, Math.min(box.left + box.width / 2 - left, cardWidth - 20));
      caret.style.left = `${Math.round(caretX)}px`;
    }
    layer.classList.add("is-ready");
  }

  function schedulePosition() {
    if (!active || positionFrame) return;
    positionFrame = requestAnimationFrame(() => {
      positionFrame = 0;
      if (!active) return;
      const step = steps[index];
      positionCard(step?.target ? findTarget(step) : null);
    });
  }

  function waitForTarget(step, done) {
    clearTimeout(waitTimer);
    let tries = 0;
    const tick = () => {
      if (!active) return;
      const target = findTarget(step);
      if (target || tries >= 24) { done(target || null); return; }
      tries += 1;
      waitTimer = setTimeout(tick, 50);
    };
    tick();
  }

  function show(nextIndex) {
    if (!active || !layer) return;
    index = Math.max(0, Math.min(nextIndex, steps.length - 1));
    const step = steps[index];
    const token = ++stepToken;
    layer.classList.remove("is-ready", "has-spot", "is-center");
    paint();

    if (step.route && location.hash !== step.route) {
      try { location.hash = step.route; } catch { /* ignore */ }
    }

    if (!step.target) {
      requestAnimationFrame(() => {
        if (active && token === stepToken) positionCard(null);
      });
      return;
    }

    waitForTarget(step, (target) => {
      if (!active || token !== stepToken) return;
      requestAnimationFrame(() => {
        if (!active || token !== stepToken) return;
        positionCard(target);
      });
    });
  }

  function next() {
    if (!active) return;
    if (index >= steps.length - 1) {
      const destination = steps[index].finishTo || "#/sell";
      stop({ restore: false });
      try { location.hash = destination; } catch { /* ignore */ }
      T.toast?.(destination === "#/stock"
        ? "Tour complete — add your first product"
        : "Tour complete — you're ready to sell", "i-check");
      return;
    }
    show(index + 1);
  }

  function onClick(event) {
    const button = event.target.closest?.("[data-tour]");
    if (button) {
      event.preventDefault();
      event.stopPropagation();
      if (button.dataset.tour === "skip") stop();
      else if (button.dataset.tour === "back") show(index - 1);
      else next();
      return;
    }
    if (event.target.closest?.(".tour-card")) return;
    // Tapping the dimmed screen is the same as Next — quick for thumbs.
    next();
  }

  function onKey(event) {
    if (!active) return;
    if (event.key === "Escape") {
      event.preventDefault();
      stop();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      next();
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      show(index - 1);
    }
  }

  function stop({ restore = true, mark = true } = {}) {
    if (!active) return;
    active = false;
    stepToken += 1;
    clearTimeout(waitTimer);
    if (positionFrame) cancelAnimationFrame(positionFrame);
    positionFrame = 0;
    window.removeEventListener("resize", schedulePosition);
    window.removeEventListener("orientationchange", schedulePosition);
    document.removeEventListener("keydown", onKey);
    if (layer) {
      layer.removeEventListener("click", onClick);
      layer.remove();
      layer = null;
    }
    if (mark) markSeen();
    const back = startHash && startHash !== location.hash ? startHash : "";
    if (restore && back) {
      try { location.hash = back; } catch { /* ignore */ }
    }
    if (lastFocus?.isConnected) {
      try { lastFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
    lastFocus = null;
  }

  function canAutoStart() {
    if (T.isDeveloperAccount?.()) return false;
    if (T.firstRunNeeded?.()) return false;
    if (T.cloudWaiting?.()) return false;
    if (T.staffBlocked?.()) return false;
    if (T.subscriptionLocked?.()) return false;
    if (T.sheets?.isOpen?.()) return false;
    if (!location.hash || location.hash === "#/auth") return false;
    // Never walk away from a sale that is already in the cart.
    if ((T.itemCount?.() || 0) > 0) return false;
    const store = T.state?.store || {};
    const name = String(store.name || "").trim().toLowerCase();
    if (!name || name === "my store") return false;
    if (!(T.staffRoster?.() || []).length) return false;
    // Once the shop has rung a sale it is no longer "new"; the tour stays
    // available from Settings, but it never jumps in mid-trade.
    if ((T.state?.transactions || []).length) return false;
    return true;
  }

  function start(opts = {}) {
    if (active) return;
    if (opts.auto) {
      if (seen() || !canAutoStart()) return;
    }
    if (!document.getElementById("app")) return;

    steps = buildSteps();
    steps[0].body = noProducts()
      ? "Your shop is set up. In one minute: add your first product, ring a sale, and see where the money lives."
      : "A quick look at selling, stock, debts and reports. You can skip at any time.";

    active = true;
    index = 0;
    stepToken += 1;
    startHash = location.hash || "#/sell";
    lastFocus = document.activeElement;
    layer = ensureLayer();
    if (!layer) { active = false; return; }

    layer.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", schedulePosition);
    window.addEventListener("orientationchange", schedulePosition);

    show(0);
    T.vibrate?.(12);
  }

  function auto() {
    if (active || seen()) return;
    if (Date.now() - autoTryAt < 5000) return;
    autoTryAt = Date.now();
    if (!canAutoStart()) return;
    start({ auto: true });
  }

  T.tour = {
    start,
    auto,
    stop,
    seen,
    reset() {
      try { localStorage.removeItem(storageKey()); } catch { /* ignore */ }
    },
    isActive: () => active
  };
})();
