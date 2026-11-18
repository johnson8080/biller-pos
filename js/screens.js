/* ============================================================
   Till — screen templates
   ============================================================ */
(() => {
  "use strict";
  const T = window.Till;
  if (!T) throw new Error("Till core must load before screens.");
  const { esc, money, compactMoney } = T;

  const icon = (name, cls = "ico") => `<svg class="${cls}" aria-hidden="true"><use href="#${name}"></use></svg>`;
  // App version comes from index.html (window.ASSET_VERSION), so the About
  // screen, Settings and the Sell hero always show the same version.
  const VERSION = String(window.ASSET_VERSION || "").trim();
  // Currency symbol lives on the label line; the value line carries only the
  // digits ("1,234" not "Ksh1,234.00").
  const currencySymbol = () => (typeof T.currencySymbol === "function" ? T.currencySymbol() : "");
  const amountOnly = (value) => String(value).split(currencySymbol()).join("").trim();
  const supplierDayLabel = (code) => (T.SUPPLIER_DAYS.find(([key]) => key === code) || [code, code])[1];

  function productTile(product, size = "") {
    return `<span class="tile ${size} tone-${T.toneFor(product.category)}" aria-hidden="true">${esc(T.initials(product.name))}</span>`;
  }

  function stockNote(product) {
    const stock = T.productStock(product);
    if (stock === 0) return `<span class="stock-note out"><span class="dot"></span>Sold out</span>`;
    if (product.soldByMass) {
      const label = T.massLabel(stock);
      if (stock <= product.lowStockAt) return `<span class="stock-note low"><span class="dot"></span>${esc(label)}</span>`;
      return `<span class="stock-note">${esc(label)}</span>`;
    }
    const unit = T.stockCountUnit ? T.stockCountUnit(product) : (product.unit || "pcs");
    const pieceLike = ["pcs", "each", "", "piece", "pieces"].includes(String(unit || "").toLowerCase());
    const countLabel = `${stock} ${pieceLike ? "pieces" : unit}`;
    const sizeLabel = T.unitSizeLabel(product);
    // "10 pieces · 100 g/piece" — what one sale removes from the shelf.
    const sizeSuffix = pieceLike && sizeLabel ? ` · ${sizeLabel}/piece` : "";
    const variantSuffix = (product.variants || []).length ? ` · ${product.variants.length} variants` : "";
    const copy = esc(countLabel + sizeSuffix);
    if (stock <= product.lowStockAt) return `<span class="stock-note low"><span class="dot"></span>${copy}${variantSuffix}</span>`;
    return `<span class="stock-note">${copy}${variantSuffix}</span>`;
  }

  /** Per-variant stock at a glance, shown on the card before the picker opens. */
  function variantStockLine(product) {
    const variants = product?.variants || [];
    if (!variants.length) return "";
    const parts = [];
    if (product.sellParent) {
      // Plain line sellable alongside its variants — show the parent's own stock.
      const plainLabel = (T.unitSizeLabel ? T.unitSizeLabel(product) : "") || product.detail || "Plain item";
      parts.push(`${plainLabel} ${product.stock}`);
    }
    parts.push(...variants.map((v) => `${v.label} ${v.stock}`));
    const visible = parts.slice(0, 3);
    if (parts.length > 3) visible.push(`+${parts.length - 3} more`);
    return visible.join(" · ");
  }

  /** "The price a product sells at: min variant price, or per kg / per bundle. */
  function priceTag(product) {
    if (product.soldByMass) return `${money(product.price)}/kg`;
    const isBundle = ["dozen", "packet", "box", "crate"].includes(String(product.soldBy || ""));
    if (isBundle && product.packSize > 0) {
      const unit = product.packLabel || product.soldBy || "packet";
      return `${money(product.price * product.packSize)}/${unit}`;
    }
    const prices = [];
    if (product.sellParent) prices.push(product.price);
    for (const variant of product.variants || []) prices.push(variant.price);
    if (prices.length > 1) {
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      if (min !== max) {
        const symbol = T.currencySymbol ? T.currencySymbol() : "KES";
        return `${symbol}${Math.round(min / 100)}\u2013${Math.round(max / 100)}`;
      }
      return money(min);
    }
    if (prices.length === 1) return money(prices[0]);
    return money(product.price);
  }

  function qtyInCart(productId) {
    return T.state.cart.items.reduce((sum, item) => item.productId === productId ? sum + item.qty : sum, 0);
  }

  /** How much of a weighed item is already in the sale, as a short label. */
  function qtyBadgeText(product, qty) {
    if (!qty) return "";
    return product.soldByMass ? T.massLabel(qty) : String(qty);
  }

  /* ---------- App chrome ---------- */

  function appbarInner(route) {
    if (route.name === "scan") return "";
    if (route.name === "debt" && route.param) {
      const customer = T.findCustomer(route.param);
      return `
        <button class="icon-btn ghost" data-nav="#/debt" aria-label="Go back to debt">${icon("i-back")}</button>
        <div class="appbar-context"><div class="appbar-title">${esc(customer?.name || "Customer")}</div></div>
        <div class="appbar-right">${customer ? `<button class="text-btn" data-act="customer-payment" data-id="${esc(customer.id)}">Pay</button>` : ""}</div>`;
    }
    if (route.name === "plans") {
      return `
        <button class="icon-btn ghost" data-nav="#/more" aria-label="Go back">${icon("i-back")}</button>
        <div class="appbar-context"><div class="appbar-title">Subscriptions</div></div>
        <div class="appbar-right"></div>`;
    }
    if (["cart", "payment", "receipt", "account", "store", "supplier", "mpesa"].includes(route.name)) {
      const supplier = route.name === "supplier" ? T.findSupplier(route.param) : null;
      const config = {
        cart: { title: "Checkout", back: "#/sell", action: `<button class="text-btn danger" data-act="clear-cart">Clear</button>` },
        payment: { title: "Take payment", back: "#/cart", action: "" },
        receipt: { title: "Receipt", back: T.ui.justPaidId ? "#/sell" : "#/orders", action: `<button class="text-btn" data-act="new-sale">New sale</button>` },
        account: { title: "Account", back: "#/more", action: "" },
        store: { title: "Store & receipts", back: "#/more", action: "" },
        mpesa: { title: "M-Pesa", back: "#/store", action: "" },
        supplier: { title: supplier?.name || "Supplier", back: "#/suppliers", action: supplier ? `<button class="text-btn" data-act="edit-supplier" data-id="${esc(supplier.id)}">Edit</button>` : "" }
      }[route.name];
      return `
        <button class="icon-btn ghost" data-nav="${config.back}" aria-label="Go back">${icon("i-back")}</button>
        <div class="appbar-context"><div class="appbar-title">${esc(config.title)}</div></div>
        <div class="appbar-right">${config.action}</div>`;
    }
    const session = T.getSession();
    const initial = (session?.email || T.state.store.staff || T.state.store.name || "S").slice(0, 1).toUpperCase();
    const cartCount = T.itemCount();
    const isSell = route.name === "sell";
    return `
      <a class="brand" href="#/sell" data-nav="#/sell" aria-label="Biller POS home">
        <span class="brand-mark">${icon("i-store")}</span>
        <span class="brand-name">Biller POS</span>
      </a>
      <div class="appbar-right">
        ${isSell ? `<button class="hero-btn hero-scan" data-act="open-scanner" aria-label="Scan barcode">${icon("i-scan")}</button>
        <button class="hero-btn hero-search ${T.ui.searchOpen ? "is-active" : ""}" data-act="toggle-search" aria-label="${T.ui.searchOpen ? "Close search" : "Search products"}" aria-pressed="${T.ui.searchOpen ? "true" : "false"}">${icon("i-search")}</button>` : ""}
        ${T.isDeveloperAccount() ? `<button class="hero-btn" data-nav="#/plans" aria-label="Online accounts">${icon("i-eye")}</button>` : ""}
        <button class="cart-hero" data-act="open-cart" aria-label="Checkout, ${cartCount} ${cartCount === 1 ? "item" : "items"} in the cart">
          ${icon("i-bag")}
          ${cartCount ? `<span class="cart-hero-count">${cartCount}</span>` : ""}
        </button>
        <button class="avatar" data-act="open-account" aria-label="${session ? `Account ${esc(session.email)}` : "Account and settings"}">
          ${esc(initial)}
          ${session ? `<span class="avatar-status" aria-hidden="true">${icon("i-check")}</span>` : ""}
        </button>
      </div>`;
  }

  /**
   * The top bar's contents — app icon and name, the scan/eye/cart actions and
   * the account avatar — sit inside one bordered bar, the same border design
   * used elsewhere in the app.
   */
  function appbar(route) {
    const inner = appbarInner(route);
    return inner ? `<div class="appbar-bar">${inner}</div>` : "";
  }

  const TABS = [
    { id: "sell", label: "SELL", icon: "i-bag", path: "#/sell" },
    { id: "orders", label: "ORDERS", icon: "i-receipt", path: "#/orders" },
    { id: "debt", label: "DEBT", icon: "i-user", path: "#/debt" },
    { id: "stock", label: "STOCK", icon: "i-box", path: "#/stock" },
    { id: "suppliers", label: "SUPPLIERS", icon: "i-truck", path: "#/suppliers" },
    { id: "reports", label: "REPORTS", icon: "i-chart", path: "#/reports" },
    { id: "more", label: "SETTINGS", icon: "i-more", path: "#/more" }
  ];

  function tabbar(route) {
    const dueCount = T.debtDueCount?.() || 0;
    return TABS.map((tab) => {
      const active = route.name === tab.id;
      const badge = tab.id === "debt" && dueCount
        ? `<span class="tab-badge" aria-hidden="true">${dueCount > 9 ? "9+" : dueCount}</span>`
        : "";
      return `<button class="tab ${active ? "is-active" : ""}" data-nav="${tab.path}" ${active ? 'aria-current="page"' : ""} aria-label="${tab.label}${tab.id === "debt" && dueCount ? `, ${dueCount} due` : ""}">
        <span class="tab-icon">${icon(tab.icon)}${badge}</span><span class="tab-label">${tab.label}</span>
      </button>`;
    }).join("");
  }

  function dock() {
    // The cart lives in the hero bar now, so the bottom dock stays empty.
    return "";
  }

  /* ---------- Sell ---------- */

  function filteredProducts() {
    const query = T.ui.search.trim().toLowerCase();
    const category = T.ui.category;
    const matched = T.state.products.filter((product) => {
      if (category !== "All" && product.category !== category) return false;
      if (!query) return true;
      return `${product.name} ${product.detail} ${product.category} ${product.barcode}`.toLowerCase().includes(query);
    });
    const sort = T.sellSort?.() || "new";
    if (sort === "az") {
      matched.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }));
    } else if (sort === "za") {
      matched.sort((a, b) => String(b.name).localeCompare(String(a.name), undefined, { sensitivity: "base" }));
    }
    // "new" keeps the catalog order, which is newest first.
    return matched;
  }

  function productCard(product) {
    const qty = qtyInCart(product.id);
    const out = T.productStock(product) === 0;
    const badge = qtyBadgeText(product, qty);
    const price = priceTag(product);
    return `<button class="product-card ${out ? "is-out" : ""}" data-act="add-to-cart" data-id="${esc(product.id)}"
      aria-label="${out ? "Out of stock: " : "Add "}${esc(product.name)}, ${esc(price)}">
      <span class="card-top">${productTile(product)}${stockNote(product)}${badge ? `<span class="qty-badge">${esc(badge)}</span>` : ""}</span>
      <span class="product-name">${esc(product.name)}</span>
      ${(() => {
        const detailLine = variantStockLine(product) || [T.unitSizeLabel(product), T.bundleLabel(product), product.detail].filter(Boolean).join(" · ");
        return detailLine ? `<span class="product-detail">${esc(detailLine)}</span>` : `<span class="product-detail is-empty" aria-hidden="true"></span>`;
      })()}
      <span class="card-bottom"><span class="product-price">${esc(price)}</span></span>
    </button>`;
  }

  /** One item per row, for shops that read a long list better. */
  function productRow(product) {
    const qty = qtyInCart(product.id);
    const out = T.productStock(product) === 0;
    const unit = T.stockCountUnit ? T.stockCountUnit(product) : (product.unit || "pcs");
    const badge = qtyBadgeText(product, qty);
    const price = priceTag(product);
    const stockText = out ? "Sold out" : product.soldByMass ? `${T.massLabel(T.productStock(product))} in stock` : `${T.productStock(product)} ${esc(unit)} in stock`;
    return `<button class="product-row ${out ? "is-out" : ""}" data-act="add-to-cart" data-id="${esc(product.id)}"
      aria-label="${out ? "Out of stock: " : "Add "}${esc(product.name)}, ${esc(price)}">
      <span class="product-row-tile">${productTile(product)}</span>
      <span class="product-row-copy">
        <strong>${esc(product.name)}</strong>
        <small>${[variantStockLine(product) || [T.unitSizeLabel(product), T.bundleLabel(product), product.detail].filter(Boolean).join(" · "), stockText].filter(Boolean).map(esc).join(" · ")}</small>
      </span>
      <span class="product-row-price">${esc(price)}</span>
      ${badge ? `<span class="qty-badge">${esc(badge)}</span>` : ""}
    </button>`;
  }

  function sellResults() {
    const products = filteredProducts();
    const categories = T.categories();
    const chips = ["All", ...categories].filter((category) => category === "All" || T.state.products.some((p) => p.category === category));
    const query = T.ui.search.trim();
    const canAdd = /^[0-9A-Za-z\-]{6,32}$/.test(query);
    let list;
    if (!products.length) {
      const noStockAtAll = !T.state.products.length;
      list = noStockAtAll
        ? `<div class="empty-state">
        <div class="empty-icon">${icon("i-box")}</div>
        <h3>No stock yet</h3>
        <p>Add the items you sell and they show up here, ready to scan or tap.</p>
        <button class="btn btn-primary" data-nav="#/stock">${icon("i-plus")} Add your first item</button>
      </div>`
        : `<div class="empty-state">
        <div class="empty-icon">${icon("i-search")}</div>
        <h3>No items match${query ? ` “${esc(query)}”` : ""}</h3>
        <p>Try a different name, category, or barcode.</p>
        ${canAdd ? `<button class="btn btn-primary" data-act="new-from-search">Add “${esc(query)}” as a product</button>` : `<button class="btn btn-ghost" data-act="clear-search">Clear search</button>`}
      </div>`;
    } else {
      const listView = T.sellView?.() === "list";
      list = listView
        ? `<div class="product-list">${products.map(productRow).join("")}</div>`
        : `<div class="product-grid">${products.map(productCard).join("")}</div>`;
    }
    const sort = T.sellSort?.() || "new";
    const sortLabel = sort === "az" ? "A to Z" : sort === "za" ? "Z to A" : "Newest first";
    const listView = T.sellView?.() === "list";
    return `
      <div class="chips" id="category-chips" aria-label="Filter by category">
        ${chips.map((category) => {
          const featured = category === "Groceries" || category === "Beverages" || category === "Snacks";
          return `<button class="chip ${T.ui.category === category ? "is-active" : ""} ${featured ? "is-featured" : ""}" data-act="set-category" data-value="${esc(category)}">${esc(category)}</button>`;
        }).join("")}
      </div>
      <div class="section-head sell-head-row">
        <h2>${T.ui.category === "All" ? "Quick add" : esc(T.ui.category)}</h2>
        <button class="sell-status-box" data-nav="#/account" aria-label="Open account settings">${esc((() => { const d = T.subscriptionActiveDaysLeft?.(); if (d === null || d === undefined) return "Active"; return d <= 0 ? "Overdue" : `${d}d left`; })())}</button>
        <div class="sell-head-tools">
          <span class="small muted">${products.length} ${products.length === 1 ? "item" : "items"}</span>
          <button class="tool-btn" data-act="open-sell-sort" aria-label="Sort items, currently ${esc(sortLabel)}" title="Sort: ${esc(sortLabel)}">${icon("i-sort")}</button>
          <button class="tool-btn" data-act="toggle-sell-view" aria-label="${listView ? "Show items as a grid" : "Show items one per row"}" title="${listView ? "Grid view" : "List view"}">${icon(listView ? "i-grid" : "i-list")}</button>
        </div>
      </div>
      ${list}`;
  }

  /** A gentle reminder on the Sell screen when the monthly plan needs paying. */
  function subscriptionBanner() {
    const status = T.subscriptionStatus();
    if (status !== "due" && status !== "overdue") return "";
    // The full lock panel already explains the pause and carries the payment
    // button, so the small banner would only repeat it on the same screen.
    if (T.subscriptionLocked()) return "";
    const plan = T.planSummary();
    const amount = money(plan.amountCents);
    const text = status === "overdue"
      ? `The ${amount} monthly plan is overdue.`
      : `The ${amount} monthly plan is due.`;
    return `<button class="plan-banner is-${status}" data-act="open-subscription">
      <span class="plan-banner-icon">${icon("i-card")}</span>
      <span class="plan-banner-copy"><strong>${esc(text)}</strong><small>Tap to pay and keep your shop running.</small></span>
      <span class="plan-banner-go">${icon("i-chevron")}</span>
    </button>`;
  }

  function sell() {
    if (T.subscriptionLocked()) return lockedScreen();
    const searchOpen = Boolean(T.ui.searchOpen);
    const retail = T.stockValue();
    const count = T.itemCount();
    const customerDebt = (T.state.customers || []).reduce((sum, c) => {
      // Balance, not just bills: payments made must reduce what is owed.
      const balance = T.customerTotals(c).balance;
      return sum + Math.max(0, balance);
    }, 0);
    const suppliers = T.state.suppliers || [];
    const myDebt = suppliers.reduce((sum, s) => {
      const totals = T.supplierTotals(s);
      return sum + Math.max(0, totals.balance);
    }, 0);

    return `<section class="screen sell" aria-labelledby="sell-title">
      ${searchOpen ? `<div class="search-field sell-search-pop ${T.ui.search ? "has-value" : ""}" id="sell-search-wrap">
        ${icon("i-search")}
        <input id="sell-search" type="search" inputmode="search" autocomplete="off" spellcheck="false"
          placeholder="Search products or barcode" value="${esc(T.ui.search)}" aria-label="Search products">
        <button class="field-clear" data-act="clear-search" aria-label="Clear search">${icon("i-close")}</button>
      </div>` : `<div class="sell-head">
        <div class="sell-meta">
          <span class="sell-meta-item is-shop">${esc(T.state.store.name || "Unnamed shop")}</span>
          <span class="sell-meta-sep" aria-hidden="true"></span>
          <span class="sell-meta-item is-date">${esc(T.shortDateFmt.format(new Date()))}</span>
          <span class="sell-meta-sep" aria-hidden="true"></span>
          ${(() => {
            const selling = T.activeStaff ? T.activeStaff() : (T.state.store.staff || "");
            return selling
              ? `<button class="sell-staff" data-act="choose-staff" aria-label="Selling as ${esc(selling)}. Tap to change">${esc(selling)}<span class="sell-staff-arrow" aria-hidden="true">${icon("i-chevron")}</span></button>`
              : `<span class="sell-meta-empty">No shopkeeper</span>`;
          })()}
          <span class="sell-meta-sep" aria-hidden="true"></span>
          ${VERSION ? `<span class="sell-version">V ${esc(VERSION)}</span>` : `<span class="sell-meta-item">—</span>`}
        </div>
        <div class="sell-title-row">
          <button class="sell-title-col" data-nav="#/stock" aria-label="RETAIL VALUE ${money(retail)}, open inventory">
            <span class="sell-title-label">RETAIL VALUE <span style="text-transform:none">[${esc(currencySymbol())}]</span></span>
            <span class="sell-title-value">${esc(amountOnly(money(retail)))}</span>
          </button>
          <button class="sell-title-col" data-nav="#/debt" aria-label="Customer debt ${money(customerDebt)}, open customer debt">
            <span class="sell-title-label">Customer debt <span style="text-transform:none">[${esc(currencySymbol())}]</span></span>
            <span class="sell-title-value is-debt">${esc(amountOnly(money(customerDebt)))}</span>
          </button>
          <button class="sell-title-col" data-nav="#/suppliers" aria-label="Supplier debt ${money(myDebt)}, open suppliers">
            <span class="sell-title-label">Supplier debt <span style="text-transform:none">[${esc(currencySymbol())}]</span></span>
            <span class="sell-title-value is-debt">${esc(amountOnly(money(myDebt)))}</span>
          </button>
        </div>
        <p class="sub"></p>
      </div>`}
      ${subscriptionBanner()}
      ${subscriptionLockPanel()}
      <div id="sell-results">${sellResults()}</div>
    </section>`;
  }

  /* ---------- Orders ---------- */

  function ordersList() {
    const filter = T.ui.ordersFilter;
    const transactions = T.state.transactions
      .filter((tx) => filter === "all" || tx.payment.method === filter)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (!transactions.length) {
      const filterLabel = filter === "mpesa" ? "M-Pesa" : filter;
      return `<div class="empty-state">
        <div class="empty-icon">${icon("i-receipt")}</div>
        <h3>${filter === "all" ? "No orders yet" : `No ${filterLabel} orders`}</h3>
        <p>${filter === "all" ? "Completed sales will appear here, with receipts you can share." : "Try a different payment filter."}</p>
        ${filter === "all" ? `<button class="btn btn-primary" data-nav="#/sell">Start a sale</button>` : `<button class="btn btn-ghost" data-act="set-order-filter" data-value="all">Show all orders</button>`}
      </div>`;
    }
    const groups = [];
    for (const tx of transactions) {
      const label = T.dayLabel(tx.createdAt);
      let group = groups.find((g) => g.label === label);
      if (!group) { group = { label, items: [] }; groups.push(group); }
      group.items.push(tx);
    }
    return `<div class="orders-list">${groups.map((group) => `
      <div class="date-group">
        <div class="date-label">${esc(group.label)}</div>
        ${group.items.map((tx) => {
          const count = tx.items.reduce((sum, item) => sum + item.qty, 0);
          const method = tx.payment.method === "cash" || tx.payment.method === "card" || tx.payment.method === "mpesa" ? tx.payment.method : "debt";
          const methodIcon = method === "cash" ? "i-cash" : method === "card" ? "i-card" : method === "mpesa" ? "i-phone" : "i-user";
          const tone = method === "cash" ? "fresh" : method === "card" ? "goods" : method === "mpesa" ? "fresh" : "bakery";
          const methodLabel = method === "mpesa" ? "M-Pesa" : method;
          // The shopkeeper who rang the sale up, shown in the open middle of
          // the card. Sales made before staff tracking carry no stamp — they
          // show a dash instead of guessing one person for all of them.
          const staffName = String(tx.staff || "").trim();
          return `<button class="order-row" data-nav="#/receipt/${esc(tx.id)}" aria-label="Open receipt ${tx.receiptNo}, ${money(tx.total)}${staffName ? `, sold by ${esc(staffName)}` : ""}">
            <span class="tile tile-sm tone-${tone}" aria-hidden="true">${icon(methodIcon, "ico")}</span>
            <span class="order-main">
              <span class="order-title">#${tx.receiptNo} <span class="method ${method}">${icon(methodIcon, "ico")}${methodLabel}</span></span>
              <span class="order-sub">${count} ${count === 1 ? "item" : "items"} · ${T.timeFmt.format(new Date(tx.createdAt))}</span>
            </span>
            <span class="order-staff ${staffName ? "" : "is-empty"}" aria-hidden="true">${staffName ? esc(staffName) : "—"}</span>
            <span class="order-total">${money(tx.total)}</span>
            <span class="order-chevron">${icon("i-chevron")}</span>
          </button>`;
        }).join("")}
      </div>`).join("")}</div>`;
  }

  function orders() {
    const today = T.state.transactions.filter((tx) => T.isToday(tx.createdAt));
    const todayTotal = today.reduce((sum, tx) => sum + tx.total, 0);
    const cash = today.filter((tx) => tx.payment.method === "cash").reduce((sum, tx) => sum + tx.total, 0);
    const card = today.filter((tx) => tx.payment.method === "card").reduce((sum, tx) => sum + tx.total, 0);
    const mpesa = today.filter((tx) => tx.payment.method === "mpesa").reduce((sum, tx) => sum + tx.total, 0);
    const debt = today.filter((tx) => tx.payment.method === "debt").reduce((sum, tx) => sum + tx.total, 0);
    return `<section class="screen" aria-labelledby="orders-title">
      <div class="screen-head">
        <h1 id="orders-title">ORDERS</h1>
        <p class="sub">Every sale, receipt, and payment method.</p>
      </div>
      <div class="sales-hero">
        <p class="eyebrow">Today’s sales</p>
        <div class="sales-hero-top">
          <div class="sales-amount money">${money(todayTotal)}</div>
          <div class="sales-hero-date">${esc(T.shortDateFmt.format(new Date()))}</div>
        </div>
        <div class="sales-hero-foot">
          <span><strong>${today.length}</strong> ${today.length === 1 ? "order" : "orders"}</span>
          <span class="sep"></span>
          <span>Cash <strong>${compactMoney(cash)}</strong></span>
          <span class="sep"></span>
          <span>M-Pesa <strong>${compactMoney(mpesa)}</strong></span>
          <span class="sep"></span>
          <span>Card <strong>${compactMoney(card)}</strong></span>
          <span class="sep"></span>
          <span>Debt <strong>${compactMoney(debt)}</strong></span>
        </div>
      </div>
      <div class="chips order-filters" aria-label="Filter orders by payment">
        ${["all", "cash", "mpesa", "card", "debt"].map((value) => `<button class="chip ${T.ui.ordersFilter === value ? "is-active" : ""}" data-act="set-order-filter" data-value="${value}">${value === "all" ? "All orders" : value === "mpesa" ? "M-Pesa" : value[0].toUpperCase() + value.slice(1)}</button>`).join("")}
      </div>
      <div id="orders-list">${ordersList()}</div>
    </section>`;
  }

  /* ---------- Reports ---------- */

  function reports() {
    const txs = T.state.transactions;
    const now = new Date();
    const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const today = txs.filter((tx) => T.isToday(tx.createdAt));
    const todayTotal = today.reduce((sum, tx) => sum + tx.total, 0);
    const todayItems = today.reduce((sum, tx) => sum + tx.items.reduce((n, item) => n + item.qty, 0), 0);
    const cash = today.filter((tx) => tx.payment.method === "cash").reduce((sum, tx) => sum + tx.total, 0);
    const card = today.filter((tx) => tx.payment.method === "card").reduce((sum, tx) => sum + tx.total, 0);
    const mpesa = today.filter((tx) => tx.payment.method === "mpesa").reduce((sum, tx) => sum + tx.total, 0);
    const debt = today.filter((tx) => tx.payment.method === "debt").reduce((sum, tx) => sum + tx.total, 0);

    // Profit: what the sales earned over what the stock cost.
    const profitOf = (list) => list.reduce((sum, tx) => sum + T.txProfit(tx).profit, 0);
    const revenueOf = (list) => list.reduce((sum, tx) => sum + T.txProfit(tx).revenue, 0);
    const todayProfit = profitOf(today);
    const todayRevenue = revenueOf(today);
    const todayMargin = todayRevenue > 0 ? todayProfit / todayRevenue : 0;
    const missingCost = T.state.products.some((product) => !product.cost);

    const weekStart = startOfDay(now);
    weekStart.setDate(weekStart.getDate() - 6);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const sumSince = (start) => txs.filter((tx) => new Date(tx.createdAt) >= start).reduce((sum, tx) => sum + tx.total, 0);
    const weekTotal = sumSince(weekStart);
    const monthTotal = sumSince(monthStart);
    const weekProfit = profitOf(txs.filter((tx) => new Date(tx.createdAt) >= weekStart));
    const monthProfit = profitOf(txs.filter((tx) => new Date(tx.createdAt) >= monthStart));
    const avgSale = today.length ? todayTotal / today.length : 0;

    // Payment mix over a chosen window: today, the week, the month or all.
    const mixPeriod = ["today", "week", "month", "all"].includes(T.ui.reportMixPeriod) ? T.ui.reportMixPeriod : "today";
    const mixStart = mixPeriod === "today" ? startOfDay(now)
      : mixPeriod === "week" ? weekStart
        : mixPeriod === "month" ? monthStart
          : new Date(0);
    const mixTxs = txs.filter((tx) => new Date(tx.createdAt) >= mixStart);
    const mixTotal = mixTxs.reduce((sum, tx) => sum + tx.total, 0);
    const mixMethods = ["cash", "mpesa", "card", "debt"].map((method) => {
      const rows = mixTxs.filter((tx) => tx.payment.method === method);
      return {
        method,
        count: rows.length,
        total: rows.reduce((sum, tx) => sum + tx.total, 0)
      };
    });

    // Last seven days, oldest first, for the little bar chart.
    const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short" });
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const day = startOfDay(now);
      day.setDate(day.getDate() - i);
      const total = txs.filter((tx) => {
        const stamp = new Date(tx.createdAt);
        return stamp.getFullYear() === day.getFullYear() && stamp.getMonth() === day.getMonth() && stamp.getDate() === day.getDate();
      }).reduce((sum, tx) => sum + tx.total, 0);
      days.push({ label: dayFmt.format(day), total, today: i === 0 });
    }
    const maxDay = Math.max(...days.map((day) => day.total), 1);

    // Best sellers from the last 30 days, falling back to all sales.
    const since30 = startOfDay(now);
    since30.setDate(since30.getDate() - 29);
    const recent = txs.filter((tx) => new Date(tx.createdAt) >= since30);
    const source = recent.length ? recent : txs;
    const sellers = new Map();
    for (const tx of source) {
      for (const item of tx.items) {
        const entry = sellers.get(item.productId) || { name: item.name, detail: item.detail, qty: 0, revenue: 0, mass: item.soldByMass === true };
        entry.qty += item.qty;
        entry.revenue += T.itemRevenue(item);
        sellers.set(item.productId, entry);
      }
    }
    const top = [...sellers.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);

    // The weekly leaderboard the shop asked for: just the last 7 days.
    const topPeriod = T.ui.topSellersPeriod === "30" ? 30 : 7;
    const topStart = startOfDay(now);
    topStart.setDate(topStart.getDate() - (topPeriod - 1));
    const topWindow = txs.filter((tx) => new Date(tx.createdAt) >= topStart);
    const weekSellers = new Map();
    for (const tx of topWindow) {
      for (const item of tx.items) {
        const entry = weekSellers.get(item.productId) || { name: item.name, detail: item.detail, qty: 0, revenue: 0, mass: item.soldByMass === true };
        entry.qty += item.qty;
        entry.revenue += T.itemRevenue(item);
        weekSellers.set(item.productId, entry);
      }
    }
    const topWeek = [...weekSellers.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5);

    // Staff scoreboard: how the shopkeepers' sales compare over the window,
    // so a multi-staff shop can see who is moving the most stock. Sales from
    // before staff tracking have no stamp — they stay unattributed and out
    // of the ranking instead of piling onto one person's name.
    const sellerPeriod = T.ui.sellerPeriod === "30" ? 30 : 7;
    const sellerStart = startOfDay(now);
    sellerStart.setDate(sellerStart.getDate() - (sellerPeriod - 1));
    const sellerWindow = txs.filter((tx) => new Date(tx.createdAt) >= sellerStart);
    const staffTotals = new Map();
    let unattributed = 0;
    for (const tx of sellerWindow) {
      const name = String(tx.staff || "").trim();
      if (!name) { unattributed += 1; continue; }
      const row = staffTotals.get(name) || { name, count: 0, total: 0, items: 0 };
      row.count += 1;
      row.total += tx.total;
      row.items += tx.items.reduce((n, item) => n + item.qty, 0);
      staffTotals.set(name, row);
    }
    const staffBoard = [...staffTotals.values()].sort((a, b) => b.total - a.total);

    // The monthly target the shop set, next to what the month made so far.
    const target = T.monthTarget?.() || { set: false };
    const targetMonthName = new Intl.DateTimeFormat("en-US", { month: "long" }).format(now);
    // Wastage: what left the shelf without a sale, in the chosen window.
    const wastagePeriod = ["7", "30", "all"].includes(String(T.ui.wastagePeriod)) ? String(T.ui.wastagePeriod) : "30";
    const wastageReport = T.wastageSince ? T.wastageSince(wastagePeriod === "all" ? 365000 : Number(wastagePeriod)) : { entries: [], count: 0, qty: 0, cost: 0 };
    const wastageReasons = new Map();
    for (const entry of wastageReport.entries || []) {
      const key = String(entry.reason || "Other");
      wastageReasons.set(key, (wastageReasons.get(key) || 0) + 1);
    }
    const wastageTopReasons = [...wastageReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

    // Profit per item, so the shop can see what really pays.
    const profitRows = new Map();
    for (const tx of source) {
      for (const item of tx.items) {
        const entry = profitRows.get(item.productId) || {
          name: item.name,
          detail: item.detail,
          qty: 0,
          revenue: 0,
          cost: 0,
          mass: item.soldByMass === true
        };
        const unitCost = item.cost ?? (T.findProduct(item.productId)?.cost || 0);
        entry.qty += item.qty;
        entry.revenue += T.itemRevenue(item);
        entry.cost += item.soldByMass ? Math.round(unitCost * item.qty / 1000) : unitCost * item.qty;
        profitRows.set(item.productId, entry);
      }
    }
    const profitTop = [...profitRows.values()]
      .map((entry) => ({ ...entry, profit: entry.revenue - entry.cost }))
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 5);

    if (!txs.length) {
      return `<section class="screen" aria-labelledby="reports-title">
        <div class="screen-head">
          <h1 id="reports-title">REPORTS</h1>
        </div>
        <p class="sub" style="margin-top:-4px">Sales, profit, best sellers, and payment mix.</p>
        <div class="empty-state">
          <div class="empty-icon">${icon("i-chart")}</div>
          <h3>No sales to report yet</h3>
          <p>Complete a sale and your daily totals, profit, best sellers, and payment breakdown appear here.</p>
          <button class="btn btn-primary" data-nav="#/sell">Start a sale</button>
        </div>
      </section>`;
    }

    return `<section class="screen" aria-labelledby="reports-title">
      <div class="screen-head">
        <h1 id="reports-title">REPORTS</h1>
      </div>
      <p class="sub" style="margin-top:-4px">Sales, profit, best sellers, and payment mix.</p>

      <div class="sales-hero">
        <p class="eyebrow">Today’s revenue</p>
        <div class="sales-hero-top">
          <div class="sales-amount money">${money(todayTotal)}</div>
          <div class="sales-hero-date">${esc(T.shortDateFmt.format(now))}</div>
        </div>
        <div class="sales-hero-foot">
          <span><strong>${today.length}</strong> ${today.length === 1 ? "order" : "orders"}</span>
          <span class="sep"></span>
          <span>Cash <strong>${compactMoney(cash)}</strong></span>
          <span class="sep"></span>
          <span>M-Pesa <strong>${compactMoney(mpesa)}</strong></span>
          <span class="sep"></span>
          <span>Card <strong>${compactMoney(card)}</strong></span>
          <span class="sep"></span>
          <span>Debt <strong>${compactMoney(debt)}</strong></span>
        </div>
        <div class="sales-hero-profit">
          <span>Profit today</span>
          <strong class="money">${money(todayProfit)}</strong>
          <span class="profit-margin">${todayRevenue > 0 ? `${Math.round(todayMargin * 100)}% margin` : "set buying prices to see margin"}</span>
        </div>
      </div>
      ${missingCost ? `<p class="report-note">Some items have no buying price yet. Set it when you add stock to see the real profit.</p>` : ""}

      ${target.set ? `<div class="settings-card target-card ${target.met ? "is-met" : ""}">
        <div class="report-card-head"><h2>${esc(targetMonthName)} target</h2><span class="report-total">${target.percent}%</span></div>
        <div class="target-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, target.percent)}"><span style="width:${Math.min(100, target.percent)}%"></span></div>
        <div class="target-nums">
          <strong>${money(target.made)}</strong>
          <span>of ${money(target.amountCents)}</span>
          ${target.met
            ? `<span class="target-flag">${icon("i-check")} Target reached</span>`
            : `<span class="target-left">${compactMoney(target.remaining)} to go</span>`}
        </div>
        <button class="text-btn target-edit" data-act="open-target">Change the target</button>
      </div>`
        : `<button class="btn btn-ghost btn-block target-offer" data-act="open-target">${icon("i-chart")} Set a monthly sales target</button>`}

      <div class="report-stats">
        <div class="report-stat"><span class="label">Sales (7 days)</span><strong>${compactMoney(weekTotal)}</strong></div>
        <div class="report-stat"><span class="label">This month</span><strong>${compactMoney(monthTotal)}</strong></div>
        <div class="report-stat"><span class="label">Average sale</span><strong>${compactMoney(avgSale)}</strong></div>
        <div class="report-stat"><span class="label">Items today</span><strong>${todayItems}</strong></div>
        <div class="report-stat is-profit"><span class="label">Profit today</span><strong>${compactMoney(todayProfit)}</strong></div>
        <div class="report-stat is-profit"><span class="label">Profit this week</span><strong>${compactMoney(weekProfit)}</strong></div>
        <div class="report-stat is-profit"><span class="label">Profit this month</span><strong>${compactMoney(monthProfit)}</strong></div>
        <div class="report-stat"><span class="label">Stock at cost</span><strong>${compactMoney(T.stockCost())}</strong></div>
      </div>

      <div class="settings-card">
        <div class="report-card-head"><h2>Sales (last 7 days)</h2><span class="report-total">${compactMoney(weekTotal)}</span></div>
        <div class="report-chart" role="img" aria-label="Sales for the last seven days">
          ${days.map((day) => `<div class="chart-col ${day.today ? "is-today" : ""}" title="${esc(day.label)}: ${money(day.total)}">
            <span class="chart-bar" style="height:${Math.max(3, Math.round((day.total / maxDay) * 82))}px"></span>
            <span class="chart-day">${esc(day.label)}</span>
          </div>`).join("")}
        </div>
      </div>

      <div class="settings-card">
        <div class="report-card-head"><h2>Top sellers</h2>
          <span class="report-chips" role="group" aria-label="Top sellers period">
            <button class="chip chip-sm ${topPeriod === 7 ? "is-active" : ""}" data-act="set-top-period" data-value="7">7 days</button>
            <button class="chip chip-sm ${topPeriod === 30 ? "is-active" : ""}" data-act="set-top-period" data-value="30">30 days</button>
          </span>
        </div>
        ${(topPeriod === 7 ? topWeek : top).length ? `<div class="report-list">${(topPeriod === 7 ? topWeek : top).map((item, index) => `
          <div class="report-row">
            <span class="report-rank">${index + 1}</span>
            <span class="report-row-copy"><strong>${esc(item.name)}</strong><small>${item.mass ? esc(T.massLabel(item.qty)) : item.qty} sold${item.detail ? ` · ${esc(item.detail)}` : ""}</small></span>
            <span class="report-amount">${money(item.revenue)}</span>
          </div>`).join("")}</div>`
          : `<p class="report-empty">No items sold in this window yet.</p>`}
        ${topPeriod === 7 ? `<p class="report-note">Ranked by what they brought in over the last 7 days.</p>` : ""}
      </div>

      ${staffBoard.length >= 2 ? `<div class="settings-card">
        <div class="report-card-head"><h2>Staff scoreboard</h2>
          <span class="report-chips" role="group" aria-label="Staff scoreboard period">
            <button class="chip chip-sm ${sellerPeriod === 7 ? "is-active" : ""}" data-act="set-seller-period" data-value="7">7 days</button>
            <button class="chip chip-sm ${sellerPeriod === 30 ? "is-active" : ""}" data-act="set-seller-period" data-value="30">30 days</button>
          </span>
        </div>
        <div class="report-list">
          ${staffBoard.map((row, index) => `
            <div class="report-row ${index === 0 ? "is-top" : ""}">
              <span class="report-rank">${index + 1}</span>
              <span class="report-row-copy"><strong>${esc(row.name)}</strong><small>${row.count} ${row.count === 1 ? "sale" : "sales"} · ${row.items} ${row.items === 1 ? "item" : "items"}${index === 0 ? ` · ${Math.round((row.total / (staffBoard.reduce((sum, r) => sum + r.total, 0)) || 1) * 100)}% of sales` : ""}</small></span>
              <span class="report-amount ${index === 0 ? "is-profit" : ""}">${money(row.total)}</span>
            </div>`).join("")}
        </div>
        <p class="report-note">Ranked by sales taken. Each name is the shopkeeper who rang the sales up on their device.${unattributed ? ` ${unattributed} ${unattributed === 1 ? "sale" : "sales"} from before staff tracking show no name and are not ranked.` : ""}</p>
      </div>` : ""}

      <div class="settings-card">
        <div class="report-card-head"><h2>Profit by item</h2><span class="report-total">Last 30 days</span></div>
        ${profitTop.length ? `<div class="report-list">${profitTop.map((item) => `
          <div class="report-row">
            <span class="report-row-copy"><strong>${esc(item.name)}</strong><small>${item.qty} sold · cost ${money(item.cost)}</small></span>
            <span class="report-amount is-profit">${money(item.profit)}</span>
          </div>`).join("")}</div>` : `<p class="report-empty">No items sold yet.</p>`}
        ${profitTop.length ? `<p class="report-note">Profit is the selling price minus the buying price, before tax.</p>` : ""}
      </div>

      <div class="settings-card">
        <div class="report-card-head"><h2>Payment mix</h2>
          <span class="report-chips" role="group" aria-label="Payment mix period">
            ${[["today", "Today"], ["week", "7 days"], ["month", "Month"], ["all", "All"]].map(([value, label]) => `<button class="chip chip-sm ${mixPeriod === value ? "is-active" : ""}" data-act="set-mix-period" data-value="${value}">${label}</button>`).join("")}
          </span>
        </div>
        <div class="pay-mix">
          ${mixMethods.map((row) => {
            const label = { cash: "Cash", mpesa: "M-Pesa", card: "Card", debt: "Debt" }[row.method];
            const tone = { cash: "", mpesa: "is-mpesa", card: "is-card", debt: "is-debt" }[row.method];
            return `<div class="pay-mix-row">
              <span class="pay-mix-label">${label}</span>
              <span class="pay-mix-bar ${tone}"><span style="width:${mixTotal ? Math.round((row.total / mixTotal) * 100) : 0}%"></span></span>
              <span class="pay-mix-value">${compactMoney(row.total)}<small>${row.count} ${row.count === 1 ? "sale" : "sales"}</small></span>
            </div>`;
          }).join("")}
        </div>
        <p class="report-note">${mixTxs.length} ${mixTxs.length === 1 ? "sale" : "sales"} · ${compactMoney(mixTotal)} taken in this window.</p>
      </div>

      <div class="settings-card">
        <div class="report-card-head"><h2>Wastage</h2>
          <span class="report-chips" role="group" aria-label="Wastage period">
            ${[["7", "7 days"], ["30", "30 days"], ["all", "All time"]].map(([value, label]) => `<button class="chip chip-sm${wastagePeriod === value ? " is-active" : ""}" data-act="set-wastage-period" data-value="${value}">${label}</button>`).join("")}
          </span>
        </div>
        ${(wastageReport.count || 0) ? `
          <p class="report-note" style="margin-top:0"><strong>${wastageReport.count}</strong> ${wastageReport.count === 1 ? "write-off" : "write-offs"} · <strong>${wastageReport.qty}</strong> lost · <strong>${money(wastageReport.cost || 0)}</strong> at cost${wastageTopReasons.length ? ` · ${wastageTopReasons.map(([reason, count]) => `${reason} (${count})`).join(" · ")}` : ""}</p>
          <div class="report-list">${(wastageReport.entries || []).slice(0, 5).map((entry) => {
            const showQty = entry.unit === "kg" && T.findProduct(entry.productId)?.soldByMass ? T.massLabel(entry.qty) : `${entry.qty} ${esc(entry.unit)}`;
            return `<div class="report-row">
              <span class="report-row-copy"><strong>${esc(entry.name)}</strong><small>${esc(T.dayLabel(`${entry.date}T00:00:00`))} · ${esc(entry.reason)}${entry.employee ? ` · ${esc(entry.employee)}` : ""}${entry.note ? ` · ${esc(entry.note)}` : ""}</small></span>
              <span class="report-amount">${esc(showQty)}</span>
            </div>`;
          }).join("")}</div>
          ${(wastageReport.entries || []).length > 5 ? `<p class="report-note">Showing the latest 5 of ${wastageReport.entries.length}. All records are exportable as CSV below.</p>` : ""}
        ` : `<p class="report-empty">No wastage recorded in this window.</p>`}
      </div>

      <div class="settings-card">
        <div class="report-card-head"><h2>Exports</h2><span class="report-total">CSV</span></div>
        <p class="report-note" style="margin-top:0">Each file opens as a spreadsheet. It saves to the phone’s Downloads, in Biller POS.</p>
        <div class="export-grid">
          <button class="btn btn-ghost" data-act="export-csv-sales">${icon("i-download")} Sales</button>
          <button class="btn btn-ghost" data-act="export-csv-items">${icon("i-download")} Sold items</button>
          <button class="btn btn-ghost" data-act="export-csv-wastage">${icon("i-download")} Wastage</button>
        </div>
      </div>
    </section>`;
  }

  /* ---------- Audit ---------- */
  function audit() {
    const products = T.state.products || [];
    const history = T.state.audits || [];
    const inProgress = T.ui.auditInProgress === true;
    const checks = T.ui.auditChecks || {};
    if (!inProgress) {
      const histHtml = history.length
        ? history.slice().reverse().map((a) => {
            const when = new Date(a.at);
            const stamp = isNaN(when.getTime()) ? a.at : `${when.toLocaleDateString()} ${when.toLocaleTimeString()}`;
            const badge = a.passed
              ? `<span style="color:#16a34a;font-weight:700">${icon("i-check")} Passed</span>`
              : `<span style="color:#dc2626;font-weight:700">${icon("i-alert")} Failed</span>`;
            return `<div class="settings-card" style="margin-bottom:6px;padding:8px 10px">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                <strong style="font-size:calc(12px * var(--fs))">${stamp}</strong>
                ${badge}
                <span style="font-size:calc(10px * var(--fs));color:var(--muted)">${a.mismatches} unchecked</span>
              </div>
              <p class="report-note" style="margin:5px 0 0;font-size:calc(11px * var(--fs))">${a.items.length} item${a.items.length === 1 ? "" : "s"} audited${a.note ? " · " + esc(a.note) : ""}</p>
            </div>`;
          }).join("")
        : `<p class="report-note">No audits recorded yet.</p>`;
      return `<section class="screen" aria-labelledby="audit-title">
        <div class="screen-head">
          <h1 id="audit-title">AUDIT REPORT</h1>
        </div>
        <p class="sub" style="margin-top:-4px">Confirm each shelf item matches the record.</p>
        <button class="btn btn-primary btn-block" data-act="start-audit" style="margin:10px 0;padding:10px 12px">${icon("i-check")} Start audit</button>
        <div class="settings-card">
          <div class="report-card-head"><h2 style="font-size:calc(13px * var(--fs))">History</h2><span class="report-total">${history.length}</span></div>
          ${histHtml}
        </div>
      </section>`;
    }
    const rows = products.map((p) => {
      const on = checks[p.id] === true;
      return `<div class="audit-row" data-act="toggle-audit-mark" data-id="${esc(p.id)}" style="gap:8px;padding:6px 0;cursor:pointer">
        <span class="audit-mark" style="flex:none;width:20px;height:20px;border-radius:5px;border:1px solid var(--ui-line);background:${on ? "var(--lime-soft)" : "var(--surface-2)"};color:${on ? "var(--forest-ink)" : "var(--faint)"};display:grid;place-items:center;font-size:11px">${on ? icon("i-check") : ""}</span>
        ${productTile(p)}
        <span class="inv-copy" style="flex:1;min-width:0">
          <span class="inv-name" style="font-size:calc(12px * var(--fs));display:block">${esc(p.name)}</span>
          <span class="inv-meta" style="font-size:calc(10px * var(--fs))">Recorded: ${p.stock} ${esc(p.unit)}</span>
        </span>
      </div>`;
    }).join("");
    return `<section class="screen" aria-labelledby="audit-title">
      <div class="screen-head" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <h1 id="audit-title">AUDIT REPORT</h1>
        <button class="btn btn-ghost" data-act="cancel-audit" style="flex:none;padding:4px 8px">${icon("i-close")} Cancel</button>
      </div>
      <p class="sub" style="margin-top:-4px">Tap an item to mark it as matched.</p>
      <div style="margin:8px 0">${rows || `<p class="report-note">No products to audit.</p>`}</div>
      <button class="btn btn-primary btn-block" data-act="submit-audit" style="margin-top:8px;padding:10px 12px">${icon("i-check")} Finish audit</button>
    </section>`;
  }

  /* ---------- Inventory ---------- */

  function sortedInventory() {
    const query = T.ui.stockSearch.trim().toLowerCase();
    const status = (p) => T.productStock(p) === 0 ? 0 : T.productStock(p) <= p.lowStockAt ? 1 : 2;
    let products = T.state.products
      .filter((p) => !query || `${p.name} ${p.detail} ${p.barcode} ${p.category}`.toLowerCase().includes(query));
    if (T.ui.stockFilter === "low") products = products.filter((p) => T.productStock(p) > 0 && T.productStock(p) <= p.lowStockAt);
    if (T.ui.stockFilter === "out") products = products.filter((p) => T.productStock(p) === 0);
    return products
      .sort((a, b) => status(a) - status(b) || a.name.localeCompare(b.name));
  }

  function stockFilterRow() {
    return `<div class="chips" id="stock-chips" aria-label="Filter inventory by stock level">
          <button class="chip ${T.ui.stockFilter === "all" ? "is-active" : ""}" data-act="set-stock-filter" data-value="all">All</button>
          <button class="chip ${T.ui.stockFilter === "low" ? "is-active" : ""}" data-act="set-stock-filter" data-value="low">Low stock</button>
          <button class="chip ${T.ui.stockFilter === "out" ? "is-active" : ""}" data-act="set-stock-filter" data-value="out">Out of stock</button>
        </div>`;
  }

  function inventoryRows() {
    const products = sortedInventory();
    if (!products.length) {
      return `<div class="empty-state">
        <div class="empty-icon">${icon("i-box")}</div>
        <h3>No products found</h3>
        <p>Try a different search, or add a new product to your catalog.</p>
        <button class="btn btn-primary" data-act="new-product">ADD TO STOCK</button>
      </div>`;
    }
    return `<div class="inv-list">${products.map((p) => {
      const out = T.productStock(p) === 0;
      const unit = T.stockCountUnit ? T.stockCountUnit(p) : (p.unit || "pcs");
      const price = priceTag(p);
      const stockText = out ? "Sold out" : p.soldByMass ? `${T.massLabel(T.productStock(p))} in stock` : `${T.productStock(p)} ${esc(unit)} in stock`;
      const detailLine = [variantStockLine(p), [T.unitSizeLabel(p), T.bundleLabel(p), p.detail].filter(Boolean).join(" · ")].filter(Boolean)[0] || "";
      return `<div class="inv-row">
        <button class="product-row ${out ? "is-out" : ""}" data-act="edit-product" data-id="${esc(p.id)}" aria-label="Edit ${esc(p.name)}">
          <span class="product-row-tile">${productTile(p)}</span>
          <span class="product-row-copy">
            <strong>${esc(p.name)}</strong>
            <small>${[detailLine, stockText].filter(Boolean).map(esc).join(" · ")}</small>
          </span>
          <span class="product-row-price">${esc(price)}</span>
        </button>
      </div>`;
    }).join("")}</div>`;
  }

  function stock() {
    if (T.subscriptionLocked()) return lockedScreen();
    const out = T.outOfStockCount();
    const low = T.lowStockCount();
    const monthWastage = T.wastageSince(30);
    const monthWastageCost = monthWastage.cost || 0;
    const allDays = T.stockDaysList?.() || [];
    const latestDay = allDays[0] || null;
    // Currency symbol lives on the label line, so the value line carries only
    // the digits ("20.0k" not "Ksh20.0k").
    const symbol = T.currencySymbol();
    const amountOnly = (c) => String(compactMoney(c)).split(symbol).join("").trim();
    return `<section class="screen" aria-labelledby="stock-title">
      <div class="screen-head with-action">
        <div>
          <h1 id="stock-title">INVENTORY</h1>
          <p class="sub">Stock levels save as you go.</p>
        </div>
        <button class="btn btn-primary btn-sm" data-act="new-product">${icon("i-plus")} Add</button>
      </div>
      <div class="inv-stats">
        <div class="inv-stat"><span class="label">Products</span><strong>${T.state.products.length}</strong></div>
        <div class="inv-stat ${low ? "warn" : ""}"><span class="label">Low stock</span><strong>${low}</strong></div>
        <div class="inv-stat"><span class="label">Retail value <span style="text-transform:none">[${esc(symbol)}]</span></span><strong>${esc(amountOnly(T.stockValue()))}</strong></div>
        <div class="inv-stat"><span class="label">STOCK VALUE <span style="text-transform:none">[${esc(symbol)}]</span></span><strong>${esc(amountOnly(T.stockCost()))}</strong></div>
      </div>
      ${stockToolsCard({ wastage: monthWastage, wastageCost: monthWastageCost, latestDay, olderDays: Math.max(0, allDays.length - 1) })}
      ${out ? `<div class="inventory-alert">${icon("i-alert")}<span><strong>${out} ${out === 1 ? "item is" : "items are"} out of stock.</strong> They’re shown first below.</span></div>` : ""}
      <div class="search-field ${T.ui.stockSearch ? "has-value" : ""}" id="stock-search-wrap">
        ${icon("i-search")}
        <input id="stock-search" type="search" inputmode="search" autocomplete="off" spellcheck="false"
          placeholder="Search inventory" value="${esc(T.ui.stockSearch)}" aria-label="Search inventory">
        <button class="field-clear" data-act="clear-stock-search" aria-label="Clear inventory search">${icon("i-close")}</button>
      </div>
      <div id="inventory-list">${stockFilterRow()}${inventoryRows()}</div>
      <p class="list-note">Low-stock items appear first. Tap a product to edit its details.</p>
    </section>`;
  }

  /**
   * Wastage and the daily stock book as one compact card, pinned right under
   * the retail value stat. They used to sit at the bottom of the inventory
   * list, which put them a long scroll away once the catalog grew.
   */
  function stockToolsCard({ wastage, wastageCost, latestDay, olderDays }) {
    const hadLoss = Boolean(wastage.count || wastageCost);
    const latestWhen = latestDay ? T.dayLabel(`${latestDay.date}T00:00:00`) : "";
    const openingCount = latestDay ? Object.keys(latestDay.opening || {}).length : 0;
    const closingCount = latestDay ? Object.keys(latestDay.closing || latestDay.latest || {}).length : 0;
    return `<div class="flat-panel stock-side">
      <div class="stock-side-grid">
        <div class="stock-side-col">
          <span class="stock-side-label">${icon("i-alert")} Wastage</span>
          <span class="stock-side-value ${hadLoss ? "is-loss" : ""}">${hadLoss ? `−${compactMoney(wastageCost)}` : "Clean"}</span>
          <span class="stock-side-sub">${hadLoss ? `${wastage.count} ${wastage.count === 1 ? "record" : "records"} written off · 30 days` : "Nothing written off · 30 days"}</span>
          <button class="btn btn-ghost btn-sm" data-act="open-wastage">${icon("i-alert")} Record</button>
        </div>
        <span class="stock-side-div" aria-hidden="true"></span>
        <div class="stock-side-col">
          <span class="stock-side-label">${icon("i-box")} Daily stock</span>
          <span class="stock-side-value">${latestWhen ? esc(latestWhen) : "—"}</span>
          <span class="stock-side-sub">${latestWhen ? `${openingCount} opening · ${closingCount} closing` : "Fills in as you trade"}</span>
          ${latestDay ? `<button class="btn btn-ghost btn-sm" data-act="open-stock-day" data-value="${esc(latestDay.date)}">${icon("i-box")} Open book</button>` : ""}
          ${latestDay && olderDays > 0 ? `<button class="text-btn" data-act="open-stock-days">Older days (${olderDays})</button>` : ""}
        </div>
      </div>
    </div>`;
  }

  /* ---------- Suppliers ---------- */

  function supplierMatches(supplier) {
    const query = T.ui.supplierSearch.trim().toLowerCase();
    if (!query) return true;
    return `${supplier.name} ${supplier.contact} ${supplier.phone} ${supplier.email} ${supplier.supplies} ${supplier.address} ${supplier.notes}`
      .toLowerCase()
      .includes(query);
  }

  function supplierResults() {
    const all = [...(T.state.suppliers || [])].sort((a, b) => a.name.localeCompare(b.name));
    const visible = all.filter(supplierMatches);
    if (!visible.length) {
      return `<div class="empty-state supplier-empty">
        <div class="empty-icon">${icon("i-search")}</div>
        <h3>No suppliers match</h3>
        <p>Try another name, phone number, or product.</p>
        <button class="btn btn-ghost" data-act="clear-supplier-search">Clear search</button>
      </div>`;
    }
    const cards = visible.map((supplier) => {
      const phoneHref = supplier.phone.replace(/[^\d+]/g, "");
      const totals = T.supplierTotals(supplier);
      const days = supplier.days || [];
      const daysLabel = days.length ? days.map((day) => supplierDayLabel(day)).join(" · ") : "No delivery days";
      const balance = totals.balance;
      const pill = balance > 0
        ? `<span class="supplier-pill is-debt">Owe ${compactMoney(balance)}</span>`
        : balance < 0
          ? `<span class="supplier-pill is-credit">Credit ${compactMoney(-balance)}</span>`
          : `<span class="supplier-pill is-settled">Settled</span>`;
      return `<article class="supplier-card">
        <div class="supplier-top">
          <button class="supplier-open" data-nav="#/supplier/${esc(supplier.id)}" aria-label="Open ${esc(supplier.name)}">
            <span class="supplier-avatar" aria-hidden="true">${esc(T.initials(supplier.name))}</span>
            <span class="supplier-copy">
              <strong>${esc(supplier.name)}</strong>
              <small>${esc(supplier.contact || "Supplier contact")}${supplier.supplies ? ` · ${esc(supplier.supplies)}` : ""}</small>
            </span>
            <span class="chev">${icon("i-chevron")}</span>
          </button>
          <div class="supplier-tools">
            <button class="supplier-tool" data-act="edit-supplier" data-id="${esc(supplier.id)}" aria-label="Edit ${esc(supplier.name)}">${icon("i-pencil")}</button>
            <button class="supplier-tool danger" data-act="delete-supplier" data-id="${esc(supplier.id)}" aria-label="Delete ${esc(supplier.name)}">${icon("i-trash")}</button>
          </div>
        </div>
        ${supplier.phone || supplier.email ? `<div class="supplier-contacts">
          ${supplier.phone ? `<a class="supplier-contact" href="tel:${esc(phoneHref)}">${icon("i-phone")}<span>${esc(supplier.phone)}</span></a>` : ""}
          ${supplier.email ? `<a class="supplier-contact" href="mailto:${esc(supplier.email)}">${icon("i-mail")}<span>${esc(supplier.email)}</span></a>` : ""}
        </div>` : ""}
        <div class="supplier-card-foot">
          <span class="supplier-days-inline">${icon("i-clock")}<span>${esc(daysLabel)}</span></span>
          ${pill}
        </div>
      </article>`;
    }).join("");
    return `<div class="supplier-list">${cards}</div>`;
  }

  function suppliers() {
    if (T.subscriptionLocked()) return lockedScreen();
    const all = T.state.suppliers || [];
    const query = T.ui.supplierSearch.trim();
    const head = `<div class="screen-head with-action">
        <div>
          <h1 id="suppliers-title">SUPPLIERS</h1>
          <p class="sub">The people and numbers you order from.</p>
        </div>
        <button class="btn btn-primary btn-sm" data-act="new-supplier">${icon("i-plus")} Add</button>
      </div>`;

    if (!all.length) {
      return `<section class="screen" aria-labelledby="suppliers-title">
        ${head}
        <div class="empty-state">
          <div class="empty-icon">${icon("i-truck")}</div>
          <h3>No suppliers yet</h3>
          <p>Add the businesses and contacts you restock from, so their phone and email are always at hand.</p>
          <button class="btn btn-primary" data-act="new-supplier">${icon("i-plus")} Add supplier</button>
        </div>
      </section>`;
    }

    return `<section class="screen" aria-labelledby="suppliers-title">
      ${head}
      <div class="search-field ${query ? "has-value" : ""}" id="supplier-search-wrap">
        ${icon("i-search")}
        <input id="supplier-search" type="search" inputmode="search" autocomplete="off" spellcheck="false"
          placeholder="Search suppliers" value="${esc(T.ui.supplierSearch)}" aria-label="Search suppliers">
        <button class="field-clear" data-act="clear-supplier-search" aria-label="Clear supplier search">${icon("i-close")}</button>
      </div>
      <div id="supplier-results">${supplierResults()}</div>
      <p class="list-note">Tap a supplier to open their account, delivery days, and balance.</p>
    </section>`;
  }

  /* ---------- Supplier account ---------- */

  function supplierDetail(id) {
    const supplier = T.findSupplier(id);
    if (!supplier) {
      return `<section class="screen" aria-labelledby="supplier-title">
        <div class="screen-head">
          <p class="eyebrow">Supplier account</p>
          <h1 id="supplier-title">Supplier not found</h1>
          <p class="sub">This supplier may have been deleted from this device.</p>
        </div>
        <div class="empty-state">
          <div class="empty-icon">${icon("i-truck")}</div>
          <h3>Supplier not found</h3>
          <p>It may have been removed from this device.</p>
          <button class="btn btn-primary" data-nav="#/suppliers">Back to suppliers</button>
        </div>
      </section>`;
    }

    const totals = T.supplierTotals(supplier);
    const balance = totals.balance;
    const status = balance > 0 ? "debt" : balance < 0 ? "credit" : "settled";
    const statusLabel = balance > 0 ? "You owe" : balance < 0 ? "Advance" : "Settled";
    const days = supplier.days || [];
    const entries = [...(supplier.ledger || [])].sort((a, b) => {
      if (a.date === b.date) return new Date(b.createdAt) - new Date(a.createdAt);
      return a.date < b.date ? 1 : -1;
    });
    const openBills = T.supplierOpenBills?.(supplier) || [];
    const unpaidById = new Map(openBills.map((bill) => [bill.id, bill.remaining]));
    const lastPayment = entries.find((entry) => entry.type === "payment");
    const entryDate = (entry) => {
      const [year, month, day] = String(entry.date || "").split("-").map(Number);
      return T.shortDateFmt.format(new Date(year || 2026, (month || 1) - 1, day || 1));
    };
    const subtitle = [supplier.contact, supplier.supplies].filter(Boolean).map((value) => esc(value)).join(" · ");
    const phoneHref = supplier.phone.replace(/[^\d+]/g, "");

    return `<section class="screen supplier-detail" aria-labelledby="supplier-title">
      <div class="supplier-detail-head">
        <span class="supplier-avatar supplier-avatar-lg" aria-hidden="true">${esc(T.initials(supplier.name))}</span>
        <div class="supplier-detail-copy">
          <p class="eyebrow">Supplier account</p>
          <h1 id="supplier-title">${esc(supplier.name)}</h1>
          <p class="sub">${subtitle || "Supplier"}</p>
        </div>
      </div>

      <div class="supplier-balance is-${status}">
        <div class="supplier-balance-top">
          <span class="eyebrow">${balance > 0 ? "Outstanding debt" : balance < 0 ? "Credit with supplier" : "Account balance"}</span>
          <span class="supplier-status is-${status}">${statusLabel}</span>
        </div>
        <div class="supplier-balance-amount money">${money(Math.abs(balance))}</div>
        <div class="supplier-balance-foot">
          <span>Stock <strong>${compactMoney(totals.bills)}</strong></span>
          <span class="sep"></span>
          <span>Paid <strong>${compactMoney(totals.paid)}</strong></span>
          ${openBills.length ? `<span class="sep"></span><span>Unpaid bills <strong>${openBills.length}</strong></span>` : ""}
        </div>
      </div>

      <div class="supplier-quick">
        <button class="btn btn-primary" data-act="supplier-payment" data-id="${esc(supplier.id)}">${icon("i-cash")} Record payment</button>
        <button class="btn btn-ghost" data-act="supplier-bill" data-id="${esc(supplier.id)}">${icon("i-plus")} Add bill</button>
      </div>

      <div class="settings-card">
        <div class="report-card-head">
          <h2>Delivery days</h2>
          <button class="supplier-edit-link" data-act="edit-supplier" data-id="${esc(supplier.id)}">Edit</button>
        </div>
        <div class="supplier-days">
          ${T.SUPPLIER_DAYS.map(([code, label]) => `<span class="supplier-day ${days.includes(code) ? "is-on" : ""}">${label}</span>`).join("")}
        </div>
        <p class="field-help">${days.length ? `${days.map((day) => supplierDayLabel(day)).join(", ")} deliveries` : "No delivery days set yet. Tap Edit to choose them."}</p>
      </div>

      <div class="settings-card">
        <h2>Contact</h2>
        <div class="supplier-contact-list">
          ${supplier.phone ? `<a class="supplier-contact" href="tel:${esc(phoneHref)}">${icon("i-phone")}<span>${esc(supplier.phone)}</span></a>` : ""}
          ${supplier.email ? `<a class="supplier-contact" href="mailto:${esc(supplier.email)}">${icon("i-mail")}<span>${esc(supplier.email)}</span></a>` : ""}
          ${supplier.address ? `<div class="supplier-contact is-static">${icon("i-store")}<span>${esc(supplier.address)}</span></div>` : ""}
          ${!supplier.phone && !supplier.email && !supplier.address ? `<p class="report-empty">No phone, email, or address saved yet.</p>` : ""}
        </div>
        ${supplier.notes ? `<p class="supplier-note">${esc(supplier.notes)}</p>` : ""}
      </div>

      <div class="settings-card">
        <div class="report-card-head">
          <h2>Payments</h2>
          <span class="report-total">${lastPayment ? `Last paid ${esc(entryDate(lastPayment))}` : "No payments yet"}</span>
        </div>
        <div class="supplier-paygrid">
          <div class="supplier-paystat">
            <span class="supplier-payicon cash">${icon("i-cash")}</span>
            <div><span class="label">Cash paid</span><strong>${compactMoney(totals.cash)}</strong></div>
          </div>
          <div class="supplier-paystat">
            <span class="supplier-payicon mpesa">${icon("i-phone")}</span>
            <div><span class="label">M-Pesa paid</span><strong>${compactMoney(totals.mpesa)}</strong></div>
          </div>
        </div>
      </div>

      <div class="settings-card">
        <div class="report-card-head">
          <h2>Account activity</h2>
          <span class="report-total">${entries.length} ${entries.length === 1 ? "entry" : "entries"}</span>
        </div>
        ${entries.length ? `<div class="supplier-ledger">${entries.map((entry) => {
          const isPayment = entry.type === "payment";
          const method = entry.method === "mpesa" ? "M-Pesa" : "Cash";
          const stock = Array.isArray(entry.items) ? entry.items : [];
          const stockText = stock.map((item) => `${item.qty} × ${item.name}`).join(", ");
          const remaining = unpaidById.get(entry.id);
          const billState = isPayment
            ? ""
            : remaining
              ? `<span class="supplier-entry-state is-open">${money(remaining)} still owed</span>`
              : `<span class="supplier-entry-state is-paid">Paid in full</span>`;
          const entryStaff = T.entryStaff ? T.entryStaff(entry) : String(entry.staff || "").trim();
          return `<div class="supplier-entry">
            <span class="supplier-entry-icon ${entry.type} ${entry.method || ""}">${icon(isPayment ? (entry.method === "mpesa" ? "i-phone" : "i-cash") : "i-box")}</span>
            <span class="supplier-entry-copy">
              <strong>${isPayment ? `${method} payment` : "Stock bill"}</strong>
              <small>${esc(entryDate(entry))}${entry.note ? ` · ${esc(entry.note)}` : ""}${entryStaff ? ` · ${esc(entryStaff)}` : ""}</small>
              ${stockText ? `<span class="supplier-entry-stock">${icon("i-box")} ${esc(stockText)}</span>` : ""}
              ${billState}
            </span>
            <span class="supplier-entry-amount ${entry.type}">${isPayment ? "−" : "+"}${money(entry.amount)}</span>
          </div>`;
        }).join("")}</div>` : `<p class="report-empty">Record a stock bill or a payment to start this supplier's account.</p>`}
      </div>
    </section>`;
  }

  /* ---------- Customer debt ---------- */

  function debtResults() {
    const customers = T.debtCustomers();
    const search = T.ui.debtSearch;
    const filter = T.ui.debtFilter;
    const matched = customers.filter(({ customer, summary }) => {
      if (filter === "due" && !(summary.status === "due" || summary.status === "overdue")) return false;
      if (filter === "settled" && summary.status !== "settled") return false;
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return `${customer.name} ${customer.phone}`.toLowerCase().includes(q);
    });
    const rank = { overdue: 0, due: 1, open: 2, settled: 3 };
    const sorted = [...matched].sort((a, b) => {
      if (rank[a.summary.status] !== rank[b.summary.status]) return rank[a.summary.status] - rank[b.summary.status];
      if (a.summary.nextDue && b.summary.nextDue) return a.summary.nextDue < b.summary.nextDue ? -1 : 1;
      if (a.summary.nextDue) return -1;
      if (b.summary.nextDue) return 1;
      return a.customer.name.localeCompare(b.customer.name);
    });
    if (!customers.length) return "";
    if (!sorted.length) {
      const message = filter === "due"
        ? "Nothing due right now. All credit customers are on track."
        : search.trim()
          ? `No customers match “${esc(search.trim())}”.`
          : "No customers to show.";
      return `<div class="empty-state">
        <div class="empty-icon">${icon("i-search")}</div>
        <h3>${filter === "due" ? "Nothing due" : "No customers match"}</h3>
        <p>${message}</p>
        ${search.trim() ? `<button class="btn btn-ghost" data-act="clear-debt-search">Clear search</button>` : `<button class="btn btn-ghost" data-act="set-debt-filter" data-value="all">Show all customers</button>`}
      </div>`;
    }
    return `<div class="debt-list">${sorted.map(({ customer, summary }) => {
      const status = summary.status;
      const statusLabel = summary.balance < 0 ? "Credit" : status === "overdue" ? "Overdue" : status === "due" ? "Due today" : status === "open" ? "On track" : "Settled";
      const pillClass = status === "overdue" || status === "due" ? "is-debt" : summary.balance < 0 ? "is-credit" : status === "open" ? "is-credit" : "is-settled";
      const dueInfo = summary.nextDue ? T.debtDueInfo(summary.nextDue) : { label: "No payment date" };
      const dueClass = summary.nextDue && (T.debtDueInfo(summary.nextDue).status === "overdue" || T.debtDueInfo(summary.nextDue).status === "due") ? "is-overdue" : "";
      // The latest shopkeeper who served this customer — entries are newest
      // first, and T.entryStaff also reads the name off the linked sale.
      // History from before staff tracking stays unattributed (a dash)
      // rather than crediting one person for everything.
      const staffName = (customer.entries || []).map((entry) => T.entryStaff ? T.entryStaff(entry) : "").find(Boolean) || "";
      return `<article class="debt-card ${status === "overdue" ? "is-overdue" : ""}">
        <button class="debt-open" data-nav="#/debt/${esc(customer.id)}" aria-label="Open ${esc(customer.name)}${staffName ? `, last served by ${esc(staffName)}` : ""}">
          <span class="debt-avatar ${summary.balance <= 0 ? "is-settled" : ""}" aria-hidden="true">${esc(T.initials(customer.name))}</span>
          <span class="debt-copy">
            <strong>${esc(customer.name)}</strong>
            <small>${esc(customer.phone || "No phone saved")}</small>
          </span>
          <span class="debt-amount">
            <strong>${money(summary.balance >= 0 ? summary.balance : -summary.balance)}</strong>
            <small>${summary.balance < 0 ? "credit" : "owed"}</small>
          </span>
          <span class="chev">${icon("i-chevron")}</span>
        </button>
        <div class="debt-card-foot">
          <span class="debt-due-inline ${dueClass}">${icon("i-clock")}<span>${esc(dueInfo.label)}</span></span>
          <span class="debt-card-staff ${staffName ? "" : "is-empty"}" aria-hidden="true">${staffName ? esc(staffName) : "—"}</span>
          <span class="supplier-pill ${pillClass}">${esc(statusLabel)}</span>
        </div>
      </article>`;
    }).join("")}</div>`;
  }

  function debt() {
    const customers = T.debtCustomers();
    const outstanding = customers.filter(({ summary }) => summary.balance > 0).reduce((sum, { summary }) => sum + summary.balance, 0);
    const overdueTotal = customers.filter(({ summary }) => summary.status === "overdue").reduce((sum, { summary }) => sum + summary.overdueAmount, 0);
    const dueTodayTotal = customers.filter(({ summary }) => summary.status === "due").reduce((sum, { summary }) => sum + summary.dueAmount, 0);
    const dueCount = customers.filter(({ summary }) => summary.status === "due" || summary.status === "overdue").length;

    const head = `<div class="screen-head with-action">
      <div>
        <h1 id="debt-title">DEBT</h1>
        <p class="sub">Goods taken now, paid later.</p>
      </div>
    </div>`;

    if (!customers.length) {
      return `<section class="screen" aria-labelledby="debt-title">
        ${head}
        <div class="empty-state">
          <div class="empty-icon">${icon("i-user")}</div>
          <h3>No customer debt yet</h3>
          <p>When a customer takes goods without paying, tap ADD TO DEBT at checkout.</p>
          <button class="btn btn-primary" data-nav="#/sell">${icon("i-plus")} Start a sale</button>
        </div>
      </section>`;
    }

    const hero = `<div class="sales-hero debt-hero">
      <div class="debt-hero-top">
        <div>
          <p class="eyebrow">Outstanding debt</p>
          <div class="sales-amount money">${money(outstanding)}</div>
        </div>
        ${dueCount ? `<span class="debt-hero-pill">${dueCount} due</span>` : ""}
      </div>
      <div class="sales-hero-foot">
        <span><strong>${customers.filter(({ summary }) => summary.balance > 0).length}</strong> owing</span>
        <span class="sep"></span>
        <span>Overdue <strong>${compactMoney(overdueTotal)}</strong></span>
        <span class="sep"></span>
        <span>Due today <strong>${compactMoney(dueTodayTotal)}</strong></span>
      </div>
    </div>`;

    const searchField = `<div class="search-field ${T.ui.debtSearch ? "has-value" : ""}" id="debt-search-wrap">
      ${icon("i-search")}
      <input id="debt-search" type="search" inputmode="search" autocomplete="off" spellcheck="false"
        placeholder="Search customers" value="${esc(T.ui.debtSearch)}" aria-label="Search customers">
      <button class="field-clear" data-act="clear-debt-search" aria-label="Clear customer search">${icon("i-close")}</button>
    </div>`;

    const chips = `<div class="chips order-filters" aria-label="Filter customers by payment status">
      ${["all", "due", "settled"].map((value) => `<button class="chip ${T.ui.debtFilter === value ? "is-active" : ""}" data-act="set-debt-filter" data-value="${value}">${value === "all" ? "All customers" : value === "due" ? "Needs payment" : "Settled"}</button>`).join("")}
    </div>`;

    return `<section class="screen" aria-labelledby="debt-title">
      ${head}
      ${hero}
      ${searchField}
      ${chips}
      <div id="debt-results">${debtResults()}</div>
      <p class="list-note">Tap a customer to see their payment dates and record payments.</p>
    </section>`;
  }

  function customerDebt(id) {
    const customer = T.findCustomer(id);
    if (!customer) {
      return `<section class="screen" aria-labelledby="debt-title">
        <div class="screen-head">
          <p class="eyebrow">Customer debt</p>
          <h1 id="debt-title">Customer not found</h1>
          <p class="sub">This customer may have been deleted from this device.</p>
        </div>
        <div class="empty-state">
          <div class="empty-icon">${icon("i-user")}</div>
          <h3>Customer not found</h3>
          <p>It may have been removed from this device.</p>
          <button class="btn btn-primary" data-nav="#/debt">Back to debt</button>
        </div>
      </section>`;
    }
    const summary = T.customerSummary(customer);
    const entries = T.customerLedger(customer);
    const openDebts = [...summary.open].sort((a, b) => {
      if (a.dueDate && b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return 0;
    });
    const status = summary.status;
    const statusLabel = summary.balance < 0 ? "Credit" : summary.balance === 0 ? "Settled" : status === "overdue" ? "Overdue" : status === "due" ? "Due today" : "On track";
    const phoneHref = customer.phone.replace(/[^\d+]/g, "");
    const txFor = (txId) => T.state.transactions.find((tx) => tx.id === txId);
    const lastPayment = entries.find((entry) => entry.type === "payment");
    const entryDate = (entry) => {
      const [y, m, d] = String(entry.date || "").split("-").map(Number);
      return T.shortDateFmt.format(new Date(y || 2026, (m || 1) - 1, d || 1));
    };
    return `<section class="screen debt-detail" aria-labelledby="debt-title">
      <div class="supplier-detail-head">
        <span class="debt-avatar debt-avatar-lg ${summary.balance <= 0 ? "is-settled" : ""}" aria-hidden="true">${esc(T.initials(customer.name))}</span>
        <div class="supplier-detail-copy">
          <p class="eyebrow">Customer debt</p>
          <h1 id="debt-title">${esc(customer.name)}</h1>
          <p class="sub">${esc(customer.phone || "No phone saved")}</p>
        </div>
      </div>

      <div class="supplier-balance is-${status === "overdue" || status === "due" ? "debt" : status === "settled" ? "settled" : "credit"}">
        <div class="supplier-balance-top">
          <span class="eyebrow">${summary.balance > 0 ? "Outstanding debt" : summary.balance < 0 ? "Credit balance" : "Account balance"}</span>
          <span class="supplier-status is-${status === "overdue" || status === "due" ? "debt" : status === "settled" ? "settled" : "credit"}">${esc(statusLabel)}</span>
        </div>
        <div class="supplier-balance-amount money">${money(Math.abs(summary.balance))}</div>
        <div class="supplier-balance-foot">
          <span>Goods <strong>${compactMoney(summary.billed)}</strong></span>
          <span class="sep"></span>
          <span>Paid <strong>${compactMoney(summary.paid)}</strong></span>
        </div>
      </div>

      <div class="supplier-quick">
        <button class="btn btn-primary" data-act="customer-payment" data-id="${esc(customer.id)}">${icon("i-cash")} Record payment</button>
        ${customer.phone ? `<a class="btn btn-ghost" href="tel:${esc(phoneHref)}">${icon("i-phone")} Call</a>` : `<button class="btn btn-ghost" data-nav="#/sell">${icon("i-plus")} New sale</button>`}
      </div>

      <div class="settings-card">
        <div class="report-card-head">
          <h2>Payment dates</h2>
          <span class="report-total">${openDebts.length ? `${openDebts.length} open` : "All paid"}</span>
        </div>
        ${openDebts.length ? `<div class="debt-due-list">${openDebts.map((debt) => {
          const info = T.debtDueInfo(debt.dueDate);
          const tx = txFor(debt.txId);
          const remaining = debt.remaining;
          const partial = debt.applied > 0 ? `${money(remaining)} of ${money(debt.amount)} remaining` : `${money(debt.amount)} owed`;
          return `<div class="debt-due-row is-${info.status === "overdue" || info.status === "due" ? "due" : "scheduled"}">
            <span class="debt-due-icon">${icon("i-clock")}</span>
            <span class="debt-due-copy">
              <strong>${esc(info.label)}</strong>
              <small>${esc(debt.note || (tx ? `Receipt #${tx.receiptNo}` : "Goods on credit"))}${debt.note && tx ? ` · #${tx.receiptNo}` : ""} · ${esc(partial)}</small>
            </span>
            <span class="debt-due-amount">${money(remaining)}</span>
          </div>`;
        }).join("")}</div>` : `<p class="report-empty">All paid up. New credit sales show their payment dates here.</p>`}
      </div>

      <div class="settings-card">
        <div class="report-card-head">
          <h2>Payments</h2>
          <span class="report-total">${lastPayment ? `Last paid ${esc(entryDate(lastPayment))}` : "No payments yet"}</span>
        </div>
        <div class="supplier-paygrid">
          <div class="supplier-paystat">
            <span class="supplier-payicon cash">${icon("i-cash")}</span>
            <div><span class="label">Cash paid</span><strong>${compactMoney(summary.cash)}</strong></div>
          </div>
          <div class="supplier-paystat">
            <span class="supplier-payicon mpesa">${icon("i-phone")}</span>
            <div><span class="label">M-Pesa paid</span><strong>${compactMoney(summary.mpesa)}</strong></div>
          </div>
        </div>
      </div>

      <div class="settings-card">
        <div class="report-card-head">
          <h2>Account activity</h2>
          <span class="report-total">${entries.length} ${entries.length === 1 ? "entry" : "entries"}</span>
        </div>
        ${entries.length ? `<div class="supplier-ledger">${entries.map((entry) => {
          const isPayment = entry.type === "payment";
          const method = entry.method === "mpesa" ? "M-Pesa" : "Cash";
          const tx = entry.txId ? txFor(entry.txId) : null;
          const entryStaff = T.entryStaff ? T.entryStaff(entry) : String(entry.staff || "").trim();
          return `<div class="supplier-entry">
            <span class="supplier-entry-icon ${isPayment ? `payment ${entry.method}` : "bill"}">${icon(isPayment ? (entry.method === "mpesa" ? "i-phone" : "i-cash") : "i-user")}</span>
            <span class="supplier-entry-copy">
              <strong>${isPayment ? `${method} payment` : "Goods on credit"}</strong>
              <small>${esc(entryDate(entry))}${entry.note ? ` · ${esc(entry.note)}` : tx ? ` · #${tx.receiptNo}` : ""}${entryStaff ? ` · ${esc(entryStaff)}` : ""}</small>
            </span>
            <span class="supplier-entry-amount ${isPayment ? "payment" : "bill"}">${isPayment ? "−" : "+"}${money(entry.amount)}</span>
          </div>`;
        }).join("")}</div>` : `<p class="report-empty">Record a credit sale or a payment to start this account.</p>`}
      </div>

      <button class="btn btn-ghost btn-block" data-act="delete-customer" data-id="${esc(customer.id)}" style="color:var(--red);border-color:rgba(168,58,42,.35);">${icon("i-trash")} Delete customer</button>
    </section>`;
  }

  /* ---------- More / settings ---------- */

  /** The Categories block on the More tab — add, rename and remove groups. */
  function categorySection() {
    const categories = T.categories();
    return `<div class="settings-card cat-card" id="category-card">
        <h2>Categories</h2>
        <p class="card-sub">These group your products on the Sell screen.</p>
        <div class="cat-list">
          ${categories.map((category) => {
            const count = T.countInCategory(category);
            return `<div class="cat-row">
              <span class="cat-swatch tone-${T.toneFor(category)}" aria-hidden="true"></span>
              <span class="cat-name">${esc(category)}</span>
              <span class="cat-count">${count} ${count === 1 ? "item" : "items"}</span>
              <button class="cat-btn" data-act="edit-category" data-value="${esc(category)}" aria-label="Rename ${esc(category)}">${icon("i-pencil")}</button>
              <button class="cat-btn danger" data-act="delete-category" data-value="${esc(category)}" aria-label="Delete ${esc(category)}">${icon("i-trash")}</button>
            </div>`;
          }).join("")}
        </div>
        <button class="btn btn-ghost btn-block cat-add" data-act="add-category">${icon("i-plus")} Add category</button>
      </div>`;
  }

  /* ---------- Lock and plans ---------- */

  /**
   * The shop cannot sell until the monthly plan is settled. This panel
   * replaces the products and explains exactly what to do.
   */
  function subscriptionLockPanel() {
    if (!T.subscriptionLocked()) return "";
    const status = T.subscriptionStatus();
    const clockTampered = status === "clock_tampered";
    const plan = T.planSummary();
    const amount = money(plan.amountCents);
    const code = T.shopCode();
    const fee = T.feeConfig();
    const waiting = status === "awaiting";
    const overdue = status === "overdue";
    const sub = T.subscription();
    const reference = sub.reference || T.subscriptionReference();
    return `<div class="plan-lock ${waiting ? "is-waiting" : ""}">
      <span class="plan-lock-mark">${icon(clockTampered ? "i-alert" : waiting ? "i-clock" : "i-lock")}</span>
      <h2>${clockTampered ? "System Date Tampered" : waiting ? "Waiting for your payment" : overdue ? "Your shop is paused" : "Your plan is due"}</h2>
      <p>${clockTampered
        ? `Your device date/time has been set backward or is inaccurate. To protect your subscription, Biller POS requires accurate time. Please enable **Automatic Date & Time** in your phone settings or exit.`
        : waiting
        ? `We are checking your ${esc(amount)} payment (ref ${esc(reference)}). The developer is looking for it in M-Pesa - usually that is minutes, not hours. If it takes longer, call us and we will switch you straight on.`
        : `The ${esc(amount)} monthly plan for Biller POS is ${overdue ? "overdue" : "due"}. Pay it to carry on selling.`}</p>
      ${clockTampered ? "" : `<div class="plan-lock-ref">
        <span>Your shop code</span>
        <strong>${esc(code)}</strong>
      </div>`}
      <div class="plan-lock-actions">
        ${clockTampered ? `<button class="btn btn-primary btn-block" data-act="open-date-settings">${icon("i-gear")} Open Date & Time Settings</button>` : ""}
        ${clockTampered ? `<button class="btn btn-ghost btn-block" data-act="exit-app">${icon("i-close")} Close App</button>` : ""}
        ${clockTampered ? "" : `<button class="btn btn-primary btn-block" data-act="pay-subscription">${icon("i-phone")} ${waiting ? "Payment details" : `Pay ${esc(amount)}`}</button>`}
        ${!clockTampered && fee.mpesaNumber ? `<a class="btn btn-ghost btn-block" href="tel:${esc(fee.mpesaNumber.replace(/[^0-9+]/g, ""))}">${icon("i-phone")} Call the developer</a>` : ""}
        ${clockTampered ? "" : `<button class="btn btn-ghost btn-block" data-act="open-developer-chat">${icon("i-chat")} Chat with developer</button>`}
        ${clockTampered || waiting ? "" : ""}
        <button class="btn btn-ghost btn-block" data-act="refresh-data">${icon("i-refresh")} Check my payment</button>
        <button class="btn btn-ghost btn-block" data-act="sign-out" style="opacity:.85">${icon("i-user")} Sign out</button>
      </div>
    </div>`;
  }

  /**
   * The whole screen when the shop has not settled its plan: just the plan
   * due explanation and the pay button, nothing else reachable.
   */
  function lockedScreen() {
    return `<section class="screen sell locked-screen" aria-labelledby="locked-title">
      <h1 id="locked-title" class="sr-only">Your plan is due</h1>
      ${subscriptionLockPanel()}
    </section>`;
  }

  /**
   * A page protected by the shop PIN. Rendered instead of the page itself;
   * the PIN sheet opens only from the explicit "Enter PIN" button — never as
   * a side effect of a re-render — so someone who does not want to enter the
   * PIN can still leave the page with the bottom tabs or the back button.
   */
  function pinLocked(title, unlockAct) {
    return `<section class="screen audit-locked" style="padding:48px 20px;text-align:center;color:var(--muted)">
      <span class="data-icon" style="display:inline-grid;place-items:center;width:46px;height:46px;border-radius:12px;background:var(--surface-2);margin:0 auto 12px;color:var(--forest)">${icon("i-lock")}</span>
      <h1 style="font-size:16px;font-weight:750;color:var(--ink)">${esc(title)} is locked</h1>
      <p>Enter the shop PIN to open it.</p>
      <div class="sheet-actions" style="margin-top:14px">
        <button class="btn btn-primary btn-block" data-act="${esc(unlockAct)}">${icon("i-lock")} Enter PIN</button>
        <button class="btn btn-quiet btn-block" data-nav="#/more">Go back to Settings</button>
      </div>
    </section>`;
  }

  /**
   * The developer's subscription panel: every shop, its code and its plan
   * state, with the payment requests waiting for an answer.
   */
  function plans() {
    if (!T.isDeveloperAccount()) {
      return `<section class="screen">
        <div class="screen-head">
          <p class="eyebrow">Developer</p>
          <h1>Subscriptions</h1>
          <p class="sub">Only the developer account can open this page.</p>
        </div>
      </section>`;
    }

    const requests = T.cloud.paymentRequests?.() || [];
    const accounts = T.cloud.accounts?.() || [];

    const seen = (stamp) => {
      if (!stamp) return "not seen yet";
      const minutes = Math.floor((Date.now() - stamp) / 60000);
      if (minutes < 1) return "just now";
      if (minutes < 60) return `${minutes} min ago`;
      if (minutes < 1440) return `${Math.floor(minutes / 60)} h ago`;
      return T.shortDateFmt.format(new Date(stamp));
    };
    // The chase amount must reflect today's plan price, not the price stored
    // in an old heartbeat or an old payment request. Historic confirmed
    // amounts are kept as-is (that is what was actually collected).
    const currentAmount = T.planSummary?.().amountCents || 80000;
    const chaseAmount = (status, stored) => {
      const chase = ["due", "overdue", "trial", "awaiting", "pending", "reverted", "declined"];
      return chase.includes(String(status || "")) ? currentAmount : (Number(stored) || currentAmount);
    };

    const isOnline = (at) => at && (Date.now() - at < 900000); // 15 min

    // One row per shop: the payment request first, then the plan state from
    // the presence records. The presence heartbeat carries the shop's live
    // plan status (due / overdue / trial), so the panel always reflects the
    // current state — even if the developer has to do nothing.
    const norm = (s) => (["reverted", "declined"].includes(s) ? "due" : s);
    const accountsById = new Map(accounts.map((a) => [a.id, a]));
    const liveStatusFor = (id, fallback) => {
      const account = accountsById.get(id);
      if (!account) return norm(String(fallback || "pending"));
      const asked = account.payment && account.payment.status === "pending";
      const sub = account.sub || {};
      return asked ? "pending" : norm(String(sub.status || fallback || "active"));
    };
    const entries = [];
    const seenIds = new Set();
    requests.forEach((request) => {
      seenIds.add(request.id);
      const liveStatus = liveStatusFor(request.id, request.status || "pending");
      entries.push({
        id: request.id,
        code: request.code || "",
        shop: request.shop || request.email || "Shop",
        email: request.email || "",
        // A reverted payment counts as due again, so it lands in "To chase"
        // instead of vanishing from the counts.
        status: liveStatus,
        amount: chaseAmount(liveStatus, request.amount),
        currency: request.currency || "KES",
        reference: request.reference || "",
        mpesaCode: request.mpesaCode || "",
        phone: request.phone || "",
        paidAt: request.confirmedAt || 0,
        at: request.at || 0,
        pending: liveStatus === "pending"
      });
    });
    accounts.forEach((account) => {
      if (seenIds.has(account.id)) return;
      const sub = account.sub;
      if (!sub) return;
      // A shop that says it has paid also shows here through its presence
      // record, so the request is visible even before the new rules are live.
      const asked = account.payment && account.payment.status === "pending";
      const accountStatus = asked ? "pending" : norm(String(sub.status || "active"));
      entries.push({
        id: account.id,
        code: account.code || "",
        shop: sub.shop || account.name,
        email: account.name || "",
        status: accountStatus,
        amount: chaseAmount(accountStatus, sub.amount),
        currency: sub.currency || "KES",
        reference: sub.reference || account.payment?.reference || "",
        mpesaCode: sub.mpesaCode || "",
        phone: sub.phone || "",
        paidAt: sub.lastPaidAt || 0,
        at: account.t || 0,
        pending: asked
      });
    });

    const filteredEntries = entries;
    const devEmails = T.DEV_EMAILS || [];
    const isDevEntry = (e) => devEmails.includes(String(e?.email || "").trim().toLowerCase());
    // My own shop is pinned to the top of the list, always. Everyone else is
    // sorted: waiting first, then by most recent activity.
    filteredEntries.sort((a, b) =>
      (isDevEntry(b) ? 1 : 0) - (isDevEntry(a) ? 1 : 0) ||
      (b.pending ? 1 : 0) - (a.pending ? 1 : 0) ||
      (b.at || 0) - (a.at || 0)
    );
    
    // An M-Pesa code belongs to exactly one real transaction. If two shops
    // send the same code, at least one payment is being claimed twice.
    const codeOwners = new Map();
    for (const entry of filteredEntries) {
      const code = String(entry.mpesaCode || "").trim().toUpperCase();
      if (!code) continue;
      if (!codeOwners.has(code)) codeOwners.set(code, new Set());
      codeOwners.get(code).add(entry.email || entry.shop || entry.id);
    }
    for (const entry of filteredEntries) {
      const code = String(entry.mpesaCode || "").trim().toUpperCase();
      entry.dupCode = code && (codeOwners.get(code)?.size || 0) > 1 ? code : "";
    }
    const rows = filteredEntries.map((entry) => planRow(entry, seen));

    const pendingCount = filteredEntries.filter((row) => row.pending).length;
    const paidCount = filteredEntries.filter((row) => row.status === "active" || row.status === "confirmed").length;
    const dueCount = filteredEntries.filter((row) => row.status === "due" || row.status === "overdue").length;
    // The developer's own account never counts toward the monthly recurring total.
    const monthly = filteredEntries
      .filter((row) => (row.status === "active" || row.status === "confirmed") && !isDevEntry(row))
      .reduce((sum, row) => sum + (row.amount || 0), 0);

    // Payment authentication: shops that signed up more than 30 days ago,
    // never settled their plan (status is due/overdue), are heartbeating
    // right now AND actually ringing sales — likely free-riding.
    const DAY_MS = 24 * 60 * 60 * 1000;
    const cheaters = accounts
      .filter((a) => a.sub)
      .filter((a) => !devEmails.includes(String(a.name || "").trim().toLowerCase()))
      .map((a) => ({
        account: a,
        days: a.sub.startedAt
          ? Math.floor((Date.now() - (Date.parse(a.sub.startedAt) || Date.now())) / DAY_MS)
          : null,
        salesMonth: Number(a.sub.salesMonth || 0)
      }))
      .filter(({ days, account, salesMonth }) => {
        if (days === null || days < 30) return false;
        const st = String(account.sub.status || "due");
        if (["active", "confirmed", "trial", "awaiting"].includes(st)) return false;
        return Date.now() - (account.t || 0) < 150000 && salesMonth > 0; // seen live AND selling
      })
      .sort((a, b) => (b.salesMonth - a.salesMonth) || (b.days - a.days));

    const authCard = `<div class="settings-card auth-card">
      <div class="report-card-head"><h2>Payment authentication</h2><span class="report-total">${cheaters.length}</span></div>
      <p class="report-note" style="margin-top:4px">Shops signing up 30+ days ago, never paid, live right now AND ringing sales — likely free-riding.</p>
      ${cheaters.length
        ? cheaters.map(({ account, days, salesMonth }) => `<div class="auth-row">
            <div class="auth-row-main">
              <strong>${esc(account.sub.shop || account.name || "Shop")}</strong>
              <small>${esc(account.name || "")} · ${days}d unpaid · ${salesMonth} sale${salesMonth === 1 ? "" : "s"} this month · seen ${seen(account.t)}</small>
            </div>
            <button class="btn btn-ghost" data-act="revert-payment" data-id="${esc(account.id)}">${icon("i-refresh")} Revert</button>
          </div>`).join("")
        : `<p class="report-note" style="margin:6px 0 0">No suspicious shops right now.</p>`}
    </div>`;

    return `<section class="screen" aria-labelledby="plans-title">
      <div class="screen-head">
        <p class="eyebrow">Developer</p>
        <h1 id="plans-title">Subscriptions</h1>
        <p class="sub">Every shop, its code, and what has been paid.</p>
      </div>
      ${authCard}
      <div class="plan-stats">
        <div class="plan-stat"><span class="label">Shops</span><strong>${rows.length}</strong></div>
        <div class="plan-stat"><span class="label">Paid</span><strong>${paidCount}</strong></div>
        <div class="plan-stat is-warn"><span class="label">To chase</span><strong>${dueCount}</strong></div>
        <div class="plan-stat"><span class="label">Waiting</span><strong>${pendingCount}</strong></div>
      </div>
      <div class="plan-total">
        <span>Monthly recurring</span>
        <strong>${esc(T.money(monthly))}</strong>
      </div>
      ${rows.length ? `<div class="plan-list">${rows.join("")}</div>` : `<p class="report-empty">No shops yet. They show up here as soon as they sign in.</p>`}
      <p class="field-small" style="margin-top:12px">A shop that says it has paid appears at the top as "Waiting". Tap Confirm and their app unlocks by itself.</p>
    </section>`;
  }

  function planRow(row, seen) {
    const label = row.status === "active" ? "Paid"
      : row.status === "trial" ? "Trial"
        : row.status === "awaiting" ? "Waiting"
          : row.status === "overdue" ? "Overdue"
            : row.status === "declined" ? "Declined"
              : row.status === "confirmed" ? "Paid"
                : row.status === "pending" ? "Waiting"
                  : "Due";
    const tone = row.status === "active" || row.status === "confirmed" ? "is-good"
      : row.status === "trial" ? "is-good"
        : row.status === "overdue" ? "is-bad" : "is-warn";
    // The developer's own shop never gets revert/delete — you can force any
    // other shop back to unpaid, but not this one.
    const isDev = (T.DEV_EMAILS || []).includes(String(row.email || "").trim().toLowerCase());
    return `<div class="plan-row">
      <div class="plan-row-top">
        <span class="plan-row-name"><strong>${esc(row.shop || "Shop")}</strong><small>${esc(row.email || "")}</small></span>
        <span class="plan-row-pill ${tone}">${esc(label)}</span>
      </div>
      <div class="plan-row-meta">
        <span class="plan-row-code"><strong>${esc(row.code || "no code")}</strong></span>
        ${isDev ? ` · <span class="plan-dup-flag">${icon("i-check")} You</span>` : ""}
        ${row.amount ? ` · <span>${esc(T.money(row.amount))}</span>` : ""}
        ${row.reference ? ` · <span>ref ${esc(row.reference)}</span>` : ""}
        ${row.mpesaCode ? ` · <span>M-Pesa ${esc(row.mpesaCode)}</span>` : ""}
        ${row.dupCode ? ` · <span class="plan-dup-flag">${icon("i-alert")} Same code</span>` : ""}
        ${row.phone ? ` · <span>${esc(row.phone)}</span>` : ""}
        ${row.paidAt ? ` · <span>paid ${esc(T.shortDateFmt.format(new Date(row.paidAt)))}</span>` : ""}
        <span class="muted" style="margin-left:auto">${esc(seen(row.at))}</span>
      </div>
      ${row.pending ? `<div class="plan-row-actions">
        <button class="btn btn-primary" data-act="confirm-payment" data-id="${esc(row.id)}">Confirm payment</button>
        <button class="btn btn-ghost" data-act="decline-payment" data-id="${esc(row.id)}">Not paid</button>
        ${isDev ? "" : `<button class="btn btn-ghost is-bad" data-act="delete-account" data-id="${esc(row.id)}">${icon("i-trash")} Delete</button>`}
      </div>` : `<div class="plan-row-actions">
        ${(row.status === "active" || row.status === "confirmed") && !isDev ? `<button class="btn btn-ghost" data-act="revert-payment" data-id="${esc(row.id)}">${icon("i-refresh")} Revert to unpaid</button>` : ""}
        ${isDev ? "" : `<button class="btn btn-ghost is-bad" data-act="delete-account" data-id="${esc(row.id)}">${icon("i-trash")} Delete</button>`}
      </div>`}
    </div>`;
  }
  /* ---------- Subscription ---------- */

  const SUB_STATUS = {
    trial: { label: "Free trial", tone: "good" },
    active: { label: "Active", tone: "good" },
    due: { label: "Payment due", tone: "warn" },
    overdue: { label: "Overdue", tone: "bad" },
    awaiting: { label: "Waiting for confirmation", tone: "warn" }
  };

  function subscriptionSection() {
    const sub = T.subscription();
    const plan = T.planSummary();
    const status = T.subscriptionStatus();
    const meta = SUB_STATUS[status] || SUB_STATUS.active;
    const fee = T.feeConfig();
    const due = T.subscriptionDueDate();
    // Active, trial and paid all share one countdown helper so the plans
    // screen always shows "X days left".
    const activeDays = T.subscriptionActiveDaysLeft?.();
    const amount = T.money(plan.amountCents);
    const reference = sub.reference || T.subscriptionReference();

    const history = (sub.payments || []).slice(-3).reverse().map((entry) => `
      <div class="data-row">
        <span class="data-icon">${icon("i-check")}</span>
        <span class="data-copy">
          <strong>${esc(T.money(entry.amountCents || plan.amountCents))}</strong>
          <small>${esc(entry.method === "mpesa" ? "Paid by M-Pesa" : "Paid")}${entry.at ? ` · ${esc(T.shortDateFmt.format(new Date(entry.at)))}` : ""}${entry.reference ? ` · ${esc(entry.reference)}` : ""}</small>
        </span>
      </div>`).join("");

    return `<div class="sub-card">
      <div class="sub-top">
        <div>
          <p class="card-sub" style="margin-top:0">${esc(plan.label)}</p>
          <div class="sub-price">${esc(amount)} <small>/ month</small></div>
        </div>
        <span class="sub-pill is-${esc(meta.tone)}">${esc(meta.label)}</span>
      </div>
      <p class="field-small" style="margin-top:8px">
        ${status === "trial"
          ? `Your first ${plan.trialDays} days are free. Pay ${esc(amount)} when the trial ends${activeDays !== null ? ` - ${activeDays} day${activeDays === 1 ? "" : "s"} left` : ""}.`
          : status === "active" && due
            ? `Next payment ${esc(T.shortDateFmt.format(due))}${activeDays !== null ? ` - ${activeDays} day${activeDays === 1 ? "" : "s"} left` : ""}.`
            : status === "due" && due
              ? `Payment of ${esc(amount)} was due ${esc(T.shortDateFmt.format(due))}.`
              : status === "awaiting"
                ? `You told us the payment is on its way (ref ${esc(reference)}). We will switch it on once it arrives.`
                : status === "overdue"
                  ? `The ${esc(amount)} payment is overdue.`
                  : `Monthly plan of ${esc(amount)}.`}
      </p>
      ${status !== "active" && status !== "trial" ? `
        <button class="btn btn-primary btn-block" data-act="pay-subscription" style="margin-top:12px">
          ${icon("i-phone")} ${status === "awaiting" ? "Payment details" : `Pay ${esc(amount)}`}
        </button>` : ""}
      ${status === "awaiting" ? `
        <p class="field-small" style="margin-top:10px">${icon("i-clock", "ico ico-sm")} We will switch your plan on as soon as the developer confirms the payment.</p>` : ""}
      ${fee.mpesaNumber || fee.bank.number ? `
        <p class="field-small" style="margin-top:10px">Reference <strong>${esc(reference)}</strong> - include it with the payment so we can match it to your shop.</p>` : ""}
      <div class="plan-reminders">
        <div class="plan-reminders-copy">
          <strong>Reminders</strong>
          <small id="notify-status">Checking...</small>
        </div>
        <div class="plan-reminders-actions">
          <button class="btn btn-ghost" data-act="notify-request" id="notify-on">Turn on</button>
          <button class="btn btn-ghost" data-act="notify-test" id="notify-test">Test</button>
        </div>
      </div>
      ${history ? `<div class="section-head" style="margin-top:14px"><h2>Payments</h2></div><div class="data-list">${history}</div>` : ""}
    </div>`;
  }
  function more() {
    const store = T.state.store;
    const session = T.getSession();
    const themeName = T.THEMES.find((theme) => theme.id === T.themeId())?.name || "Forest";
    const isDeveloper = T.isDeveloperAccount();
    const openGroups = T.ui.settingsOpen && typeof T.ui.settingsOpen === "object" ? T.ui.settingsOpen : {};
    const settingsGroup = (id, iconName, title, sub, body) => `
      <section class="settings-group ${openGroups[id] ? "is-open" : ""}">
        <button type="button" class="settings-group-head" data-act="toggle-settings-group" data-value="${id}" aria-expanded="${openGroups[id] ? "true" : "false"}">
          <span class="data-icon">${icon(iconName)}</span>
          <span class="data-copy"><strong>${esc(title)}</strong><small>${esc(sub)}</small></span>
          <span class="chev">${icon("i-chevron")}</span>
        </button>
        <div class="settings-group-body" ${openGroups[id] ? "" : "hidden"}>${body}</div>
      </section>`;
    const subscriptionBody = subscriptionSection();
    const shopBody = `
      <div class="data-list">
        <button class="data-row" data-nav="#/store">
          <span class="data-icon">${icon("i-store")}</span>
          <span class="data-copy"><strong>Store &amp; receipts</strong><small>${esc(store.name)} · ${esc(store.currency)} · tax ${esc(store.taxRate)}%</small></span>
          <span class="chev">${icon("i-chevron")}</span>
        </button>
        <button class="data-row" data-nav="#/suppliers">
          <span class="data-icon">${icon("i-truck")}</span>
          <span class="data-copy"><strong>Suppliers</strong><small>${(T.state.suppliers || []).length} ${(T.state.suppliers || []).length === 1 ? "restock contact" : "restock contacts"}</small></span>
          <span class="chev">${icon("i-chevron")}</span>
        </button>
        <button class="data-row" data-nav="#/mpesa">
          <span class="data-icon">${icon("i-phone")}</span>
          <span class="data-copy"><strong>M-Pesa</strong><small>Shortcode, Daraja app and connection test</small></span>
          <span class="chev">${icon("i-chevron")}</span>
        </button>
        <button class="data-row" data-nav="#/audit">
          <span class="data-icon">${icon("i-check")}</span>
          <span class="data-copy"><strong>Audit report</strong><small>Count shelf stock and mark each item as matched</small></span>
          <span class="chev">${icon("i-chevron")}</span>
        </button>
      </div>
      ${subscriptionBody ? `<div class="section-head" style="margin-top:12px"><h2>Monthly plan</h2><span class="small muted">${T.subscriptionStatus() === "active" ? "Active" : T.subscriptionStatus() === "trial" ? "Free trial" : T.subscriptionStatus() === "awaiting" ? "Awaiting confirmation" : "Payment due"}</span></div>${subscriptionBody}` : ""}`;
    const catalogBody = categorySection();
    const appearanceBody = `
      <div class="theme-card">
        <p class="card-sub">Pick the palette for this till.</p>
        <div class="field" style="margin-bottom:11px">
          <label>Light or dark</label>
          <div class="segmented" role="group" aria-label="Light or dark theme">
            <button type="button" class="seg-btn ${T.colorScheme() === "light" ? "is-active" : ""}" data-act="set-color-scheme" data-value="light" aria-pressed="${T.colorScheme() === "light"}">${icon("i-eye")} Light</button>
            <button type="button" class="seg-btn ${T.colorScheme() === "dark" ? "is-active" : ""}" data-act="set-color-scheme" data-value="dark" aria-pressed="${T.colorScheme() === "dark"}">${icon("i-lock")} Dark</button>
          </div>
          <p class="field-small">Your choice wins over the phone's own setting, so the till always looks the same.</p>
        </div>
        <div class="theme-grid" role="group" aria-label="App theme">
          ${T.THEMES.map((theme) => {
            const active = T.themeId() === theme.id;
            return `<button class="theme-swatch theme-${theme.id} ${active ? "is-active" : ""}" data-act="set-theme" data-value="${theme.id}" aria-pressed="${active}" aria-label="${theme.name} theme, ${theme.hint}">
              <span class="theme-preview" aria-hidden="true"><span class="bar"></span><span class="bar accent"></span><span class="bar dot"></span></span>
              <span class="theme-name">${theme.name}</span>
            </button>`;
          }).join("")}
        </div>
        <div class="field" style="margin-top:10px">
          <label>Text size</label>
          <div class="segmented" role="group" aria-label="Text size">
            ${["small", "medium", "large"].map((size) => `<button type="button" class="seg-btn ${T.textSizeId() === size ? "is-active" : ""}" data-act="set-text-size" data-value="${size}" aria-pressed="${T.textSizeId() === size}">${size[0].toUpperCase() + size.slice(1)}</button>`).join("")}
          </div>
        </div>
      </div>`;
    const accountBody = `
      <div class="data-list">
        <button class="data-row" data-nav="#/account">
          <span class="data-icon">${icon("i-user")}</span>
          <span class="data-copy"><strong>Account &amp; sign-in</strong><small>${session ? session.email : "Not signed in"}</small></span>
          <span class="chev">${icon("i-chevron")}</span>
        </button>
      </div>`;
    const paymentMode = T.paymentMode ? T.paymentMode() : "all";
    const debtAllowed = T.debtAllowed ? T.debtAllowed() : true;
    const debtBlocked = !debtAllowed;
    const modeCopy = {
      all: "Cash, M-Pesa and Card can all be taken at checkout.",
      cash: "Only cash can be taken. M-Pesa and Card are grayed out at checkout.",
      mpesa: "Only M-Pesa can be taken. Cash and Card are grayed out at checkout.",
      card: "Only Card can be taken. Cash and M-Pesa are grayed out at checkout."
    }[paymentMode];
    const securityBody = `
      <div class="about-card">
        <div class="report-card-head"><h2>Shop PIN</h2><span class="status-pill ${T.pinEnabled() ? "is-good" : "is-warn"}"><span class="dot"></span>${T.pinEnabled() ? "On" : "Off"}</span></div>
        <p class="card-sub">${T.pinEnabled() ? "A 4-digit PIN is required every time staff edit stock, edit or delete orders, products, suppliers or shop data — and every write-off and restore." : "No PIN is set — anyone with this till can edit stock, edit or delete records, write off wastage and restore backups."}</p>
        <div class="sheet-actions" style="margin-top:10px">
          ${T.pinEnabled()
            ? `<button class="btn btn-ghost btn-block" data-act="remove-pin">${icon("i-trash")} Remove PIN</button>
               <button class="btn btn-primary btn-block" data-act="change-pin">${icon("i-lock")} Change PIN</button>`
            : `<button class="btn btn-primary btn-block" data-act="set-pin">${icon("i-lock")} Set a PIN</button>`}
        </div>
        <div class="security-divider" role="separator"></div>
        <div class="report-card-head"><h2>Checkout payment mode</h2><span class="status-pill ${paymentMode === "all" ? "is-good" : "is-warn"}"><span class="dot"></span>${paymentMode === "all" ? "All methods" : paymentMode === "cash" ? "Cash only" : paymentMode === "mpesa" ? "M-Pesa only" : "Card only"}</span></div>
        <p class="card-sub">${esc(modeCopy)}</p>
        <div class="segmented seg-four" role="radiogroup" aria-label="Allowed payment methods" style="margin-top:8px">
          ${[
            { value: "all", label: "All payments" },
            { value: "cash", label: "Cash only" },
            { value: "mpesa", label: "M-Pesa only" },
            { value: "card", label: "Card only" }
          ].map((option) => `<button class="seg-btn ${paymentMode === option.value ? "is-active" : ""}" data-act="set-payment-mode" data-value="${option.value}" role="radio" aria-checked="${paymentMode === option.value}">${option.label}</button>`).join("")}
        </div>
        <div class="security-divider" role="separator"></div>
        <div class="switch-row">
          <div class="switch-copy">
            <strong>No debt allowed</strong>
            <small>${debtBlocked ? "On — ADD TO DEBT is grayed out at checkout. Every sale must be paid now." : "Off — customers can buy now and pay later."}</small>
          </div>
          <button class="switch${debtBlocked ? " is-on" : ""}" type="button" role="switch" aria-checked="${debtBlocked}" data-act="toggle-no-debt" aria-label="No debt allowed"><span class="switch-thumb"></span></button>
        </div>
      </div>`;
    const developerBody = `
      <div class="data-list">
        <button class="data-row" data-nav="#/plans">
          <span class="data-icon">${icon("i-card")}</span>
          <span class="data-copy"><strong>Subscription panel</strong><small>Every shop, its code and what has been paid</small></span>
          <span class="chev">${icon("i-chevron")}</span>
        </button>
      </div>`;
    const dataBody = `
      <div class="data-list">
        <button class="data-row" data-act="export-data">
          <span class="data-icon">${icon("i-download")}</span>
          <span class="data-copy"><strong>Export data</strong><small>Products, orders and settings as JSON</small></span>
          <span class="chev">${icon("i-chevron")}</span>
        </button>
        <button class="data-row" data-act="import-data">
          <span class="data-icon">${icon("i-download")}</span>
          <span class="data-copy"><strong>Restore from backup</strong><small>Load JSON backup file</small></span>
          <span class="chev">${icon("i-chevron")}</span>
        </button>
        <button class="data-row" data-act="save-info">
          <span class="data-icon">${icon("i-lock")}</span>
          <span class="data-copy"><strong>Saved on this device</strong><small>Products, orders and settings are stored locally</small></span>
          <span class="save-chip" id="saveState" aria-label="Data saved on this device">
            <span class="dot"></span><span class="save-label">Saved</span>
          </span>
        </button>
        <button class="data-row danger" data-act="reset-data">
          <span class="data-icon">${icon("i-refresh")}</span>
          <span class="data-copy"><strong>Reset all data</strong><small>Clear products, orders and settings</small></span>
          <span class="chev">${icon("i-chevron")}</span>
        </button>
      </div>`;
    const activity = Array.isArray(T.state.activityLog) ? T.state.activityLog : [];
    const timeAgo = (iso) => {
      const ts = Date.parse(iso);
      if (!Number.isFinite(ts)) return "";
      const minutes = Math.floor((Date.now() - ts) / 60000);
      if (minutes < 1) return "just now";
      if (minutes < 60) return `${minutes}m ago`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      if (days === 1) return "yesterday";
      if (days < 30) return `${days}d ago`;
      return new Date(ts).toLocaleDateString("en-KE", { day: "numeric", month: "short" });
    };
    const activityIcon = (kind) => ({ add: "i-plus", edit: "i-pencil", delete: "i-trash", sale: "i-receipt", stock: "i-box", security: "i-lock", reset: "i-refresh" }[kind] || "i-info");
    const cleanKind = (kind) => String(kind || "other").replace(/[^a-z]/g, "").slice(0, 20) || "other";
    const historyBody = `
      ${activity.length ? `<div class="activity-list">
        ${activity.slice(0, 30).map((entry) => {
          const kind = cleanKind(entry.kind);
          return `<div class="activity-row">
          <span class="activity-icon kind-${kind}">${icon(activityIcon(kind))}</span>
          <span class="activity-copy"><strong>${esc(entry.summary)}</strong><small>${esc(timeAgo(entry.at))}</small></span>
        </div>`;
        }).join("")}
      </div>
      <div class="sheet-actions" style="margin-top:10px"><button class="btn btn-ghost btn-block" data-act="clear-activity-log">${icon("i-trash")} Clear history</button></div>` : `<p class="card-sub" style="padding:10px 2px 2px">Nothing recorded yet. Adds, edits, deletes, stock changes, sales and security switches will show up here.</p>`}`;
    const aboutBody = `
      <div class="about-card">
        <div class="about-top">
          <span class="about-mark">${icon("i-store")}</span>
          <div><div class="about-name">BILLER POS</div><div class="about-version">${VERSION ? `V ${esc(VERSION)} · ` : ""}cloud-synced till</div></div>
        </div>
        <p><strong>Cash is recorded on this device.</strong> M-Pesa sends a real PIN prompt to the customer once your Paybill or Till is connected in Store &amp; receipts. The card reader is a demo and moves no money.</p>
      </div>`;
    return `<section class="screen">
      <div class="screen-head">
        <h1 id="more-title">SETTINGS</h1>
        <p class="sub">Everything in one place, grouped.</p>
      </div>

      <div class="settings-groups">
        ${settingsGroup("shop", "i-store", "Shop & receipts", `${store.name} · Plan ${T.subscriptionStatus() === "active" ? "active" : T.subscriptionStatus() === "trial" ? "trial" : T.subscriptionStatus() === "awaiting" ? "awaiting" : "due"}`, shopBody)}
        ${settingsGroup("catalog", "i-grid", "Catalog", `${T.categories().length} categories · ${T.state.products.length} products`, catalogBody)}
        ${settingsGroup("appearance", "i-pencil", "Appearance", `${themeName} · ${T.colorScheme() === "dark" ? "Dark" : "Light"}`, appearanceBody)}
        ${settingsGroup("data", "i-lock", "Data & privacy", "Export, backup and reset", dataBody)}
        ${isDeveloper ? settingsGroup("developer", "i-chat", "Developer", "Subscriptions and support", developerBody) : ""}
        ${settingsGroup("account", "i-user", "Account", session ? session.email : "Not signed in", accountBody)}
        ${settingsGroup("security", "i-lock", "Security", `${T.pinEnabled() ? "PIN on" : "No PIN"} · ${paymentMode === "all" ? "All payments" : paymentMode === "cash" ? "Cash only" : paymentMode === "mpesa" ? "M-Pesa only" : "Card only"}${debtBlocked ? " · No debt" : ""}`, securityBody)}
        ${settingsGroup("history", "i-receipt", "History log", activity.length ? `${activity.length} recent ${activity.length === 1 ? "entry" : "entries"} · adds, edits, deletes` : "Adds, edits and deletes", historyBody)}
      </div>

      <button type="button" class="account-card support-card" data-act="open-developer-chat" style="margin-top:10px">
        <span class="data-icon">${icon("i-chat")}</span>
        <span class="account-card-copy">
          <strong>CHAT DEVELOPER</strong>
          <small>Spotted a bug or need help setting up? Send a message.</small>
        </span>
        <span class="chev">${icon("i-chevron")}</span>
      </button>

      <div class="settings-groups" style="margin-top:10px">
        ${settingsGroup("about", "i-info", "About Biller POS", VERSION ? `V ${esc(VERSION)}` : "", aboutBody)}
      </div>
    </section>`;
  }

  function mpesaSettings() {
    const store = T.state.store;
    return `<section class="screen" aria-labelledby="mpesa-title">
      <div class="screen-head">
        <p class="eyebrow">Shop details</p>
        <h1 id="mpesa-title">M-Pesa</h1>
        <p class="sub">Take Lipa na M-Pesa payments straight into your Paybill or Till.</p>
      </div>
      <form class="settings-card" id="settings-form" novalidate>
        <div class="mpesa-settings">
          <p class="card-sub">Take Lipa na M-Pesa payments straight into your Paybill or Till. The customer gets a PIN prompt on their phone.</p>
          <ol class="mpesa-steps">
            <li><strong>Your shortcode.</strong> The Paybill or Till number that should receive the money.</li>
            <li><strong>Your Daraja app.</strong> Consumer key, secret and the passkey for that number — you do this once, then it is saved with your shop.</li>
            <li><strong>Check it.</strong> Send a KES 1 prompt to your own phone and approve it.</li>
          </ol>
          <div class="field-row">
            <div class="field">
              <label id="mpesa-mode-label">Send payments to</label>
              <div class="seg-choice" role="radiogroup" aria-labelledby="mpesa-mode-label">
                <input type="radio" id="mpesa-mode-paybill" name="mpesaMode" value="paybill" ${(store.mpesa?.mode || "paybill") === "paybill" ? "checked" : ""}>
                <label for="mpesa-mode-paybill">Paybill</label>
                <input type="radio" id="mpesa-mode-till" name="mpesaMode" value="till" ${store.mpesa?.mode === "till" ? "checked" : ""}>
                <label for="mpesa-mode-till">Till</label>
              </div>
            </div>
            <div class="field">
              <label id="mpesa-env-label">Daraja environment</label>
              <div class="seg-choice" role="radiogroup" aria-labelledby="mpesa-env-label">
                <input type="radio" id="mpesa-env-sandbox" name="mpesaEnv" value="sandbox" ${store.mpesa?.environment !== "production" ? "checked" : ""}>
                <label for="mpesa-env-sandbox">Sandbox</label>
                <input type="radio" id="mpesa-env-production" name="mpesaEnv" value="production" ${store.mpesa?.environment === "production" ? "checked" : ""}>
                <label for="mpesa-env-production">Production</label>
              </div>
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="mpesa-paybill">Paybill number</label>
              <input class="input" id="mpesa-paybill" name="mpesaPaybill" inputmode="numeric" autocomplete="off" placeholder="e.g. 247247" value="${esc(store.mpesa?.paybill || "")}">
            </div>
            <div class="field">
              <label for="mpesa-till">Till number</label>
              <input class="input" id="mpesa-till" name="mpesaTill" inputmode="numeric" autocomplete="off" placeholder="e.g. 123456" value="${esc(store.mpesa?.till || "")}">
            </div>
          </div>
          <p class="field-small">Only the number matching the choice above is used. The other one is greyed out and stays as a spare.</p>
          <div class="field">
            <label for="mpesa-account">Paybill account number <span class="label-optional">optional</span></label>
            <input class="input" id="mpesa-account" name="mpesaAccount" autocomplete="off" maxlength="12" placeholder="e.g. your business account number" value="${esc(store.mpesa?.account || "")}">
            <p class="field-small">What shows as the account number on your M-Pesa statement. The cashier can edit it on each Paybill sale; leave it blank to use the receipt number.</p>
          </div>

          <details class="settings-details" ${store.mpesa?.consumerKey || store.mpesa?.backend ? "open" : ""}>
            <summary>Connection details</summary>
            <p class="field-help">These three values let this till talk to Safaricom. They belong to <strong>your shop's</strong> Daraja app, so nobody else has to fill them for you.</p>
            <div class="field">
              <label for="mpesa-consumer-key">Consumer key</label>
              <input class="input" id="mpesa-consumer-key" name="mpesaConsumerKey" autocomplete="off" placeholder="Daraja consumer key" value="${esc(store.mpesa?.consumerKey || "")}">
              <p class="field-small">developer.safaricom.co.ke &rarr; My Apps &rarr; your app &rarr; Consumer Key.</p>
            </div>
            <div class="field">
              <label for="mpesa-consumer-secret">Consumer secret</label>
              <input class="input" id="mpesa-consumer-secret" name="mpesaConsumerSecret" type="password" autocomplete="off" placeholder="Daraja consumer secret" value="${esc(store.mpesa?.consumerSecret || "")}">
              <p class="field-small">The same page, right under the key. Never share it.</p>
            </div>
            <div class="field">
              <label for="mpesa-passkey">Lipa na M-Pesa passkey</label>
              <input class="input" id="mpesa-passkey" name="mpesaPasskey" type="password" autocomplete="off" placeholder="STK push passkey" value="${esc(store.mpesa?.passkey || "")}">
              <p class="field-small">Safaricom issues this for your Paybill or Till. It must match the number above, or the request is refused.</p>
            </div>
            <div class="field">
              <label for="mpesa-backend">Backend URL <span class="label-optional">optional</span></label>
              <input class="input" id="mpesa-backend" name="mpesaBackend" type="url" inputmode="url" autocomplete="off" placeholder="https://your-server.example/mpesa" value="${esc(store.mpesa?.backend || "")}">
              <p class="field-small">When set, the app sends the request through this server instead of calling Safaricom directly. The server contract is in MPESA-SETUP.md and server/README.md.</p>
            </div>
            <div class="field">
              <label for="mpesa-backend-key">Backend key <span class="label-optional">optional</span></label>
              <input class="input" id="mpesa-backend-key" name="mpesaBackendKey" type="password" autocomplete="off" placeholder="Sent as a Bearer token" value="${esc(store.mpesa?.backendKey || "")}">
              <p class="field-small">Your server keeps the Daraja details, so this till only needs its Paybill or Till number.</p>
            </div>
            <div class="mpesa-test-row">
              <button type="button" class="btn btn-ghost" data-act="mpesa-demo">${icon("i-flash")} Try the Safaricom sandbox</button>
              <span class="mpesa-test-note" id="mpesa-demo-note" role="status"></span>
            </div>
          </details>

          <div class="mpesa-test-row">
            <button type="button" class="btn btn-ghost" data-act="mpesa-test">${icon("i-check")} Test connection</button>
            <span class="mpesa-test-note" id="mpesa-test-note" role="status"></span>
          </div>
          <div class="mpesa-test-row">
            <input class="input mpesa-test-phone" id="mpesa-test-phone" inputmode="tel" autocomplete="off" placeholder="Your phone, e.g. 0712 345 678">
            <button type="button" class="btn btn-ghost" data-act="mpesa-test-push">${icon("i-phone")} Send KES 1 test prompt</button>
          </div>
          <span class="mpesa-test-note" id="mpesa-push-note" role="status"></span>
          <p class="field-small">The KES 1 prompt proves the shortcode and passkey belong together — the most common setup mistake. Approve it on your own phone to finish the check.</p>
          <p class="field-small">Payments are recorded in Orders and on the receipt with the customer's number and the M-Pesa reference.</p>
        </div>

        <div class="settings-actions">
          <button class="btn btn-primary btn-block" type="submit">Save M-Pesa settings</button>
        </div>
      </form>
    </section>`;
  }

  function storeSettings() {
    const store = T.state.store;
    const roster = T.staffRoster ? T.staffRoster() : (store.staff ? [store.staff] : []);
    // The same value the Sell tab's picker shows: one shopkeeper per device.
    const active = T.activeStaff ? T.activeStaff() : "";
    return `<section class="screen" aria-labelledby="store-title">
      <div class="screen-head">
        <p class="eyebrow">Shop details</p>
        <h1 id="store-title">Store &amp; receipts</h1>
        <p class="sub">These details appear on every digital receipt.</p>
      </div>
      <form class="settings-card" id="store-settings-form" novalidate style="margin-top:0">
        <h2>Store profile</h2>
        <p class="card-sub">The name and contact details printed on receipts.</p>
        <div class="field">
          <label for="store-name">Store name</label>
          <input class="input" id="store-name" name="name" value="${esc(store.name)}" required autocomplete="organization">
        </div>
        <div class="field">
          <label for="store-address">Address</label>
          <input class="input" id="store-address" name="address" value="${esc(store.address)}" autocomplete="street-address">
        </div>
        <div class="field">
          <label for="store-phone">Phone</label>
          <input class="input" id="store-phone" name="phone" value="${esc(store.phone)}" autocomplete="tel" inputmode="tel">
        </div>
        <div class="field">
          <label for="store-staff">Shopkeeper on this device</label>
          ${roster.length ? `<select class="select" id="store-staff" name="staff">
            ${roster.map((name) => {
              const taken = name !== active && Boolean(T.staffClaimedBy?.(name));
              return `<option value="${esc(name)}" ${String(active) === name ? "selected" : ""} ${taken ? "disabled" : ""}>${esc(name)}${taken ? " — selling on another device" : ""}</option>`;
            }).join("")}
          </select>` : `<input class="input" id="store-staff" name="staff" value="${esc(store.staff)}" autocomplete="name" placeholder="Add a shopkeeper below first">`}
          <p class="field-help">Same choice as the Sell tab — the name printed on this device's receipts. A name already selling on another till stays greyed out.</p>
        </div>

        <div class="section-head"><h2>Sales &amp; receipts</h2></div>
        <div class="field-row">
          <div class="field">
            <label for="store-tax">Sales tax</label>
            <div class="input-affix"><input class="input" id="store-tax" name="taxRate" type="number" min="0" max="30" step="0.01" inputmode="decimal" value="${esc(store.taxRate)}"><span class="affix">%</span></div>
          </div>
          <div class="field">
            <label for="store-currency">Currency</label>
            <select class="select" id="store-currency" name="currency">
              ${["KES", "USD", "EUR", "GBP", "UGX", "TZS", "GHS", "NGN", "INR", "AUD", "CAD"].map((code) => `<option value="${esc(code)}" ${String(store.currency || "KES") === code ? "selected" : ""}>${esc(code)} — ${code === "KES" ? "Kenyan shillings (KSh)" : code}</option>`).join("")}
            </select>
          </div>
        </div>
        <p class="field-help">All totals, receipts, and change calculations use this currency.</p>
        <div class="field">
          <label for="store-footer">Receipt footer</label>
          <textarea class="textarea" id="store-footer" name="footer" rows="2">${esc(store.footer)}</textarea>
        </div>

        <div class="settings-actions">
          <button class="btn btn-primary btn-block" type="submit">Save store settings</button>
        </div>
      </form>

      <div class="settings-card">
        <h2>Shopkeepers</h2>
        <p class="card-sub">Everyone who can ring up sales. Each device picks who is selling, and the picked name prints on its receipts. One shopkeeper sells on one device at a time.</p>
        <div class="staff-roster">
          ${roster.length ? roster.map((name) => {
            const taken = name !== active && Boolean(T.staffClaimedBy?.(name));
            return `
            <span class="staff-chip">
              <span class="staff-chip-name">${esc(name)}</span>
              ${taken ? `<button type="button" class="staff-chip-free" data-act="release-staff" data-value="${esc(name)}" aria-label="Free ${esc(name)} from the other device">Free</button>` : ""}
              <button type="button" class="staff-chip-x" data-act="remove-staff" data-value="${esc(name)}" aria-label="Remove ${esc(name)}">${icon("i-close")}</button>
            </span>`;
          }).join("") : `<span class="staff-roster-empty">No shopkeepers yet — add the first one below.</span>`}
        </div>
        <div class="staff-add-row">
          <input class="input" id="new-staff-name" inputmode="text" autocomplete="off" spellcheck="false" placeholder="e.g. Mary Wanjiku" aria-label="New shopkeeper name">
          <button class="btn" type="button" data-act="add-staff">Add</button>
        </div>
      </div>
    </section>`;
  }

  /* ---------- Account ---------- */

  function cloudCard() {
    const cloud = T.cloud?.status?.() || { mode: "local", phase: "signed-out", lastSyncAt: 0 };
    const session = T.getSession();
    let status = "This device only";
    if (!session) status = "Sign in to sync";
    else if (cloud.phase === "syncing") status = "Syncing…";
    else if (cloud.phase === "synced") status = "Saved to Firebase";
    else if (cloud.phase === "error") status = cloud.error || "Cloud sync stopped";
    else if (cloud.mode === "local") status = cloud.error || "Firebase unavailable";
    const lastSync = cloud.lastSyncAt
      ? T.shortDateFmt.format(new Date(cloud.lastSyncAt))
      : "Not yet";
    return `<div class="settings-card">
      <div class="report-card-head">
        <h2>Cloud backup</h2>
        <span class="report-total">${esc(status)}</span>
      </div>
      <p class="card-sub">Your shop, stock and orders live in Firebase under your account, and stay on this device so you can keep selling without a connection.</p>
      <div class="account-row"><span>Storage</span><strong>${cloud.mode === "cloud" ? "Firebase" : "This device"}</strong></div>
      <div class="account-row"><span>Last sync</span><strong>${esc(lastSync)}</strong></div>
      <div class="settings-actions">
        <button class="btn btn-ghost btn-block" data-act="cloud-sync">${icon("i-refresh")} Sync now</button>
      </div>
      <p class="account-note">${icon("i-lock", "ico ico-sm")}<span>Tap Sync now to fetch the latest copy from the cloud.</span></p>
    </div>`;
  }

  /** Only the developer account sees this card. */
  function devPanel() {
    const cloud = T.cloud?.status?.();
    if (!T.isDeveloperAccount()) return "";
    const accounts = T.cloud?.accounts?.() || [];
    const planRows = accounts.map((account) => {
      const sub = account.sub;
      if (!sub) return "";
      const status = String(sub.status || "active");
      const label = status === "active" ? "Paid" : status === "trial" ? "Trial" : status === "awaiting" ? "Awaiting" : status === "overdue" ? "Overdue" : "Due";
      const tone = status === "active" || status === "trial" ? "is-online" : status === "overdue" ? "is-bad" : "is-warn";
      const amount = sub.amount ? T.money(sub.amount) : "";
      const detail = [
        sub.shop ? sub.shop : "",
        amount,
        sub.reference ? `ref ${sub.reference}` : "",
        sub.paidUntil ? `until ${T.shortDateFmt.format(new Date(sub.paidUntil))}` : ""
      ].filter(Boolean).join(" · ");
      return `<div class="dev-account">
        <span class="dev-dot ${tone}" aria-hidden="true"></span>
        <span class="dev-copy"><strong>${esc(sub.shop || account.name)}</strong><small>${esc(detail || "monthly plan")}</small></span>
        <span class="dev-state ${tone}">${esc(label)}</span>
      </div>`;
    }).join("");
    return `<div class="settings-card dev-panel">
      ${cloud.accountsError ? `<p class="dev-error">Cannot read other accounts (${esc(cloud.accountsError)}). Check the Firestore rules for the presence collection.</p>` : ""}
      ${planRows ? `<div class="section-head"><h2>Monthly plans</h2></div>
      <p class="card-sub">Each shop's plan state. A shop marked "Awaiting" has sent the money and is waiting for you to confirm it.</p>
      <div class="dev-account-list">${planRows}</div>` : `<p class="report-empty">No shop has a plan yet.</p>`}
    </div>`;
  }

  function accountSettings() {
    const session = T.getSession();
    const initial = (session?.email || T.state.store.staff || T.state.store.name || "S").slice(0, 1).toUpperCase();
    return `<section class="screen" aria-labelledby="account-title">
      <div class="screen-head">
        <p class="eyebrow">Your account</p>
        <h1 id="account-title">Account</h1>
        <p class="sub">Sign-in and syncing for this till.</p>
      </div>
      <div class="account-hero">
        <span class="avatar avatar-lg" aria-hidden="true">${esc(initial)}${session ? `<span class="avatar-status">${icon("i-check")}</span>` : ""}</span>
        <div class="account-copy">
          <strong>${session ? esc(session.email) : "Not signed in"}</strong>
          <small>${session ? `<span class="account-dot"></span>Signed in` : "Local till mode"}</small>
        </div>
      </div>
      ${session ? `
      <div class="settings-card">
        <h2>Sign-in details</h2>
        <p class="card-sub">Your shop settings sync with this email.</p>
        <div class="account-row"><span>Email</span><strong>${esc(session.email)}</strong></div>
        <div class="account-row"><span>Status</span><strong class="account-ok">${icon("i-check", "ico ico-sm")} Signed in</strong></div>
        <div class="settings-actions">
          <button class="btn btn-ghost btn-block" data-act="sign-out">Sign out</button>
        </div>
      </div>
      ${(() => {
        const activated = T.subscriptionActivatedAt?.();
        const daysLeft = T.subscriptionActiveDaysLeft?.();
        const activatedText = activated ? T.shortDateFmt.format(activated) : "—";
        const daysText = daysLeft === null ? "—" : (daysLeft < 0 ? `${Math.abs(daysLeft)} days overdue` : `${daysLeft} days left`);
        return `<div class="settings-card">
          <h2>Plan status</h2>
          <p class="card-sub">Your activation and remaining active days.</p>
          <div class="account-row"><span>Activated on</span><strong>${esc(activatedText)}</strong></div>
          <div class="account-row"><span>Days remaining</span><strong>${esc(daysText)}</strong></div>
        </div>`;
      })()}
      ${(() => {
        const st = T.cloud?.status?.() || {};
        const online = st.online !== false && (typeof navigator === "undefined" || navigator.onLine !== false);
        const phase = String(st.phase || (st.mode === "cloud" ? "syncing" : "local"));
        const statusText = !online
          ? "Offline — changes save on this device"
          : (st.mode === "local"
            ? "Local only — sign in to sync"
            : (phase === "synced" ? "Synced with the cloud" : (phase === "error" ? (st.error || "Could not reach the cloud") : "Syncing…")));
        return `<div class="settings-card">
          <h2>Sync &amp; offline</h2>
          <p class="card-sub">Your data is saved on this device and syncs when online.</p>
          <div class="account-row"><span>Connection</span><strong>${online ? "Online" : "Offline"}</strong></div>
          <div class="account-row"><span>Cloud sync</span><strong>${esc(statusText)}</strong></div>
          <div class="settings-actions">
            <button class="btn btn-ghost btn-block" data-act="refresh-data">${icon("i-refresh")} Refresh data</button>
          </div>
        </div>`;
      })()}
      <p class="account-note">${icon("i-lock", "ico ico-sm")}<span>Products, stock and orders stay saved on this device. Signing out only ends the email session.</span></p>`
      : `
      <div class="settings-card">
        <h2>Sign in</h2>
        <p class="card-sub">Use an email account to keep your shop settings in sync across devices.</p>
        <button class="btn btn-primary btn-block" data-act="open-auth">Sign in ${icon("i-arrow")}</button>
      </div>
      <p class="account-note">${icon("i-lock", "ico ico-sm")}<span>You can keep selling without an account. Everything stays saved on this device.</span></p>`}
      ${cloudCard()}
      ${devPanel()}
    </section>`;
  }

  /* ---------- Login / welcome ---------- */

  function auth() {
    const session = T.getSession();
    // The Firebase SDK never loaded (blocked network / no signal on this
    // device). Be explicit about it instead of silently letting the user in
    // — that is what made new signups vanish without a trace.
    if (window.localOnlyMode) {
      return `<section class="screen login-screen" id="login-screen" aria-labelledby="login-title">
        <div class="login-brand">
          <span class="login-mark">${icon("i-store")}</span>
          <h1 id="login-title">Biller POS</h1>
          <p class="eyebrow">Point of sale, in one hand</p>
        </div>

        <div class="login-card">
          <div class="login-alert offline-card" role="alert">
            ${icon("i-alert", "ico ico-sm")}
            <span id="login-alert-text"><strong>You are offline.</strong> The sign-in service can’t be reached from this device, so accounts can’t be created right now.</span>
          </div>
          <p class="offline-copy">Your shop keeps working offline. Anything you do is saved on this phone and will sync once you are online and sign in.</p>
          <div class="offline-actions">
            <button class="btn btn-primary btn-block" data-act="continue-offline">${icon("i-arrow")} Continue without an account</button>
            <button class="btn btn-quiet btn-block" data-act="retry-connection">${icon("i-refresh")} Try again</button>
          </div>
          <p class="field-help" style="margin-top:10px;text-align:center">Continuing offline means this shop stays on this device only. Sign in later to sync it to your account.</p>
        </div>
      </section>`;
    }
    return `<section class="screen login-screen" id="login-screen" data-mode="signin" aria-labelledby="login-title">
      <div class="login-brand">
        <span class="login-mark">${icon("i-store")}</span>
        <h1 id="login-title">Biller POS</h1>
        <p class="eyebrow">Point of sale, in one hand</p>
      </div>

      <div class="login-card">
        <div class="login-seg" id="login-seg" role="tablist" aria-label="Sign in or create an account" data-active="signin">
          <span class="login-seg-pill" aria-hidden="true"></span>
          <button type="button" class="login-seg-btn" role="tab" aria-selected="true" data-login-mode="signin">Sign in</button>
          <button type="button" class="login-seg-btn" role="tab" aria-selected="false" data-login-mode="signup">Create account</button>
        </div>

        <form class="login-form" id="login-form" novalidate>
          <div class="login-field" data-field="email">
            <label for="login-email">Email address</label>
            <input class="input" id="login-email" name="email" type="email" inputmode="email"
                   autocomplete="email" spellcheck="false" autocapitalize="none"
                   placeholder="you@shop.com" data-input-for="email" value="${esc(session?.email || "")}">
            <p class="login-error" data-error-for="email" role="alert"></p>
          </div>

          <div class="login-field" data-field="password">
            <label for="login-password">Password</label>
            <div class="login-affix">
              <input class="input" id="login-password" name="password" type="password"
                     autocomplete="current-password" placeholder="••••••••" data-input-for="password">
              <button type="button" class="login-eye" data-login-toggle="login-password"
                      aria-label="Show password" aria-pressed="false">${icon("i-eye", "ico ico-sm")}</button>
            </div>
            <p class="login-error" data-error-for="password" role="alert"></p>
          </div>

          <div class="login-field login-field-signup" data-field="confirmPassword">
            <label for="login-confirm">Confirm password</label>
            <div class="login-affix">
              <input class="input" id="login-confirm" name="confirmPassword" type="password"
                     autocomplete="new-password" placeholder="••••••••" data-input-for="confirmPassword">
              <button type="button" class="login-eye" data-login-toggle="login-confirm"
                      aria-label="Show password" aria-pressed="false">${icon("i-eye", "ico ico-sm")}</button>
            </div>
            <p class="login-error" data-error-for="confirmPassword" role="alert"></p>
          </div>

          <div class="login-alert" id="login-alert" role="alert" hidden>
            ${icon("i-alert", "ico ico-sm")}
            <span id="login-alert-text"></span>
          </div>

          <button type="submit" class="btn btn-primary btn-block login-submit" id="login-submit">
            <span class="login-spinner" aria-hidden="true"></span>
            <span class="login-submit-label">Sign in</span>
          </button>
        </form>
      </div>

      <p class="login-foot">
        ${icon("i-lock", "ico ico-sm")}
        <span>Your shop data stays on this device. Sign in to sync it across devices.</span>
      </p>
    </section>`;
  }

  /* ---------- Cart ---------- */

  function cart() {
    const locked = T.subscriptionLocked();
    const debtAllowed = T.debtAllowed ? T.debtAllowed() : true;
    const totals = T.cartTotals();
    const count = T.itemCount();
    const items = totals.lines.map((line) => {
      const { product, variant, qty, lineTotal, price, unitCost, lineCost } = line;
      const mass = product.soldByMass === true;
      const basePrice = variant ? variant.price : product.price;
      const stock = variant ? variant.stock : product.stock;
      const atMax = qty >= stock;
      const changed = price !== basePrice;
      const lineProfit = lineTotal - lineCost;
      const qtyLabel = mass ? T.massLabel(qty) : String(qty);
      const variantAttr = variant ? ` data-variant="${esc(variant.id)}"` : "";
      const variantName = variant ? ` · ${esc(variant.label)}` : "";
      const fullName = `${esc(product.name)}${variantName}`;
      const detail = variant ? [product.detail].filter(Boolean).join("") : [T.unitSizeLabel(product), T.bundleLabel(product), product.detail].filter(Boolean).join(" · ");
      return `<div class="cart-item">
        <div class="cart-item-top">${productTile(product, "tile-sm")}
          <div class="cart-item-copy">
            <div class="cart-item-name">${fullName}${detail ? ` <span class="product-detail">${esc(detail)}</span>` : ""}</div>
            ${stock <= product.lowStockAt ? `<div class="cart-item-stock">only ${mass ? esc(T.massLabel(stock)) : stock} left</div>` : ""}
          </div>
          <div class="cart-item-total">${money(lineTotal)}</div>
        </div>
        <div class="cart-item-bottom">
          <span class="cart-item-price-wrap">
            <input class="cart-item-price" type="number" min="0" step="0.01" inputmode="decimal"
              data-price-input data-id="${esc(product.id)}"${variantAttr} value="${(price / 100).toFixed(2)}"
              aria-label="Price for each ${fullName}" ${locked ? "disabled" : ""}>
            <span class="cart-item-price-tag">${mass ? "/kg" : "each"}</span>
          </span>
          ${changed ? `<button class="cart-item-reset" data-act="reset-line-price" data-id="${esc(product.id)}"${variantAttr}>set ${money(basePrice)}</button>` : ""}
          <span class="cart-item-side">
            ${unitCost ? `<span class="cart-item-profit">Profit ${money(lineProfit)}</span>` : ""}
            ${atMax ? `<span class="item-stock">Max</span>` : ""}
          </span>
          <span class="stepper" aria-label="Quantity for ${fullName}">
            ${mass ? `<button class="step-btn weigh-edit" data-act="open-weigh" data-id="${esc(product.id)}"${variantAttr} data-edit="1" aria-label="Reweigh ${fullName}" ${locked ? "disabled" : ""}>${icon("i-scale")}</button>` : ""}
            <button class="step-btn minus ${!mass && qty === 1 ? "at-one" : ""}" data-act="dec-item" data-id="${esc(product.id)}"${variantAttr} aria-label="${mass ? `Take off 100 g` : (qty === 1 ? "Remove" : "Decrease quantity")}" ${locked ? "disabled" : ""}>${icon(mass || qty > 1 ? "i-minus" : "i-trash")}</button>
            <span class="step-value">${esc(qtyLabel)}</span>
            <button class="step-btn" data-act="inc-item" data-id="${esc(product.id)}"${variantAttr} aria-label="${mass ? "Add 100 g" : "Increase quantity"}" ${atMax || locked ? "disabled" : ""}>${icon("i-plus")}</button>
          </span>
        </div>
      </div>`;
    }).join("");

    const discount = totals.discount;
    const discountCopy = discount
      ? { strong: discount.type === "percent" ? `${discount.value}% discount` : `${money(discount.value)} discount`, small: "Applied to this sale" }
      : { strong: "Add discount", small: "Percentage or fixed amount" };

    return `<section class="screen flow-screen" aria-labelledby="cart-title">
      ${locked ? subscriptionLockPanel() : ""}
      <div class="section-head" style="margin-top:2px"><h2 id="cart-title">${count} ${count === 1 ? "item" : "items"}</h2><span class="small muted">Sales tax ${esc(T.state.store.taxRate)}%</span></div>
      <div class="cart-list">${items}</div>
      <button class="add-more" data-nav="#/sell">${icon("i-plus")} Add more items</button>
      <div class="discount-row">
        <span class="discount-icon">${icon("i-tag")}</span>
        <button class="discount-copy" data-act="open-discount" ${locked ? "disabled" : ""}>
          <strong>${esc(discountCopy.strong)}</strong><small>${esc(discountCopy.small)}</small>
        </button>
        ${discount ? `<span class="discount-value">−${money(totals.discountAmount)}</span><button class="remove-discount" data-act="remove-discount" aria-label="Remove discount" ${locked ? "disabled" : ""}>${icon("i-close")}</button>` : `<button class="remove-discount" data-act="open-discount" aria-label="Add discount" ${locked ? "disabled" : ""}>${icon("i-chevron")}</button>`}
      </div>
      <div class="totals-card">
        <div class="total-line"><span class="label">Subtotal</span><span class="value">${money(totals.subtotal)}</span></div>
        ${totals.discountAmount ? `<div class="total-line"><span class="label">Discount</span><span class="value discount">−${money(totals.discountAmount)}</span></div>` : ""}
        <div class="total-line"><span class="label">Tax (${esc(T.state.store.taxRate)}%)</span><span class="value">${money(totals.tax)}</span></div>
        ${totals.cost ? `<div class="total-line"><span class="label">Buying cost</span><span class="value">${money(totals.cost)}</span></div>` : ""}
        <div class="total-divider"></div>
        <div class="grand-line"><span class="label">Total</span><span class="value">${money(totals.total)}</span></div>
        ${totals.cost ? `<div class="total-line total-profit"><span class="label">Profit on this sale</span><span class="value">${money(totals.profit)} · ${Math.round(totals.margin * 100)}%</span></div>` : ""}
      </div>
      <div class="flow-footer">
        <button class="btn btn-primary btn-block" data-act="checkout" ${locked ? "disabled" : ""}>SELL ITEMS</button>
        <button class="btn btn-debt btn-block${debtAllowed ? "" : " is-blocked"}" data-act="add-to-debt" ${locked || !count ? "disabled" : ""} aria-disabled="${debtAllowed ? "false" : "true"}">${icon("i-user")} ADD TO DEBT</button>
        <p class="footer-hint">${locked ? "Pay the monthly plan to complete this sale. The cart is kept safe." : debtAllowed ? "Tax and discounts are included in this total." : "No debt allowed — every sale must be paid now."}</p>
      </div>
    </section>`;
  }

  /* ---------- Payment ---------- */

  function quickCashValues(total) {
    // Cash is counted in whole shillings. Round the total up so the "Exact"
    // chip can never leave the till a few cents short.
    const exact = Math.max(0, Math.ceil(total / 100) * 100);
    const values = [exact];
    for (const step of [1000, 5000, 10000, 20000, 50000, 100000]) {
      const next = Math.ceil(exact / step) * step;
      if (next > exact) values.push(next);
      if (values.length >= 4) break;
    }
    return [...new Set(values)].slice(0, 4);
  }

  function payment() {
    if (T.subscriptionLocked()) {
      return `<section class="screen sell">${subscriptionLockPanel()}</section>`;
    }
    const totals = T.cartTotals();
    const allows = (m) => (T.paymentAllows ? T.paymentAllows(m) : true);
    // Which tender methods the till is allowed to take. When a method is not
    // allowed it renders grayed out and tapping it explains why.
    const tenders = [
      { method: "cash", label: "Cash", iconName: "i-cash" },
      { method: "mpesa", label: "M-Pesa", iconName: "i-phone" },
      { method: "card", label: "Card", iconName: "i-card" }
    ];
    let method = T.ui.payment === "card" ? "card" : T.ui.payment === "mpesa" ? "mpesa" : "cash";
    if (!allows(method)) method = tenders.find((t) => allows(t.method))?.method || "cash";
    // The keypad stores whole shillings; amounts elsewhere are in cents.
    const cash = Math.round((Number(T.ui.cash) || 0) * 100);
    const tendered = method === "cash" ? cash : 0;
    const change = tendered - totals.total;
    const canPay = method === "cash" && tendered >= totals.total && totals.total > 0;

    const quick = quickCashValues(totals.total).map((value, index) => `
      <button class="chip ${index === 0 ? "exact" : ""}" data-act="cash-quick" data-value="${value}">${index === 0 ? (totals.total % 100 ? "Round up" : "Exact") : money(value)}</button>`).join("");

    const cashBoard = method === "cash" ? `
      <div class="cash-board">
        <div class="cash-display">
          <div class="cash-cell"><div class="cash-label">Cash received</div><div class="cash-amount ${cash ? "" : "placeholder"} money">${cash ? money(cash) : "—"}</div></div>
          <div class="cash-cell"><div class="cash-label">${change >= 0 && cash ? "Change due" : "Remaining"}</div>
            <div class="cash-amount money ${change >= 0 && cash ? "change" : cash ? "short" : "placeholder"}">${cash ? money(Math.abs(change)) : "—"}</div>
          </div>
        </div>
        <div class="quick-cash" aria-label="Quick cash amounts">${quick}</div>
        <div class="keypad" aria-label="Cash keypad">
          ${[1,2,3,4,5,6,7,8,9].map((n) => `<button class="key" data-act="cash-key" data-key="${n}">${n}</button>`).join("")}
          <button class="key util" data-act="cash-key" data-key="00">00</button>
          <button class="key" data-act="cash-key" data-key="0">0</button>
          <button class="key util" data-act="cash-key" data-key="del" aria-label="Backspace">${icon("i-backspace")}</button>
        </div>
      </div>
      <div class="pay-note">${icon("i-lock")}<span>Cash payments are recorded locally. No cash drawer or card terminal is connected in this demo.</span></div>` : "";

    const cardBoard = method === "card" ? `
      <div class="card-board">
        <span class="demo-pill">${icon("i-info", "ico")} Demo payment</span>
        <div class="card-illustration">${icon("i-card")}</div>
        <h3>${T.ui.cardBusy ? "Waiting for the reader…" : "Use the demo card reader"}</h3>
        <p>${T.ui.cardBusy ? "This usually takes a moment. Keep this screen open." : "Simulates an approved card payment. No card details are collected and no money is charged."}</p>
        <button class="btn btn-primary btn-block" data-act="start-card" ${T.ui.cardBusy ? "disabled" : ""}>
          ${T.ui.cardBusy ? `<span class="spinner"></span> Processing` : `Start demo payment ${icon("i-arrow")}`}
        </button>
      </div>
      <div class="pay-note">${icon("i-info")}<span>This is a product demo. To charge real cards, connect a payment provider in production.</span></div>` : "";

    const mpesaBoard = method === "mpesa" ? mpesaPaymentBoard(totals) : "";

    return `<section class="screen flow-screen payment-screen" aria-labelledby="payment-title">
      <div class="pay-amount">
        <p class="eyebrow">Amount due</p>
        <div class="amount money" id="payment-title">${money(totals.total)}</div>
        <p class="breakdown">Subtotal ${money(totals.subtotal)}${totals.discountAmount ? ` · Discount −${money(totals.discountAmount)}` : ""} · Tax ${money(totals.tax)}</p>
      </div>
      <div class="segmented seg-three" role="tablist" aria-label="Payment method">
        ${tenders.map((t) => {
          const allowed = allows(t.method);
          const active = method === t.method;
          return `<button class="seg-btn ${active ? "is-active" : ""}${allowed ? "" : " is-blocked"}" data-act="set-payment" data-value="${t.method}" role="tab" aria-selected="${active}" aria-disabled="${!allowed}">${icon(t.iconName)} ${t.label}</button>`;
        }).join("")}
      </div>
      ${cashBoard}
      ${mpesaBoard}
      ${cardBoard}
      ${method === "cash" ? `<div class="flow-footer">
        <button class="btn btn-primary btn-block" id="cash-complete" data-act="complete-cash" ${canPay ? "" : "disabled"}>Complete cash sale ${canPay ? icon("i-check") : ""}</button>
        <p class="footer-hint" id="pay-hint">${cash ? (canPay ? `Change due ${money(change)}` : `Add ${money(totals.total - cash)} more to complete`) : "Enter the cash received, or tap Exact."}</p>
      </div>` : ""}
    </section>`;
  }

  /** The M-Pesa half of the checkout screen: phone, waiting and error states. */
  function mpesaPaymentBoard(totals) {
    const cfg = T.mpesaConfig();
    const state = T.ui.mpesa;
    const api = window.Till?.mpesa;
    const ready = api ? api.readiness(cfg) : { ok: false, message: "M-Pesa is not available on this device." };
    const amount = Math.max(1, Math.ceil(totals.total / 100));
    const whole = totals.total % 100 === 0;
    const busy = state.stage === "sending" || state.stage === "waiting";
    const phone = state.phone || "";
    const check = api ? api.normalizePhone(phone) : { ok: false };
    const target = cfg.mode === "till" ? `Till ${cfg.shortcode}` : `Paybill ${cfg.shortcode}`;
    // Paybill payments carry an account number. Start from the saved default,
    // then fall back to the receipt number so the field is never empty.
    const account = String(state.account || cfg.account || `POS-${T.state.nextReceipt || ""}`).slice(0, 12);
    const accountReady = cfg.mode !== "paybill" || account.trim().length > 0;

    if (!cfg.shortcode) {
      return `<div class="mpesa-board is-empty">
        <span class="mpesa-brand"><span class="mpesa-word">M-PESA</span></span>
        <h3>Receive payments on M-Pesa</h3>
        <p>Add your Safaricom Paybill or Till number in Store &amp; receipts. Customers will then get a PIN prompt on their phone and the money goes straight to your account.</p>
        <button class="btn btn-primary btn-block" data-nav="#/store">${icon("i-store")} Add Paybill or Till</button>
      </div>`;
    }

    if (busy) {
      const sending = state.stage === "sending";
      return `<div class="mpesa-board is-waiting" aria-live="polite">
        <span class="mpesa-brand"><span class="mpesa-word">M-PESA</span><span class="mpesa-target">${esc(target)}</span></span>
        <div class="mpesa-wait-mark"><span class="spinner"></span></div>
        <h3>${sending ? "Sending the request…" : "Waiting for the customer"}</h3>
        <p>${sending ? "Talking to Safaricom." : `An M-Pesa prompt was sent to <strong>${esc(api.formatPhone(state.phone))}</strong>. Ask the customer to enter their M-Pesa PIN.`}</p>
        <div class="mpesa-amount-line"><span>Amount</span><strong class="money">${money(amount * 100)}</strong></div>
        ${cfg.mode === "paybill" ? `<div class="mpesa-amount-line"><span>Account</span><strong>${esc(account)}</strong></div>` : ""}
        <p class="mpesa-small">Keep this screen open. It can take up to a minute.</p>
        <button class="btn btn-ghost btn-block" data-act="mpesa-cancel">Cancel request</button>
      </div>`;
    }

    const note = state.stage === "failed" || state.stage === "timeout"
      ? `<div class="mpesa-alert" role="alert">${icon("i-alert", "ico ico-sm")}<span>${esc(state.error || "The payment was not completed. You can try again.")}</span></div>`
      : "";
    const blocker = ready.ok
      ? ""
      : `<div class="mpesa-alert is-setup">${icon("i-info", "ico ico-sm")}<span>${esc(ready.message)}</span></div>
         ${ready.reason === "browser" ? `<button class="btn btn-ghost btn-block" data-nav="#/store">Open settings</button>` : `<button class="btn btn-ghost btn-block" data-nav="#/store">Open store settings</button>`}`;

    return `<div class="mpesa-board">
      <span class="mpesa-brand"><span class="mpesa-word">M-PESA</span><span class="mpesa-target">${esc(target)}</span></span>
      <div class="field mpesa-phone-field">
        <label for="mpesa-phone">Customer's M-Pesa number</label>
        <input class="input" id="mpesa-phone" name="mpesaPhone" type="tel" inputmode="tel" autocomplete="tel"
               placeholder="0712 345 678" value="${esc(phone)}" ${busy ? "disabled" : ""}>
        <p class="field-small">${check.ok ? "This number will get the PIN prompt." : "Enter the Safaricom number that will pay."}</p>
      </div>
      ${cfg.mode === "paybill" ? `<div class="field mpesa-account-field">
        <label for="mpesa-account">Account number</label>
        <input class="input" id="mpesa-account" name="mpesaAccount" autocomplete="off" maxlength="12"
               placeholder="e.g. 0100 or invoice number" value="${esc(account)}" ${busy ? "disabled" : ""}>
        <p class="field-small">${accountReady ? "This is what appears on your M-Pesa statement." : "Enter the account number customers pay with."}</p>
      </div>` : ""}
      <div class="mpesa-amount-line"><span>They pay</span><strong class="money">${money(amount * 100)}</strong></div>
      ${whole ? "" : `<p class="mpesa-small">Rounded from ${money(totals.total)} — M-Pesa charges whole shillings.</p>`}
      ${note}
      ${blocker}
      <button class="btn btn-primary btn-block" data-act="mpesa-send" ${ready.ok && accountReady ? "" : "disabled"}>
        ${icon("i-phone")} Send M-Pesa request
      </button>
      <p class="mpesa-small">The customer gets a prompt to enter their M-Pesa PIN. Money is paid to your ${esc(cfg.mode === "till" ? "Till" : "Paybill")} ${esc(cfg.shortcode)}${cfg.mode === "paybill" ? `, account <strong>${esc(account)}</strong>` : ""}.</p>
    </div>`;
  }

  /* ---------- Receipt ---------- */

  function receiptText(tx) {
    const store = tx.store || T.state.store;
    const lines = tx.items.map((item) => `${T.qtyText(item)} × ${item.name}${item.detail ? ` (${item.detail})` : ""}  ${money(T.itemRevenue(item))}`);
    const discount = tx.discountAmount ? `Discount: -${money(tx.discountAmount)}` : null;
    const payment = tx.payment.method === "cash"
      ? `Cash tendered: ${money(tx.payment.tendered)}  Change: ${money(tx.payment.change)}`
      : tx.payment.method === "card"
        ? `Card: demo approved (${tx.payment.reference})`
        : tx.payment.method === "mpesa"
          ? `M-Pesa: ${money(tx.total)}${tx.payment.customerPhone ? ` from ${T.mpesa?.formatPhone(tx.payment.customerPhone) || tx.payment.customerPhone}` : ""}${tx.payment.accountRef ? ` · Account ${tx.payment.accountRef}` : ""}${tx.payment.reference ? ` · Ref ${tx.payment.reference}` : ""}${!tx.payment.reference && tx.payment.checkoutId ? ` · Request ${tx.payment.checkoutId}` : ""}`
          : `Debt: ${tx.payment.customerName || "Customer"} (${tx.payment.customerPhone || ""}) · Due ${tx.payment.dueDate}`;
    // Only the shopkeeper stamped on the transaction is shown. Sales made
    // before staff tracking print no name rather than crediting whoever
    // happens to hold the shop's staff field today.
    const servedBy = String(tx.staff || "").trim();
    return [
      store.name.toUpperCase(),
      store.address,
      store.phone,
      "",
      `Receipt #${tx.receiptNo}`,
      `${T.receiptDateFmt.format(new Date(tx.createdAt))} · ${T.timeFmt.format(new Date(tx.createdAt))}`,
      servedBy ? `Served by ${servedBy}` : null,
      "",
      ...lines,
      "",
      `Subtotal: ${money(tx.subtotal)}`,
      ...(discount ? [discount] : []),
      `Tax (${tx.taxRate}%): ${money(tx.tax)}`,
      tx.rounding ? `M-Pesa rounding: ${tx.rounding > 0 ? "+" : "−"}${money(Math.abs(tx.rounding))}` : null,
      `TOTAL: ${money(tx.total)}`,
      "",
      payment,
      "",
      store.footer,
      `Digital receipt · ${tx.id.slice(-8).toUpperCase()}`
    ].filter((line) => line !== null).join("\n");
  }

  /** Styles copied onto the image, so the PNG matches the receipt on screen. */
  const IMAGE_PROPS = [
    "background", "background-color", "background-image", "border", "border-top", "border-right",
    "border-bottom", "border-left", "border-radius", "box-shadow", "color", "display", "flex",
    "flex-direction", "flex-wrap", "align-items", "align-self", "justify-content", "gap",
    "font-family", "font-size", "font-weight", "font-style", "font-variant-numeric",
    "letter-spacing", "line-height", "margin", "margin-top", "margin-right", "margin-bottom",
    "margin-left", "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "text-align", "text-transform", "white-space",
    "box-sizing", "opacity", "overflow"
  ];

  function inlineStyles(source) {
    const copy = source.cloneNode(true);
    const from = [source, ...source.querySelectorAll("*")];
    const to = [copy, ...copy.querySelectorAll("*")];
    from.forEach((el, index) => {
      const target = to[index];
      if (!target) return;
      const computed = getComputedStyle(el);
      const style = IMAGE_PROPS.map((prop) => `${prop}:${computed.getPropertyValue(prop)}`).join(";");
      // Hairline rules (the dashed dividers) are 1px tall boxes; text blocks
      // keep their natural height so a wrapped line never spills.
      const height = parseFloat(computed.height);
      target.setAttribute("style", height > 0 && height <= 2 ? `${style};height:${height}px` : style);
      target.removeAttribute("id");
    });
    return copy;
  }

  /**
   * Render the receipt paper — the same markup the screen shows — into a PNG
   * data URL. The node is cloned with its computed styles and drawn through an
   * SVG foreignObject, so the download keeps the on-screen design.
   */
  async function receiptImage(tx) {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-10000px;top:0;width:420px;background:#ffffff;pointer-events:none";
    host.innerHTML = receiptPaper(tx);
    document.body.appendChild(host);
    const paper = host.querySelector(".receipt-paper");
    let copy = null;
    let size = { width: 420, height: 600 };
    try {
      // Sprite icons live in the page, not the standalone image: the mark
      // keeps the shop's initial instead.
      const mark = paper.querySelector(".receipt-mark");
      if (mark) {
        const name = String((tx.store || T.state.store).name || "B").trim();
        mark.textContent = name.charAt(0).toUpperCase() || "B";
        mark.style.cssText = "font:800 13px system-ui, sans-serif; color:#c6f24a";
      }
      const rect = paper.getBoundingClientRect();
      // A few spare pixels at the bottom: the cloned markup re-flows by a hair
      // once it is serialised, and the last line should never be clipped.
      size = { width: Math.ceil(rect.width) || 420, height: (Math.ceil(rect.height) || 600) + 12 };
      // The receipt number and the date sit on one line on screen; keep them
      // there in the image instead of letting the date break after "3:56".
      paper.querySelectorAll(".receipt-meta span").forEach((span) => { span.style.whiteSpace = "nowrap"; });
      copy = inlineStyles(paper);
      // Only the paper itself gets a fixed width; inner blocks size from it,
      // so a phone whose font runs wider wraps where the screen wraps.
      copy.style.width = `${size.width}px`;
    } finally {
      host.remove();
    }
    copy.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    const scale = 2;
    // A white margin around the card, so the rounded corners and the border
    // read the same way they do on screen.
    const pad = 16;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width + pad * 2}" height="${size.height + pad * 2}">`
      + `<foreignObject x="${pad}" y="${pad}" width="${size.width}" height="${size.height}">${new XMLSerializer().serializeToString(copy)}</foreignObject></svg>`;
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("The receipt image did not render"));
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
    const canvas = document.createElement("canvas");
    canvas.width = (size.width + pad * 2) * scale;
    canvas.height = (size.height + pad * 2) * scale;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(image, 0, 0);
    return canvas.toDataURL("image/png");
  }

  /**
   * The receipt as it appears on screen. Both the receipt screen and the
   * downloaded PNG use this same markup, so the file keeps the design.
   */
  function receiptPaper(tx) {
    const store = tx.store || T.state.store;
    return `<article class="receipt-paper" id="receipt-paper">
        <div class="receipt-brand">
          <div class="receipt-mark">${icon("i-store")}</div>
          <h3>${esc(store.name)}</h3>
          <p>${esc(store.address)}<br>${esc(store.phone)}</p>
        </div>
        <div class="receipt-meta"><span>Receipt #${tx.receiptNo}</span><span>${esc(T.receiptDateFmt.format(new Date(tx.createdAt)))} · ${T.timeFmt.format(new Date(tx.createdAt))}</span></div>
        <div class="dashes"></div>
        <div class="receipt-lines">
          ${tx.items.map((item) => `<div class="receipt-line">
            <span class="qty">${esc(T.qtyText(item))}</span>
            <span class="name">${esc(item.name)}${item.detail ? `<span class="unit">${esc(item.detail)} · ${money(item.price)}${item.soldByMass ? "/kg" : " each"}</span>` : ""}</span>
            <span class="amount">${money(T.itemRevenue(item))}</span>
          </div>`).join("")}
        </div>
        <div class="dashes"></div>
        <div class="receipt-totals">
          <div class="r-line"><span>Subtotal</span><span class="val">${money(tx.subtotal)}</span></div>
          ${tx.discountAmount ? `<div class="r-line"><span>Discount${tx.discount?.type === "percent" ? ` (${tx.discount.value}%)` : ""}</span><span class="val">−${money(tx.discountAmount)}</span></div>` : ""}
          <div class="r-line"><span>Tax (${tx.taxRate}%)</span><span class="val">${money(tx.tax)}</span></div>
          ${tx.rounding ? `<div class="r-line"><span>M-Pesa rounding</span><span class="val">${tx.rounding > 0 ? "+" : "−"}${money(Math.abs(tx.rounding))}</span></div>` : ""}
          <div class="r-line total"><span>Total</span><span class="val">${money(tx.total)}</span></div>
        </div>
        <div class="receipt-payment">
          <div class="row"><span>Payment</span><strong>${tx.payment.method === "cash" ? "Cash" : tx.payment.method === "card" ? "Card · demo" : tx.payment.method === "mpesa" ? "M-Pesa" : `Debt · ${esc(tx.payment.customerName || "Customer")}`}</strong></div>
          ${tx.payment.method === "cash" ? `<div class="row"><span>Tendered</span><span>${money(tx.payment.tendered)}</span></div><div class="row"><span>Change</span><span>${money(tx.payment.change)}</span></div>` : tx.payment.method === "card" ? `<div class="row"><span>Reference</span><span>${esc(tx.payment.reference || "—")}</span></div>` : tx.payment.method === "mpesa" ? `<div class="row"><span>Customer phone</span><span>${esc(T.mpesa?.formatPhone(tx.payment.customerPhone) || tx.payment.customerPhone || "—")}</span></div>${tx.payment.accountRef ? `<div class="row"><span>Account number</span><span>${esc(tx.payment.accountRef)}</span></div>` : ""}<div class="row"><span>M-Pesa reference</span><span>${esc(tx.payment.reference || "Confirmed")}</span></div>${!tx.payment.reference && tx.payment.checkoutId ? `<div class="row"><span>Request ID</span><span>${esc(tx.payment.checkoutId)}</span></div>` : ""}${tx.payment.account ? `<div class="row"><span>Paid to</span><span>${esc(tx.payment.account)}</span></div>` : ""}` : `<div class="row"><span>Customer phone</span><span>${esc(tx.payment.customerPhone || "—")}</span></div><div class="row"><span>Due date</span><span>${esc(tx.payment.dueDate || "—")}</span></div>`}
          <div class="row"><span>Served by</span><span>${esc(String(tx.staff || "").trim() || "—")}</span></div>
          ${tx.payment.method === "mpesa" && !tx.payment.reference ? `<button class="text-btn mpesa-code-link" data-act="add-mpesa-code" data-id="${esc(tx.id)}">Add M-Pesa code</button>` : ""}
        </div>
        <div class="receipt-bar" aria-hidden="true"></div>
        <div class="receipt-code">${esc(tx.id.slice(-8).toUpperCase())}</div>
        <p class="receipt-thanks">${esc(store.footer)}<br>Digital receipt · keep for your records</p>
      </article>`;
  }

  function receipt(tx, justPaid) {
    return `<section class="screen receipt-screen" aria-labelledby="receipt-title">
      ${justPaid ? `<div class="success-hero">
        <div class="success-check">${icon("i-check")}</div>
        <h2 id="receipt-title">${tx.payment.method === "debt" ? "Added to debt" : "Payment complete"}</h2>
        <div class="paid-total money">${money(tx.total)}</div>
        <div class="paid-meta">${tx.payment.method === "cash" ? `Cash · Change ${money(tx.payment.change)}` : tx.payment.method === "card" ? "Card · Demo approved" : tx.payment.method === "mpesa" ? `M-Pesa${tx.payment.customerPhone ? ` · ${esc(T.mpesa?.formatPhone(tx.payment.customerPhone) || tx.payment.customerPhone)}` : ""}` : `On credit · ${esc(tx.payment.customerName || "Customer")} · Due ${esc(tx.payment.dueDate || "")}`} · ${T.timeFmt.format(new Date(tx.createdAt))}</div>
      </div>` : `<div class="history-hero">
        <div><p class="eyebrow" style="margin-bottom:5px">Receipt #${tx.receiptNo}</p><div class="paid-total" id="receipt-title">${money(tx.total)}</div></div>
        <span class="status-pill ${tx.payment.method === "debt" ? "is-debt" : ""}"><span class="dot"></span>${tx.payment.method === "debt" ? "On credit" : "Paid"}</span>
      </div>`}
      ${receiptPaper(tx)}
      <div class="receipt-actions">
        <button class="btn btn-ghost" data-act="share-receipt" data-id="${esc(tx.id)}">${icon("i-share")} Share</button>
        <button class="btn btn-primary" data-act="download-receipt" data-id="${esc(tx.id)}">${icon("i-download")} Download</button>
        ${justPaid ? "" : `<button class="btn btn-ghost delete-product" data-act="delete-order" data-id="${esc(tx.id)}">${icon("i-trash")} Delete</button>`}
      </div>
      <div class="receipt-primary">
        <button class="btn btn-primary btn-block" data-act="new-sale">${icon("i-plus")} New sale</button>
      </div>
    </section>`;
  }

  /* ---------- Scanner ---------- */

  function scan() {
    const editor = T.ui.scanPurpose === "editor";
    return `<section class="scan-screen" aria-label="Barcode scanner">
      <div class="scan-top">
        <button class="icon-btn" data-act="close-scan" aria-label="Close scanner">${icon("i-close")}</button>
        <div class="scan-title">${editor ? "Scan product barcode" : "Scan barcode"}</div>
        <button class="icon-btn" id="torchBtn" data-act="toggle-torch" aria-label="Turn flashlight on" aria-pressed="false" hidden>${icon("i-flash")}</button>
      </div>
      <div class="scan-stage">
        <video id="scan-video" playsinline muted autoplay aria-label="Camera preview"></video>
        <div class="scan-shade"></div>
        <div class="scan-reticle" aria-hidden="true"><span class="corner"></span><span class="scan-line"></span></div>
        <div class="scan-hint" id="scan-hint"><strong>Align the barcode inside the frame</strong>EAN, UPC, Code 128 and QR are supported</div>
        <div class="scan-overlay" id="scan-overlay">
          <div class="scan-overlay-inner" id="scan-overlay-content">
            <div class="scan-start" aria-hidden="true"></div>
            <h2>Starting camera</h2>
            <p>If your browser asks, allow camera access for Biller.</p>
          </div>
        </div>
      </div>
      <div class="scan-bottom">
        <div class="scan-formats"><span>EAN-13</span><span>EAN-8</span><span>UPC-A</span><span>UPC-E</span><span>Code 128</span><span>QR</span></div>
        <button class="manual-btn" data-act="manual-entry">${icon("i-pencil")} Enter a barcode manually</button>
      </div>
    </section>`;
  }

  T.screens = { appbar, tabbar, dock, sell, sellResults, orders, ordersList, reports, audit, suppliers, supplierResults, supplierDetail, debt, debtResults, customerDebt, stock, inventoryRows, stockFilterRow, more, storeSettings, mpesaSettings, accountSettings, categorySection, plans, auth, cart, payment, receipt, receiptText, receiptImage, scan, productTile, stockNote, qtyInCart, lockedScreen, pinLocked, icon };
})();
