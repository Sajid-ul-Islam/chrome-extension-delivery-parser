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
    }, 2500);
  }

  // Listen for messages from extension popup
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "extract_page_data") {
        const result = runParse();
        sendResponse(result);
      }
      return true;
    });
  }

  // Delay widget injection slightly so the host page finishes rendering
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(initFloatingWidget, 800));
  } else {
    setTimeout(initFloatingWidget, 800);
  }
})();
