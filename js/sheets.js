/* ============================================================
   Till — sheets and dialogs
   ============================================================ */
(() => {
  "use strict";
  const T = window.Till;
  if (!T) throw new Error("Till core must load before sheets.");
  const { esc, money } = T;
  const icon = (name) => `<svg class="ico" aria-hidden="true"><use href="#${name}"></use></svg>`;

  // Quick-pick sizes and units for the product editor. Shopkeepers can still
  // type anything else; these just cover the everyday cases.
  const COMMON_VARIANTS = [
    "Small", "Medium", "Large",
    "250 ml", "500 ml", "1 L", "1.5 L",
    "500 g", "1 kg", "Pack", "Piece", "Dozen"
  ];

  // How stock is counted. The short code is stored with the product and shown
  // next to the stock number on the Sell cards.
  const STOCK_UNITS = [
    ["pcs", "Pieces"],
    ["each", "Each"],
    ["dozen", "Dozen"],
    ["packet", "Packet"],
    ["box", "Box"],
    ["crate", "Crate"],
    ["bottle", "Bottle"],
    ["sachet", "Sachet"],
    ["kg", "Kg"],
    ["g", "g"],
    ["L", "L"],
    ["ml", "ml"]
  ];

  let closeTimer = null;
  let closeToken = 0;
  let active = false;
  let onCloseCallback = null;
  let lastFocus = null;
  let dialogEl = null;
  let confirmCallback = null;

  function layers() {
    return document.getElementById("layers");
  }

  function isOpen() {
    return active;
  }

  function open({ title, subtitle = "", iconName = "", tone = "", body = "", focus = "", onClose = null, head = true, size = "default" }) {
    const root = layers();
    if (!root) return;
    close(true);
    lastFocus = document.activeElement;
    active = true;
    onCloseCallback = onClose;
    const sizeClass = size === "compact" ? "sheet-compact" : "";
    root.innerHTML = `
      <div class="scrim" data-act="close-sheet"></div>
      <section class="sheet ${sizeClass}" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1">
        <div class="sheet-grabber" aria-hidden="true"></div>
        ${head ? `<div class="sheet-head">
          <div>
            <h2 id="sheet-title">${esc(title)}</h2>
            ${subtitle ? `<p>${esc(subtitle)}</p>` : ""}
          </div>
          <button class="sheet-close" data-act="close-sheet" aria-label="Close">${icon("i-close")}</button>
        </div>` : ""}
        <div class="sheet-body">${body}</div>
      </section>`;
    root.classList.add("is-open");
    dialogEl = root.querySelector(".sheet");
    // A sheet can open outside a render pass, so wire its buttons here.
    window.TillActions?.wireActions?.(root);
    requestAnimationFrame(() => {
      root.classList.add("is-open");
      const target = (focus && root.querySelector(focus)) || dialogEl;
      target?.focus({ preventScroll: true });
    });
  }

  function close(immediate = false) {
    const root = layers();
    if (!root) return;
    if (!active && !root.innerHTML) return;
    active = false;
    const callback = onCloseCallback;
    onCloseCallback = null;
    // Any camera window that belongs to this sheet goes with it.
    T.scanner?.stopBar?.();
    root.classList.remove("is-open");
    document.getElementById("app")?.classList.remove("sheet-open");
    if (callback) {
      try { callback(); } catch (error) { console.warn(error); }
    }
    if (immediate) {
      closeToken += 1;
      root.innerHTML = "";
      dialogEl = null;
    } else {
      const token = ++closeToken;
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        if (token === closeToken && !active) {
          root.innerHTML = "";
          dialogEl = null;
        }
      }, 320);
    }
    if (lastFocus?.isConnected) {
      try { lastFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
    lastFocus = null;
  }

  function setFormError(form, message) {
    const box = form.querySelector(".form-error");
    if (!box) return;
    box.textContent = message;
    box.classList.toggle("show", Boolean(message));
  }

  /* ---------- Manual barcode entry ---------- */

  function openManual({ onClose = null } = {}) {
    open({
      title: "Enter a barcode",
      subtitle: "Type the number printed under the barcode.",
      iconName: "i-barcode",
      focus: "#manual-code",
      onClose,
      body: `<form class="manual-form" id="manual-form" novalidate>
        <input class="input" id="manual-code" name="code" inputmode="text" autocomplete="off" autocapitalize="characters"
          spellcheck="false" placeholder="e.g. 6001234567890" aria-label="Barcode">
        <div class="form-error" role="alert"></div>
        <button class="btn btn-primary btn-block" type="submit">Look up barcode ${icon("i-arrow")}</button>
      </form>
      <p class="manual-hint">The number printed under the barcode. It has to match a product in your stock.</p>`
    });

    const form = document.getElementById("manual-form");

        form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const code = String(new FormData(form).get("code") || "").trim();
      if (!code) {
        manualError("Enter the barcode number.");
        return;
      }
      manualError("");
      T.app?.handleBarcode?.(code, { source: "manual" });
      close(true);
    });
  }

  function manualError(message) {
    const form = document.getElementById("manual-form");
    if (form) setFormError(form, message);
  }

  /* ---------- Unknown barcode ---------- */

  function openUnknown(code, { onClose = null } = {}) {
    open({
      title: "No product found",
      subtitle: "This barcode isn’t in your catalog yet.",
      iconName: "i-barcode",
      tone: "warn",
      onClose,
      body: `<div class="code-pill">${icon("i-barcode")}${esc(code)}</div>
        <p style="margin-top:14px">Add it once and you can scan it every time. The barcode will be filled in for you.</p>
        <div class="sheet-actions">
          <button class="btn btn-primary" data-act="add-unknown" data-code="${esc(code)}">Add as new product ${icon("i-arrow")}</button>
          <button class="btn btn-ghost" data-act="scan-again">Scan again</button>
        </div>`
    });
  }

  /* ---------- Out of stock ---------- */

  function openOutOfStock(product, { fromScan = false, onClose = null } = {}) {
    open({
      title: `${product.name} is out of stock`,
      subtitle: "It can’t be added to a sale until you restock it.",
      iconName: "i-box",
      tone: "danger",
      onClose,
      body: `<div class="product-preview">
          ${T.screens.productTile(product)}
          <div><div class="name">${esc(product.name)}</div><div class="meta">${esc(product.barcode)} · ${money(product.price)} · 0 in stock</div></div>
        </div>
        <p>Update the stock count in Inventory, then come back to the sale.</p>
        <div class="sheet-actions">
          <button class="btn btn-primary" data-act="restock-product" data-id="${esc(product.id)}">Restock product ${icon("i-arrow")}</button>
          <button class="btn btn-ghost" data-act="${fromScan ? "scan-again" : "close-sheet"}">${fromScan ? "Scan another item" : "Close"}</button>
        </div>`
    });
  }

  /* ---------- Discount ---------- */

  function openDiscount() {
    const current = T.state.cart.discount;
    T.ui.discountMode = current?.type === "amount" ? "amount" : "percent";
    const activeMode = T.ui.discountMode;
    open({
      title: "Add a discount",
      subtitle: "Discounts apply to the whole sale before tax.",
      iconName: "i-tag",
      body: `<div class="discount-grid" aria-label="Quick discounts">
          ${[5, 10, 15, 20].map((value) => `<button class="discount-opt ${current?.type === "percent" && current.value === value ? "is-active" : ""}" data-act="apply-discount" data-type="percent" data-value="${value}">${value}%</button>`).join("")}
        </div>
        <div class="custom-discount">
          <div class="segmented" role="tablist" aria-label="Discount type">
            <button class="seg-btn ${activeMode === "percent" ? "is-active" : ""}" data-act="set-discount-mode" data-value="percent" role="tab" aria-selected="${activeMode === "percent"}">Percent</button>
            <button class="seg-btn ${activeMode === "amount" ? "is-active" : ""}" data-act="set-discount-mode" data-value="amount" role="tab" aria-selected="${activeMode === "amount"}">Fixed amount</button>
          </div>
          <form id="discount-form" novalidate>
            <div class="input-affix">
              <input class="input" id="discount-input" name="value" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" aria-label="Custom discount value">
              <span class="affix" id="discount-affix">${activeMode === "percent" ? "%" : T.currencySymbol()}</span>
            </div>
            <div class="form-error" role="alert"></div>
            <button class="btn btn-primary btn-block discount-apply" type="submit">Apply custom discount</button>
          </form>
        </div>
        ${current ? `<div class="sheet-actions"><button class="btn btn-danger" data-act="remove-discount">Remove current discount</button></div>` : ""}`
    });

    const form = document.getElementById("discount-form");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const raw = String(new FormData(form).get("value") || "").trim();
      const amount = Number(raw);
      if (!raw || !Number.isFinite(amount) || amount <= 0) {
        discountError("Enter a discount greater than zero.");
        return;
      }
      const type = T.ui.discountMode;
      if (type === "percent" && amount > 100) {
        discountError("A percentage discount cannot be more than 100.");
        return;
      }
      discountError("");
      T.state.cart.discount = { type, value: amount };
      T.save();
      close(true);
      T.toast(`${type === "percent" ? amount + "%" : T.money(amount)} discount applied`, "i-tag");
      window.render?.();
    });
  }

  function setDiscountMode(mode) {
    T.ui.discountMode = mode === "amount" ? "amount" : "percent";
    document.querySelectorAll("[data-act='set-discount-mode']").forEach((button) => {
      const isActive = button.dataset.value === T.ui.discountMode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    });
    const affix = document.getElementById("discount-affix");
    if (affix) affix.textContent = T.ui.discountMode === "percent" ? "%" : T.currencySymbol();
    const input = document.getElementById("discount-input");
    if (input) {
      input.max = T.ui.discountMode === "percent" ? "100" : "";
      input.step = T.ui.discountMode === "percent" ? "1" : "0.01";
      input.focus({ preventScroll: true });
    }
  }

  function discountError(message) {
    const form = document.getElementById("discount-form");
    if (form) setFormError(form, message);
  }

  /* ---------- Variant picker (products with sizes/variants) ---------- */

  /**
   * Open a compact choice of a product's variants: tap the size/type you
   * want, and it drops into the cart. Out-of-stock variants are disabled.
   */
  /**
   * Variant picker — each row shows the variant with quick picks: single
   * pieces and whole packs (when a pack size is set). Tap a chip to add that
   * many to the sale, then Done.
   */
  function openVariantPicker(product, options = {}) {
    if (!product || !(product.variants || []).length) return;
    const onClose = typeof options.onClose === "function" ? options.onClose : null;
    const packSize = Math.max(0, Math.round(Number(product.packSize) || 0));
    const unit = T.stockCountUnit ? T.stockCountUnit(product) : (product.unit || "pcs");
    open({
      title: esc(product.name),
      subtitle: esc(product.detail || "Choose a variant and quantity"),
      iconName: "i-box",
      onClose,
      size: "compact",
      body: `<div class="variant-list">
        ${product.variants.map((variant) => {
          const out = variant.stock <= 0;
          const packButton = packSize > 0
            ? `<button class="variant-pick-chip is-pack" data-act="pick-variant-qty" data-id="${esc(product.id)}" data-variant="${esc(variant.id)}" data-packs="1" ${out ? "disabled" : ""}><span class="variant-pick-chip-top">1 pack</span><small>${packSize} pcs</small></button>`
            : `<button class="variant-pick-chip" data-act="pick-variant-qty" data-id="${esc(product.id)}" data-variant="${esc(variant.id)}" data-qty="12" ${out ? "disabled" : ""}><span class="variant-pick-chip-top">+ 12</span><small>pcs</small></button>`;
          return `<div class="variant-pick ${out ? "is-out" : ""}">
            <div class="variant-pick-head">
              <span class="variant-pick-tile tone-${T.toneFor(product.category)}" aria-hidden="true">${esc(T.initials(variant.label))}</span>
              <span class="variant-pick-copy">
                <strong>${esc(variant.label)}</strong>
                <small>${out ? "Sold out" : `${variant.stock} ${esc(unit)} in stock`} · ${money(variant.price)} each</small>
              </span>
              <span class="variant-pick-price">${money(variant.price)}</span>
            </div>
            <div class="variant-pick-grid">
              <button class="variant-pick-chip is-primary" data-act="pick-variant-qty" data-id="${esc(product.id)}" data-variant="${esc(variant.id)}" data-qty="1" ${out ? "disabled" : ""}><span class="variant-pick-chip-top">Add 1</span><small>pc</small></button>
              <button class="variant-pick-chip" data-act="pick-variant-qty" data-id="${esc(product.id)}" data-variant="${esc(variant.id)}" data-qty="2" ${out ? "disabled" : ""}><span class="variant-pick-chip-top">+ 2</span><small>pcs</small></button>
              <button class="variant-pick-chip" data-act="pick-variant-qty" data-id="${esc(product.id)}" data-variant="${esc(variant.id)}" data-qty="6" ${out ? "disabled" : ""}><span class="variant-pick-chip-top">+ 6</span><small>pcs</small></button>
              ${packButton}
            </div>
          </div>`;
        }).join("")}
      </div>
      <div class="sheet-actions" style="margin-top:8px">
        <button class="btn btn-quiet btn-block" data-act="close-sheet">Done</button>
      </div>`
    });
  }

  /* ---------- Product editor ---------- */

  function emptyEditorValues() {
    const categories = T.categories();
    return {
      name: "", detail: "", price: "", cost: "", stock: "10", lowStockAt: "5",
      barcode: "", category: categories[0] || "General", unit: "", unitSize: "",
      soldByMass: false, packSize: "", packMode: "piece", variants: [], soldBy: "each"
    };
  }

  function editorFromProduct(product) {
    // Bundle-sold stock is typed in bundles, not pieces — show the shopkeeper
    // the number of bundles they had on hand.
    const bundleMode = ["packet", "box", "dozen", "crate"].includes(String(product.soldBy)) && Number.isFinite(Number(product.packSize)) && Number(product.packSize) > 0;
    return {
      name: product.name,
      detail: product.detail,
      price: (product.price / 100).toFixed(2),
      cost: product.cost ? (product.cost / 100).toFixed(2) : "",
      // Weighed items keep stock in grams but the shop reads kilograms.
      // Bundle items divide pieces by the bundle size.
      stock: bundleMode ? String(Math.round((product.stock / Number(product.packSize)) * 1000) / 1000) : product.soldByMass ? (product.stock / 1000).toFixed(3).replace(/\.?0+$/, "") : String(product.stock),
      lowStockAt: String(product.lowStockAt),
      barcode: product.barcode,
      category: product.category,
      unit: product.unit || "pcs",
      unitSize: product.unitSize ? String(product.unitSize) : "",
      soldByMass: product.soldByMass === true,
      packSize: Number.isFinite(Number(product.packSize)) && product.packSize > 0 ? String(product.packSize) : "",
      packMode: product.packMode === "pack" ? "pack" : "piece",
      soldBy: ["each", "mass", "dozen", "packet", "box", "crate"].includes(String(product.soldBy)) ? String(product.soldBy) : (product.soldByMass === true ? "mass" : (Number(product.packSize) > 0 ? "packet" : "each")),
      variants: (product.variants || []).map((variant) => ({
        id: variant.id,
        label: variant.label,
        price: (variant.price / 100).toFixed(2),
        cost: variant.cost ? (variant.cost / 100).toFixed(2) : "",
        stock: String(variant.stock),
        barcode: variant.barcode || ""
      }))
    };
  }

  /** One editable variant row: label, price, cost, stock and barcode. */
  function renderVariantEditorRow(variant, index, category) {
    const initials = T.initials(variant.label || "New");
    return `<div class="variant-editor-row" data-index="${index}" data-variant-id="${esc(variant.id || "")}">
      <span class="variant-editor-tile tone-${T.toneFor(category)}" aria-hidden="true">${esc(initials)}</span>
      <div class="variant-editor-body">
        <div class="variant-editor-top">
          <input class="input variant-field variant-label" data-field="label" value="${esc(variant.label || "")}" placeholder="Label (e.g. 500 g)" autocomplete="off">
          <button type="button" class="icon-btn danger variant-remove" aria-label="Remove variant">${icon("i-trash")}</button>
        </div>
        <div class="variant-editor-grid">
          <input class="input variant-field variant-price" data-field="price" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(variant.price || "")}" placeholder="Price" aria-label="Variant price">
          <input class="input variant-field variant-cost" data-field="cost" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(variant.cost || "")}" placeholder="Cost" aria-label="Variant cost">
          <input class="input variant-field variant-stock" data-field="stock" type="number" min="0" step="1" inputmode="numeric" value="${esc(variant.stock || "")}" placeholder="Stock" aria-label="Variant stock">
        </div>
        <input class="input variant-field variant-barcode" data-field="barcode" value="${esc(variant.barcode || "")}" placeholder="Barcode (optional)" inputmode="numeric" autocomplete="off" spellcheck="false">
      </div>
    </div>`;
  }

  function openProductEditor(id = null, { barcode = "", source = "inventory", addToCart = false } = {}) {
    const product = id ? T.findProduct(id) : null;
    const values = product ? editorFromProduct(product) : emptyEditorValues();
    if (barcode) values.barcode = barcode;
    T.ui.editor = {
      id: product?.id || null,
      values,
      source,
      addToCart
    };
    renderProductEditor({ focusName: !product });
  }

  function renderProductEditor({ focusName = false } = {}) {
    const editor = T.ui.editor;
    if (!editor) return;
    const values = editor.values;
    const editing = Boolean(editor.id);
    // Unit dropdown offers only official mass/volume units. Products saved with
    // an older unit keep it as the first option so editing never silently
    // rewrites their unit.
    const OFFICIAL_UNITS = [["kg","Kilograms"],["g","Grams"],["L","Litres"],["ml","Millilitres"]];
    const UNIT_LABELS = { kg: "Kilograms", g: "Grams", L: "Litres", ml: "Millilitres" };
    const UNIT_SYMBOLS = { kg: "kg", g: "g", L: "L", ml: "ml" };
    const LEGACY_UNIT_LABELS = { pcs: "Pieces", each: "Each", pack: "Pack", box: "Box", bottle: "Bottle", sachet: "Sachet" };
    const unitLabel = (u) => UNIT_LABELS[u] || LEGACY_UNIT_LABELS[u] || u;
    const unitSymbol = (u) => UNIT_SYMBOLS[u] || u;
    const unitHint = (u, sizeStr) => {
      if (!u) return "Pick a unit to show how the till counts stock.";
      const num = Number(String(sizeStr ?? "").trim());
      const sizePart = Number.isFinite(num) && num > 0 ? ` · ${num} ${unitSymbol(u)} each` : "";
      return `Till counts stock in ${unitLabel(u).toLowerCase()}${sizePart}.`;
    };
    const PACK_PLURAL = { packet: "packets", box: "boxes", dozen: "dozens", crate: "crates" };
    const isBundleType = (t) => Object.prototype.hasOwnProperty.call(PACK_PLURAL, t);
    const packHint = (type, sizeStr) => {
      if (!isBundleType(type)) return "Pick a product type to show how the till counts stock.";
      const num = Number(String(sizeStr ?? "").trim());
      const sizePart = Number.isFinite(num) && num > 0 ? ` · ${num} pieces each` : "";
      return `Till counts stock in ${PACK_PLURAL[type]}${sizePart}.`;
    };
    const currentUnit = String(values.unit || "");
    const currentType = isBundleType(String(values.soldBy)) ? String(values.soldBy) : "";
    // Stock field: when a bundle type is chosen, stock is typed in bundles and
    // converted to pieces on save (2 packets × 10 = 20 pieces of 100 g each).
    // N/A type → the number typed is the stock.
    const stockField = (type, packRaw, unit, unitSizeRaw, typed) => {
      const bundle = isBundleType(type);
      const packDigit = Number(String(packRaw ?? "").trim());
      const unitSizeNum = Number(String(unitSizeRaw ?? "").trim());
      const sizeNum = Number.isFinite(unitSizeNum) && unitSizeNum > 0 ? Math.round(unitSizeNum * 1000) / 1000 : null;
      const unitPart = unit && sizeNum !== null ? ` of ${sizeNum} ${unitSymbol(unit)}` : "";
      const plural = PACK_PLURAL[type] || "";
      const typedStr = String(typed ?? "").trim();
      const typedNum = Number(typedStr);
      if (!bundle) return { label: "In stock", hint: "The number you type is the stock." };
      const label = `In stock (${plural}${unitPart})`;
      let hint;
      if (typedStr === "" || !Number.isFinite(typedNum)) hint = "The number you type is how many bundles you have.";
      else if (Number.isFinite(packDigit) && packDigit > 0) {
        const total = Math.round(typedNum * packDigit * 1000) / 1000;
        hint = `${typedStr} ${plural} × ${packDigit} = ${total} pieces${unitPart ? ` of ${sizeNum} ${unitSymbol(unit)} each` : ""}.`;
      } else hint = "Type pieces per bundle above to see the total pieces.";
      return { label, hint };
    };
    const initialStock = stockField(currentType, values.packSize, currentUnit, values.unitSize, values.stock);
    const refreshStockField = () => {
      const formEl = document.getElementById("product-form");
      if (!formEl) return;
      const type = String(formEl.querySelector("#product-type")?.value || "").toLowerCase();
      const bundle = isBundleType(type);
      const state = stockField(
        type,
        formEl.querySelector("#product-pack-size")?.value || "",
        formEl.querySelector("#product-unit")?.value || "",
        formEl.querySelector("#product-unit-size")?.value || "",
        formEl.querySelector("#product-stock")?.value || ""
      );
      const label = formEl.querySelector("#product-stock-label");
      const hint = formEl.querySelector("#product-stock-hint");
      const input = formEl.querySelector("#product-stock");
      if (label) label.textContent = state.label;
      if (hint) hint.textContent = state.hint;
      if (input) { input.step = bundle ? "0.001" : "1"; input.inputMode = bundle ? "decimal" : "numeric"; }
    };
    const unitOptions = currentUnit && !OFFICIAL_UNITS.some(([value]) => value === currentUnit) ? [[currentUnit, LEGACY_UNIT_LABELS[currentUnit] || currentUnit], ...OFFICIAL_UNITS] : OFFICIAL_UNITS;
    open({
      title: editing ? "Edit product" : "New product",
      subtitle: editing ? "Changes apply to future sales." : "Add the details once — scan it forever.",
      iconName: editing ? "i-pencil" : "i-box",
      focus: focusName ? "#product-name" : "",
      body: `<form id="product-form" novalidate>
        <div class="product-preview">
          <span class="tile tile-lg tone-${T.toneFor(values.category)}" id="product-preview-tile" aria-hidden="true">${esc(T.initials(values.name || "New"))}</span>
          <div><div class="name" id="product-preview-name">${esc(values.name || "New product")}</div><div class="meta" id="product-preview-meta">${esc(values.category)}${values.barcode ? ` · ${esc(values.barcode)}` : ""}</div></div>
        </div>
        <div class="field-row" style="margin-top:0">
          <div class="field">
            <label for="product-barcode">Barcode</label>
            <div class="barcode-field">
              <input class="input" id="product-barcode" name="barcode" value="${esc(values.barcode)}" placeholder="Scan or type" autocomplete="off" spellcheck="false">
              <button class="barcode-scan" type="button" data-act="scan-barcode-field" aria-label="Scan barcode with camera">${icon("i-scan")}</button>
            </div>
          </div>
          <div class="field">
            <label for="product-name">Product name</label>
            <input class="input" id="product-name" name="name" value="${esc(values.name)}" placeholder="e.g. Oat Milk" required autocomplete="off">
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="product-size">Size</label>
            <select class="select" id="product-size" aria-label="Pick a size">
              <option value="">N/A</option>
              ${["Small","Medium","Large"].map((label) => `<option value="${esc(label)}" ${values.detail === label ? "selected" : ""}>${esc(label)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="product-unit">Unit</label>
            <select class="select" id="product-unit" name="unit" aria-label="Official product unit">
              <option value="">N/A</option>
              ${unitOptions.map(([value,label]) => `<option value="${esc(value)}" ${currentUnit === value ? "selected" : ""}>${esc(label)}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="field" id="unit-size-row"${currentUnit ? "" : ' style="display:none"'}>
          <label for="product-unit-size">Amount per unit</label>
          <div class="input-affix">
            <input class="input" id="product-unit-size" name="unitSize" type="number" min="0" step="0.001" inputmode="decimal" value="${esc(values.unitSize ?? "")}" placeholder="e.g. 500">
            <span class="affix" id="unit-size-affix">${esc(unitSymbol(currentUnit))}</span>
          </div>
          <p class="field-help" id="unit-size-hint" style="margin-top:6px">${esc(unitHint(currentUnit, values.unitSize))}</p>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="product-type">Product type</label>
            <select class="select" id="product-type" name="productType" aria-label="The bundle the item comes in">
              <option value="">N/A</option>
              ${["Packet","Box","Dozen","Crate"].map((label) => {
                const value = label.toLowerCase();
                return `<option value="${value}" ${String(values.soldBy) === value ? "selected" : ""}>${label}</option>`;
              }).join("")}
            </select>
          </div>
          <div class="field" style="display:flex;align-items:flex-end;padding-bottom:6px"><span class="field-help" style="margin:0">The bundle the item comes in</span></div>
        </div>

        <div class="field" id="pack-size-row"${currentType ? "" : ' style="display:none"'}>
          <label for="product-pack-size" id="pack-size-label">${currentType ? `Pieces per ${esc(currentType)}` : "Pieces per bundle"}</label>
          <div class="input-affix">
            <input class="input" id="product-pack-size" name="packSize" type="number" min="0" step="1" inputmode="numeric" value="${esc(values.packSize ?? "")}" placeholder="e.g. 12">
            <span class="affix">pieces</span>
          </div>
          <p class="field-help" id="pack-size-hint" style="margin-top:6px">${esc(packHint(currentType, values.packSize))}</p>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="product-cost">Buying price</label>
            <div class="input-affix"><input class="input" id="product-cost" name="cost" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(values.cost)}" placeholder="0.00"><span class="affix">${esc(T.currencySymbol())}</span></div>
          </div>
          <div class="field">
            <label for="product-price">Selling price</label>
            <div class="input-affix"><input class="input" id="product-price" name="price" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(values.price)}" placeholder="0.00" required><span class="affix">${esc(T.currencySymbol())}</span></div>
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="product-stock" id="product-stock-label">${esc(initialStock.label)}</label>
            <input class="input" id="product-stock" name="stock" type="number" min="0" step="${isBundleType(currentType) ? "0.001" : "1"}" inputmode="${isBundleType(currentType) ? "decimal" : "numeric"}" value="${esc(values.stock)}" required>
            <p class="field-help" id="product-stock-hint" style="margin-top:6px">${esc(initialStock.hint)}</p>
          </div>
          <div class="field">
            <label for="product-low">Low-stock alert</label>
            <input class="input" id="product-low" name="lowStockAt" type="number" min="0" step="1" inputmode="numeric" value="${esc(values.lowStockAt)}">
          </div>
        </div>

        <div class="field">
          <label for="product-category">Category</label>
          <select class="select" id="product-category" name="category">
            ${T.categories().map((category) => `<option value="${esc(category)}" ${values.category === category ? "selected" : ""}>${esc(category)}</option>`).join("")}
          </select>
        </div>

        <input type="hidden" id="product-detail" name="detail" value="${esc(values.detail || "")}">

        <div class="form-error" role="alert"></div>
        <div class="sheet-actions">
          <button class="btn btn-primary" type="submit">${editing ? "Save changes" : "Add product"} ${icon("i-check")}</button>
        </div>
        ${editing ? `<button class="btn btn-danger delete-product" type="button" data-act="delete-product" data-id="${esc(editor.id)}">Delete product</button>` : ""}
      </form>`
    });

    const form = document.getElementById("product-form");
    // Save every keystroke back to T.ui.editor.values so nothing the shopkeeper
    // typed is lost if the sheet closes and reopens.
    form?.addEventListener("input", () => {
      const editor = T.ui.editor;
      if (editor) editor.values = { ...editor.values, ...readProductForm(form) };
      const name = form.querySelector("#product-name")?.value || "New product";
      const category = form.querySelector("#product-category")?.value || T.categories()[0] || "General";
      const tile = document.getElementById("product-preview-tile");
      const previewName = document.getElementById("product-preview-name");
      const meta = document.getElementById("product-preview-meta");
      if (tile) { tile.textContent = T.initials(name); tile.className = `tile tile-lg tone-${T.toneFor(category)}`; }
      if (previewName) previewName.textContent = name;
      if (meta) meta.textContent = `${category}${form.querySelector("#product-barcode")?.value ? ` · ${form.querySelector("#product-barcode").value}` : ""}`;
      // Keep the "how the till counts stock" hints in step with what was typed.
      const unitSizeHint = form.querySelector("#unit-size-hint");
      if (unitSizeHint) {
        const unit = form.querySelector("#product-unit")?.value || "";
        const size = form.querySelector("#product-unit-size")?.value || "";
        unitSizeHint.textContent = unitHint(unit, size);
      }
      const packSizeHint = form.querySelector("#pack-size-hint");
      if (packSizeHint) {
        const type = String(form.querySelector("#product-type")?.value || "").toLowerCase();
        const size = form.querySelector("#product-pack-size")?.value || "";
        packSizeHint.textContent = packHint(type, size);
      }
      refreshStockField();
    });

    // Picking a unit reveals the "amount per unit" box; clearing it hides it.
    form?.addEventListener("change", (event) => {
      const t = event.target;
      if (t.id === "product-size") {
        const detail = form.querySelector("#product-detail");
        if (detail) detail.value = t.value || "";
        return;
      }
      if (t.id === "product-unit") {
        const row = form.querySelector("#unit-size-row");
        const affix = form.querySelector("#unit-size-affix");
        const hint = form.querySelector("#unit-size-hint");
        const sizeInput = form.querySelector("#product-unit-size");
        if (row) row.style.display = t.value ? "" : "none";
        if (affix) affix.textContent = unitSymbol(t.value);
        if (hint) hint.textContent = unitHint(t.value, sizeInput?.value || "");
        if (t.value && sizeInput) sizeInput.focus({ preventScroll: true });
      }
      if (t.id === "product-type") {
        const row = form.querySelector("#pack-size-row");
        const label = form.querySelector("#pack-size-label");
        const hint = form.querySelector("#pack-size-hint");
        const packInput = form.querySelector("#product-pack-size");
        const type = String(t.value || "").toLowerCase();
        const bundle = isBundleType(type);
        if (row) row.style.display = bundle ? "" : "none";
        if (label) label.textContent = bundle ? `Pieces per ${type}` : "Pieces per bundle";
        if (hint) hint.textContent = packHint(type, packInput?.value || "");
        if (bundle && packInput) packInput.focus({ preventScroll: true });
      }
      refreshStockField();
    });

    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = readProductForm(form);
      if (!values) return;
      if (!values.name) {
        productEditorError("Give the product a name.");
        return;
      }
      const editor = T.ui.editor;
      const existing = editor.id ? T.findProduct(editor.id) : null;
      const mass = values.soldByMass === true;
      const packSize = T.clampInt(values.packSize || "0", 0, 100000);
      // When the shopkeeper said prices are per pack, every variant price and
      // cost is divided by pieces per pack so the till always knows piece price.
      const perPack = values.packMode === "pack" && packSize > 0;
      const perPackToPiece = (value) => perPack && value !== null && value !== undefined && Number.isFinite(value) ? Math.max(0, Math.round(Number(value) / packSize)) : value;
      // Variants: each needs a label and a price greater than zero.
      const previousVariants = new Map((existing?.variants || []).map((v) => [String(v.label).toLowerCase(), v]));
      let variantError = "";
      const variants = values.variants.map((v) => {
        if (variantError) return null;
        if (!v.label) { variantError = "Give every variant a label."; return null; }
        const vPrice = T.parsePriceToCents(v.price);
        if (!Number.isFinite(vPrice) || vPrice <= 0) { variantError = `Variant “${v.label}” needs a price greater than zero.`; return null; }
        const rawVPrice = vPrice;
        const vPriceFinal = perPack && rawVPrice > 0 ? Math.max(1, Math.round(rawVPrice / packSize)) : rawVPrice;
        const vCost = String(v.cost || "").trim() === "" ? 0 : (T.parsePriceToCents(v.cost) || 0);
        const vCostFinal = perPack && vCost > 0 ? Math.max(0, Math.round(vCost / packSize)) : vCost;
        const vStock = T.clampInt(v.stock || "0", 0, 1000000);
        const match = previousVariants.get(String(v.label).toLowerCase());
        return {
          id: match?.id || v.id || T.uid("v"),
          label: v.label,
          price: vPriceFinal,
          cost: vCostFinal,
          stock: vStock,
          barcode: T.cleanBarcode(v.barcode)
        };
      }).filter(Boolean);
      if (variantError) {
        productEditorError(variantError);
        return;
      }
      const hasVariants = variants.length > 0;
      // Parent price/stock/cost become a summary of its variants so legacy
      // displays and searches still work.
      const summaryPrice = hasVariants ? Math.min(...variants.map((v) => v.price)) : null;
      const summaryCost = hasVariants ? (() => {
        const nonZero = variants.map((v) => v.cost).filter((c) => c > 0);
        return nonZero.length ? Math.min(...nonZero) : 0;
      })() : null;
      const summaryStock = hasVariants ? variants.reduce((sum, v) => sum + v.stock, 0) : null;
      // Weighed stock is kept in grams: what the shop types as 2.5 kg is
      // stored as 2500 g so all the math stays in whole numbers.
      // Bundle stock is typed in bundles: 2 packets of 10 → 20 pieces.
      const rawStock = Number(values.stock);
      const bundleStockMode = ["packet","box","dozen","crate"].includes(values.soldBy) && packSize > 0;
      const stock = hasVariants
        ? summaryStock
        : mass
          ? Math.max(0, Math.min(1000000, Math.round((Number.isFinite(rawStock) ? rawStock : 0) * 1000)))
          : bundleStockMode
            ? T.clampInt(String(Math.round((Number.isFinite(rawStock) ? rawStock : 0) * packSize)), 0, 999999)
            : T.clampInt(values.stock, 0, 999999);
      const lowStockAt = T.clampInt(values.lowStockAt, 0, 999999);
      const price = hasVariants
        ? summaryPrice
        : (() => {
            const p = T.parsePriceToCents(values.price);
            if (!Number.isFinite(p) || p <= 0) { productEditorError("Enter a price greater than zero."); return null; }
            return p;
          })();
      if (price === null) return;
      const costRaw = String(values.cost || "").trim();
      const cost = hasVariants
        ? summaryCost
        : costRaw === "" ? 0 : (T.parsePriceToCents(costRaw) || 0);
      const barcode = T.cleanBarcode(values.barcode);
      // "500 ml" / "1 kg" — how much one item holds, in its unit.
      const unitSizeNum = Number(String(values.unitSize ?? "").trim());
      const unitSize = Number.isFinite(unitSizeNum) && unitSizeNum > 0 ? Math.round(unitSizeNum * 1000) / 1000 : 0;
      // Pack mode: if the shopkeeper typed prices per pack, convert to per piece.
      const perPackSimple = values.packMode === "pack" && packSize > 0 && !hasVariants;
      const unitPrice = perPackSimple ? Math.max(1, Math.round(price / packSize)) : price;
      const unitCost = perPackSimple ? Math.max(0, Math.round(cost / packSize)) : cost;

      if (existing) {
        existing.name = values.name;
        existing.detail = values.detail;
        existing.price = unitPrice;
        existing.cost = unitCost;
        existing.stock = stock;
        existing.lowStockAt = lowStockAt;
        existing.unit = mass ? "kg" : (values.unit || "pcs");
        existing.unitSize = unitSize;
        existing.barcode = barcode;
        existing.category = values.category;
        existing.soldByMass = mass;
        existing.soldBy = values.soldBy;
        existing.packSize = packSize;
        existing.packLabel = ["dozen","packet","box","crate"].includes(values.soldBy) ? values.soldBy : "";
        existing.packMode = values.packMode;
        existing.variants = variants;
      } else {
        const product = {
          id: T.uid(),
          name: values.name,
          detail: values.detail,
          price: unitPrice,
          cost: unitCost,
          stock,
          lowStockAt,
          unit: mass ? "kg" : (values.unit || "pcs"),
          unitSize,
          barcode,
          category: values.category,
          soldByMass: mass,
          packSize,
          packLabel: values.packLabel || (["dozen","packet","box","crate"].includes(values.soldBy) ? values.soldBy : ""),
          variants,
          packMode: values.packMode
        };
        T.state.products.unshift(product);
        if (editor.addToCart) {
          if (mass) T.sheets?.openWeigh?.(product, { fromEditor: true });
          else if ((product.variants || []).length) T.sheets?.openVariantPicker?.(product);
          else T.addToCart(product, 1);
        }
      }
      T.save();
      T.ui.editor = null;
      close(true);
      T.toast(existing ? "Product updated" : "Product added", "i-check");
      window.render?.();
    });
  }

  function readProductForm(form) {
    if (!form) return null;
    const data = new FormData(form);
    // Preserve the previous product's sold-by, pack and variant config — the
    // simplified onboarding form no longer edits them.
    const previous = T.ui?.editor?.values || {};
    // The product-type choice is the bundle the item comes in; it drives the
    // sold-by mode the till uses. Legacy mass (weight-sold) items keep their
    // mode; "—" means "not a bundle" → the till sells pieces.
    const productType = String(data.get("productType") || "").trim().toLowerCase();
    const bundle = ["dozen","packet","box","crate"].includes(productType) ? productType : "";
    const soldBy = bundle || (previous.soldBy === "mass" ? "mass" : "each");
    return {
      name: String(data.get("name") || "").trim(),
      detail: String(data.get("detail") || "").trim(),
      price: String(data.get("price") || "").trim(),
      cost: String(data.get("cost") || "").trim(),
      stock: String(data.get("stock") || "").trim(),
      lowStockAt: String(data.get("lowStockAt") || "5").trim(),
      barcode: String(data.get("barcode") || "").trim(),
      category: String(data.get("category") || T.categories()[0] || "General"),
      unit: String(data.get("unit") || "").trim(),
      unitSize: String(data.get("unitSize") || "").trim(),
      soldByMass: soldBy === "mass",
      // Variants preserved from a product being edited are never wiped just
      // because the field is gone from the form.
      soldBy,
      variants: previous.variants || [],
      packSize: data.has("packSize") ? String(data.get("packSize") || "").trim() : (previous.packSize || ""),
      packMode: previous.packMode || "piece",
      packLabel: bundle || (["dozen","packet","box","crate"].includes(String(previous.soldBy)) ? String(previous.soldBy) : "")
    };
  }

  function productEditorError(message) {
    const form = document.getElementById("product-form");
    if (form) setFormError(form, message);
  }

  /* ---------- Info / confirm ---------- */

  function openSaveInfo() {
    const bytes = new Blob([JSON.stringify(T.state)]).size;
    open({
      title: "Saved on this device",
      subtitle: "Signed-in data syncs with Firebase; local data is a fallback.",
      iconName: "i-lock",
      tone: "good",
      body: `<p>Products, stock, orders, and receipts are saved on this device. When you sign in with Firebase, your session syncs to the cloud.</p>
        <div class="data-list" style="margin-top:14px">
          <div class="data-row"><span class="data-icon">${icon("i-box")}</span><span class="data-copy"><strong>${T.state.products.length} products</strong><small>${T.state.transactions.length} receipts · ${(bytes / 1024).toFixed(1)} KB</small></span></div>
        </div>
        <p style="margin-top:14px">Clearing browser data or resetting the app erases this store. Export a JSON backup from Settings if you need one.</p>
        <div class="sheet-actions"><button class="btn btn-primary" data-act="close-sheet">Got it</button></div>`
    });
  }

  function confirm({ title, message, confirmLabel = "Confirm", danger = false, onConfirm }) {
    confirmCallback = onConfirm;
    open({
      title,
      iconName: danger ? "i-alert" : "i-info",
      tone: danger ? "danger" : "warn",
      body: `<p class="confirm-copy">${esc(message)}</p>
        <div class="sheet-actions pair">
          <button class="btn btn-quiet" data-act="close-sheet">Cancel</button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-act="confirm-sheet">${esc(confirmLabel)}</button>
        </div>`
    });
  }

  function runConfirm() {
    const callback = confirmCallback;
    confirmCallback = null;
    close(true);
    if (callback) callback();
  }

  /* ---------- Inline scan bar (inside the product editor) ---------- */

  /**
   * Open the little camera window under the barcode field. The entry form
   * stays exactly where it is, so nothing already typed is lost.
   */
  function openMiniScan() {
    const bar = document.getElementById("mini-scan");
    if (!bar) return;
    bar.hidden = false;
    bar.classList.add("is-open");
    T.scanner?.startBar?.();
  }

  function closeMiniScan() {
    T.scanner?.stopBar?.();
    const bar = document.getElementById("mini-scan");
    if (bar) {
      bar.hidden = true;
      bar.classList.remove("is-open");
    }
    const field = document.getElementById("product-barcode");
    if (field) field.focus({ preventScroll: true });
  }

  /* ---------- Quick scan (Sell screen) ---------- */

  function quickScanSummary() {
    const count = T.itemCount();
    if (!count) return `<span>No items yet</span><strong>${money(0)}</strong>`;
    const { total } = T.cartTotals();
    return `<span>${count} ${count === 1 ? "item" : "items"} in this sale</span><strong>${money(total)}</strong>`;
  }

  /** Refresh the running total while the compact scanner is open. */
  function refreshQuickScan() {
    const summary = document.getElementById("quick-scan-summary");
    if (summary) summary.innerHTML = quickScanSummary();
  }

  function openQuickScan() {
    open({
      title: "Scan barcode",
      subtitle: "Each scan goes straight into the current sale.",
      iconName: "i-scan",
      onClose: () => { window.render?.(); },
      body: `<div class="scan-bar is-open" id="mini-scan">
          <div class="scan-bar-head">
            <span class="scan-bar-title">${icon("i-scan")} Point at a barcode</span>
            <button class="scan-bar-close" type="button" data-act="close-quick-scan" aria-label="Close the camera">${icon("i-close")}</button>
          </div>
          <div class="scan-bar-stage">
            <video id="mini-scan-video" playsinline muted autoplay aria-label="Camera preview"></video>
            <span class="scan-bar-reticle" aria-hidden="true"></span>
            <span class="scan-bar-status" id="mini-scan-status">Starting the camera…</span>
          </div>
        </div>
        <div class="quick-scan-summary" id="quick-scan-summary">${quickScanSummary()}</div>
        <p class="quick-scan-hint">The camera stays open so you can scan the whole basket.</p>
        <div class="sheet-actions pair">
          <button class="btn btn-ghost" data-act="manual-entry">${icon("i-pencil")} Enter barcode</button>
          <button class="btn btn-primary" data-act="close-quick-scan">Done</button>
        </div>`
    });
    requestAnimationFrame(() => T.scanner?.startQuick?.());
  }

  /* ---------- Suppliers ---------- */

  function openSupplierEditor(id = null) {
    const supplier = id ? T.findSupplier(id) : null;
    const editing = Boolean(supplier);
    const selectedDays = new Set(supplier?.days || []);
    const values = {
      name: supplier?.name || "",
      contact: supplier?.contact || "",
      phone: supplier?.phone || "",
      email: supplier?.email || "",
      supplies: supplier?.supplies || "",
      address: supplier?.address || "",
      notes: supplier?.notes || ""
    };
    open({
      title: editing ? "Edit supplier" : "New supplier",
      subtitle: editing ? "Update this supplier's contact details." : "Save the contacts you order from.",
      iconName: editing ? "i-pencil" : "i-truck",
      focus: "#supplier-name",
      body: `<form id="supplier-form" novalidate>
        <div class="field">
          <label for="supplier-name">Supplier name</label>
          <input class="input" id="supplier-name" name="name" value="${esc(values.name)}" placeholder="e.g. Nairobi Fresh Produce" maxlength="80" autocomplete="organization" required>
        </div>
        <div class="field">
          <label for="supplier-contact">Contact person</label>
          <input class="input" id="supplier-contact" name="contact" value="${esc(values.contact)}" placeholder="e.g. Mary Wanjiku" maxlength="80" autocomplete="name">
        </div>
        <div class="field-row">
          <div class="field">
            <label for="supplier-phone">Phone</label>
            <input class="input" id="supplier-phone" name="phone" type="tel" value="${esc(values.phone)}" placeholder="+254 700 000 000" maxlength="40" inputmode="tel" autocomplete="tel">
          </div>
          <div class="field">
            <label for="supplier-email">Email</label>
            <input class="input" id="supplier-email" name="email" type="email" value="${esc(values.email)}" placeholder="orders@supplier.co.ke" maxlength="120" inputmode="email" autocomplete="email">
          </div>
        </div>
        <div class="field">
          <label for="supplier-supplies">What they supply</label>
          <input class="input" id="supplier-supplies" name="supplies" value="${esc(values.supplies)}" placeholder="e.g. Milk, bread, eggs" maxlength="120">
        </div>
        <div class="field">
          <label>Delivery days</label>
          <div class="supplier-days supplier-day-picker" id="supplier-days">
            ${T.SUPPLIER_DAYS.map(([code, label]) => `<button type="button" class="supplier-day ${selectedDays.has(code) ? "is-on" : ""}" data-day="${code}" aria-pressed="${selectedDays.has(code)}">${label}</button>`).join("")}
          </div>
          <p class="field-help">Tap the days this supplier delivers.</p>
        </div>
        <div class="field">
          <label for="supplier-address">Address</label>
          <input class="input" id="supplier-address" name="address" value="${esc(values.address)}" placeholder="Shop, street, town" maxlength="160" autocomplete="street-address">
        </div>
        <div class="field">
          <label for="supplier-notes">Notes</label>
          <textarea class="textarea" id="supplier-notes" name="notes" rows="2" maxlength="400" placeholder="Payment terms, delivery notes…">${esc(values.notes)}</textarea>
        </div>
        <div class="form-error" role="alert"></div>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-block" type="submit">${editing ? "Save supplier" : "Add supplier"} ${icon("i-check")}</button>
          ${editing ? `<button class="btn btn-danger btn-block" type="button" data-act="delete-supplier" data-id="${esc(supplier.id)}">Delete supplier</button>` : ""}
        </div>
      </form>`
    });

    document.querySelectorAll("#supplier-days .supplier-day").forEach((button) => {
      button.addEventListener("click", () => {
        const on = button.classList.toggle("is-on");
        button.setAttribute("aria-pressed", String(on));
      });
    });

    const form = document.getElementById("supplier-form");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const next = {
        name: String(data.get("name") || "").trim().replace(/\s+/g, " "),
        contact: String(data.get("contact") || "").trim().replace(/\s+/g, " "),
        phone: String(data.get("phone") || "").trim(),
        email: String(data.get("email") || "").trim(),
        supplies: String(data.get("supplies") || "").trim(),
        address: String(data.get("address") || "").trim(),
        notes: String(data.get("notes") || "").trim(),
        days: [...form.querySelectorAll("#supplier-days .supplier-day.is-on")].map((button) => button.dataset.day)
      };
      if (!next.name) {
        supplierError("Give the supplier a name.");
        return;
      }
      if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) {
        supplierError("Enter a valid email address.");
        return;
      }
      const existing = id ? T.findSupplier(id) : null;
      if (existing) Object.assign(existing, next);
      else {
        T.state.suppliers.unshift({ id: T.uid("s"), ...next, ledger: [], createdAt: new Date().toISOString() });
        T.ui.supplierSearch = "";
      }
      T.save();
      close(true);
      T.toast(existing ? "Supplier updated" : "Supplier added", "i-check");
      window.render?.();
    });
  }

  function supplierError(message) {
    const form = document.getElementById("supplier-form");
    if (form) setFormError(form, message);
  }

  /* ---------- Supplier payments and bills ---------- */

  function supplierPayTarget(supplier) {
    const totals = T.supplierTotals(supplier);
    const balance = totals.balance > 0
      ? `You owe ${money(totals.balance)}`
      : totals.balance < 0
        ? `${money(-totals.balance)} credit`
        : "Account settled";
    return `<div class="supplier-pay-target">
      <span class="supplier-avatar" aria-hidden="true">${esc(T.initials(supplier.name))}</span>
      <div class="supplier-pay-target-copy"><strong>${esc(supplier.name)}</strong><small>${esc(balance)}</small></div>
    </div>`;
  }

  /* ---------- Stock received lines ----------
     A supplier bill means stock came in and the money is owed later. A
     payment can also carry stock, when the shop buys and pays on the spot.
     Both use this small line editor: pick an item, how many, and what each
     one cost. */

  function stockLineOptions() {
    return (T.state.products || []).map((product) => {
      const unit = T.stockCountUnit ? T.stockCountUnit(product) : (product.unit || "pcs");
      return `<option value="${esc(product.id)}">${esc(product.name)} — ${product.stock} ${esc(unit)} in stock</option>`;
    }).join("");
  }

  function stockLineRow(options = "") {
    return `<div class="stock-line" data-line>
      <select class="select stock-line-product" aria-label="Item received">
        <option value="">Choose an item…</option>
        <option value="__new__">+ New item (not in stock yet)</option>
        ${options}
      </select>
      <div class="stock-line-newfields" hidden>
        <input class="input stock-line-name" type="text" placeholder="New product name" aria-label="New product name" autocomplete="off" spellcheck="false">
        <div class="stock-line-newrow">
          <select class="select stock-line-category" aria-label="Category">
            ${T.categories().map((category) => `<option value="${esc(category)}">${esc(category)}</option>`).join("")}
          </select>
          <div class="input-affix"><input class="input stock-line-price" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Selling price" aria-label="Selling price"><span class="affix">${esc(T.currencySymbol())}</span></div>
        </div>
      </div>
      <div class="stock-line-fields">
        <input class="input stock-line-qty" type="number" min="1" step="1" inputmode="numeric" placeholder="Qty" aria-label="Quantity received">
        <div class="input-affix"><input class="input stock-line-cost" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Cost each" aria-label="Cost for each"><span class="affix">${esc(T.currencySymbol())}</span></div>
        <button type="button" class="stock-line-remove" data-remove-line aria-label="Remove this item">${icon("i-close")}</button>
      </div>
    </div>`;
  }

  /** New-item lines need a name and a selling price before they can go into stock. */
  function stockLineError(lines) {
    const bad = (lines || []).find((line) => line.newItem && (!line.name || !(line.price > 0)));
    return bad ? "Each new item needs a name and a selling price." : null;
  }

  function stockLinesField({ title, help }) {
    return `<div class="field stock-lines-field">
      <label>${title}</label>
      <div class="stock-lines" data-stock-lines>${stockLineRow(stockLineOptions())}</div>
      <div class="stock-lines-foot">
        <button type="button" class="btn btn-ghost btn-sm" data-add-line>${icon("i-plus")} Add item</button>
        <span class="stock-lines-total" data-stock-total>0 items</span>
      </div>
      <button type="button" class="stock-lines-use" data-use-total hidden>Use the stock total as the amount</button>
      <p class="field-help">${help}</p>
    </div>`;
  }

  /** Wires the line editor and returns a reader for the filled lines. */
  function wireStockLines(form) {
    const container = form?.querySelector("[data-stock-lines]");
    if (!container) return null;
    const options = stockLineOptions();
    const summary = form.querySelector("[data-stock-total]");
    const useButton = form.querySelector("[data-use-total]");

    const readLines = () => [...container.querySelectorAll("[data-line]")]
      .map((row) => {
        const productId = row.querySelector(".stock-line-product")?.value || "";
        const qty = T.clampInt(row.querySelector(".stock-line-qty")?.value, 0, 100000);
        const costRaw = row.querySelector(".stock-line-cost")?.value;
        const cost = String(costRaw ?? "").trim() === "" ? 0 : (T.parsePriceToCents(costRaw) || 0);
        if (productId === "__new__") {
          const name = String(row.querySelector(".stock-line-name")?.value || "").trim();
          const category = String(row.querySelector(".stock-line-category")?.value || "") || T.categories()[0] || "General";
          const priceRaw = row.querySelector(".stock-line-price")?.value;
          const price = String(priceRaw ?? "").trim() === "" ? 0 : (T.parsePriceToCents(priceRaw) || 0);
          return { newItem: true, name, category, price, qty, cost };
        }
        return { productId, qty, cost };
      })
      .filter((line) => (line.newItem ? line.qty > 0 : line.productId && line.qty > 0));

    const refresh = () => {
      // Reveal the inline new-item fields only for rows in "new item" mode.
      container.querySelectorAll("[data-line]").forEach((row) => {
        const isNew = row.querySelector(".stock-line-product")?.value === "__new__";
        row.querySelector(".stock-line-newfields")?.toggleAttribute("hidden", !isNew);
      });
      const lines = readLines();
      const items = lines.reduce((sum, line) => sum + line.qty, 0);
      const total = lines.reduce((sum, line) => sum + line.qty * line.cost, 0);
      if (summary) summary.textContent = `${items} ${items === 1 ? "item" : "items"} · ${money(total)}`;
      if (useButton) {
        useButton.hidden = total <= 0;
        useButton.textContent = `Use ${money(total)} as the amount`;
      }
      return { lines, items, total };
    };

    container.addEventListener("input", refresh);
    container.addEventListener("change", refresh);
    container.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-remove-line]");
      if (!remove) return;
      const row = remove.closest("[data-line]");
      const rows = container.querySelectorAll("[data-line]");
      if (rows.length > 1) {
        row.remove();
      } else {
        row.querySelector(".stock-line-product").value = "";
        row.querySelector(".stock-line-qty").value = "";
        row.querySelector(".stock-line-cost").value = "";
        const name = row.querySelector(".stock-line-name");
        if (name) name.value = "";
        const price = row.querySelector(".stock-line-price");
        if (price) price.value = "";
      }
      refresh();
    });

    form.querySelector("[data-add-line]")?.addEventListener("click", () => {
      container.insertAdjacentHTML("beforeend", stockLineRow(options));
      const rows = container.querySelectorAll("[data-line]");
      rows[rows.length - 1]?.querySelector(".stock-line-product")?.focus();
      refresh();
    });

    useButton?.addEventListener("click", () => {
      const { total } = refresh();
      const amountInput = form.querySelector("[data-amount-target]");
      if (amountInput && total > 0) {
        amountInput.value = (total / 100).toFixed(2);
        amountInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    refresh();
    return { readLines, refresh };
  }

  /** Unpaid bills, with a one-tap way to pay one of them. */
  function supplierOpenBillsField(supplier) {
    const open = T.supplierOpenBills?.(supplier) || [];
    if (!open.length) return "";
    const total = open.reduce((sum, bill) => sum + bill.remaining, 0);
    return `<div class="field supplier-open-bills">
      <label>Unpaid bills</label>
      <div class="supplier-bill-list">
        ${open.map((bill) => `<div class="supplier-bill-row">
          <span class="supplier-bill-copy"><strong>${money(bill.remaining)}</strong><small>${esc(bill.note || "Stock bill")}${bill.items?.length ? ` · ${bill.items.map((item) => `${item.qty} × ${item.name}`).join(", ")}` : ""}</small></span>
          <button type="button" class="btn btn-ghost btn-sm" data-pay-bill="${bill.remaining}">Pay this</button>
        </div>`).join("")}
      </div>
      <button type="button" class="supplier-pay-full" data-pay-full="${total}">Pay the full balance — ${money(total)}</button>
    </div>`;
  }

  function openSupplierPayment(id) {
    const supplier = T.findSupplier(id);
    if (!supplier) return;
    let method = "cash";
    open({
      title: "Record payment",
      subtitle: `Paying ${supplier.name}`,
      iconName: "i-cash",
      focus: "#supplier-payment-amount",
      body: `<form id="supplier-payment-form" novalidate>
        ${supplierPayTarget(supplier)}
        ${supplierOpenBillsField(supplier)}
        <!-- Amount Section Card -->
        <div class="supplier-pay-card">
          <div class="card-header">
            <span class="card-header title">Amount paid</span>
          </div>
          <div class="card-body">
            <div class="supplier-pay-section">
              <label class="section-title"><span class="icon">&#xf013;</span>Amount</label>
              <div class="field">
                <label for="supplier-payment-amount">Amount paid</label>
                <div class="input-affix">
                  <input class="input supplier-pay-amount-input" id="supplier-payment-amount" name="amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" required data-amount-target>
                  <span class="affix">${esc(T.currencySymbol())}</span>
                </div>
                <p class="field-help">Settles the oldest unpaid bill first, or pays for stock you are taking right now.</p>
              </div>
            </div>
          </div>
        </div>
        <!-- Payment Method Section Card -->
        <div class="supplier-pay-card">
          <div class="card-header">
            <span class="card-header title">Payment method</span>
          </div>
          <div class="card-body">
            <div class="supplier-pay-section">
              <label class="section-title"><span class="icon">&#xf099;</span>Method</label>
              <div class="pay-method-picker" id="supplier-pay-method">
                <button type="button" class="pay-method is-active" data-method="cash" aria-pressed="true">${icon("i-cash")} Cash</button>
                <button type="button" class="pay-method" data-method="mpesa" aria-pressed="false">${icon("i-phone")} M-Pesa</button>
              </div>
            </div>
          </div>
        </div>
        <!-- Stock Section Card -->
        <div class="supplier-pay-card">
          <div class="card-header">
            <span class="card-header title">Stock received</span>
          </div>
          <div class="card-body">
            ${stockLinesField({
              title: "Stock received with this payment",
              help: "Optional. Items taken now are added to your inventory and counted in this payment."
            })}
          </div>
        </div>
        <!-- Date/Note Section Card -->
        <div class="supplier-pay-card">
          <div class="card-header">
            <span class="card-header title">Details</span>
            <span class="card-header subtitle">Date and reference</span>
          </div>
          <div class="card-body">
            <div class="supplier-pay-section" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <div>
                <label class="section-title"><span class="icon">&#xf073;</span>Date</label>
                <div class="field">
                  <input class="input" id="supplier-payment-date" name="date" type="date" value="${T.isoDay()}">
                </div>
              </div>
              <div>
                <label class="section-title"><span class="icon">&#xf0e7;</span>Note</label>
                <div class="field">
                  <input class="input" id="supplier-payment-note" name="note" placeholder="e.g. M-Pesa code QGH7X8Y2Z1" maxlength="120">
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="form-error" role="alert"></div>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-block supplier-pay-submit" type="submit">Record payment ${icon("i-check")}</button>
        </div>
      </form>`
    });

    document.querySelectorAll("#supplier-pay-method .pay-method").forEach((button) => {
      button.addEventListener("click", () => {
        method = button.dataset.method === "mpesa" ? "mpesa" : "cash";
        document.querySelectorAll("#supplier-pay-method .pay-method").forEach((item) => {
          const active = item.dataset.method === method;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-pressed", String(active));
        });
      });
    });

    const form = document.getElementById("supplier-payment-form");
    const stock = wireStockLines(form);
    const setAmount = (cents) => {
      const input = document.getElementById("supplier-payment-amount");
      if (!input || !Number.isFinite(cents) || cents <= 0) return;
      input.value = (cents / 100).toFixed(2);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    form?.querySelector("[data-pay-full]")?.addEventListener("click", (event) => {
      setAmount(Number(event.currentTarget.dataset.payFull));
    });
    form?.querySelectorAll("[data-pay-bill]").forEach((button) => {
      button.addEventListener("click", () => setAmount(Number(button.dataset.payBill)));
    });

    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const lines = stock?.readLines() || [];
      const stockError = stockLineError(lines);
      if (stockError) {
        setFormError(form, stockError);
        return;
      }
      const stockTotal = lines.reduce((sum, line) => sum + line.qty * line.cost, 0);
      const typed = T.parsePriceToCents(data.get("amount"));
      const amount = Number.isFinite(typed) && typed > 0 ? typed : stockTotal;
      if (!Number.isFinite(amount) || amount <= 0) {
        setFormError(form, "Enter an amount greater than zero.");
        return;
      }
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(data.get("date") || "")) ? String(data.get("date")) : T.isoDay();
      const items = T.applyStockLines(lines);
      supplier.ledger = supplier.ledger || [];
      supplier.ledger.unshift({
        id: T.uid("se"),
        type: "payment",
        method,
        amount,
        note: String(data.get("note") || "").trim(),
        staff: (T.activeStaff ? T.activeStaff() : "") || T.state.store.staff || null,
        items,
        date,
        createdAt: new Date().toISOString()
      });
      T.save();
      close(true);
      T.toast(items.length
        ? `Payment recorded · ${items.length} ${items.length === 1 ? "item" : "items"} in stock`
        : `${method === "mpesa" ? "M-Pesa" : "Cash"} payment recorded`, "i-check");
      window.render?.();
    });
  }

  function openSupplierBill(id) {
    const supplier = T.findSupplier(id);
    if (!supplier) return;
    open({
      title: "Add supplier bill",
      subtitle: `Stock from ${supplier.name} — you pay later`,
      iconName: "i-box",
      focus: "#supplier-bill-amount",
      body: `<form id="supplier-bill-form" novalidate>
        ${supplierPayTarget(supplier)}
        <div class="field">
          <label for="supplier-bill-amount">Amount owed</label>
          <div class="input-affix"><input class="input" id="supplier-bill-amount" name="amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" required data-amount-target><span class="affix">${esc(T.currencySymbol())}</span></div>
          <p class="field-help">This bill is added to what you owe ${esc(supplier.name)}. Nothing is paid yet.</p>
        </div>
        ${stockLinesField({
          title: "Stock received",
          help: "Items received now are added to your inventory straight away."
        })}
        <div class="field">
          <label for="supplier-bill-date">Date</label>
          <input class="input" id="supplier-bill-date" name="date" type="date" value="${T.isoDay()}">
        </div>
        <div class="field">
          <label for="supplier-bill-note">What was supplied <span class="field-optional">Optional</span></label>
          <input class="input" id="supplier-bill-note" name="note" placeholder="e.g. 2 crates of milk" maxlength="120">
        </div>
        <div class="form-error" role="alert"></div>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-block" type="submit">Add bill ${icon("i-check")}</button>
        </div>
      </form>`
    });

    const form = document.getElementById("supplier-bill-form");
    const stock = wireStockLines(form);
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const lines = stock?.readLines() || [];
      const stockError = stockLineError(lines);
      if (stockError) {
        setFormError(form, stockError);
        return;
      }
      const stockTotal = lines.reduce((sum, line) => sum + line.qty * line.cost, 0);
      const typed = T.parsePriceToCents(data.get("amount"));
      const amount = Number.isFinite(typed) && typed > 0 ? typed : stockTotal;
      if (!Number.isFinite(amount) || amount <= 0) {
        setFormError(form, "Enter an amount greater than zero.");
        return;
      }
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(data.get("date") || "")) ? String(data.get("date")) : T.isoDay();
      const items = T.applyStockLines(lines);
      supplier.ledger = supplier.ledger || [];
      supplier.ledger.unshift({
        id: T.uid("se"),
        type: "bill",
        method: null,
        amount,
        note: String(data.get("note") || "").trim(),
        staff: (T.activeStaff ? T.activeStaff() : "") || T.state.store.staff || null,
        items,
        date,
        createdAt: new Date().toISOString()
      });
      T.save();
      close(true);
      T.toast(items.length
        ? `Bill added · ${items.length} ${items.length === 1 ? "item" : "items"} in stock`
        : "Supplier bill added", "i-check");
      window.render?.();
    });
  }

  /* ---------- Categories ---------- */

  function openCategoryEditor(name = "") {
    const editing = Boolean(name);
    open({
      title: editing ? "Rename category" : "Add a category",
      subtitle: editing
        ? "Products in this category follow the new name."
        : "Categories group your products on the Sell screen.",
      iconName: "i-tag",
      focus: "#category-name",
      body: `<form id="category-form" novalidate>
        <div class="field">
          <label for="category-name">Category name</label>
          <input class="input" id="category-name" name="name" value="${esc(name)}" placeholder="e.g. Beverages" maxlength="40" autocomplete="off">
        </div>
        <div class="form-error" role="alert"></div>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-block" type="submit">${editing ? "Save name" : "Add category"} ${icon("i-check")}</button>
        </div>
      </form>`
    });

    const form = document.getElementById("category-form");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = String(new FormData(form).get("name") || "").trim();
      const result = editing ? T.renameCategory(name, value) : T.addCategory(value);
      if (!result.ok) {
        categoryError(result.error);
        return;
      }
      close(true);
      T.toast(editing ? `Category renamed to ${result.name}` : "Category added", "i-check");
      window.render?.();
    });
  }

  function categoryError(message) {
    const form = document.getElementById("category-form");
    if (form) setFormError(form, message);
  }

  /* ---------- Account ---------- */

  function openAccount() {
    const session = T.getSession();
    if (!session) {
      open({
        title: "Account",
        subtitle: "Sign in to keep your shop in sync.",
        iconName: "i-lock",
        body: `<p class="confirm-copy">No account is signed in on this device. Sign in to sync your shop settings across devices.</p>
          <div class="account-actions">
            <button class="btn btn-primary btn-block" data-act="open-auth">Sign in ${icon("i-arrow")}</button>
          </div>`
      });
      return;
    }
    const initial = session.email.slice(0, 1).toUpperCase();
    open({
      title: "Account",
      subtitle: "Signed in on this device.",
      iconName: "i-lock",
      body: `<div class="account-hero">
          <span class="avatar avatar-lg" aria-hidden="true">${esc(initial)}<span class="avatar-status">${icon("i-check")}</span></span>
          <div class="account-copy">
            <strong>${esc(session.email)}</strong>
            <small><span class="account-dot"></span>Signed in</small>
          </div>
        </div>
        <div class="account-actions">
          <button class="btn btn-primary btn-block" data-act="open-account-settings">Account settings ${icon("i-arrow")}</button>
          <button class="btn btn-ghost btn-block" data-act="sign-out">Sign out</button>
        </div>
        <p class="account-note">${icon("i-lock", "ico ico-sm")}<span>Your account keeps shop settings in sync. Products, stock and orders stay saved on this device.</span></p>`
    });
  }

  /* ---------- Customer debt ---------- */

  function openDebtCheckout() {
    const totals = T.cartTotals();
    if (!totals.lines.length) { T.toast("There is nothing to sell", "i-alert"); return; }
    const count = T.itemCount();
    const defaultDue = T.debtDefaultDueDate(7);
    let matched = null;
    open({
      title: "Add to debt",
      subtitle: "Customer takes goods now, pays later.",
      iconName: "i-user",
      tone: "warn",
      focus: "#debt-customer-name",
      body: `<form id="debt-form" novalidate>
        <div class="debt-sale-summary">
          <span class="debt-sale-icon">${icon("i-user")}</span>
          <div class="debt-sale-copy">
            <strong>${money(totals.total)} on credit</strong>
            <small>${count} ${count === 1 ? "item" : "items"} added to this customer's debt.</small>
          </div>
        </div>
        <div class="field">
          <label for="debt-customer-name">Customer name</label>
          <input class="input" id="debt-customer-name" name="name" placeholder="e.g. Mary Wanjiku" maxlength="80" autocomplete="name" required>
        </div>
        <div class="field">
          <label for="debt-customer-phone">Phone number</label>
          <input class="input" id="debt-customer-phone" name="phone" type="tel" placeholder="+254 700 000 000" maxlength="40" inputmode="tel" autocomplete="tel" required>
          <p class="field-help" id="debt-customer-hint">New customer — a debt account will be created.</p>
        </div>
        <div class="field">
          <label for="debt-due-date">Payment date</label>
          <input class="input" id="debt-due-date" name="dueDate" type="date" value="${defaultDue}" min="${T.isoDay()}">
          <p class="field-help">When the customer should settle this debt.</p>
        </div>
        <div class="field">
          <label for="debt-note">Note <span class="field-optional">Optional</span></label>
          <input class="input" id="debt-note" name="note" placeholder="e.g. Paid next Friday" maxlength="120">
        </div>
        <div class="form-error" role="alert"></div>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-block" type="submit">Add to debt ${icon("i-check")}</button>
        </div>
      </form>`
    });
    const form = document.getElementById("debt-form");
    const nameInput = form?.querySelector('[name="name"]');
    const phoneInput = form?.querySelector('[name="phone"]');
    const hint = document.getElementById("debt-customer-hint");
    const updateHint = () => {
      const phone = phoneInput?.value || "";
      const match = T.findCustomerByPhone(phone);
      if (match) {
        matched = match;
        if (hint) {
          const summary = T.customerSummary(match);
          hint.textContent = `Existing customer: ${match.name} · ${money(summary.balance >= 0 ? summary.balance : -summary.balance)} ${summary.balance >= 0 ? "owed" : "credit"}`;
          hint.classList.add("is-existing");
        }
        if (nameInput && !nameInput.value.trim()) nameInput.value = match.name;
      } else {
        matched = null;
        if (hint) {
          hint.textContent = "New customer — a debt account will be created.";
          hint.classList.remove("is-existing");
        }
      }
    };
    phoneInput?.addEventListener("input", updateHint);
    phoneInput?.addEventListener("blur", updateHint);

    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const name = String(data.get("name") || "").trim();
      const phone = String(data.get("phone") || "").trim();
      const dueDate = String(data.get("dueDate") || "").trim();
      const note = String(data.get("note") || "").trim();
      if (!name) { setFormError(form, "Give the customer a name."); return; }
      if (!phone || phone.replace(/\D/g, "").length < 7) { setFormError(form, "Enter a valid phone number."); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) { setFormError(form, "Choose a payment date."); return; }
      const tx = T.completeSale({ method: "debt", customerName: name, customerPhone: phone, customerId: matched?.id || null, dueDate, note });
      if (!tx) { setFormError(form, "Could not add this sale to debt."); return; }
      close(true);
      T.toast(`Added to ${name}'s debt`, "i-check");
      T.ui.justPaidId = tx.id;
      if (T.go) T.go(`#/receipt/${tx.id}`, { user: false, reset: true }); else { location.hash = `#/receipt/${tx.id}`; window.render?.(); }
    });
  }

  function openCustomerPayment(id) {
    const customer = T.findCustomer(id);
    if (!customer) return;
    const summary = T.customerSummary(customer);
    const mpesaApi = T.mpesa;
    const cfg = T.mpesaConfig();
    const ready = mpesaApi
      ? mpesaApi.readiness(cfg)
      : { ok: false, reason: "unavailable", message: "M-Pesa is not available on this device." };
    // The account number on a Paybill statement: the shop default, or the
    // customer's number so the payment is easy to trace back.
    const phoneGuess = mpesaApi?.normalizePhone(customer.phone);
    const suggestedAccount = (cfg.account || (phoneGuess?.ok ? phoneGuess.phone : "")).slice(0, 12);
    let method = "cash";
    let busy = false;

    open({
      title: "Record payment",
      subtitle: `Paying ${customer.name}`,
      iconName: "i-cash",
      focus: "#customer-payment-amount",
      onClose: () => { if (busy) T.mpesa?.cancel?.(); },
      body: `<form id="customer-payment-form" novalidate>
        <div class="supplier-pay-target">
          <span class="debt-avatar" aria-hidden="true">${esc(T.initials(customer.name))}</span>
          <div class="supplier-pay-target-copy"><strong>${esc(customer.name)}</strong><small>${money(summary.balance >= 0 ? summary.balance : -summary.balance)} ${summary.balance >= 0 ? "owed" : "credit"}</small></div>
        </div>
        <div class="field">
          <label for="customer-payment-amount">Amount paid</label>
          <div class="input-affix"><input class="input" id="customer-payment-amount" name="amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" required><span class="affix">${esc(T.currencySymbol())}</span></div>
        </div>
        <div class="field">
          <label>Payment method</label>
          <div class="pay-method-picker" id="customer-pay-method">
            <button type="button" class="pay-method is-active" data-method="cash" aria-pressed="true">${icon("i-cash")} Cash</button>
            <button type="button" class="pay-method" data-method="mpesa" aria-pressed="false">${icon("i-phone")} M-Pesa</button>
          </div>
        </div>
        <div id="customer-mpesa-fields" class="customer-mpesa-fields" hidden>
          <div class="field">
            <label for="customer-payment-phone">Customer's M-Pesa number</label>
            <input class="input" id="customer-payment-phone" name="mpesaPhone" type="tel" inputmode="tel" autocomplete="tel"
                   placeholder="0712 345 678" value="${esc(customer.phone || "")}">
            <p class="field-small">The customer gets a PIN prompt on this number.</p>
          </div>
          ${cfg.mode === "paybill" ? `<div class="field">
            <label for="customer-payment-account">Account number</label>
            <input class="input" id="customer-payment-account" name="mpesaAccount" autocomplete="off" maxlength="12"
                   placeholder="e.g. customer number" value="${esc(suggestedAccount)}">
            <p class="field-small">This is what appears on your M-Pesa statement for this payment.</p>
          </div>` : ""}
          ${ready.ok ? "" : `<div class="mpesa-alert is-setup">${icon("i-info", "ico ico-sm")}<span>${esc(ready.message)}</span></div>
            <button type="button" class="btn btn-ghost btn-block" id="customer-mpesa-settings">Open store settings</button>`}
          <div class="mpesa-inline-wait" id="customer-mpesa-wait" hidden aria-live="polite">
            <span class="mpesa-wait-mark"><span class="spinner"></span></span>
            <div class="mpesa-inline-wait-copy">
              <strong id="customer-mpesa-wait-title">Sending the request…</strong>
              <small id="customer-mpesa-wait-text">Talking to Safaricom.</small>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" id="customer-mpesa-cancel">Cancel</button>
          </div>
        </div>
        <div class="field">
          <label for="customer-payment-date">Date</label>
          <input class="input" id="customer-payment-date" name="date" type="date" value="${T.isoDay()}">
        </div>
        <div class="field">
          <label for="customer-payment-note">Reference or note <span class="field-optional">Optional</span></label>
          <input class="input" id="customer-payment-note" name="note" placeholder="e.g. M-Pesa code QGH7X8Y2Z1" maxlength="120">
        </div>
        <div class="form-error" role="alert"></div>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-block" type="submit" id="customer-payment-submit">Record payment ${icon("i-check")}</button>
        </div>
      </form>`
    });

    const form = document.getElementById("customer-payment-form");
    const mpesaFields = document.getElementById("customer-mpesa-fields");
    const waitEl = document.getElementById("customer-mpesa-wait");
    const waitTitle = document.getElementById("customer-mpesa-wait-title");
    const waitText = document.getElementById("customer-mpesa-wait-text");
    const submit = document.getElementById("customer-payment-submit");

    function setWaiting(active, title = "", text = "") {
      busy = active;
      if (waitEl) waitEl.hidden = !active;
      if (waitTitle && title) waitTitle.textContent = title;
      if (waitText && text) waitText.textContent = text;
      form?.querySelectorAll("input").forEach((input) => { input.disabled = active; });
      document.querySelectorAll("#customer-pay-method .pay-method").forEach((button) => { button.disabled = active; });
      if (submit) submit.disabled = active;
    }

    function refreshMethod() {
      const isMpesa = method === "mpesa";
      if (mpesaFields) mpesaFields.hidden = !isMpesa;
      if (submit) {
        submit.innerHTML = isMpesa
          ? `${icon("i-phone")} Send M-Pesa request`
          : `Record payment ${icon("i-check")}`;
        submit.disabled = busy || (isMpesa && !ready.ok);
      }
    }

    document.querySelectorAll("#customer-pay-method .pay-method").forEach((button) => {
      button.addEventListener("click", () => {
        method = button.dataset.method === "mpesa" ? "mpesa" : "cash";
        document.querySelectorAll("#customer-pay-method .pay-method").forEach((item) => {
          const active = item.dataset.method === method;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-pressed", String(active));
        });
        refreshMethod();
      });
    });
    refreshMethod();

    document.getElementById("customer-mpesa-settings")?.addEventListener("click", () => {
      close(true);
      window.Till.go?.("#/mpesa");
    });

    document.getElementById("customer-mpesa-cancel")?.addEventListener("click", () => {
      T.mpesa?.cancel?.();
      setWaiting(false);
      setFormError(form, "");
    });

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;
      const data = new FormData(form);
      const amount = T.parsePriceToCents(data.get("amount"));
      if (!Number.isFinite(amount) || amount <= 0) {
        setFormError(form, "Enter an amount greater than zero.");
        return;
      }
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(data.get("date") || "")) ? String(data.get("date")) : T.isoDay();
      const typedNote = String(data.get("note") || "").trim();

      if (method === "mpesa") {
        if (!mpesaApi) { setFormError(form, "M-Pesa is not available on this device."); return; }
        if (!ready.ok) { setFormError(form, ready.message); return; }
        const phone = String(data.get("mpesaPhone") || customer.phone || "").trim();
        const check = mpesaApi.normalizePhone(phone);
        if (!check.ok) { setFormError(form, check.error); return; }
        const accountRef = String(data.get("mpesaAccount") || "").trim().slice(0, 12) || check.phone.slice(0, 12);

        setFormError(form, "");
        setWaiting(true, "Sending the request…", "Talking to Safaricom.");
        const result = await mpesaApi.collect({
          phone: check.phone,
          amountCents: amount,
          accountRef,
          description: `Debt ${customer.name}`.slice(0, 13),
          onStage: (stage) => {
            if (stage.stage !== "waiting") return;
            setWaiting(
              true,
              "Waiting for the customer",
              `Prompt sent to ${mpesaApi.formatPhone(stage.phone)}. Ask them to enter their M-Pesa PIN.`
            );
          }
        });

        if (result.stage === "cancelled") { setWaiting(false); return; }
        if (!result.ok) {
          setWaiting(false);
          setFormError(form, result.message || "The payment was not completed.");
          return;
        }
        const reference = result.reference || "";
        const checkoutId = result.checkoutId || "";
        const charged = Number(result.amountCents) > 0 ? Number(result.amountCents) : amount;
        const mpesaNote = reference ? `M-Pesa ${reference}` : checkoutId ? `M-Pesa request ${checkoutId}` : "M-Pesa";
        const entry = T.recordCustomerPayment(customer.id, {
          amount: charged,
          method: "mpesa",
          date,
          note: typedNote ? `${typedNote} · ${mpesaNote}` : mpesaNote,
          reference,
          checkoutId,
          accountRef
        });
        if (!entry) { setWaiting(false); setFormError(form, "Could not record this payment."); return; }
        setWaiting(false);
        close(true);
        T.toast(`M-Pesa payment received · ${money(charged)}`, "i-check");
        window.render?.();
        return;
      }

      const entry = T.recordCustomerPayment(customer.id, { amount, method, date, note: typedNote });
      if (!entry) { setFormError(form, "Could not record this payment."); return; }
      close(true);
      T.toast(`Cash payment recorded · ${money(amount)}`, "i-check");
      window.render?.();
    });
  }

  function openDebtReminder() {
    const due = T.debtReminders();
    if (!due.length) return false;
    T.markDebtReminderSeen();
    const total = due.reduce((sum, { summary }) => sum + summary.balance, 0);
    open({
      title: "Payments due",
      subtitle: `${due.length} ${due.length === 1 ? "customer has" : "customers have"} a payment date today or overdue.`,
      iconName: "i-alert",
      tone: "warn",
      body: `<p class="confirm-copy">${money(total)} outstanding from ${due.length} ${due.length === 1 ? "customer" : "customers"}.</p>
        <div class="debt-reminder-list">
          ${due.slice(0, 5).map(({ customer, summary }) => {
            const info = T.debtDueInfo(summary.nextDue);
            return `<button class="debt-reminder-row" data-act="view-debt" data-id="${esc(customer.id)}">
              <span class="debt-reminder-icon">${icon("i-clock")}</span>
              <span class="debt-reminder-copy">
                <strong>${esc(customer.name)}</strong>
                <small>${esc(info.label)}${customer.phone ? ` · ${esc(customer.phone)}` : ""}</small>
              </span>
              <span class="debt-reminder-amount">${money(summary.balance)}</span>
            </button>`;
          }).join("")}
          ${due.length > 5 ? `<p class="field-help" style="text-align:center;">And ${due.length - 5} more customers.</p>` : ""}
        </div>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-block" data-act="view-debt">View debt ${icon("i-arrow")}</button>
          <button class="btn btn-ghost btn-block" data-act="close-sheet">Remind me later</button>
        </div>`
    });
    return true;
  }

  /* ---------- Closing the app ---------- */

  function openExitPrompt() {
    if (T.ui.exitPromptOpen) return;
    T.ui.exitPromptOpen = true;
    open({
      title: "Close Biller POS?",
      subtitle: "Your stock and orders are saved on this device.",
      iconName: "i-alert",
      tone: "warn",
      onClose: () => { T.ui.exitPromptOpen = false; },
      body: `<p class="confirm-copy">You are on the Sell screen, the home of the app. Close to leave Biller POS, or keep selling to stay.</p>
        <div class="sheet-actions pair">
          <button class="btn btn-quiet" data-act="close-sheet">Keep selling</button>
          <button class="btn btn-danger" data-act="exit-app">Close app</button>
        </div>`
    });
  }

  /* ---------- Stock in and prices ---------- */

  /**
   * Receive stock: how many arrived, what each one cost, and what it sells
   * for. The buying price is what the profit is worked out from.
   */
  function openStockIn(id) {
    const product = T.findProduct(id);
    if (!product) return;
    const unit = T.stockCountUnit ? T.stockCountUnit(product) : (product.unit || "pcs");
    const mass = product.soldByMass === true;
    const costValue = product.cost ? (product.cost / 100).toFixed(2) : "";
    const priceValue = product.price ? (product.price / 100).toFixed(2) : "";
    const packSize = Number.isFinite(Number(product.packSize)) && product.packSize > 0 ? product.packSize : "";
    const variants = Array.isArray(product.variants) ? product.variants : [];
    open({
      title: mass ? "Add weight" : "Add stock",
      subtitle: `${product.name}${product.detail ? ` · ${product.detail}` : ""}`,
      iconName: "i-box",
      focus: "#stock-in-qty",
      body: `<form id="stock-in-form" novalidate>
        <div class="supplier-pay-target">
          <span class="supplier-avatar" aria-hidden="true">${esc(T.initials(product.name))}</span>
          <div class="supplier-pay-target-copy"><strong>${esc(product.name)}</strong><small>${mass ? esc(T.massLabel(product.stock)) : `${product.stock} ${esc(unit)}`} in stock now</small></div>
        </div>
        ${variants.length ? "" : mass ? "" : `<div class="field">
          <label>Also track this in packs?</label>
          <div class="pack-row">
            <input class="input" id="stock-in-packs" inputmode="numeric" type="number" min="0" placeholder="Number of packs">
            <span class="variant-x">×</span>
            <input class="input" id="stock-in-pack-size" inputmode="numeric" type="number" min="1" placeholder="Pieces each" value="${esc(packSize)}">
            <span class="variant-x">=</span>
            <span class="variant-total" id="stock-in-pack-total">0</span>
          </div>
          <div class="segmented-row">
            <span class="field-help" style="margin:0">Prices below are per:</span>
            <div class="segmented compact" id="stock-in-price-mode" role="group" aria-label="Prices per piece or per pack">
              <button type="button" class="seg-btn is-active" data-mode="piece">Piece</button>
              <button type="button" class="seg-btn" data-mode="pack">Pack</button>
            </div>
          </div>
          <p class="field-help">Buying &amp; selling prices are converted to per-piece automatically when you pick "Pack" (e.g. cost 100 / sell 120 per pack of 10 → 10 / 12 each).</p>
          <button type="button" class="btn btn-ghost btn-sm" id="stock-in-pack-fill">${icon("i-box")} Fill from packs</button>
        </div>`}
        ${variants.length ? `<div class="field">
          <label>How many of each variant did you receive?</label>
          <div class="variant-restock-list">
            ${variants.map((variant) => `<div class="variant-restock-row">
              <span class="variant-restock-tile tone-${T.toneFor(product.category)}" aria-hidden="true">${esc(T.initials(variant.label))}</span>
              <span class="variant-restock-copy">
                <strong>${esc(variant.label)}</strong>
                <small>${variant.stock} ${esc(unit)} in stock · ${money(variant.price)}</small>
              </span>
              <input class="input variant-qty" data-variant-id="${esc(variant.id)}" inputmode="numeric" type="number" min="0" placeholder="0" aria-label="Pieces of ${esc(variant.label)} received">
            </div>`).join("")}
          </div>
        </div>` : `<div class="field">
          <label for="stock-in-qty">${mass ? "How many kilograms did you receive?" : "How many did you receive?"}</label>
          <input class="input" id="stock-in-qty" name="qty" type="number" min="${mass ? "0.001" : "1"}" step="${mass ? "0.001" : "1"}" inputmode="${mass ? "decimal" : "numeric"}" value="${mass ? "1" : "1"}" required>
          <div class="variant-chips" role="group" aria-label="Common quantities">
            ${mass
              ? [0.5, 1, 5, 10, 25].map((n) => `<button type="button" class="variant-chip" data-qty="${n}">+${n} kg</button>`).join("")
              : [1, 6, 12, 24, 50].map((n) => `<button type="button" class="variant-chip" data-qty="${n}">+${n}</button>`).join("")}
          </div>
        </div>`}
        <div class="field-row">
          <div class="field">
            <label for="stock-in-cost">Buying price</label>
            <div class="input-affix"><input class="input" id="stock-in-cost" name="cost" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(costValue)}" placeholder="0.00"><span class="affix">${esc(T.currencySymbol())}</span></div>
            <p class="field-help">What you pay for each one.</p>
          </div>
          <div class="field">
            <label for="stock-in-price">Selling price</label>
            <div class="input-affix"><input class="input" id="stock-in-price" name="price" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(priceValue)}" placeholder="0.00" required><span class="affix">${esc(T.currencySymbol())}</span></div>
            <p class="field-help">What the customer pays.</p>
          </div>
        </div>
        <div class="field">
          <label for="stock-in-note">Note <span class="field-optional">Optional</span></label>
          <input class="input" id="stock-in-note" name="note" placeholder="e.g. Delivery from Nairobi Wholesalers" maxlength="120">
        </div>
        ${(T.state.suppliers || []).length ? `<div class="field">
          <label for="stock-in-supplier">Supplier <span class="field-optional">Optional</span></label>
          <select class="input" id="stock-in-supplier" name="supplier">
            <option value="">No supplier bill</option>
            ${(T.state.suppliers || []).map((supplier) => `<option value="${esc(supplier.id)}">${esc(supplier.name)}</option>`).join("")}
          </select>
          <p class="field-help">Pick a supplier only if you are taking this stock on credit. The buying cost is added to what you owe them.</p>
        </div>` : ""}
        <div class="form-error" role="alert"></div>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-block" type="submit">Add to stock ${icon("i-check")}</button>
        </div>
      </form>`
    });

    const form = document.getElementById("stock-in-form");
    form?.querySelectorAll("[data-qty]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const input = form.querySelector("#stock-in-qty");
        if (!input) return;
        input.value = Number(chip.dataset.qty) || 1;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });

    // Packs → pieces: type "5 packs × 24 pieces" and the count lands in qty.
    const packsInput = form.querySelector("#stock-in-packs");
    const packSizeInput = form.querySelector("#stock-in-pack-size");
    const packTotal = form.querySelector("#stock-in-pack-total");
    const packFill = form.querySelector("#stock-in-pack-fill");
    const packModeSeg = form.querySelector("#stock-in-price-mode");
    const priceMode = () => packModeSeg?.querySelector(".seg-btn.is-active")?.dataset?.mode || "piece";
    const updatePackHint = () => {
      if (priceMode() === "pack") {
        const costLabel = form.querySelector('label[for="stock-in-cost"]');
        const priceLabel = form.querySelector('label[for="stock-in-price"]');
        if (costLabel) costLabel.textContent = "Buying price (per pack)";
        if (priceLabel) priceLabel.textContent = "Selling price (per pack)";
      } else {
        const costLabel = form.querySelector('label[for="stock-in-cost"]');
        const priceLabel = form.querySelector('label[for="stock-in-price"]');
        if (costLabel) costLabel.textContent = "Buying price";
        if (priceLabel) priceLabel.textContent = "Selling price";
      }
    };
    packModeSeg?.addEventListener("click", (event) => {
      const btn = event.target.closest(".seg-btn");
      if (!btn) return;
      packModeSeg.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
      updatePackHint();
    });
    updatePackHint();
    const packCount = () => {
      const packs = Number(packsInput?.value || 0);
      const size = Number(packSizeInput?.value || 0);
      const whole = Number.isFinite(packs) && Number.isFinite(size) ? Math.floor(packs * size) : 0;
      return Math.max(0, Math.min(1000000, whole));
    };
    const updatePackTotal = () => {
      if (packTotal) packTotal.textContent = String(packCount());
    };
    packsInput?.addEventListener("input", updatePackTotal);
    packSizeInput?.addEventListener("input", updatePackTotal);
    packFill?.addEventListener("click", () => {
      const input = form.querySelector("#stock-in-qty");
      if (!input) return;
      input.value = String(packCount());
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    updatePackTotal();

    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const price = T.parsePriceToCents(data.get("price"));
      const costRaw = String(data.get("cost") || "").trim();
      const cost = costRaw === "" ? null : T.parsePriceToCents(costRaw);
      const supplierId = String(data.get("supplier") || "");
      const note = String(data.get("note") || "").trim();
      const packSizeValue = Number(data.get("packSize") || packSizeInput?.value || 0);
      const packSize = Number.isFinite(packSizeValue) && packSizeValue > 0 ? Math.round(packSizeValue) : null;
      const packMode = priceMode();
      // If the shopkeeper said prices are per pack, divide by pieces per pack
      // so every price stored on the product is per piece.
      const perPackToPiece = (value) =>
        packMode === "pack" && packSize && value !== null && value !== undefined && Number.isFinite(value)
          ? Math.max(0, Math.round(Number(value) / packSize))
          : value;
      const commonCost = Number.isFinite(cost) ? perPackToPiece(cost) : null;
      const commonPrice = Number.isFinite(price) ? perPackToPiece(price) : null;

      if (variants.length) {
        // Variant products: each variant gets its own restock line.
        const lines = [];
        for (const input of form.querySelectorAll("[data-variant-id]")) {
          const variant = product.variants.find((v) => v.id === input.dataset.variantId);
          const raw = Number(input.value || 0);
          const qty = Number.isFinite(raw) ? Math.max(0, Math.min(1000000, Math.round(raw))) : 0;
          if (!variant || qty <= 0) continue;
          lines.push({ variantId: variant.id, qty, cost: commonCost, price: commonPrice, packSize });
        }
        if (!lines.length) {
          setFormError(form, "Enter how many pieces of each variant you received.");
          return;
        }
        // Price/cost is shared: apply it to the parent + every variant.
        if (supplierId && (!Number.isFinite(cost) || cost <= 0)) {
          setFormError(form, "Enter the buying price to record a supplier bill, or choose No supplier bill.");
          return;
        }
        let totalQty = 0;
        for (const line of lines) {
          const result = T.receiveStock(id, line);
          if (!result.ok) {
            setFormError(form, result.error || "Could not add that stock.");
            return;
          }
          totalQty += line.qty;
        }
        if (supplierId) {
          const supplier = T.findSupplier(supplierId);
          if (supplier && Number.isFinite(cost) && cost > 0) {
            const items = lines.map((line) => ({ productId: product.id, name: product.name, unit: "pcs", qty: line.qty, cost: commonCost }));
            supplier.ledger = supplier.ledger || [];
            supplier.ledger.unshift({
              id: T.uid("se"),
              type: "bill",
              method: null,
              amount: Math.round(commonCost || 0) * totalQty,
              note: note || `Stock: ${product.name}`,
              staff: (T.activeStaff ? T.activeStaff() : "") || T.state.store.staff || null,
              items,
              date: T.isoDay(),
              createdAt: new Date().toISOString()
            });
            T.save();
          }
        }
        close(true);
        T.toast(`${totalQty} pcs across ${lines.length} variant${lines.length === 1 ? "" : "s"} added`, "i-check");
        window.render?.();
        return;
      }

      // Weighed deliveries are typed in kilograms and stored in grams.
      const rawQty = Number(data.get("qty"));
      const qty = mass
        ? Math.max(0, Math.min(1000000, Math.round((Number.isFinite(rawQty) ? rawQty : 0) * 1000)))
        : T.clampInt(data.get("qty"), 0, 1000000);
      if (qty <= 0) {
        setFormError(form, mass ? "Enter how much you received." : "Enter how many you received.");
        return;
      }
      if (commonPrice === null || commonPrice <= 0) {
        setFormError(form, "Enter the price you sell it for.");
        return;
      }
      const priceValue = commonPrice;
      const costValue = commonCost;
      if (supplierId && (!Number.isFinite(costValue) || costValue <= 0)) {
        setFormError(form, "Enter the buying price to record a supplier bill, or choose No supplier bill.");
        return;
      }
      // The bill is the price per kilogram times the kilograms received.
      const billAmount = mass ? Math.round(costValue * qty / 1000) : costValue * qty;
      const result = T.receiveStock(id, { qty, cost: Number.isFinite(costValue) ? costValue : null, price: priceValue, packSize });
      if (!result.ok) {
        setFormError(form, result.error || "Could not add that stock.");
        return;
      }
      const supplier = T.findSupplier(supplierId);
      if (supplier && Number.isFinite(costValue) && costValue > 0) {
        // Only a supplier the shopkeeper picked gets a bill. Guessing the
        // first supplier silently corrupted somebody else's account.
        supplier.ledger = supplier.ledger || [];
        supplier.ledger.unshift({
          id: T.uid("se"),
          type: "bill",
          method: null,
          amount: billAmount,
          note: note || `Stock: ${product.name}`,
          staff: (T.activeStaff ? T.activeStaff() : "") || T.state.store.staff || null,
          items: [{ productId: product.id, name: product.name, unit, qty, cost: costValue }],
          date: T.isoDay(),
          createdAt: new Date().toISOString()
        });
        T.save();
      }
      close(true);
      T.toast(`${mass ? T.massLabel(qty) : `${qty} ${unit}`} added to stock`, "i-check");
      window.render?.();
    });
  }

  /* ---------- M-Pesa code on a receipt ---------- */

  function openMpesaCode(txId) {
    const tx = T.state.transactions.find((entry) => entry.id === txId);
    if (!tx || tx.payment?.method !== "mpesa") return;
    open({
      title: "Add M-Pesa code",
      subtitle: "The code in the customer's M-Pesa confirmation SMS.",
      iconName: "i-phone",
      focus: "#mpesa-code",
      body: `<form class="manual-form" id="mpesa-code-form" novalidate>
        <input class="input" id="mpesa-code" name="code" autocomplete="off" autocapitalize="characters"
          spellcheck="false" placeholder="e.g. QK12345678" maxlength="20"
          value="${esc(tx.payment.reference || "")}">
        <div class="form-error" role="alert"></div>
        <button class="btn btn-primary btn-block" type="submit">Save code ${icon("i-arrow")}</button>
      </form>
      <p class="manual-hint">Optional. This lets you match the sale to your M-Pesa statement later.</p>`
    });

    const form = document.getElementById("mpesa-code-form");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const code = String(new FormData(form).get("code") || "").trim().toUpperCase().replace(/\s+/g, "");
      if (!/^[A-Z0-9]{6,20}$/.test(code)) {
        setFormError(form, "Enter the code from the M-Pesa message.");
        return;
      }
      tx.payment.reference = code;
      T.save();
      close(true);
      window.render?.();
      T.toast("M-Pesa code saved", "i-check");
    });
  }

  /* ---------- Sort options for the Sell screen ---------- */

  function openSellSort() {
    const current = T.sellSort?.() || "new";
    const options = [
      { id: "new", label: "Newest first", hint: "Recently added items on top" },
      { id: "az", label: "A to Z", hint: "Item names in alphabetical order" },
      { id: "za", label: "Z to A", hint: "Item names in reverse order" }
    ];
    open({
      title: "Sort items",
      subtitle: "How the items are ordered on the Sell screen.",
      iconName: "i-sort",
      body: `<div class="sort-options">
        ${options.map((option) => `<button class="sort-option ${current === option.id ? "is-active" : ""}" data-act="set-sell-sort" data-value="${option.id}" aria-pressed="${current === option.id}">
          <span class="sort-option-copy"><strong>${option.label}</strong><small>${option.hint}</small></span>
          ${current === option.id ? `<span class="sort-option-check">${icon("i-check")}</span>` : ""}
        </button>`).join("")}
      </div>`
    });
  }

  /**
   * Pick who is selling on this device. The choice stays on the device (not
   * in the cloud), so the same account signed in on several phones can each
   * ring up sales as a different shopkeeper — and each receipt rung up here
   * prints that name.
   */
  function openStaffPicker() {
    const roster = T.staffRoster ? T.staffRoster() : [];
    if (!roster.length) return;
    const current = T.activeStaff ? T.activeStaff() : "";
    open({
      title: "Who is selling?",
      subtitle: "This device only — the name goes on your receipts",
      iconName: "i-user",
      body: `<div class="staff-picker">
        ${roster.map((name) => {
          const taken = name !== current && Boolean(T.staffClaimedBy?.(name));
          return `
          <button class="sort-option staff-pick ${name === current ? "is-active" : ""} ${taken ? "is-taken" : ""}" data-act="pick-staff" data-value="${esc(name)}" aria-pressed="${name === current}" ${taken ? "disabled" : ""}>
            <span class="staff-pick-avatar" aria-hidden="true">${esc(String(name).slice(0, 1).toUpperCase())}</span>
            <span class="sort-option-copy"><strong>${esc(name)}</strong><small>${name === current ? "Selling on this device" : taken ? "Selling on another device" : "Tap to sell as " + esc(name) + " here"}</small></span>
            ${name === current ? `<span class="sort-option-check">${icon("i-check")}</span>` : ""}
          </button>`;
        }).join("")}
      </div>`
    });
  }

  /**
   * Collect the monthly plan. When the developer has a Till or Paybill
   * configured, the shop pays with an M-Pesa prompt like any other sale.
   * Without one - which is now - the sheet walks the shop through sending the
   * money straight to the developer's M-Pesa number, adding the shop code, and
   * then marking the payment as sent for the developer to confirm.
   */
  function openSubscriptionPayment() {
    const T = window.Till;
    let busy = false;
    const sub = T.subscription();
    const plan = T.planSummary();
    const fee = T.feeConfig();
    const amount = plan.amountCents;
    const amountText = T.money(amount);
    const reference = sub.reference || T.subscriptionReference();

    if (!T.feeReady()) {
      const code = T.shopCode();
      const mpesaCode = String(document.getElementById("subscription-mpesa-code")?.value || "").trim().toUpperCase();
      open({
        title: "Pay the monthly plan",
        subtitle: amountText + " per month",
        iconName: "i-card",
        body: `<div class="plan-amount"><strong>${esc(amountText)}</strong><small>per month</small></div>
          <p>Send <strong>${esc(amountText)}</strong> to the developer to activate <strong>${esc(T.state.store?.name || "your till")}</strong>. Selling stays paused until the payment is confirmed.</p>
          <div class="plan-steps">
            <div class="plan-step"><span class="plan-step-num">1</span><span class="plan-step-copy"><strong>Send the money</strong><small>Open M-Pesa on the shop's phone and send ${esc(amountText)} to the number below.</small></span></div>
            <div class="plan-step"><span class="plan-step-num">2</span><span class="plan-step-copy"><strong>Add your shop code</strong><small>Put <strong>${esc(code)}</strong> in the payment message so we know which shop paid.</small></span></div>
            <div class="plan-step"><span class="plan-step-num">3</span><span class="plan-step-copy"><strong>Tell us it arrived</strong><small>Tap the button and the developer checks the payment. That is usually minutes.</small></span></div>
          </div>
          ${fee.mpesaNumber ? `<div class="data-row" style="margin-top:12px"><span class="data-icon">${icon("i-phone")}</span><span class="data-copy"><strong>M-Pesa number</strong><small>${esc(fee.mpesaNumber)}</small></span></div>
            <button class="btn btn-ghost btn-block" data-act="copy-value" data-value="${esc(fee.mpesaNumber)}" style="margin-top:8px">${icon("i-copy")} Copy the M-Pesa number</button>` : ""}
          ${fee.bank.number ? `<div class="data-row" style="margin-top:8px"><span class="data-icon">${icon("i-store")}</span><span class="data-copy"><strong>Bank transfer</strong><small>${esc(fee.bank.bank)}${fee.bank.name ? " · " + esc(fee.bank.name) : ""} · ${esc(fee.bank.number)}</small></span></div>` : ""}
          <div class="plan-code-box">
            <span>Your shop code</span>
            <strong>${esc(code)}</strong>
            <small>Put this in the payment message so we know which shop it is.</small>
            <button class="btn btn-ghost btn-block" data-act="copy-shop-code" data-code="${esc(code)}" style="margin-top:10px">${icon("i-copy")} Copy the shop code</button>
          </div>
          <div class="field" style="margin-top:14px">
            <label for="subscription-mpesa-code">M-Pesa transaction code</label>
            <input class="input" id="subscription-mpesa-code" name="mpesaCode" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20" placeholder="e.g. QK12345678">
            <p class="field-small">From the confirmation SMS. Optional, but it helps the developer confirm faster.</p>
          </div>
          <p class="field-small" style="margin-top:12px">Activation usually takes up to 5 minutes. If it takes longer, call us and we will switch you on straight away.</p>
          <div class="sheet-actions">
            <button class="btn btn-primary btn-block" data-act="subscription-sent" data-ref="${esc(reference)}">${icon("i-check")} I have sent the payment</button>
            ${fee.mpesaNumber ? `<a class="btn btn-ghost btn-block" href="tel:${esc(fee.mpesaNumber.replace(/[^0-9+]/g, ""))}">${icon("i-phone")} Call the developer</a>` : ""}
            <button class="btn btn-ghost" data-act="open-developer-chat" data-code="${esc(code)}" data-amount="${esc(String(amount))}" data-mpesa="${esc(mpesaCode)}">${icon("i-chat")} Tell the developer</button>
            <button class="btn btn-ghost" data-act="close-sheet">${icon("i-close")} Not now</button>
          </div>`
      });
      return;
    }

    const mpesaApi = T.mpesa;
    open({
      title: "Pay the monthly plan",
      subtitle: amountText + " per month",
      iconName: "i-phone",
      body: `<form id="subscription-pay-form" novalidate>
        <div class="field">
          <label for="subscription-phone">M-Pesa number to charge</label>
          <input class="input" id="subscription-phone" name="phone" inputmode="tel" autocomplete="off" placeholder="07xx xxx xxx" value="${esc(T.state.store?.phone || "")}">
          <p class="field-small">The prompt lands on this number. It should be the one the shop uses for M-Pesa.</p>
        </div>
        <div class="mpesa-inline-wait" id="subscription-mpesa-wait" hidden aria-live="polite">
          <span class="mpesa-wait-mark"><span class="spinner"></span></span>
          <div><strong id="subscription-mpesa-wait-title">Sending the request.</strong><small id="subscription-mpesa-wait-text">Talking to Safaricom.</small></div>
        </div>
        <div class="form-error" role="alert"></div>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-block" type="submit" id="subscription-pay-submit">${icon("i-phone")} Send M-Pesa request</button>
          <button class="btn btn-ghost" data-act="close-sheet">Not now</button>
        </div>
      </form>`
    });

    const form = document.getElementById("subscription-pay-form");
    const waitEl = document.getElementById("subscription-mpesa-wait");
    const waitTitle = document.getElementById("subscription-mpesa-wait-title");
    const waitText = document.getElementById("subscription-mpesa-wait-text");
    const submit = document.getElementById("subscription-pay-submit");

    const setWaiting = (active, title = "", text = "") => {
      busy = active;
      if (waitEl) waitEl.hidden = !active;
      if (waitTitle && title) waitTitle.textContent = title;
      if (waitText && text) waitText.textContent = text;
      form?.querySelectorAll("input").forEach((input) => { input.disabled = active; });
      if (submit) submit.disabled = active;
    };

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy || !mpesaApi) return;
      const data = new FormData(form);
      const phone = String(data.get("phone") || "").trim();
      const check = mpesaApi.normalizePhone(phone);
      if (!check.ok) { setFormError(form, check.error); return; }
      setFormError(form, "");
      setWaiting(true, "Sending the request…", "Talking to Safaricom.");
      const result = await mpesaApi.collect({
        phone: check.phone,
        amountCents: amount,
        accountRef: reference.slice(0, 12),
        description: String(plan.label || "Plan").slice(0, 13),
        cfg: {
          paybill: fee.mode === "paybill" ? fee.shortcode : "",
          till: fee.mode === "till" ? fee.shortcode : "",
          mode: fee.mode,
          shortcode: fee.shortcode,
          account: fee.account,
          environment: fee.environment,
          consumerKey: fee.consumerKey,
          consumerSecret: fee.consumerSecret,
          passkey: fee.passkey,
          backend: fee.backend,
          backendKey: fee.backendKey
        },
        onStage: (stage) => {
          if (stage.stage === "waiting") setWaiting(true, "Waiting for approval.", "The customer must enter their PIN on the phone.");
        }
      });
      if (!result.ok) {
        setWaiting(false);
        setFormError(form, result.message || "The payment could not be sent.");
        return;
      }
      T.markSubscriptionPaid({ method: "mpesa", reference: result.reference || result.checkoutId || "" });
      close(true);
      T.toast("Monthly plan paid. Thank you.", "i-check");
      window.render?.();
    });
  }

  /* ---------- Weigh a product ---------- */

  /**
   * The scale for weighed products: the shop taps or types what the
   * customer is taking, sees the price it comes to, and the weight goes
   * into the sale. Also used to reweigh a line that is already in the cart.
   */
  function openWeigh(product, { fromScan = false, fromEditor = false, editLine = false } = {}) {
    if (!product || product.soldByMass !== true) return;
    const existing = T.state.cart.items.find((item) => item.productId === product.id);
    const editing = editLine && existing;
    const currentGrams = editing ? existing.qty : 1000;
    const pricePerKg = product.price;
    open({
      title: editing ? "Reweigh" : "Weigh",
      subtitle: product.name + (product.detail ? ` · ${product.detail}` : ""),
      iconName: "i-scale",
      focus: "#weigh-kg",
      onClose: null,
      size: "compact",
      body: `<div class="supplier-pay-target">
          <span class="supplier-avatar" aria-hidden="true">${esc(T.initials(product.name))}</span>
          <div class="supplier-pay-target-copy"><strong>${esc(product.name)}</strong><small>${esc(T.massLabel(product.stock))} in stock · ${esc(T.money(pricePerKg))} per kg</small></div>
        </div>
        <form id="weigh-form" novalidate>
          <div class="field">
            <label for="weigh-kg">Weight (kg)</label>
            <input class="input weigh-input" id="weigh-kg" name="kg" type="number" min="0.001" step="0.001" inputmode="decimal" value="${(currentGrams / 1000).toFixed(3).replace(/\.?0+$/, "")}" required>
            <div class="variant-chips" role="group" aria-label="Common weights">
              ${[[100, "100 g"], [250, "250 g"], [500, "500 g"], [1000, "1 kg"], [2000, "2 kg"]].map(([g, label]) => `<button type="button" class="variant-chip" data-grams="${g}">${label}</button>`).join("")}
            </div>
          </div>
          <div class="weigh-total">
            <span class="weigh-total-label">Comes to</span>
            <strong class="weigh-total-amount" id="weigh-total">${esc(T.money(Math.round(pricePerKg * currentGrams / 1000)))}</strong>
            <small class="weigh-total-note" id="weigh-note">${esc(T.massLabel(currentGrams))} × ${esc(T.money(pricePerKg))}/kg</small>
          </div>
          <div class="form-error" role="alert"></div>
          <div class="sheet-actions">
            <button class="btn btn-primary btn-block" type="submit">${editing ? "Update the weight" : "Add to the sale"} ${icon("i-check")}</button>
          </div>
        </form>`
    });

    const form = document.getElementById("weigh-form");
    const input = form?.querySelector("#weigh-kg");
    const totalEl = document.getElementById("weigh-total");
    const noteEl = document.getElementById("weigh-note");

    const gramsFromInput = () => {
      const kg = Number(input?.value);
      return Number.isFinite(kg) ? Math.round(kg * 1000) : 0;
    };

    const paintTotal = () => {
      const grams = gramsFromInput();
      if (totalEl) totalEl.textContent = T.money(Math.round(pricePerKg * grams / 1000));
      if (noteEl) noteEl.textContent = `${T.massLabel(grams)} × ${T.money(pricePerKg)}/kg`;
    };
    input?.addEventListener("input", paintTotal);
    paintTotal();

    form?.querySelectorAll("[data-grams]").forEach((chip) => {
      chip.addEventListener("click", () => {
        if (!input) return;
        const grams = Number(chip.dataset.grams) || 1000;
        input.value = (grams / 1000).toFixed(3).replace(/\.?0+$/, "");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });

    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const grams = gramsFromInput();
      if (grams <= 0) {
        setFormError(form, "Enter the weight on the scale.");
        return;
      }
      if (grams > product.stock) {
        setFormError(form, `Only ${T.massLabel(product.stock)} in stock.`);
        return;
      }
      if (editing) {
        existing.qty = grams;
        T.save();
        close(true);
        T.toast(`${product.name}: ${T.massLabel(grams)}`, "i-check");
        window.render?.();
        return;
      }
      if (fromEditor) {
        // Straight after adding the product, the cart is not rendered yet.
        T.state.cart.items.push({ productId: product.id, qty: grams });
        T.save();
        close(true);
        T.toast(`${product.name}: ${T.massLabel(grams)} added`, "i-check");
        window.render?.();
        return;
      }
      if (T.addToCart(product, grams)) {
        T.confirmAdded(product, grams);
        close(true);
        if (fromScan) T.scanner?.resume?.();
        window.render?.();
      }
    });
  }

  /* ---------- Pack picker (products sold in bundles) ---------- */

  /**
   * Bundled products (dozen of eggs, crate of soda, box of 12) are sold
   * pieces at a time. Tapping one opens this sheet so the shopkeeper picks
   * how many, with quick picks for both pieces and whole packs.
   */
  function openPackPicker(product, { fromScan = false, fromEditor = false } = {}) {
    if (!product) return;
    const packSize = Math.max(0, Math.round(Number(product.packSize) || 0));
    if (packSize <= 0) return;
    const existing = T.state.cart.items.find((item) => item.productId === product.id);
    const price = product.variants?.length ? 0 : product.price;
    open({
      title: "Pack",
      subtitle: product.name + (packSize ? ` · 1 pack = ${packSize} pcs` : ""),
      iconName: "i-box",
      focus: "#pack-pieces",
      onClose: null,
      size: "compact",
      body: `<div class="supplier-pay-target">
          <span class="supplier-avatar" aria-hidden="true">${esc(T.initials(product.name))}</span>
          <div class="supplier-pay-target-copy"><strong>${esc(product.name)}</strong><small>${esc(T.productStock(product))} ${esc(T.stockCountUnit ? T.stockCountUnit(product) : (product.unit || "pcs"))} in stock · ${esc(T.money(price))} each</small></div>
        </div>
        <form id="pack-form" novalidate>
          <div class="field">
            <label for="pack-pieces">How many pieces?</label>
            <input class="input weigh-input" id="pack-pieces" name="pieces" type="number" min="1" step="1" inputmode="numeric" value="1" required>
            <div class="variant-chips" role="group" aria-label="Quick pick">
              ${[1, 2, 3, 6].map((n) => `<button type="button" class="variant-chip" data-pieces="${n}">${n} pc</button>`).join("")}
              ${[1, 2, 5].map((n) => `<button type="button" class="variant-chip" data-packs="${n}">${n === 1 ? "1" : n} pack${n === 1 ? "" : "s"} (${n * packSize})</button>`).join("")}
            </div>
          </div>
          <div class="weigh-total">
            <span class="weigh-total-label">Comes to</span>
            <strong class="weigh-total-amount" id="pack-total">${esc(T.money(price))}</strong>
            <small class="weigh-total-note" id="pack-note">1 pc × ${esc(T.money(price))}</small>
          </div>
          <div class="form-error" role="alert"></div>
          <div class="sheet-actions">
            <button class="btn btn-primary btn-block" type="submit">Add to the sale ${icon("i-check")}</button>
          </div>
        </form>`
    });

    const form = document.getElementById("pack-form");
    const input = form?.querySelector("#pack-pieces");
    const totalEl = document.getElementById("pack-total");
    const noteEl = document.getElementById("pack-note");

    const piecesFromInput = () => {
      const value = Number(input?.value);
      return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    };

    const paintTotal = () => {
      const pieces = piecesFromInput();
      if (totalEl) totalEl.textContent = T.money(Math.round(price * pieces));
      if (noteEl) noteEl.textContent = `${pieces} pc × ${T.money(price)} each`;
    };
    input?.addEventListener("input", paintTotal);
    paintTotal();

    form?.querySelectorAll("[data-pieces]").forEach((chip) => {
      chip.addEventListener("click", () => {
        if (!input) return;
        input.value = chip.dataset.pieces || "1";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });
    form?.querySelectorAll("[data-packs]").forEach((chip) => {
      chip.addEventListener("click", () => {
        if (!input) return;
        input.value = String(Math.max(1, Number(chip.dataset.packs) * packSize));
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });

    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const pieces = piecesFromInput();
      if (pieces <= 0) {
        setFormError(form, "Enter how many pieces you are selling.");
        return;
      }
      if (pieces > T.productStock(product)) {
        setFormError(form, `Only ${T.productStock(product)} in stock.`);
        return;
      }
      if (T.addToCart(product, pieces)) {
        T.confirmAdded(product, pieces);
        close(true);
        if (fromScan) T.scanner?.resume?.();
        window.render?.();
      }
    });
  }

  /* ---------- Wastage ---------- */

  /**
   * Record stock that left the shelf without a sale and show what has
   * already been written off lately.
   */
  function openWastage() {
    const products = [...T.state.products].sort((a, b) => a.name.localeCompare(b.name));
    const recent = (T.state.wastage || []).slice(0, 6);
    const defaultEmployee = String((T.activeStaff ? T.activeStaff() : "") || T.state.store?.staff || T.getSession?.()?.email?.split("@")[0] || "").trim();
    const reasons = T.WASTAGE_REASONS || ["Spoiled", "Damaged", "Expired", "Spilled", "Missing", "Other"];
    open({
      title: "Record wastage",
      subtitle: "Stock that spoiled, broke or went missing",
      iconName: "i-alert",
      focus: products.length ? "#wastage-product" : "",
      body: `${products.length ? `<form id="wastage-form" novalidate>
        <div class="field">
          <label for="wastage-product">Product</label>
          <select class="select" id="wastage-product" name="productId">
            ${products.map((product) => `<option value="${esc(product.id)}">${esc(product.name)}${product.detail ? ` · ${esc(product.detail)}` : ""}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="wastage-qty" id="wastage-qty-label">How many were wasted?</label>
          <input class="input" id="wastage-qty" name="qty" type="number" min="1" step="1" inputmode="numeric" value="1" required>
          <div class="variant-chips" id="wastage-chips" role="group" aria-label="Common quantities"></div>
        </div>
        <div class="field">
          <label>Why</label>
          <div class="chip-row" id="wastage-reasons" role="group" aria-label="Reason for the wastage">
            ${reasons.map((reason) => `<button type="button" class="chip ${reason === reasons[0] ? "is-active" : ""}" data-reason="${esc(reason)}">${esc(reason)}</button>`).join("")}
          </div>
        </div>
        <div class="field">
          <label for="wastage-employee">Recorded by <span class="field-optional">Optional</span></label>
          <input class="input" id="wastage-employee" name="employee" value="${esc(defaultEmployee)}" placeholder="Who is writing this off?" maxlength="60">
        </div>
        <div class="field">
          <label for="wastage-note">Note <span class="field-optional">Optional</span></label>
          <input class="input" id="wastage-note" name="note" placeholder="e.g. Power cut spoiled the milk" maxlength="140">
        </div>
        <div class="form-error" role="alert"></div>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-block" type="submit">${icon("i-check")} Record the wastage</button>
        </div>
      </form>` : `<div class="empty-state"><div class="empty-icon">${icon("i-box")}</div><h3>No products yet</h3><p>Add products to your inventory first, then wastage can be recorded against them.</p></div>`}
        ${recent.length ? `<div class="report-card-head" style="margin-top:16px"><h2>Latest wastage</h2></div>
        <div class="report-list">${recent.map((entry) => {
          const mass = entry.unit === "kg";
          const product = T.findProduct(entry.productId);
          const showQty = mass && product?.soldByMass ? T.massLabel(entry.qty) : `${entry.qty} ${esc(entry.unit)}`;
          return `<div class="report-row">
            <span class="report-row-copy"><strong>${esc(entry.name)}</strong><small>${esc(T.dayLabel(`${entry.date}T00:00:00`))} · ${esc(entry.reason)}${entry.employee ? ` · ${esc(entry.employee)}` : ""}${entry.note ? ` · ${esc(entry.note)}` : ""}</small></span>
            <span class="report-amount">${esc(showQty)}</span>
          </div>`;
        }).join("")}</div>` : ""}`
    });

    if (!products.length) return;
    const form = document.getElementById("wastage-form");
    const productSelect = form.querySelector("#wastage-product");
    const qtyInput = form.querySelector("#wastage-qty");
    const qtyLabel = form.querySelector("#wastage-qty-label");
    const chipsRow = form.querySelector("#wastage-chips");
    let reason = reasons[0];

    const paintProduct = () => {
      const product = T.findProduct(productSelect.value);
      const mass = product?.soldByMass === true;
      if (qtyLabel) qtyLabel.textContent = mass ? "How much was wasted (kg)?" : "How many were wasted?";
      if (qtyInput) {
        qtyInput.step = mass ? "0.001" : "1";
        qtyInput.min = mass ? "0.001" : "1";
        qtyInput.inputMode = mass ? "decimal" : "numeric";
        qtyInput.value = mass ? "0.5" : "1";
      }
      if (chipsRow) {
        chipsRow.innerHTML = mass
          ? [[100, "100 g"], [250, "250 g"], [500, "500 g"], [1000, "1 kg"]].map(([g, label]) => `<button type="button" class="variant-chip" data-grams="${g}">${label}</button>`).join("")
          : [1, 2, 6, 12].map((n) => `<button type="button" class="variant-chip" data-qty="${n}">${n}</button>`).join("");
      }
    };
    productSelect?.addEventListener("change", paintProduct);
    paintProduct();

    chipsRow?.addEventListener("click", (event) => {
      const chip = event.target.closest(".variant-chip");
      if (!chip || !qtyInput) return;
      if (chip.dataset.grams) {
        const grams = Number(chip.dataset.grams) || 1000;
        qtyInput.value = (grams / 1000).toFixed(3).replace(/\.?0+$/, "");
      } else {
        qtyInput.value = chip.dataset.qty;
      }
    });

    form.querySelector("#wastage-reasons")?.addEventListener("click", (event) => {
      const chip = event.target.closest(".chip");
      if (!chip) return;
      reason = chip.dataset.reason;
      form.querySelectorAll("#wastage-reasons .chip").forEach((btn) => btn.classList.toggle("is-active", btn === chip));
    });

    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const product = T.findProduct(String(data.get("productId") || ""));
      const mass = product?.soldByMass === true;
      const rawQty = Number(data.get("qty"));
      const qty = mass
        ? Math.round((Number.isFinite(rawQty) ? rawQty : 0) * 1000)
        : T.clampInt(data.get("qty"), 0, 1000000);
      const result = T.recordWastage(product?.id, {
        qty,
        reason,
        note: String(data.get("note") || ""),
        employee: String(data.get("employee") || "")
      });
      if (!result.ok) {
        setFormError(form, result.error || "Could not record that.");
        return;
      }
      close(true);
      T.toast(mass ? `Wastage recorded: ${T.massLabel(qty)} of ${product.name}` : `Wastage recorded: ${qty} ${product.name}`, "i-check");
      window.render?.();
    });
  }

  /* ---------- Monthly sales target ---------- */

  /** The sheet where the shop sets what the month should make. */
  function openTarget() {
    const now = new Date();
    const current = T.state.store?.target || {};
    const amount = Number(current.amountCents) > 0 ? (current.amountCents / 100).toFixed(0) : "";
    const month = Number.isFinite(Number(current.month)) && Number(current.month) >= 1 ? Number(current.month) : now.getMonth() + 1;
    const year = Number.isFinite(Number(current.year)) && Number(current.year) >= 2020 ? Number(current.year) : now.getFullYear();
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    open({
      title: "Monthly sales target",
      subtitle: "A goal to chase this month",
      iconName: "i-chart",
      focus: "#target-amount",
      body: `<form id="target-form" novalidate>
        <div class="field">
          <label for="target-amount">Target amount</label>
          <div class="input-affix"><input class="input" id="target-amount" name="amount" type="number" min="0" step="1" inputmode="numeric" value="${esc(amount)}" placeholder="e.g. 60000"><span class="affix">${esc(T.currencySymbol())}</span></div>
          <p class="field-help">The total the shop wants to sell for the whole month.</p>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="target-month">Month</label>
            <select class="select" id="target-month" name="month">
              ${monthNames.map((name, index) => `<option value="${index + 1}" ${month === index + 1 ? "selected" : ""}>${name}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="target-year">Year</label>
            <input class="input" id="target-year" name="year" type="number" min="2020" max="2100" step="1" inputmode="numeric" value="${esc(year)}">
          </div>
        </div>
        <div class="form-error" role="alert"></div>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-block" type="submit">${icon("i-check")} Save the target</button>
          ${Number(current.amountCents) > 0 ? `<button class="btn btn-ghost btn-block" type="button" id="target-clear">${icon("i-trash")} Remove the target</button>` : ""}
        </div>
      </form>`
    });

    const form = document.getElementById("target-form");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const cents = T.parsePriceToCents(String(data.get("amount") || "0"));
      const month = Number(data.get("month"));
      const year = Number(data.get("year"));
      if (!Number.isFinite(cents) || cents <= 0) {
        setFormError(form, "Enter an amount above zero.");
        return;
      }
      T.setTarget(cents, { month, year });
      close(true);
      const name = monthNames[(month || 1) - 1];
      T.toast(`Target set: ${T.money(cents)} for ${name} ${year}`, "i-check");
      window.render?.();
    });
    document.getElementById("target-clear")?.addEventListener("click", () => {
      T.setTarget(0);
      close(true);
      T.toast("Target removed", "i-check");
      window.render?.();
    });
  }

  /* ---------- Daily opening & closing stock ---------- */

  /** One day from the stock book, product by product. */
  function openStockDay(date) {
    const detail = T.stockDayDetail?.(date);
    if (!detail) return;
    const rows = detail.rows.map((row) => {
      const qtyText = (value) => row.mass ? T.massLabel(value) : `${value} ${esc(row.unit)}`;
      const moved = row.sold || row.wasted;
      return `<div class="report-row">
        <span class="report-row-copy"><strong>${esc(row.name)}</strong><small>${qtyText(row.opening)} → ${qtyText(row.closing)}${moved ? ` · sold ${row.mass ? T.massLabel(row.sold) : row.sold}${row.wasted ? ` · wasted ${row.mass ? T.massLabel(row.wasted) : row.wasted}` : ""}` : ""}</small></span>
        <span class="report-amount ${row.closing < row.opening ? "is-profit" : ""}">${row.closing === row.opening ? "same" : `${row.closing > row.opening ? "+" : "−"}${qtyText(Math.abs(row.closing - row.opening))}`}</span>
      </div>`;
    }).join("");
    const openedAt = detail.openingAt ? T.timeFmt.format(new Date(detail.openingAt)) : "";
    const closedAt = detail.closingAt ? T.timeFmt.format(new Date(detail.closingAt)) : "";
    open({
      title: "Stock on " + T.dayLabel(`${date}T00:00:00`),
      subtitle: `${detail.rows.length} ${detail.rows.length === 1 ? "product" : "products"} counted${openedAt ? ` · opened ${openedAt}` : ""}${closedAt ? ` · closed ${closedAt}` : ""}`,
      iconName: "i-box",
      body: rows
        ? `<div class="report-list">${rows}</div><p class="report-note">The opening count is taken at the first save of the day; the closing count is the last level seen that day.</p>`
        : `<div class="empty-state"><div class="empty-icon">${icon("i-box")}</div><h3>Nothing counted</h3><p>This day has no stock levels saved for it.</p></div>`
    });
  }


  /**
   * Pick an older day from the stock book. The compact stock-tab card shows
   * the latest day; this sheet is the way back through the older ones.
   */
  function openStockDays() {
    const days = T.stockDaysList ? T.stockDaysList() : [];
    if (!days.length) return;
    open({
      title: "Stock book",
      subtitle: "Opening and closing counts by day",
      iconName: "i-box",
      body: `<div class="report-list">${days.map((day) => {
        const openingCount = Object.keys(day.opening || {}).length;
        const closingCount = Object.keys(day.closing || day.latest || {}).length;
        const when = T.dayLabel(`${day.date}T00:00:00`);
        return `<button class="report-row report-row-btn" data-act="open-stock-day" data-value="${esc(day.date)}">
          <span class="report-rank">${icon("i-box")}</span>
          <span class="report-row-copy"><strong>${esc(when)}</strong><small>${openingCount} opening · ${closingCount} closing</small></span>
          <span class="chev">${icon("i-chevron")}</span>
        </button>`;
      }).join("")}</div>`
    });
  }


  T.sheets = {
    open, close, isOpen, openManual, manualError, openUnknown, openOutOfStock,
    openWeigh, openWastage, openTarget, openStockDay,
    openDiscount, setDiscountMode, discountError, openProductEditor, renderProductEditor,    readProductForm, productEditorError, openSaveInfo, confirm, runConfirm,
    openMiniScan, closeMiniScan,
    openQuickScan, refreshQuickScan,
    openCategoryEditor, categoryError, openExitPrompt, openAccount,
    openSupplierEditor, supplierError, openSupplierPayment, openSupplierBill,
    openDebtCheckout, openCustomerPayment, openDebtReminder, openSellSort,
    openStaffPicker,
    openStockDays,
    openStockIn, openMpesaCode, openSubscriptionPayment,
    openVariantPicker, openPackPicker,
    setFormError
  };
})();
