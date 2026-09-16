/**
 * DEEN Delivery Parser - In-Page Content Script
 * Injected on courier portals (e.g. merchant.pathao.com)
 */

(function () {
  let cachedParsed = null;
  let isExpanded = false;

  function initFloatingWidget() {
    if (document.getElementById("deen-floating-widget")) return;

    const container = document.createElement("div");
    container.id = "deen-floating-widget";
    document.body.appendChild(container);

    renderWidget(container);
  }

  function extractPageText() {
    const isConsignmentId = (s) => /[A-Z]{2}\d{6}[A-Z0-9]+/i.test(s);

    // 1. Check if user currently has text selected
    const selection = window.getSelection ? window.getSelection().toString().trim() : "";
    if (selection && isConsignmentId(selection)) {
      return selection.replace(/\t/g, "\n");
    }

    // 2. Scan all tables, table bodies, and order row containers
    const candidates = Array.from(document.querySelectorAll(
      "table, tbody, [class*='table'], [class*='order'], [class*='parcel'], .ant-table-body, .ant-table-content, [role='table'], [role='rowgroup'], main, [role='main']"
    ));
    for (const el of candidates) {
      const txt = el.innerText || "";
      if (isConsignmentId(txt)) {
        return txt.replace(/\t/g, "\n");
      }
    }

    // 3. Fallback to whole document body
    return (document.body ? document.body.innerText : "").replace(/\t/g, "\n");
  }

  function extractDOMRows() {
    const isConsId = (s) => /[A-Z]{2}\d{6}[A-Z0-9]+/i.test(s);
    const isPhone = (s) => /(?:(?:\+?880)|0)1[3-9]\d{8}/.test(s);

    const rows = Array.from(document.querySelectorAll("table tbody tr, .ant-table-tbody tr, tr[class*='row'], div[role='row']"));
    const parcelRows = rows.filter(r => isConsId(r.innerText || ""));
    if (parcelRows.length === 0) return null;

    const extracted = [];
    for (const row of parcelRows) {
      const cells = Array.from(row.querySelectorAll("td, [role='cell'], div[class*='cell']"));
      const cellTexts = cells.map(c => (c.innerText || "").trim());

      let consId = "";
      let type = "";
      const consCell = cellTexts.find(t => isConsId(t)) || "";
      if (consCell) {
        const m = consCell.match(/([A-Z]{2}\d{6}[A-Z0-9]+)/i);
        consId = m ? m[1] : "";
        if (/express/i.test(consCell)) type = "Express";
        else if (/normal/i.test(consCell)) type = "Normal";
      }

      let phone = "";
      let name = "";
      let address = "";
      const phoneCell = cellTexts.find(t => isPhone(t)) || "";
      if (phoneCell) {
        const pm = phoneCell.match(/(?:(?:\+?880)|0)1[3-9]\d{8}/);
        phone = pm ? pm[0] : "";
        const lines = phoneCell.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const nonPhone = lines.filter(l => !l.includes(phone));
        if (nonPhone.length > 0) name = nonPhone[0];
        if (nonPhone.length > 1) address = nonPhone.slice(1).join(", ");
      }

      let paymentStatus = "Unpaid";
      for (const t of cellTexts) {
        if (/^paid$/i.test(t) || (/\bpaid\b/i.test(t) && !/unpaid/i.test(t))) {
          paymentStatus = "Paid";
          break;
        }
      }

      let deliveryStatus = "";
      let statusUpdatedOn = "";
      for (const t of cellTexts) {
        if (/updated on/i.test(t) || /(At Delivery Hub|Delivered|In Transit|Returned|Hold|Pending|Cancelled)/i.test(t)) {
          const dm = t.match(/updated on\s*([^\n\r]+)/i);
          if (dm) statusUpdatedOn = dm[1].trim();
          deliveryStatus = t.replace(/updated on[^\n\r]*/i, "").trim().replace(/\n+/g, "; ");
          break;
        }
      }

      let cod = 0, charge = 0, discount = 0;
      for (const t of cellTexts) {
        if (t === consCell || t === phoneCell) continue;
        if (/updated on/i.test(t) || /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t)) continue;
        if (/(?:delivered|transit|hub|return|hold|pending|cancel)/i.test(t)) continue;

        const nums = Array.from(t.matchAll(/([\d,]+(?:\.\d+)?)/g))
          .map(m => parseFloat(m[1].replace(/,/g, "")))
          .filter(n => !isNaN(n) && n < 1000000);
        if (nums.length >= 3) {
          cod = nums[0]; charge = nums[1]; discount = nums[2]; break;
        } else if (nums.length === 2 && !nums.includes(Number(phone))) {
          cod = nums[0]; charge = nums[1]; break;
        } else if (nums.length === 1 && (t.toLowerCase().includes("cod") || nums[0] > 100) && !t.includes(phone)) {
          cod = nums[0];
        }
      }

      let orderId = "";
      let store = "";
      for (const t of cellTexts) {
        if (t === consCell || t === phoneCell) continue;
        if (!orderId && (/^ORD[-\d]+/i.test(t) || /^\d{4,8}$/.test(t))) {
          orderId = t;
        } else if (!store && /store|commerce|deen|outlet/i.test(t)) {
          store = t;
        }
      }

      extracted.push({
        "Consignment ID": consId,
        "Type": type,
        "Order ID": orderId,
        "Store": store,
        "Recipient Name": name,
        "Address": address,
        "Phone": phone,
        "Delivery Status": deliveryStatus,
        "Status Updated On": statusUpdatedOn,
        "COD Amount": cod,
        "Charge": charge,
        "Discount": discount,
        "Payment Status": paymentStatus,
        "Action": ""
      });
    }

    return extracted.length > 0 ? extracted : null;
  }

  function runParse() {
    const domRows = extractDOMRows();
    if (domRows && domRows.length > 0) {
      cachedParsed = {
        records: domRows,
        metrics: computeMetrics(domRows),
        mode: "DOM Table"
      };
      return cachedParsed;
    }

    const text = extractPageText();
    let res = parseDeliveryData(text);
    if (!res || !res.records || res.records.length === 0) {
      // Auto fallback to fuzzy if standard sequential tokens were not matched
      res = parseDeliveryData(text, true);
    }
    cachedParsed = res;
    return cachedParsed;
  }

  function renderWidget(container) {
    if (!isExpanded) {
      // Pill mode
      const result = cachedParsed || runParse();
      const count = result && result.records ? result.records.length : 0;

      container.innerHTML = `
        <div class="deen-pill-btn" id="deen-pill-toggle" title="Click to open DEEN Delivery Parser">
          <span>⚡ DEEN Parser</span>
          <span class="deen-badge">${count} Parcels</span>
        </div>
      `;

      const pill = container.querySelector("#deen-pill-toggle");
      if (pill) {
        pill.addEventListener("click", () => {
          isExpanded = true;
          renderWidget(container);
        });
      }
    } else {
      // Card mode
      const result = runParse();
      const { records, metrics } = result;

      container.innerHTML = `
        <div class="deen-card">
          <div class="deen-card-header">
            <div class="deen-title">
              <span>⚡ DEEN Delivery Parser</span>
              <span class="deen-badge">${records.length}</span>
            </div>
            <button class="deen-close-btn" id="deen-close-card" title="Minimize">✕</button>
          </div>

          <div class="deen-metrics-grid">
            <div class="deen-metric-box">
              <div class="deen-metric-label">Total Parcels</div>
              <div class="deen-metric-val">${metrics.totalParcels}</div>
            </div>
            <div class="deen-metric-box">
              <div class="deen-metric-label">Paid / Unpaid</div>
              <div class="deen-metric-val">${metrics.paidCount} / ${metrics.unpaidCount}</div>
            </div>
            <div class="deen-metric-box">
              <div class="deen-metric-label">Total COD</div>
              <div class="deen-metric-val green">৳${Math.round(metrics.totalCOD).toLocaleString()}</div>
            </div>
            <div class="deen-metric-box">
              <div class="deen-metric-label">Net Revenue</div>
              <div class="deen-metric-val blue">৳${Math.round(metrics.netRevenue).toLocaleString()}</div>
            </div>
          </div>

          <div class="deen-actions">
            <button class="deen-btn-primary" id="deen-btn-excel">
              <span>📥 Export to Excel (.xlsx)</span>
            </button>
            <div class="deen-btn-group">
              <button class="deen-btn-secondary" id="deen-btn-csv">
                <span>📄 CSV</span>
              </button>
              <button class="deen-btn-secondary" id="deen-btn-copy">
                <span>📋 Copy Table</span>
              </button>
            </div>
            <button class="deen-btn-secondary" id="deen-btn-refresh">
              <span>🔄 Scan Page Again</span>
            </button>
          </div>
        </div>
      `;

      container.querySelector("#deen-close-card").addEventListener("click", () => {
        isExpanded = false;
        renderWidget(container);
      });

      container.querySelector("#deen-btn-excel").addEventListener("click", () => {
        if (!records.length) {
          showToast("No parcels detected on this page!");
          return;
        }
        const todayStr = new Date().toISOString().split("T")[0];
        exportToXLSX(records, `pathao_deliveries_${todayStr}.xlsx`);
        showToast(`Exported ${records.length} parcels to Excel (.xlsx)!`);
      });

      container.querySelector("#deen-btn-csv").addEventListener("click", () => {
        if (!records.length) {
          showToast("No parcels detected on this page!");
          return;
        }
        const todayStr = new Date().toISOString().split("T")[0];
        exportToCSV(records, `pathao_deliveries_${todayStr}.csv`);
        showToast(`Exported ${records.length} parcels to CSV!`);
      });

      container.querySelector("#deen-btn-copy").addEventListener("click", () => {
        if (!records.length) {
          showToast("No parcels detected to copy!");
          return;
        }
        copyAsTSV(records);
        showToast(`Copied ${records.length} records to clipboard!`);
      });

      container.querySelector("#deen-btn-refresh").addEventListener("click", () => {
        runParse();
        renderWidget(container);
        showToast("Page rescanned!");
      });
    }
  }

  function copyAsTSV(records) {
    if (!records.length) return;
    const cols = Object.keys(records[0]);
    const lines = [cols.join("\t")];
    for (let r of records) {
      lines.push(cols.map(c => (r[c] !== undefined ? String(r[c]).replace(/[\t\n\r]/g, " ") : "")).join("\t"));
    }
    navigator.clipboard.writeText(lines.join("\n"));
  }

  function showToast(message) {
    const existing = document.querySelector(".deen-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "deen-toast";
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  // ==========================================
  // Pathao Recipient Details Auto-Fill System
  // ==========================================

  function setReactInputValue(inputEl, value, shouldBlur = false) {
    if (!inputEl) return false;

    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value"
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(inputEl, value);
    } else {
      inputEl.value = value;
    }

    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    inputEl.dispatchEvent(new Event("change", { bubbles: true }));
    if (shouldBlur) {
      inputEl.dispatchEvent(new Event("blur", { bubbles: true }));
    }
    return true;
  }

  function setReactTextareaValue(textareaEl, value, shouldBlur = false) {
    if (!textareaEl) return false;

    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, "value"
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(textareaEl, value);
    } else {
      textareaEl.value = value;
    }

    textareaEl.dispatchEvent(new Event("input", { bubbles: true }));
    textareaEl.dispatchEvent(new Event("change", { bubbles: true }));
    if (shouldBlur) {
      textareaEl.dispatchEvent(new Event("blur", { bubbles: true }));
    }
    return true;
  }

  /**
   * Input value with simulated typing keystrokes and keep focus so Pathao's customer popup appears
   */
  function triggerSearchPopup(inputEl, value) {
    if (!inputEl) return false;

    // 1. Focus & Click to ensure active state
    inputEl.focus();
    inputEl.click();

    // 2. Set native value (React/AntD compatible)
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value"
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(inputEl, value);
    } else {
      inputEl.value = value;
    }

    // 3. Dispatch InputEvent with data
    try {
      inputEl.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        data: value,
        inputType: "insertText"
      }));
    } catch (e) {
      // Fallback
    }
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));

    // 4. Dispatch Keyboard events (triggers Ant Design / React autocomplete lookup)
    const lastChar = value.slice(-1) || "0";
    inputEl.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: lastChar,
      code: "Digit" + lastChar
    }));
    inputEl.dispatchEvent(new KeyboardEvent("keyup", {
      bubbles: true,
      cancelable: true,
      key: lastChar,
      code: "Digit" + lastChar
    }));

    // 5. Dispatch change
    inputEl.dispatchEvent(new Event("change", { bubbles: true }));

    // 6. Keep input focused so popup remains open
    inputEl.focus();
    return true;
  }

  function findPathaoRecipientFields() {
    const fields = {
      phone: null,
      name: null,
      address: null,
      cod: null
    };

    // 1. Recipient Name / Customer Search input (Primary target for phone lookup)
    fields.name = document.querySelector(
      "input[id*='recipient_name'], input[name*='recipient_name'], input[id*='customer_name'], input[name*='customer_name'], input[placeholder*='Recipient Name' i], input[placeholder*='Customer Name' i], input[placeholder*='গ্রহীতার নাম' i], input[placeholder*='Search customer' i], input[placeholder*='Search by' i]"
    );

    // 2. Recipient Phone input
    fields.phone = document.querySelector(
      "input[id*='recipient_phone'], input[name*='recipient_phone'], input[id*='phone'], input[name*='phone'], input[placeholder*='01'], input[placeholder*='Phone' i], input[placeholder*='Mobile' i], input[placeholder*='ফোন' i]"
    );

    // 3. Address
    fields.address = document.querySelector(
      "textarea[id*='recipient_address'], textarea[name*='recipient_address'], textarea[id*='address'], textarea[name*='address'], textarea[placeholder*='address' i], textarea[placeholder*='ঠিকানা' i], input[id*='recipient_address']"
    );

    // 4. COD / Amount
    fields.cod = document.querySelector(
      "input[id*='amount_to_collect'], input[name*='amount_to_collect'], input[id*='cod'], input[name*='cod'], input[placeholder*='Amount' i], input[placeholder*='টাকা' i]"
    );

    // Fallback: Scan Ant Design / Bootstrap form items by label text
    if (!fields.name || !fields.phone) {
      const formItems = Array.from(document.querySelectorAll(".ant-form-item, .form-group, .form-item, div[class*='formItem'], div[class*='input-wrapper']"));
      for (const item of formItems) {
        const labelEl = item.querySelector("label, .ant-form-item-label, div[class*='label'], span[class*='label']");
        const labelText = (labelEl ? labelEl.innerText : item.innerText || "").toLowerCase();
        const input = item.querySelector("input");
        const textarea = item.querySelector("textarea");

        if (!fields.name && (labelText.includes("recipient name") || labelText.includes("গ্রহীতার নাম") || labelText.includes("customer name") || (labelText.includes("name") && !labelText.includes("store") && !labelText.includes("item")))) {
          if (input) fields.name = input;
        }
        if (!fields.phone && (labelText.includes("phone") || labelText.includes("mobile") || labelText.includes("ফোন") || labelText.includes("contact"))) {
          if (input) fields.phone = input;
        }
        if (!fields.address && (labelText.includes("address") || labelText.includes("ঠিকানা"))) {
          if (textarea) fields.address = textarea;
          else if (input) fields.address = input;
        }
        if (!fields.cod && (labelText.includes("collect") || labelText.includes("amount") || labelText.includes("cod"))) {
          if (input) fields.cod = input;
        }
      }
    }

    return fields;
  }

  function highlightField(el) {
    if (!el) return;
    el.classList.add("deen-highlight-pulse");
    setTimeout(() => {
      el.classList.remove("deen-highlight-pulse");
    }, 4000);
  }

  function autofillRecipientDetails(data) {
    if (!data || !data.phone) return false;

    const fields = findPathaoRecipientFields();
    if (!fields.name && !fields.phone) {
      return false;
    }

    // 1. Fill COD first if provided
    if (data.cod && fields.cod) {
      setReactInputValue(fields.cod, data.cod, false);
      highlightField(fields.cod);
    }

    // 2. Fill Phone field as well if a distinct phone field exists
    if (fields.phone && fields.phone !== fields.name) {
      setReactInputValue(fields.phone, data.phone, false);
      highlightField(fields.phone);
    }

    // 3. MAIN: Input phone number in Recipient Name (receptionise tanme) to trigger Pathao customer popup
    const targetSearchField = fields.name || fields.phone;
    if (targetSearchField) {
      triggerSearchPopup(targetSearchField, data.phone);
      highlightField(targetSearchField);
    }

    showToast(`⚡ Phone ${data.phone} entered in Recipient Name! Customer popup should now appear.`);
    return true;
  }

  /**
   * Periodically check for pending autofill data (with retries for dynamic SPA rendering)
   */
  function checkPendingAutofill(retryCount = 0) {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;

    chrome.storage.local.get(["pathao_autofill_data"], (res) => {
      if (res && res.pathao_autofill_data) {
        const item = res.pathao_autofill_data;
        // Only apply if copied within the last 15 minutes
        if (Date.now() - (item.timestamp || 0) < 15 * 60 * 1000) {
          const success = autofillRecipientDetails(item);
          if (!success && retryCount < 8) {
            setTimeout(() => checkPendingAutofill(retryCount + 1), 700);
          }
        }
      }
    });
  }

  // Listen for storage changes from WooCommerce
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && changes.pathao_autofill_data && changes.pathao_autofill_data.newValue) {
        // Try filling immediately, with retries if page is transitioning
        checkPendingAutofill(0);
      }
    });
  }

  // Listen for messages from extension background/popup
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "extract_page_data") {
        const result = runParse();
        sendResponse(result);
      } else if (request.action === "autofill_pathao_recipient") {
        const ok = autofillRecipientDetails(request.data);
        if (!ok) {
          checkPendingAutofill(0);
        }
        sendResponse({ success: ok });
      }
      return true;
    });
  }

  // Watch for page navigation / dynamic form loading in Pathao SPA
  if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // Check if recipient name input has newly appeared and is currently empty
        const nameField = document.querySelector(
          "input[id*='recipient_name'], input[name*='recipient_name'], input[placeholder*='Recipient Name' i], input[placeholder*='Customer Name' i]"
        );
        if (nameField && !nameField.value) {
          checkPendingAutofill(0);
        }
      }, 300);
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        if (document.body) observer.observe(document.body, { childList: true, subtree: true });
      });
    }
  }

  // Delay widget injection and check pending autofill slightly so the host page finishes rendering
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        setTimeout(initFloatingWidget, 800);
        setTimeout(() => checkPendingAutofill(0), 1000);
      });
    } else {
      setTimeout(initFloatingWidget, 800);
      setTimeout(() => checkPendingAutofill(0), 1000);
    }
  }
})();
