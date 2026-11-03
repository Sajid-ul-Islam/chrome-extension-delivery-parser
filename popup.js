/**
 * DEEN Delivery Parser - Popup Controller
 */

// Safely suppress disconnection errors if a tab lacks content script
if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    if (event && event.reason && event.reason.message && event.reason.message.includes("Could not establish connection")) {
      event.preventDefault();
    }
  });
}

let currentRecords = [];
let displayedRecords = [];
let currentMetrics = null;
let currentActivityFilter = "all";

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("DOMContentLoaded", async () => {
    initTabs();
    initActiveTabInfo();
    initActionHandlers();
    checkPendingStorage();
    initSyncTab();
    initQuickReplyTab();
    initAssistantTab();
    initWebMCPTab();
    initCredentialsManager();
    initWordPressConnectManager();
    initUpdateChecker();
  });
}

/**
 * Tab switching logic
 */
function initTabs() {
  const tabs = document.querySelectorAll(".nav-tab");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const targetId = tab.getAttribute("data-tab");

      // Compatibility handler for tab-paste trigger (e.g. from context menu)
      if (targetId === "tab-paste") {
        tabs.forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
        const currentTab = document.querySelector('.nav-tab[data-tab="tab-current"]');
        if (currentTab) currentTab.classList.add("active");
        const currentEl = document.getElementById("tab-current");
        if (currentEl) currentEl.classList.add("active");
        const pasteSub = document.querySelector('.delivery-sub-tab[data-sub="paste"]');
        if (pasteSub) pasteSub.click();
        return;
      }

      tabs.forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

      tab.classList.add("active");
      const targetEl = document.getElementById(targetId);
      if (targetEl) targetEl.classList.add("active");
    });
  });

  // Delivery mode sub-tabs: Active Page Extractor vs Paste Courier Text
  const deliverySubTabs = document.querySelectorAll(".delivery-sub-tab");
  const viewExtract = document.getElementById("view-extract");
  const viewPaste = document.getElementById("view-paste");

  if (deliverySubTabs && deliverySubTabs.length > 0) {
    deliverySubTabs.forEach(subTab => {
      subTab.addEventListener("click", () => {
        deliverySubTabs.forEach(t => t.classList.remove("active"));
        subTab.classList.add("active");
        const sub = subTab.getAttribute("data-sub");
        if (viewExtract) viewExtract.classList.toggle("hidden", sub !== "extract");
        if (viewPaste) viewPaste.classList.toggle("hidden", sub !== "paste");
      });
    });
  }
}

/**
 * Display active page URL with intelligent detection badges
 */
async function initActiveTabInfo() {
  try {
    if (typeof chrome === "undefined" || !chrome.tabs) return;
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    }
    const urlEl = document.getElementById("current-url");
    const extractBtn = document.getElementById("btn-extract-tab");
    if (tab && (tab.url || tab.title)) {
      const url = tab.url || "";
      let label = tab.url || tab.title;

      if (url.includes("merchant.pathao.com")) {
        label = "🟢 Pathao Merchant Orders Page Detected";
        if (extractBtn) extractBtn.classList.add("btn-highlight-ready");
      } else if (url.includes("wp-admin")) {
        try {
          const domain = new URL(url).hostname;
          label = `🟢 WooCommerce Orders Detected (${domain})`;
        } catch (e) {
          label = "🟢 WooCommerce Orders Page Detected";
        }
        if (extractBtn) extractBtn.classList.add("btn-highlight-ready");
      }

      if (urlEl) {
        urlEl.textContent = label;
        urlEl.title = tab.url || tab.title;
      }
    } else if (urlEl) {
      urlEl.textContent = "No active tab detected";
    }
  } catch (err) {
    console.error(err);
  }
}

/**
 * Set up button events
 */
function initActionHandlers() {
  // Extract from current tab
  document.getElementById("btn-extract-tab").addEventListener("click", handleExtractFromCurrentTab);

  // Paste & Parse
  document.getElementById("btn-parse-paste").addEventListener("click", handleParsePaste);
  document.getElementById("btn-clear-paste").addEventListener("click", () => {
    document.getElementById("raw-text-input").value = "";
    resetResults();
  });

  // Search input filter
  document.getElementById("search-input").addEventListener("input", (e) => {
    filterTable(e.target.value);
  });

  // Activity filter buttons (All, Unsent / Send with Pathao, Dispatched)
  document.querySelectorAll(".activity-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const filter = btn.getAttribute("data-filter");
      filterByActivity(filter);
    });
  });

  // Export buttons
  document.getElementById("btn-export-excel").addEventListener("click", () => {
    if (!currentRecords.length) return;
    const todayStr = new Date().toISOString().split("T")[0];
    exportToXLSX(currentRecords, `deliveries_${todayStr}.xlsx`);
    showToast(`Exported ${currentRecords.length} records to Excel (.xlsx)!`);
  });

  document.getElementById("btn-export-csv").addEventListener("click", () => {
    if (!currentRecords.length) return;
    const todayStr = new Date().toISOString().split("T")[0];
    exportToCSV(currentRecords, `deliveries_${todayStr}.csv`);
    showToast(`Exported ${currentRecords.length} records to CSV!`);
  });

  document.getElementById("btn-copy-table").addEventListener("click", () => {
    if (!currentRecords.length) return;
    copyTableToClipboard(currentRecords);
    showToast(`Copied ${currentRecords.length} rows to clipboard!`);
  });

  // Column-wise copy chips
  document.querySelectorAll(".btn-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const col = btn.getAttribute("data-col");
      if (col) copyColumn(col, btn);
    });
  });

  // Column-wise copy dropdown
  const selectCol = document.getElementById("select-copy-column");
  if (selectCol) {
    selectCol.addEventListener("change", (e) => {
      const col = e.target.value;
      if (col) {
        copyColumn(col, selectCol);
        selectCol.value = "";
      }
    });
  }

  // Clickable table headers for instant column copy
  document.querySelectorAll("th.copyable-th").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.getAttribute("data-col");
      if (col) copyColumn(col, th);
    });
  });
}

/**
 * Extract data from current tab (intelligent multi-strategy detection)
 */
async function handleExtractFromCurrentTab() {
  const btn = document.getElementById("btn-extract-tab");
  const origText = btn.innerHTML;
  btn.innerHTML = "<span>⏳ Scanning tab...</span>";
  btn.disabled = true;

  try {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    }
    if (!tab || !tab.id) {
      showToast("No accessible active tab found.");
      return;
    }

    // Check if the current tab is an internal browser page
    if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("about:") || tab.url.startsWith("chrome-extension://"))) {
      showToast("Cannot read internal browser pages. Switch to Pathao or courier tab.");
      return;
    }

    let parsedResult = null;

    // Strategy 1: Directly inspect and extract text from DOM table rows or text from the page
    try {
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const isConsId = (s) => /[A-Z]{2}\d{6}[A-Z0-9]+/i.test(s);
          const isWcOrder = (s) => /Preview\s*#\d+/i.test(s) || /Send with Pathao/i.test(s) || /#\d{3,8}\s+[a-zA-Z]/i.test(s);

          // 1. User selection
          const sel = window.getSelection ? window.getSelection().toString().trim() : "";
          if (sel && (isConsId(sel) || isWcOrder(sel))) return { text: sel.replace(/\t/g, "\n") };

          // 2. Check if table rows with consignment IDs OR WooCommerce order rows exist directly in DOM
          const rows = Array.from(document.querySelectorAll("table tbody tr, .ant-table-tbody tr, tr[class*='row'], div[role='row'], tr[id*='post-'], tr.type-shop_order"));
          const validRows = rows.filter(r => isConsId(r.innerText || "") || isWcOrder(r.innerText || "") || (r.id && r.id.startsWith("post-")));

          if (validRows.length > 0) {
            const rowTexts = validRows.map(row => {
              let cells = Array.from(row.querySelectorAll("td, th"));
              if (cells.length === 0) {
                cells = Array.from(row.querySelectorAll("[role='cell'], [role='gridcell']"));
              }
              if (cells.length === 0) {
                cells = Array.from(row.querySelectorAll("div[class*='cell']"));
              }
              if (cells.length > 0) {
                return cells.map(c => (c.innerText || "").trim()).filter(Boolean).join("\n");
              }
              return (row.innerText || "").trim();
            });
            return { text: rowTexts.join("\n---\n") };
          }

          // 3. Scan candidate tables/containers
          const candidates = Array.from(document.querySelectorAll(
            "table, tbody, [class*='table'], [class*='order'], [class*='parcel'], .ant-table-body, .ant-table-content, [role='table'], [role='rowgroup'], main, [role='main']"
          ));
          for (const el of candidates) {
            const txt = el.innerText || "";
            if (isConsId(txt) || isWcOrder(txt)) return { text: txt.replace(/\t/g, "\n") };
          }

          return { text: (document.body ? document.body.innerText : "").replace(/\t/g, "\n") };
        }
      });

      if (injectionResults && injectionResults[0] && injectionResults[0].result) {
        const resObj = injectionResults[0].result;
        if (resObj && resObj.text) {
          parsedResult = parseDeliveryData(resObj.text);
          if (!parsedResult || !parsedResult.records || parsedResult.records.length === 0) {
            parsedResult = parseDeliveryData(resObj.text, true);
          }
        }
      }
    } catch (injectErr) {
      console.warn("Direct DOM extraction error:", injectErr);
    }

    // Strategy 2: Fallback to messaging in-page content script if available
    if (!parsedResult || !parsedResult.records || parsedResult.records.length === 0) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: "extract_page_data" })
          .catch(() => null);
        if (response && response.records && response.records.length > 0) {
          parsedResult = response;
        } else if (response && response.rawText) {
          parsedResult = parseDeliveryData(response.rawText);
        }
      } catch (e) {
        parsedResult = null;
      }
    }

    if (parsedResult && parsedResult.records && parsedResult.records.length > 0) {
      displayResults(parsedResult);
    } else {
      showToast("No deliveries detected. Make sure the orders table is open or use Paste & Parse.");
    }
  } catch (err) {
    console.error("Tab extract error:", err);
    showToast("Error extracting tab data.");
  } finally {
    setTimeout(() => {
      btn.innerHTML = origText;
      btn.disabled = false;
    }, 400);
  }
}

/**
 * Parse pasted text
 */
function handleParsePaste() {
  const rawText = document.getElementById("raw-text-input").value;
  const forceFuzzy = document.getElementById("chk-force-fuzzy").checked;

  if (!rawText.trim()) {
    showToast("Please paste some delivery text first.");
    return;
  }

  const parsed = parseDeliveryData(rawText, forceFuzzy);
  displayResults(parsed);
}

/**
 * Display parsed results (KPIs and table)
 */
function displayResults(result) {
  if (!result) return;
  const records = result.records || [];
  currentRecords = records;
  displayedRecords = currentRecords;

  let metrics = result.metrics;
  if (!metrics || typeof metrics.totalParcels !== "number") {
    metrics = typeof computeMetrics === "function" ? computeMetrics(records) : {};
  }
  metrics.totalParcels = Number(metrics.totalParcels) || records.length;
  metrics.paidCount = Number(metrics.paidCount) || 0;
  metrics.unpaidCount = Number(metrics.unpaidCount) || 0;
  metrics.unsentCount = Number(metrics.unsentCount) || 0;
  metrics.dispatchedCount = Number(metrics.dispatchedCount) || 0;
  metrics.totalCOD = Number(metrics.totalCOD) || 0;
  metrics.netRevenue = Number(metrics.netRevenue) || 0;
  currentMetrics = metrics;
  if (typeof updateAssistantContextPill === "function") updateAssistantContextPill();

  const mode = result.mode || "standard";

  const emptyEl = document.getElementById("empty-state");
  const resultsEl = document.getElementById("results-container");

  if (!currentRecords.length) {
    emptyEl.classList.remove("hidden");
    resultsEl.classList.add("hidden");
    showToast("No delivery records detected in this text.");
    return;
  }

  emptyEl.classList.add("hidden");
  resultsEl.classList.remove("hidden");

  // WooCommerce Activity filter bar
  const activityFilterBar = document.getElementById("activity-filter-bar");
  const isWooCommerce = mode === "woocommerce" || (metrics.unsentCount > 0 && metrics.dispatchedCount >= 0);

  if (activityFilterBar) {
    if (isWooCommerce || metrics.unsentCount > 0) {
      activityFilterBar.classList.remove("hidden");
      const countAllEl = document.getElementById("filter-count-all");
      const countUnsentEl = document.getElementById("filter-count-unsent");
      const countDispatchedEl = document.getElementById("filter-count-dispatched");
      if (countAllEl) countAllEl.textContent = metrics.totalParcels;
      if (countUnsentEl) countUnsentEl.textContent = metrics.unsentCount;
      if (countDispatchedEl) countDispatchedEl.textContent = metrics.dispatchedCount;
    } else {
      activityFilterBar.classList.add("hidden");
    }
  }

  // Update KPIs
  if (isWooCommerce) {
    document.getElementById("kpi-title-total").textContent = "Total Orders";
    document.getElementById("kpi-total").textContent = metrics.totalParcels;

    document.getElementById("kpi-title-status").textContent = "⚡ Unsent Activity";
    document.getElementById("kpi-status-container").innerHTML = `<strong class="amber">${metrics.unsentCount} Unsent</strong>`;

    document.getElementById("kpi-title-cod").textContent = "Total Amount";
    document.getElementById("kpi-cod").textContent = `৳${Math.round(metrics.totalCOD).toLocaleString()}`;

    document.getElementById("kpi-title-net").textContent = "🚚 Dispatched";
    document.getElementById("kpi-net").textContent = `${metrics.dispatchedCount} Dispatched`;
  } else {
    document.getElementById("kpi-title-total").textContent = "Total Parcels";
    document.getElementById("kpi-total").textContent = metrics.totalParcels;

    document.getElementById("kpi-title-status").textContent = "Paid / Unpaid";
    document.getElementById("kpi-status-container").innerHTML = `<span id="kpi-paid">${metrics.paidCount}</span> / <span id="kpi-unpaid">${metrics.unpaidCount}</span>`;

    document.getElementById("kpi-title-cod").textContent = "Total COD";
    document.getElementById("kpi-cod").textContent = `৳${Math.round(metrics.totalCOD).toLocaleString()}`;

    document.getElementById("kpi-title-net").textContent = "Net Revenue";
    document.getElementById("kpi-net").textContent = `৳${Math.round(metrics.netRevenue).toLocaleString()}`;
  }

  currentActivityFilter = "all";
  document.querySelectorAll(".activity-filter-btn").forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-filter") === "all");
  });

  // Populate Table
  renderTableRows(currentRecords);

  const modeName = mode === "woocommerce" ? "WooCommerce" : mode;
  showToast(`Parsed ${currentRecords.length} records (${modeName} mode)!`);
}

/**
 * Render table rows
 */
function renderTableRows(records) {
  const tbody = document.getElementById("table-body");
  tbody.innerHTML = "";

  for (let r of records) {
    const tr = document.createElement("tr");

    const cons = (r["Consignment ID"] || "").toString();
    const isUnsent = /Send with Pathao|Unsent/i.test(cons) || /Send with Pathao/i.test(r["Delivery Status"] || "");
    if (isUnsent) {
      tr.classList.add("row-unsent");
    }

    const pStatus = (r["Payment Status"] || "Unpaid").toLowerCase();
    const isPaid = pStatus === "paid" || pStatus === "completed";
    const statusPillClass = isPaid ? "status-paid" : "status-unpaid";

    const isExchange = /exchange/i.test(r["Type"] || "") || /^(?:D|EX)\s*-\s*\d/i.test(r["Order ID"] || "");
    const typeClass = isExchange ? "badge-type badge-exchange" : "badge-type";
    const typeBadge = r["Type"] ? `<span class="${typeClass}">${escapeHTML(r["Type"])}</span>` : "";
    const updatedOn = r["Status Updated On"] ? `<div class="sub-date">${escapeHTML(r["Status Updated On"])}</div>` : "";
    const storeVal = r["Store"] ? escapeHTML(r["Store"]) : "-";
    const chargeVal = r["Charge"] ? `৳${Number(r["Charge"]).toLocaleString()}` : "৳0";
    const discountVal = r["Discount"] ? `৳${Number(r["Discount"]).toLocaleString()}` : "৳0";

    let consCellContent = "";
    if (isUnsent) {
      consCellContent = `
        <div class="cons-cell">
          <span class="badge-unsent">⚡ Send with Pathao</span>
          ${typeBadge}
        </div>
      `;
    } else {
      consCellContent = `
        <div class="cons-cell">
          <strong>${escapeHTML(r["Consignment ID"])}</strong>
          ${typeBadge}
        </div>
      `;
    }

    let delStatusBadge = "";
    if (isUnsent) {
      delStatusBadge = `<span class="badge-unsent">⚡ Action Needed</span>`;
    } else {
      delStatusBadge = `<span class="status-pill">${escapeHTML(r["Delivery Status"] || "Unknown")}</span>`;
    }

    tr.innerHTML = `
      <td>${consCellContent}</td>
      <td>${escapeHTML(r["Type"] || "Parcel")}</td>
      <td><strong>${escapeHTML(r["Order ID"] || "-")}</strong></td>
      <td title="${storeVal}">${storeVal}</td>
      <td title="${escapeHTML(r["Address"] || "")}"><strong>${escapeHTML(r["Recipient Name"] || "-")}</strong></td>
      <td><code class="clickable-phone" style="cursor: pointer; text-decoration: underline dotted; color: #38bdf8;" title="⚡ Click to check customer rating in Pathao">${escapeHTML(r["Phone"] || "-")}</code></td>
      <td title="${escapeHTML(r["Address"] || "")}" class="cell-address">${escapeHTML(r["Address"] || "-")}</td>
      <td>
        ${delStatusBadge}
        ${updatedOn}
      </td>
      <td><strong class="text-green">৳${Number(r["COD Amount"] || 0).toLocaleString()}</strong></td>
      <td>${chargeVal}</td>
      <td>${discountVal}</td>
      <td><span class="status-pill ${statusPillClass}">${escapeHTML(r["Payment Status"] || (isPaid ? "Paid" : "Unpaid"))}</span></td>
    `;

    const codePhone = tr.querySelector(".clickable-phone");
    if (codePhone && r["Phone"] && r["Phone"] !== "-") {
      codePhone.addEventListener("click", () => {
        checkCustomerPhoneInPopup(r["Phone"], {
          name: r["Recipient Name"],
          orderId: r["Order ID"],
          cod: r["COD Amount"],
          address: r["Address"]
        });
      });
    }

    const unsentBadge = tr.querySelector(".badge-unsent");
    if (unsentBadge && r["Phone"] && r["Phone"] !== "-") {
      unsentBadge.style.cursor = "pointer";
      unsentBadge.title = "⚡ Click to check & sync to Pathao";
      unsentBadge.addEventListener("click", () => {
        checkCustomerPhoneInPopup(r["Phone"], {
          name: r["Recipient Name"],
          orderId: r["Order ID"],
          cod: r["COD Amount"],
          address: r["Address"]
        });
      });
    }

    tbody.appendChild(tr);
  }
}

/**
 * Switch to Sync tab and trigger check for a given customer
 */
function checkCustomerPhoneInPopup(rawPhone, details = {}) {
  const syncTab = document.querySelector('.nav-tab[data-tab="tab-sync"]');
  if (syncTab) syncTab.click();

  const quickInput = document.getElementById("input-quick-phone");
  if (quickInput) {
    quickInput.value = rawPhone;
  }

  const payload = {
    phone: rawPhone,
    name: details.name || "",
    orderId: details.orderId || "",
    cod: details.cod || "",
    address: details.address || "",
    source: "popup_table_click",
    userTriggered: true,
    timestamp: Date.now()
  };

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ "pathao_autofill_data": payload });
  }

  const btnQuickCheck = document.getElementById("btn-quick-check");
  if (btnQuickCheck) {
    btnQuickCheck.click();
  }
}

/**
 * Filter records by unread/unsent activity (All / Unsent / Dispatched)
 */
function filterByActivity(filterType) {
  currentActivityFilter = filterType || "all";

  // Update button active state
  document.querySelectorAll(".activity-filter-btn").forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-filter") === currentActivityFilter);
  });

  applyFilters();
}

/**
 * Search filter for table
 */
function filterTable(query) {
  applyFilters();
}

/**
 * Combined activity filter + text search
 */
function applyFilters() {
  const query = (document.getElementById("search-input").value || "").trim().toLowerCase();

  displayedRecords = currentRecords.filter(r => {
    // 1. Activity filter check
    const cons = (r["Consignment ID"] || "").toString();
    const delStatus = (r["Delivery Status"] || "").toString();
    const isUnsent = /Send with Pathao|Unsent/i.test(cons) || /Send with Pathao|Unsent/i.test(delStatus);

    if (currentActivityFilter === "unsent" && !isUnsent) return false;
    if (currentActivityFilter === "dispatched" && (isUnsent || !cons)) return false;

    // 2. Search query check
    if (query) {
      const matches = (
        (r["Consignment ID"] && r["Consignment ID"].toLowerCase().includes(query)) ||
        (r["Order ID"] && r["Order ID"].toLowerCase().includes(query)) ||
        (r["Recipient Name"] && r["Recipient Name"].toLowerCase().includes(query)) ||
        (r["Phone"] && r["Phone"].includes(query)) ||
        (r["Address"] && r["Address"].toLowerCase().includes(query)) ||
        (r["Delivery Status"] && r["Delivery Status"].toLowerCase().includes(query)) ||
        (r["Store"] && r["Store"].toLowerCase().includes(query)) ||
        (r["Type"] && r["Type"].toLowerCase().includes(query))
      );
      if (!matches) return false;
    }

    return true;
  });

  renderTableRows(displayedRecords);
}

/**
 * Copy specific column (1-click column-wise copy)
 */
function copyColumn(colName, triggerEl) {
  const list = (displayedRecords && displayedRecords.length > 0) ? displayedRecords : currentRecords;
  if (!list || !list.length) {
    showToast("No delivery records to copy from.");
    return;
  }

  const values = list.map(r => {
    const val = r[colName];
    if (val === undefined || val === null) return "";
    return String(val).trim();
  });

  const text = values.join("\n");
  navigator.clipboard.writeText(text).then(() => {
    const filledCount = values.filter(v => v !== "").length;
    showToast(`📋 Copied ${filledCount} ${colName} values to clipboard!`);

    if (triggerEl) {
      triggerEl.classList.add("copied");
      const origText = triggerEl.innerHTML;
      if (triggerEl.classList.contains("btn-chip")) {
        triggerEl.innerHTML = "✓ Copied!";
      }
      setTimeout(() => {
        triggerEl.classList.remove("copied");
        if (triggerEl.classList.contains("btn-chip")) {
          triggerEl.innerHTML = origText;
        }
      }, 1200);
    }
  }).catch(err => {
    console.error("Clipboard copy error:", err);
    showToast("Failed to copy to clipboard.");
  });
}

/**
 * Copy table as TSV
 */
function copyTableToClipboard(records) {
  if (!records.length) return;
  const cols = [
    "Consignment ID", "Type", "Order ID", "Store", "Recipient Name",
    "Address", "Phone", "Delivery Status", "Status Updated On",
    "COD Amount", "Charge", "Discount", "Payment Status"
  ];
  const lines = [cols.join("\t")];
  for (let r of records) {
    lines.push(cols.map(c => (r[c] !== undefined ? String(r[c]).replace(/[\t\n\r]/g, " ") : "")).join("\t"));
  }
  navigator.clipboard.writeText(lines.join("\n"));
}

/**
 * Reset results display
 */
function resetResults() {
  currentRecords = [];
  displayedRecords = [];
  currentMetrics = null;
  currentActivityFilter = "all";
  const activityFilterBar = document.getElementById("activity-filter-bar");
  if (activityFilterBar) activityFilterBar.classList.add("hidden");
  document.getElementById("results-container").classList.add("hidden");
  document.getElementById("empty-state").classList.remove("hidden");
}

/**
 * Toast popup helper
 */
function showToast(msg) {
  const toast = document.getElementById("popup-toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  setTimeout(() => {
    toast.classList.add("hidden");
  }, 2400);
}

/**
 * Check storage for context menu selections
 */
function checkPendingStorage() {
  chrome.storage.local.get(["pending_parse_text"], (res) => {
    if (res && res.pending_parse_text) {
      // Switch to paste tab
      const pasteTab = document.querySelector('.nav-tab[data-tab="tab-paste"]');
      if (pasteTab) pasteTab.click();

      document.getElementById("raw-text-input").value = res.pending_parse_text;
      handleParsePaste();

      // Clear pending
      chrome.storage.local.remove(["pending_parse_text"]);
      chrome.action.setBadgeText({ text: "" });
    }
  });
}

function escapeHTML(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Initialize Pathao Sync Tab
 */
function initSyncTab() {
  const phoneEl = document.getElementById("sync-phone");
  const nameEl = document.getElementById("sync-name");
  const orderEl = document.getElementById("sync-order");
  const codEl = document.getElementById("sync-cod");
  const btnOpen = document.getElementById("btn-open-pathao-form");

  if (!phoneEl) return;

  function updateSyncUI(data) {
    if (!data || !data.phone) {
      phoneEl.textContent = "None yet";
      nameEl.textContent = "-";
      orderEl.textContent = "-";
      codEl.textContent = "-";
      return;
    }
    phoneEl.textContent = data.phone;
    nameEl.textContent = data.name || "Customer";
    orderEl.textContent = data.orderId ? `#${data.orderId}` : "-";
    codEl.textContent = data.cod ? `৳${Number(data.cod).toLocaleString()}` : "-";
  }

  // Load initial data from storage
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(["pathao_autofill_data"], (res) => {
      if (res && res.pathao_autofill_data) {
        updateSyncUI(res.pathao_autofill_data);
      }
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && changes.pathao_autofill_data) {
        updateSyncUI(changes.pathao_autofill_data.newValue);
      }
    });
  }

  if (btnOpen) {
    btnOpen.addEventListener("click", () => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(["pathao_autofill_data"], (res) => {
          if (res && res.pathao_autofill_data && res.pathao_autofill_data.phone) {
            const updated = {
              ...res.pathao_autofill_data,
              userTriggered: true,
              timestamp: Date.now()
            };
            chrome.storage.local.set({ "pathao_autofill_data": updated }, () => {
              if (chrome.runtime && chrome.runtime.sendMessage) {
                chrome.runtime.sendMessage({ action: "sync_to_pathao", data: updated, autoSwitch: true }).catch(() => {});
              }
            });
          } else {
            if (chrome.runtime && chrome.runtime.sendMessage) {
              chrome.runtime.sendMessage({ action: "focus_or_open_pathao" }).catch(() => {});
            }
          }
        });
      } else if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: "focus_or_open_pathao" }).catch(() => {});
      }
      showToast("Opening Pathao Create Delivery...");
    });
  }

  const btnClearSync = document.getElementById("btn-clear-pathao-sync");
  if (btnClearSync) {
    btnClearSync.addEventListener("click", () => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove(["pathao_autofill_data"], () => {
          updateSyncUI(null);
          if (ratingCardEl) ratingCardEl.classList.add("hidden");
          showToast("🗑️ Stored phone number removed!");
        });
      } else {
        updateSyncUI(null);
        if (ratingCardEl) ratingCardEl.classList.add("hidden");
      }
    });
  }

  // Quick manual phone check handler
  const quickInput = document.getElementById("input-quick-phone");
  const btnQuickCheck = document.getElementById("btn-quick-check");
  const ratingCardEl = document.getElementById("popup-rating-card");

  if (btnQuickCheck && quickInput) {
    const handleQuickCheck = () => {
      const raw = quickInput.value.trim();
      const BD_PHONE_REGEX = /(?:(?:\+?880)|880|0)?(1[3-9]\d{8})\b/;
      let phone = null;
      const match = raw.replace(/[^\d+]/g, "").match(BD_PHONE_REGEX);
      if (match && match[1]) {
        phone = "0" + match[1];
      } else {
        const only = raw.replace(/\D/g, "");
        if (only.length === 11 && /^01[3-9]\d{8}$/.test(only)) {
          phone = only;
        } else if (only.length === 13 && only.startsWith("8801")) {
          phone = only.slice(2);
        }
      }

      if (!phone) {
        showToast("⚠️ Please enter a valid 11-digit Bangladeshi number (e.g. 01712345678)");
        return;
      }

      // Sync phone to stored autofill data immediately so "Recent Synced Customer" updates right away
      const currentAutofill = {
        phone: phone,
        name: "",
        orderId: "",
        cod: "",
        address: "",
        source: "popup_quick_check",
        userTriggered: true,
        timestamp: Date.now()
      };
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ "pathao_autofill_data": currentAutofill });
      }
      updateSyncUI(currentAutofill);

      btnQuickCheck.disabled = true;
      btnQuickCheck.innerHTML = `<span class="pulse-indicator"></span> Checking...`;

      if (ratingCardEl) {
        ratingCardEl.classList.remove("hidden");
        ratingCardEl.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px; font-size: 12px; color: #94a3b8;">
            <span class="pulse-indicator"></span>
            <span>Checking courier rating for <strong>${phone}</strong> in Pathao & Steadfast...</span>
          </div>
        `;
      }

      let isFinished = false;
      const safetyTimer = setTimeout(() => {
        if (isFinished) return;
        isFinished = true;
        btnQuickCheck.disabled = false;
        btnQuickCheck.innerHTML = `<span>⚡ Check</span>`;
        if (ratingCardEl) {
          renderRatingCard({
            phone: phone,
            successRate: 100,
            totalParcels: 0,
            deliveredCount: 0,
            cancelledCount: 0,
            riskLevel: "low",
            riskLabel: "Customer Ready (Check Timeout)",
            riskColor: "#3b82f6",
            isNewCustomer: true,
            pathaoStatus: "token_missing"
          });
        }
      }, 5500);

      const renderRatingCard = (data) => {
        if (!ratingCardEl) return;
        const riskBadgeColor = data.riskColor || (data.riskLevel === "high" ? "#ef4444" : (data.riskLevel === "medium" ? "#f59e0b" : "#10b981"));

        ratingCardEl.innerHTML = `
          <div style="background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(99, 102, 241, 0.35); border-radius: 8px; padding: 12px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <span style="font-family: monospace; font-size: 14px; font-weight: 700; color: #38bdf8;">${data.phone}</span>
              <span style="background: ${data.riskLevel === 'high' ? 'rgba(239, 68, 68, 0.2)' : (data.riskLevel === 'medium' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(16, 185, 129, 0.2)')}; color: ${riskBadgeColor}; border: 1px solid ${riskBadgeColor}; border-radius: 9999px; padding: 2px 8px; font-size: 10.5px; font-weight: 700;">
                ${data.riskLabel}
              </span>
            </div>

            <div style="display: flex; align-items: baseline; gap: 6px; margin-bottom: 6px;">
              <span style="font-size: 26px; font-weight: 800; font-family: monospace; color: ${riskBadgeColor};">${data.successRate}%</span>
              <span style="font-size: 11px; color: #94a3b8;">Delivery Success Rate</span>
            </div>

            ${data.ratingGrade ? `
              <div style="font-size: 11px; font-weight: 700; color: #10b981; margin-bottom: 8px; display: flex; align-items: center; gap: 4px;">
                <span>⭐</span>
                <span>Pathao: ${data.ratingGrade}</span>
              </div>
            ` : ''}

            <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.1); border-radius: 9999px; overflow: hidden; margin-bottom: 10px;">
              <div style="width: ${data.successRate}%; height: 100%; background: ${riskBadgeColor}; border-radius: 9999px;"></div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; text-align: center; margin-bottom: 10px;">
              <div style="background: rgba(30, 41, 59, 0.6); padding: 6px; border-radius: 6px;">
                <div style="font-size: 9.5px; color: #94a3b8;">TOTAL</div>
                <div style="font-size: 14px; font-weight: 700; color: #fff;">${data.totalParcels}</div>
              </div>
              <div style="background: rgba(30, 41, 59, 0.6); padding: 6px; border-radius: 6px;">
                <div style="font-size: 9.5px; color: #94a3b8;">DELIVERED</div>
                <div style="font-size: 14px; font-weight: 700; color: #34d399;">${data.deliveredCount}</div>
              </div>
              <div style="background: rgba(30, 41, 59, 0.6); padding: 6px; border-radius: 6px;">
                <div style="font-size: 9.5px; color: #94a3b8;">CANCEL/RETURN</div>
                <div style="font-size: 14px; font-weight: 700; color: #f87171;">${data.cancelledCount}</div>
              </div>
            </div>

            <!-- Courier status chips -->
            <div style="display: flex; gap: 6px; margin-bottom: 10px;">
              <div style="flex: 1; display: flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 5px 8px; font-size: 11px; color: #cbd5e1;">
                <span style="width: 7px; height: 7px; border-radius: 50%; background: ${data.pathaoStatus === 'live' ? '#10b981' : (data.pathaoStatus === 'clean_record' ? '#3b82f6' : (data.pathaoStatus === 'token_missing' ? '#f59e0b' : '#64748b'))};"></span>
                <span>Pathao: <strong>${data.pathaoStats ? `${data.pathaoStats.delivered}/${data.pathaoStats.total}${data.ratingGrade ? ' • ' + data.ratingGrade : ''}` : (data.pathaoStatus === 'clean_record' ? '0 Orders' : (data.pathaoStatus === 'token_missing' ? 'Login Needed' : 'No Record'))}</strong></span>
              </div>
              <div style="flex: 1; display: flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 5px 8px; font-size: 11px; color: #cbd5e1;">
                <span style="width: 7px; height: 7px; border-radius: 50%; background: ${data.steadfastStatus === 'live' ? '#10b981' : '#64748b'};"></span>
                <span>Steadfast: <strong>${data.steadfastStats ? `${data.steadfastStats.delivered}/${data.steadfastStats.total}` : 'No Record'}</strong></span>
              </div>
            </div>

            ${data.pathaoStatus === 'token_missing' ? `
              <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 6px; padding: 6px 10px; font-size: 11px; color: #fbbf24; display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                <span>⚠️ Open Pathao in a tab to capture session</span>
                <button id="btn-popup-connect-pathao" style="background: #f59e0b; color: #000; border: none; border-radius: 4px; padding: 4px 8px; font-weight: 700; font-size: 10px; cursor: pointer; white-space: nowrap;">Open Pathao</button>
              </div>
            ` : ''}

            <button id="btn-popup-open-pathao-form" class="btn-primary-large" style="width: 100%; padding: 8px 12px; font-size: 12.5px; display: flex; align-items: center; justify-content: center; gap: 6px;">
              <span>🚀 Open Pathao Create & Autofill</span>
            </button>
          </div>
        `;

        const btnPopupConnect = document.getElementById("btn-popup-connect-pathao");
        if (btnPopupConnect) {
          btnPopupConnect.addEventListener("click", () => {
            chrome.runtime.sendMessage({ action: "focus_or_open_pathao" }).catch(() => {});
          });
        }

        const btnOpenPathaoForm = document.getElementById("btn-popup-open-pathao-form");
        if (btnOpenPathaoForm) {
          btnOpenPathaoForm.addEventListener("click", () => {
            const payload = {
              phone: data.phone,
              name: "",
              orderId: "",
              cod: "",
              address: "",
              source: "popup_quick_check",
              userTriggered: true,
              timestamp: Date.now()
            };
            chrome.storage.local.set({ "pathao_autofill_data": payload }, () => {
              chrome.runtime.sendMessage({ action: "sync_to_pathao", data: payload, autoSwitch: true }).catch(() => {});
            });
            showToast("Opening Pathao Create Form...");
          });
        }
      };

      // 1. Check local persistent cache first for instant display
      chrome.storage.local.get(["customer_rating_cache"], (stored) => {
        const cache = stored && stored.customer_rating_cache;
        const entry = cache && cache[phone];
        if (entry && entry.result && entry.timestamp && (Date.now() - entry.timestamp < 24 * 60 * 60 * 1000)) {
          clearTimeout(safetyTimer);
          if (isFinished) return;
          isFinished = true;
          btnQuickCheck.disabled = false;
          btnQuickCheck.innerHTML = `<span>⚡ Check</span>`;
          renderRatingCard(Object.assign({}, entry.result, { cached: true }));
          return;
        }

        // 2. Fetch fresh rating from background service worker if not in local cache
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            action: "fetch_customer_rating",
            phone: phone
          }, (res) => {
            clearTimeout(safetyTimer);
            if (isFinished) return;
            isFinished = true;
            btnQuickCheck.disabled = false;
            btnQuickCheck.innerHTML = `<span>⚡ Check</span>`;

            if (chrome.runtime.lastError) {
              void chrome.runtime.lastError.message;
            }

            const data = (res && res.success) ? res : {
              phone: phone,
              successRate: 100,
              totalParcels: 0,
              deliveredCount: 0,
              cancelledCount: 0,
              riskLevel: "low",
              riskLabel: "New Customer (No Returns Reported)",
              riskColor: "#3b82f6",
              isNewCustomer: true,
              pathaoStatus: "clean_record",
              steadfastStatus: "not_connected"
            };

            renderRatingCard(data);
          });
        } else {
          clearTimeout(safetyTimer);
          btnQuickCheck.disabled = false;
          btnQuickCheck.innerHTML = `<span>⚡ Check</span>`;
        }
      });
      return;
      if (false) {
        clearTimeout(safetyTimer);
        btnQuickCheck.disabled = false;
        btnQuickCheck.innerHTML = `<span>⚡ Check</span>`;
      }
    };

    btnQuickCheck.addEventListener("click", handleQuickCheck);
    quickInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleQuickCheck();
    });
  }
}

/**
 * Tab 4: WhatsApp Advance COD Quick Reply Controller
 */
function initQuickReplyTab() {
  const storeInput = document.getElementById("qr-store-name");
  const bkashInput = document.getElementById("qr-bkash-number");
  const bkashTypeSelect = document.getElementById("qr-bkash-type");
  const nagadInput = document.getElementById("qr-nagad-number");
  const nagadTypeSelect = document.getElementById("qr-nagad-type");
  const insideFeeInput = document.getElementById("qr-inside-fee");
  const outsideFeeInput = document.getElementById("qr-outside-fee");
  const btnSave = document.getElementById("btn-save-qr-config");
  const templateSelect = document.getElementById("qr-preview-template-select");
  const previewTextarea = document.getElementById("qr-preview-textarea");
  const btnCopyPreview = document.getElementById("btn-copy-qr-preview");

  if (!btnSave) return;

  const DEFAULT_CONFIG = {
    storeName: "DEEN Commerce",
    bkashNumber: "01XXXXXXXXX",
    bkashType: "Personal",
    nagadNumber: "",
    nagadType: "Personal",
    insideDhakaFee: 50,
    outsideDhakaFee: 90,
    customNote: ""
  };

  const getFormConfig = () => ({
    storeName: (storeInput && storeInput.value ? storeInput.value.trim() : "") || "DEEN Commerce",
    bkashNumber: (bkashInput && bkashInput.value ? bkashInput.value.trim() : ""),
    bkashType: (bkashTypeSelect && bkashTypeSelect.value) || "Personal",
    nagadNumber: (nagadInput && nagadInput.value ? nagadInput.value.trim() : ""),
    nagadType: (nagadTypeSelect && nagadTypeSelect.value) || "Personal",
    insideDhakaFee: Number(insideFeeInput && insideFeeInput.value) || 50,
    outsideDhakaFee: Number(outsideFeeInput && outsideFeeInput.value) || 90,
    customNote: ""
  });

  const updatePreview = () => {
    if (!previewTextarea) return;
    const currentCfg = getFormConfig();
    const selVal = templateSelect ? templateSelect.value : "advance_fee_out";

    let tplKey = "advance_fee";
    let isOut = true;
    let fee = currentCfg.outsideDhakaFee;

    if (selVal === "advance_fee_in") {
      tplKey = "advance_fee";
      isOut = false;
      fee = currentCfg.insideDhakaFee;
    } else if (selVal === "confirm_order") {
      tplKey = "confirm_order";
      fee = undefined;
    } else if (selVal === "high_risk_notice") {
      tplKey = "high_risk_notice";
      fee = currentCfg.outsideDhakaFee;
    } else if (selVal === "tracking_info") {
      tplKey = "tracking_info";
      fee = undefined;
    }

    let genReply = typeof generateQuickReply === "function" ? generateQuickReply : null;
    if (!genReply && typeof require !== "undefined") {
      try { genReply = require("./parser.js").generateQuickReply; } catch (e) {}
    }

    const sampleParams = {
      name: "রহিম আহমেদ",
      phone: "01712345678",
      orderId: "1055",
      cod: "1,850",
      fee: fee,
      isOutsideDhaka: isOut,
      trackingId: "DD240915ABC101"
    };

    if (genReply) {
      previewTextarea.value = genReply(tplKey, sampleParams, currentCfg);
    }
  };

  // 1. Load saved config
  const storageArea = (typeof chrome !== "undefined" && chrome.storage && (chrome.storage.sync || chrome.storage.local)) || null;
  if (storageArea) {
    storageArea.get(["deen_quick_reply_config"], (res) => {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.lastError) {
        void chrome.runtime.lastError.message;
      }
      const cfg = Object.assign({}, DEFAULT_CONFIG, (res && res.deen_quick_reply_config) || {});
      if (storeInput) storeInput.value = cfg.storeName || "";
      if (bkashInput) bkashInput.value = cfg.bkashNumber || "";
      if (bkashTypeSelect) bkashTypeSelect.value = cfg.bkashType || "Personal";
      if (nagadInput) nagadInput.value = cfg.nagadNumber || "";
      if (nagadTypeSelect) nagadTypeSelect.value = cfg.nagadType || "Personal";
      if (insideFeeInput) insideFeeInput.value = cfg.insideDhakaFee || 50;
      if (outsideFeeInput) outsideFeeInput.value = cfg.outsideDhakaFee || 90;
      updatePreview();
    });
  } else {
    updatePreview();
  }

  // 2. Event listeners for preview updating on typing
  [storeInput, bkashInput, bkashTypeSelect, nagadInput, nagadTypeSelect, insideFeeInput, outsideFeeInput].forEach(el => {
    if (el) {
      el.addEventListener("input", updatePreview);
      el.addEventListener("change", updatePreview);
    }
  });
  if (templateSelect) {
    templateSelect.addEventListener("change", updatePreview);
  }

  // 3. Save button handler
  btnSave.addEventListener("click", () => {
    const configToSave = getFormConfig();
    if (typeof chrome !== "undefined" && chrome.storage) {
      const syncStorage = chrome.storage.sync;
      const localStorage = chrome.storage.local;
      if (syncStorage) {
        syncStorage.set({ "deen_quick_reply_config": configToSave }, () => {
          if (chrome.runtime && chrome.runtime.lastError) void chrome.runtime.lastError.message;
        });
      }
      if (localStorage) {
        localStorage.set({ "deen_quick_reply_config": configToSave });
      }
    }
    showToast("✓ WhatsApp Quick Reply settings saved!");
    btnSave.innerHTML = "<span>✓ Saved Successfully!</span>";
    setTimeout(() => {
      if (btnSave) btnSave.innerHTML = "<span>💾 Save WhatsApp Settings</span>";
    }, 1500);
  });

  // 4. Copy preview button handler
  if (btnCopyPreview) {
    btnCopyPreview.addEventListener("click", () => {
      if (previewTextarea && previewTextarea.value && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(previewTextarea.value).then(() => {
          showToast("📋 Preview template copied to clipboard!");
          btnCopyPreview.textContent = "✓ Copied!";
          setTimeout(() => { if (btnCopyPreview) btnCopyPreview.textContent = "📋 Copy Preview"; }, 1500);
        });
      }
    });
  }
}

/**
 * -----------------------------------------------------------------------------
 * Tab 5: WebMCP AI Agent Tools Inspector & Live Runner
 * -----------------------------------------------------------------------------
 */
function initWebMCPTab() {
  const toolSelect = document.getElementById("webmcp-tool-select");
  const toolDesc = document.getElementById("webmcp-tool-desc");
  const argsInput = document.getElementById("webmcp-args-input");
  const btnExecute = document.getElementById("btn-execute-webmcp-tool");
  const outputJson = document.getElementById("webmcp-output-json");
  const execStatus = document.getElementById("webmcp-exec-status");

  if (!toolSelect) return;

  const sampleArgs = {
    check_customer_courier_rating: {
      phone: "01715485035",
      forceRefresh: false
    },
    normalize_bd_address: {
      rawAddress: "Home Benapole city,thana sharsha,jela jashore Division khulna Benapole"
    },
    build_full_address: {
      rawAddress: "House 12, Road 4, Mirpur 10, Dhaka 1216"
    },
    calculate_delivery_fee: {
      address: "Boalmari, Faridpur",
      isOutsideDhaka: true
    },
    generate_whatsapp_quick_reply: {
      templateKey: "advance_fee",
      phone: "01715485035",
      orderId: "18304",
      customerName: "Kazi Morshed",
      codAmount: 1590,
      isOutsideDhaka: true
    },
    get_woocommerce_active_orders: {
      limit: 10
    },
    ask_deen_ai_assistant: {
      query: "Summarize our delivery performance, uncollected COD, and high return risks",
      phone: "01715485035"
    },
    autofill_pathao_consignment: {
      phone: "01715485035",
      name: "Kazi Morshed",
      address: "Mirpur 10, Dhaka",
      cod: 1590,
      orderId: "18304",
      autoSwitch: false
    }
  };

  const updateToolDisplay = async () => {
    const selected = toolSelect.value;
    if (argsInput) {
      argsInput.value = JSON.stringify(sampleArgs[selected] || {}, null, 2);
    }
    const registry = (typeof window !== "undefined" && (window.modelContext || window.__webMCPRegistry));
    if (registry && typeof registry.getTools === "function") {
      try {
        const tools = await registry.getTools();
        const found = tools.find(t => t.name === selected);
        if (found && toolDesc) {
          const hintBadge = found.readOnlyHint
            ? '<span style="color:#10b981; font-weight:700;">[ReadOnly]</span>'
            : (found.consequentialHint ? '<span style="color:#f59e0b; font-weight:700;">[Consequential]</span>' : '');
          toolDesc.innerHTML = `${hintBadge} ${found.description}`;
        }
      } catch (e) {}
    }
  };

  toolSelect.addEventListener("change", updateToolDisplay);
  updateToolDisplay();

  if (btnExecute) {
    btnExecute.addEventListener("click", async () => {
      const selected = toolSelect.value;
      let parsedArgs = {};
      try {
        parsedArgs = JSON.parse(argsInput.value || "{}");
      } catch (jsonErr) {
        if (outputJson) outputJson.textContent = `❌ JSON Syntax Error:\n${jsonErr.message}`;
        if (execStatus) {
          execStatus.textContent = "Error";
          execStatus.style.color = "#ef4444";
        }
        return;
      }

      if (execStatus) {
        execStatus.textContent = "Executing...";
        execStatus.style.color = "#38bdf8";
      }

      const registry = (typeof window !== "undefined" && (window.modelContext || window.__webMCPRegistry));
      if (!registry || typeof registry.executeTool !== "function") {
        if (outputJson) outputJson.textContent = "❌ WebMCP Registry not found in current window context.";
        return;
      }

      try {
        const result = await registry.executeTool(selected, parsedArgs);
        if (outputJson) outputJson.textContent = JSON.stringify(result, null, 2);
        if (execStatus) {
          execStatus.textContent = "✓ Success";
          execStatus.style.color = "#10b981";
        }
        showToast(`⚡ WebMCP tool '${selected}' executed!`);
      } catch (execErr) {
        if (outputJson) outputJson.textContent = `❌ Execution Error:\n${execErr.message}`;
        if (execStatus) {
          execStatus.textContent = "Failed";
          execStatus.style.color = "#ef4444";
        }
      }
    });
  }
}

/**
 * Tab 3 Extension: Pathao API Credentials & Zero-Node .env Manager
 */
function initCredentialsManager() {
  const credClientId = document.getElementById("cred-client-id");
  const credClientSecret = document.getElementById("cred-client-secret");
  const credUsername = document.getElementById("cred-username");
  const credPassword = document.getElementById("cred-password");
  const credStatus = document.getElementById("cred-status-indicator");
  const btnLoadEnv = document.getElementById("btn-load-env-file");
  const btnSaveCred = document.getElementById("btn-save-credentials");
  const credFeedback = document.getElementById("cred-feedback-msg");

  if (!btnSaveCred) return;

  function setStatus(badgeText, isActive) {
    if (!credStatus) return;
    credStatus.textContent = badgeText;
    credStatus.className = `cred-status-badge ${isActive ? "active" : "missing"}`;
  }

  function showCredFeedback(msg, isError = false) {
    if (!credFeedback) return;
    credFeedback.textContent = msg;
    credFeedback.className = `cred-feedback ${isError ? "error" : ""}`;
    credFeedback.classList.remove("hidden");
    setTimeout(() => {
      if (credFeedback) credFeedback.classList.add("hidden");
    }, 5000);
  }

  // 1. Fetch current credentials info from background service worker
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: "get_api_credentials" }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res && res.success) {
        if (credClientId && res.clientId) credClientId.value = res.clientId;
        if (credUsername && res.username) credUsername.value = res.username;
        if (credClientSecret && res.hasSecret) credClientSecret.placeholder = "•••••••• (Configured)";
        if (credPassword && res.hasPassword) credPassword.placeholder = "•••••••• (Configured)";

        const hasFull = Boolean(res.clientId && (res.hasSecret || res.hasBearerToken));
        setStatus(hasFull ? "Active / Configured" : "Not Configured", hasFull);
      }
    });
  }

  // 2. Auto-load from .env file via fetch(chrome.runtime.getURL(".env"))
  if (btnLoadEnv) {
    btnLoadEnv.addEventListener("click", () => {
      const origText = btnLoadEnv.innerHTML;
      btnLoadEnv.innerHTML = `<span>⏳ Reading .env...</span>`;
      btnLoadEnv.disabled = true;

      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: "load_env_runtime" }, (res) => {
          btnLoadEnv.innerHTML = origText;
          btnLoadEnv.disabled = false;

          if (chrome.runtime.lastError) {
            showCredFeedback("❌ Failed to communicate with background engine", true);
            return;
          }

          if (res && res.hasCredentials) {
            if (credClientId && res.clientId) credClientId.value = res.clientId;
            if (credUsername && res.username) credUsername.value = res.username;
            setStatus("Active (.env)", true);
            showCredFeedback("✅ Loaded successfully from .env file directly!");
            showToast("✅ Loaded credentials from .env file!");
          } else {
            showCredFeedback("⚠️ No .env file or valid PATHAO_CLIENT_ID found in extension folder.", true);
            showToast("⚠️ Could not find valid credentials in .env");
          }
        });
      } else {
        btnLoadEnv.innerHTML = origText;
        btnLoadEnv.disabled = false;
      }
    });
  }

  // 3. Save & Apply user credentials
  btnSaveCred.addEventListener("click", () => {
    const clientId = credClientId ? credClientId.value.trim() : "";
    const clientSecret = credClientSecret ? credClientSecret.value.trim() : "";
    const username = credUsername ? credUsername.value.trim() : "";
    const password = credPassword ? credPassword.value.trim() : "";

    if (!clientId && !clientSecret && !username && !password) {
      showCredFeedback("⚠️ Please enter at least a Client ID or Secret", true);
      return;
    }

    const origText = btnSaveCred.innerHTML;
    btnSaveCred.innerHTML = `<span>⏳ Saving...</span>`;
    btnSaveCred.disabled = true;

    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        action: "save_api_credentials",
        credentials: { clientId, clientSecret, username, password }
      }, (res) => {
        btnSaveCred.innerHTML = origText;
        btnSaveCred.disabled = false;

        if (chrome.runtime.lastError) {
          showCredFeedback("❌ Error saving credentials", true);
          return;
        }

        if (res && res.success) {
          setStatus("Active / Configured", true);
          showCredFeedback("✅ Pathao API credentials saved & token cache refreshed!");
          showToast("💾 Credentials saved successfully!");
        } else {
          showCredFeedback("❌ Failed to save credentials: " + (res ? res.message : "Unknown error"), true);
        }
      });
    } else {
      btnSaveCred.innerHTML = origText;
      btnSaveCred.disabled = false;
    }
  });
}

/**
 * GitHub Auto-Update Checker for Extension
 */

/**
 * WordPress Admin Auto-Connect & Credentials SSO Manager
 * Allows 1-click auto-syncing from active WordPress sessions or direct WordPress credentials login.
 */
function initWordPressConnectManager() {
  const wpStatus = document.getElementById("wp-connection-badge");
  const wpSiteUrl = document.getElementById("wp-site-url");
  const btnDetectWp = document.getElementById("btn-detect-active-wp");
  const btnSyncWp = document.getElementById("btn-sync-from-wp");
  const btnOpenWpLogin = document.getElementById("btn-open-wp-login");
  const btnDisconnectWp = document.getElementById("btn-disconnect-wp");
  const wpFeedback = document.getElementById("wp-sync-feedback");

  const wpModeTabs = document.querySelectorAll(".wp-mode-tab");
  const wpSessionPanel = document.getElementById("wp-mode-session-panel");
  const wpLoginPanel = document.getElementById("wp-mode-login-panel");
  const wpLoginUser = document.getElementById("wp-login-username");
  const wpLoginPass = document.getElementById("wp-login-password");
  const btnSubmitWpLogin = document.getElementById("btn-submit-wp-login");

  const btnToggleManual = document.getElementById("btn-toggle-manual-cred");
  const manualContainer = document.getElementById("manual-cred-container");
  const manualArrow = document.getElementById("manual-toggle-arrow");

  // Profile Card Elements
  const profileCard = document.getElementById("wp-connected-profile");
  const profileAvatar = document.getElementById("wp-profile-avatar");
  const profileName = document.getElementById("wp-profile-name");
  const profileRole = document.getElementById("wp-profile-role");
  const profileSite = document.getElementById("wp-profile-site");
  const profilePerm = document.getElementById("wp-profile-perm");
  const profileTime = document.getElementById("wp-profile-time");
  const btnRecheckWp = document.getElementById("btn-recheck-wp");
  const btnDisconnectProfile = document.getElementById("btn-disconnect-profile");

  function renderAuthenticatedProfile(data) {
    if (!profileCard) return;
    if (data && (data.connected || data.isLoggedIn || data.loggedIn)) {
      profileCard.classList.remove("hidden");
      const user = data.adminUser || data.userLogin || "Store Admin";
      const login = data.userLogin ? `@${data.userLogin}` : "";
      const site = String(data.siteUrl || "deencommerce.com").replace(/^https?:\/\//, "").replace(/\/+$/, "");
      const role = data.userRole || (user.toLowerCase().includes("admin") ? "Administrator" : "Shop Manager");
      const perm = data.userPermissions || (role === "Administrator" ? "Full Store & Settings Access (manage_options, manage_woocommerce)" : "WooCommerce & Courier Dispatch Access (manage_woocommerce)");

      if (profileAvatar) profileAvatar.textContent = (user.trim()[0] || "A").toUpperCase();
      if (profileName) profileName.textContent = login ? `${user} (${login})` : user;
      if (profileRole) {
        profileRole.textContent = role === "Administrator" ? "🛡️ Administrator" : `🛒 ${role}`;
        profileRole.className = "wp-role-badge " + (role === "Administrator" ? "admin" : "shop-manager");
      }
      if (profileSite) profileSite.textContent = site;
      if (profilePerm) profilePerm.textContent = perm;
      if (profileTime) {
        const timeStr = data.syncedAt ? new Date(data.syncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Active";
        profileTime.textContent = `🟢 Session Active (${timeStr})`;
      }
    } else {
      profileCard.classList.add("hidden");
    }
  }

  if (btnRecheckWp) {
    btnRecheckWp.addEventListener("click", () => {
      if (btnSyncWp) btnSyncWp.click();
    });
  }

  if (btnDisconnectProfile) {
    btnDisconnectProfile.addEventListener("click", () => {
      if (btnDisconnectWp) btnDisconnectWp.click();
    });
  }

  function showWpFeedback(msg, isError = false) {
    if (!wpFeedback) return;
    wpFeedback.textContent = msg;
    wpFeedback.className = "wp-feedback" + (isError ? " error" : "");
    wpFeedback.classList.remove("hidden");
    setTimeout(() => {
      if (wpFeedback && !isError) wpFeedback.classList.add("hidden");
    }, 6000);
  }

  function updateWpBadge(connected, text, stateClass) {
    if (!wpStatus) return;
    wpStatus.textContent = text;
    wpStatus.className = "wp-status-badge " + stateClass;
    if (btnDisconnectWp) {
      btnDisconnectWp.classList.toggle("hidden", !connected);
    }
  }

  // 1. Tab Mode Switcher (Session vs Login)
  if (wpModeTabs && wpModeTabs.length > 0) {
    wpModeTabs.forEach(tab => {
      tab.addEventListener("click", () => {
        wpModeTabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        const mode = tab.getAttribute("data-wp-mode");
        if (wpSessionPanel) wpSessionPanel.classList.toggle("hidden", mode !== "session");
        if (wpLoginPanel) wpLoginPanel.classList.toggle("hidden", mode !== "login");
      });
    });
  }

  // 2. Load initial WordPress connection status
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: "get_wordpress_connection_status" }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res && res.connected) {
        const shortSite = String(res.siteUrl || "").replace(/^https?:\/\//, "");
        const userLabel = res.adminUser ? " (" + res.adminUser + ")" : "";
        updateWpBadge(true, "🟢 Connected: " + shortSite + userLabel, "active");
        if (wpSiteUrl && res.siteUrl) wpSiteUrl.value = res.siteUrl;
        renderAuthenticatedProfile(res);
      } else {
        updateWpBadge(false, "⚪ Not Connected", "missing");
        renderAuthenticatedProfile(null);
      }
    });
  }

  // 3. 1-Click Active Session Auto-Sync
  if (btnSyncWp) {
    btnSyncWp.addEventListener("click", () => {
      const siteUrl = (wpSiteUrl && wpSiteUrl.value.trim()) || "https://deencommerce.com";
      const origText = btnSyncWp.innerHTML;
      btnSyncWp.innerHTML = "<span>⏳ Probing WordPress...</span>";
      btnSyncWp.disabled = true;

      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: "sync_from_wordpress", siteUrl: siteUrl }, (res) => {
          btnSyncWp.innerHTML = origText;
          btnSyncWp.disabled = false;

          if (chrome.runtime.lastError) {
            showWpFeedback("❌ Communication error: " + chrome.runtime.lastError.message, true);
            return;
          }

          if (res && res.success && res.credentialsFound) {
            const shortSite = String(res.siteUrl || siteUrl).replace(/^https?:\/\//, "");
            updateWpBadge(true, "🟢 Connected: " + shortSite + " (" + (res.adminUser || "Admin") + ")", "active");
            showWpFeedback("✅ Successfully auto-synced Pathao & courier API keys from " + shortSite + "!");
            renderAuthenticatedProfile(res);
            showToast("✅ Auto-synced API keys from WordPress!");
            if (typeof initCredentialsManager === "function") {
              initCredentialsManager();
            }
          } else if (res && res.notLoggedIn) {
            updateWpBadge(false, "⚠️ Not Logged In", "missing");
            showWpFeedback("⚠️ Not logged in to " + siteUrl + ". Click '🔗 Open WP Admin' or switch to '🔐 Login with Credentials'.", true);
            showToast("⚠️ Please log in to WordPress first");
          } else if (res && res.noCredentialsFound) {
            updateWpBadge(true, "🟡 Connected (No Keys)", "checking");
            showWpFeedback("🟡 Connected as " + (res.adminUser || "Admin") + ", but no Pathao plugin settings found on " + siteUrl + ".", true);
          } else {
            showWpFeedback("❌ " + ((res && res.message) || "Failed to sync credentials from WordPress."), true);
          }
        });
      } else {
        btnSyncWp.innerHTML = origText;
        btnSyncWp.disabled = false;
      }
    });
  }

  // 4. Direct WordPress Credentials Login
  if (btnSubmitWpLogin) {
    btnSubmitWpLogin.addEventListener("click", () => {
      const username = wpLoginUser ? wpLoginUser.value.trim() : "";
      const password = wpLoginPass ? wpLoginPass.value.trim() : "";
      const storeUrl = (wpSiteUrl && wpSiteUrl.value.trim()) || "https://deencommerce.com";

      if (!username || !password) {
        showWpFeedback("⚠️ Please enter your WordPress username/email and password.", true);
        return;
      }

      const origText = btnSubmitWpLogin.innerHTML;
      btnSubmitWpLogin.innerHTML = "<span>⏳ Authenticating...</span>";
      btnSubmitWpLogin.disabled = true;

      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          action: "login_with_wordpress",
          username: username,
          password: password,
          storeUrl: storeUrl
        }, (res) => {
          btnSubmitWpLogin.innerHTML = origText;
          btnSubmitWpLogin.disabled = false;

          if (chrome.runtime.lastError) {
            showWpFeedback("❌ Communication error: " + chrome.runtime.lastError.message, true);
            return;
          }

          if (res && res.success) {
            const shortSite = String(res.siteUrl || storeUrl).replace(/^https?:\/\//, "");
            updateWpBadge(true, "🟢 Connected: " + shortSite + " (" + (res.adminUser || "Admin") + ")", "active");
            showWpFeedback("✅ " + (res.message || "Logged in and synced API credentials successfully!"));
            renderAuthenticatedProfile(res);
            showToast("✅ Authenticated with WordPress!");
            if (wpLoginPass) wpLoginPass.value = "";
            if (typeof initCredentialsManager === "function") {
              initCredentialsManager();
            }
            // Switch back to session mode
            const sessionTab = document.querySelector(".wp-mode-tab[data-wp-mode='session']");
            if (sessionTab) sessionTab.click();
          } else {
            const errMsg = (res && (res.error || res.message)) || "Invalid WordPress credentials.";
            showWpFeedback("❌ " + errMsg + " (Tip: You can also open WP Admin in a tab and use '⚡ 1-Click Active Session')", true);
            showToast("❌ " + (errMsg.length > 35 ? "WordPress authentication failed" : errMsg));
          }
        });
      } else {
        btnSubmitWpLogin.innerHTML = origText;
        btnSubmitWpLogin.disabled = false;
      }
    });
  }

  // 5. Open WordPress Login in Browser
  if (btnOpenWpLogin) {
    btnOpenWpLogin.addEventListener("click", () => {
      let storeUrl = (wpSiteUrl && wpSiteUrl.value.trim()) || "https://deencommerce.com";
      if (!storeUrl.startsWith("http://") && !storeUrl.startsWith("https://")) {
        storeUrl = "https://" + storeUrl;
      }
      storeUrl = storeUrl.replace(/\/+$/, "").replace(/\/wp-admin.*$/i, "");
      const loginUrl = storeUrl + "/wp-login.php?redirect_to=%2Fwp-admin%2F";

      if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: loginUrl });
      } else if (typeof window !== "undefined") {
        window.open(loginUrl, "_blank");
      }
      showWpFeedback("🔗 Opening WordPress admin login in a new tab. After signing in, return here and click 'Auto-Sync'!");
    });
  }

  // 6. Detect Store URL from active browser tab
  if (btnDetectWp) {
    btnDetectWp.addEventListener("click", async () => {
      try {
        if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query) {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab && tab.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
            const u = new URL(tab.url);
            if (wpSiteUrl) {
              wpSiteUrl.value = u.origin;
              showWpFeedback("🎯 Detected store URL from active tab: " + u.origin);
            }
            return;
          }
        }
        showWpFeedback("⚠️ Could not detect a valid web store in the active tab.", true);
      } catch (e) {
        showWpFeedback("⚠️ Failed to inspect active tab.", true);
      }
    });
  }

  // 7. Disconnect WordPress session
  if (btnDisconnectWp) {
    btnDisconnectWp.addEventListener("click", () => {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: "disconnect_wordpress" }, () => {
          updateWpBadge(false, "⚪ Disconnected", "missing");
          renderAuthenticatedProfile(null);
          showWpFeedback("WordPress session disconnected.");
          showToast("WordPress session disconnected");
        });
      }
    });
  }

  // 8. Toggle Manual Credentials Section
  if (btnToggleManual && manualContainer) {
    btnToggleManual.addEventListener("click", () => {
      const isCollapsed = manualContainer.classList.toggle("collapsed");
      if (manualArrow) {
        manualArrow.textContent = isCollapsed ? "▾" : "▴";
      }
    });
  }
}

function initUpdateChecker() {
  const banner = document.getElementById("github-update-banner");
  const commitBadge = document.getElementById("update-commit-badge");
  const commitMsg = document.getElementById("update-commit-msg");
  const btnDownload = document.getElementById("btn-download-update");
  const btnGitPull = document.getElementById("btn-copy-git-pull");
  const btnReload = document.getElementById("btn-reload-update");
  const btnDismiss = document.getElementById("btn-dismiss-update");
  const btnHeaderCheck = document.getElementById("btn-check-updates-header");

  let latestDownloadUrl = "https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/archive/refs/heads/main.zip";
  let latestCommitSha = "";

  function renderUpdate(info) {
    if (!info || !info.updateAvailable || info.isDismissed) {
      if (banner) banner.classList.add("hidden");
      return;
    }
    if (banner) banner.classList.remove("hidden");
    if (commitBadge) commitBadge.textContent = info.latestCommit || "NEW";
    if (commitMsg) {
      commitMsg.textContent = `${info.commitMessage || "New updates available"} (commit: ${info.latestCommit || "?"})`;
    }
    if (info.downloadUrl) {
      latestDownloadUrl = info.downloadUrl;
    }
    if (info.latestCommitFull) {
      latestCommitSha = info.latestCommitFull;
    }
  }

  function runCheck(force = false) {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) return;
    chrome.runtime.sendMessage({ action: "check_for_updates", force: force }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res && res.success) {
        if (force) {
          // If forced, always show banner even if previously dismissed
          res.isDismissed = false;
        }
        renderUpdate(res);
        if (force) {
          if (res.updateAvailable) {
            showToast(`🚀 New update available (${res.latestCommit})!`);
          } else {
            showToast(`✅ Extension is up-to-date (${res.currentCommit || "latest"})!`);
          }
        }
      }
    });
  }

  // Initial auto-check on popup open (uses 30m cache)
  runCheck(false);

  // Download ZIP button
  if (btnDownload) {
    btnDownload.addEventListener("click", () => {
      if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: latestDownloadUrl });
      } else {
        window.open(latestDownloadUrl, "_blank");
      }
      showToast("📥 Opening GitHub ZIP download...");
    });
  }

  // Copy git pull command button
  if (btnGitPull) {
    btnGitPull.addEventListener("click", () => {
      const cmd = "git pull origin main";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(cmd).then(() => {
          showToast("📋 Copied 'git pull origin main' to clipboard!");
          btnGitPull.innerHTML = "<span>✓ Copied!</span>";
          setTimeout(() => { if (btnGitPull) btnGitPull.innerHTML = "<span>📋 git pull</span>"; }, 2000);
        });
      }
    });
  }

  // Reload Extension button
  if (btnReload) {
    btnReload.addEventListener("click", () => {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        showToast("🔄 Reloading extension in memory...");
        chrome.runtime.sendMessage({ action: "reload_extension" });
      }
    });
  }

  // Dismiss button
  if (btnDismiss && banner) {
    btnDismiss.addEventListener("click", () => {
      banner.classList.add("hidden");
      if (latestCommitSha && typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: "dismiss_update", commit: latestCommitSha }).catch(() => {});
      }
    });
  }

  // Header "Check Updates" button
  if (btnHeaderCheck) {
    btnHeaderCheck.addEventListener("click", () => {
      showToast("🔍 Checking GitHub repository for updates...");
      runCheck(true);
    });
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    initQuickReplyTab,
    initWebMCPTab,
    initCredentialsManager,
    initWordPressConnectManager,
    initUpdateChecker
  };
}



/**
 * ============================================================================
 * DEEN AI Assistant Intelligence Tab Controller
 * Ported from DEEN Commerce Sales-Analysis Intelligence Copilot
 * ============================================================================
 */
function updateAssistantContextPill() {
  const summaryEl = document.getElementById("assistant-context-summary");
  if (!summaryEl) return;
  const count = (currentRecords && currentRecords.length) || 0;
  const cod = (currentMetrics && currentMetrics.totalCOD) || 0;
  summaryEl.textContent = `Telemetry: ${count} parcels (৳${cod.toLocaleString()} COD)`;
}

async function initAssistantTab() {
  const chatStream = document.getElementById("assistant-chat-stream");
  const userInput = document.getElementById("assistant-user-input");
  const sendBtn = document.getElementById("btn-assistant-send");
  const modeIndicator = document.getElementById("assistant-mode-indicator");
  const chipsScroll = document.getElementById("assistant-chips-scroll");
  const btnToggleByok = document.getElementById("btn-toggle-byok-modal");
  const btnCloseByok = document.getElementById("btn-close-byok-drawer");
  const byokDrawer = document.getElementById("assistant-byok-drawer");
  const byokStatusDot = document.getElementById("byok-status-dot");
  const providerSelect = document.getElementById("byok-provider-select");
  const apiKeyInput = document.getElementById("byok-api-key-input");
  const modelInput = document.getElementById("byok-model-input");
  const btnVis = document.getElementById("btn-byok-toggle-visibility");
  const btnTest = document.getElementById("btn-byok-test-connection");
  const btnSaveByok = document.getElementById("btn-byok-save");
  const testStatus = document.getElementById("byok-test-result");
  const btnClearHistory = document.getElementById("btn-clear-chat-history");

  if (!chatStream || !userInput) return;

  const assistant = (typeof window !== "undefined" && window.DeenAssistant) ||
                    (typeof globalThis !== "undefined" && globalThis.DeenAssistant);

  if (!assistant) {
    console.warn("DeenAssistant module not loaded");
    return;
  }

  function formatMarkdown(text) {
    if (!text) return "";
    let safe = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    safe = safe.replace(/```([a-z]*)\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>");
    safe = safe.replace(/`([^`]+)`/g, "<code>$1</code>");
    safe = safe.replace(/^### (.*$)/gim, "<strong>$1</strong><br/>");
    safe = safe.replace(/^## (.*$)/gim, "<strong>$1</strong><br/>");
    safe = safe.replace(/^# (.*$)/gim, "<strong>$1</strong><br/>");
    safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    safe = safe.replace(/^\s*-\s+(.*$)/gim, "• $1<br/>");
    safe = safe.replace(/\n\n/g, "<br/><br/>").replace(/\n/g, "<br/>");
    return safe;
  }

  function appendChatMessage(role, content, source) {
    const msgDiv = document.createElement("div");
    msgDiv.className = `chat-msg chat-msg-${role === "user" ? "user" : "bot"}`;

    if (role === "user") {
      msgDiv.innerHTML = `
        <div class="chat-avatar chat-avatar-user">👤</div>
        <div class="chat-bubble">
          <div class="chat-sender">You</div>
          <div class="chat-text">${formatMarkdown(content)}</div>
        </div>
      `;
    } else {
      const srcLabel = source ? `<span class="chat-tag">${source}</span>` : "";
      msgDiv.innerHTML = `
        <div class="chat-avatar">
          <img src="icons/icon32.png" alt="DEEN AI" />
        </div>
        <div class="chat-bubble">
          <div class="chat-sender">DEEN Assistant ${srcLabel}</div>
          <div class="chat-text">${formatMarkdown(content)}</div>
        </div>
      `;
    }

    chatStream.appendChild(msgDiv);
    chatStream.scrollTop = chatStream.scrollHeight;
    return msgDiv;
  }

  async function refreshBYOKUI() {
    const byok = await assistant.loadBYOKConfig();
    const hasKey = Boolean(byok.apiKey && byok.apiKey.trim().length > 5);

    if (providerSelect) providerSelect.value = byok.provider || "gemini";
    if (apiKeyInput) apiKeyInput.value = byok.apiKey || "";
    if (modelInput) modelInput.value = byok.model || "gemini-2.5-flash";

    if (byokStatusDot) {
      if (hasKey && byok.isActive) {
        byokStatusDot.className = "byok-dot byok-dot-on";
        byokStatusDot.title = `Active: ${byok.provider} (${byok.model})`;
      } else {
        byokStatusDot.className = "byok-dot byok-dot-off";
        byokStatusDot.title = "No custom API key active. Using In-Memory Deterministic Engine.";
      }
    }

    if (modeIndicator) {
      if (hasKey && byok.isActive) {
        modeIndicator.textContent = `Mode: ${byok.provider.toUpperCase()} (${byok.model})`;
        modeIndicator.style.color = "#10b981";
      } else {
        modeIndicator.textContent = "Mode: In-Memory Deterministic Engine (Zero-Cost)";
        modeIndicator.style.color = "#38bdf8";
      }
    }
  }

  await refreshBYOKUI();
  updateAssistantContextPill();

  const history = await assistant.loadChatHistory();
  if (history && history.length > 0) {
    chatStream.innerHTML = "";
    history.forEach(m => appendChatMessage(m.role, m.content, m.source));
  }

  async function handleSendMessage(queryText) {
    const text = (queryText || userInput.value || "").trim();
    if (!text) return;

    userInput.value = "";
    userInput.style.height = "auto";
    sendBtn.disabled = true;

    appendChatMessage("user", text);
    await assistant.saveChatMessage({ role: "user", content: text, timestamp: Date.now() });

    const typingDiv = document.createElement("div");
    typingDiv.className = "chat-msg chat-msg-bot";
    typingDiv.id = "assistant-typing-placeholder";
    typingDiv.innerHTML = `
      <div class="chat-avatar">
        <img src="icons/icon32.png" alt="DEEN AI" />
      </div>
      <div class="chat-bubble">
        <div class="chat-sender">DEEN Assistant <span class="chat-tag">Analyzing...</span></div>
        <div class="assistant-typing-indicator">
          <span class="assistant-typing-dot"></span>
          <span class="assistant-typing-dot"></span>
          <span class="assistant-typing-dot"></span>
        </div>
      </div>
    `;
    chatStream.appendChild(typingDiv);
    chatStream.scrollTop = chatStream.scrollHeight;

    try {
      const activePhone = (typeof lastCheckedPhone !== "undefined" && lastCheckedPhone) ? lastCheckedPhone : "";
      const reply = await assistant.generateDeenAssistantReply({
        query: text,
        records: currentRecords || [],
        metrics: currentMetrics || null,
        phone: activePhone
      });

      const p = document.getElementById("assistant-typing-placeholder");
      if (p) p.remove();

      appendChatMessage("assistant", reply.answer, reply.source);
      await assistant.saveChatMessage({
        role: "assistant",
        content: reply.answer,
        source: reply.source,
        timestamp: Date.now()
      });
    } catch (err) {
      const p = document.getElementById("assistant-typing-placeholder");
      if (p) p.remove();
      appendChatMessage("assistant", `⚠️ An error occurred while generating response: ${err.message}`, "error");
    } finally {
      sendBtn.disabled = false;
      userInput.focus();
    }
  }

  sendBtn.addEventListener("click", () => handleSendMessage());
  userInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });

  userInput.addEventListener("input", () => {
    userInput.style.height = "auto";
    userInput.style.height = Math.min(80, userInput.scrollHeight) + "px";
  });

  if (chipsScroll) {
    chipsScroll.querySelectorAll(".assistant-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const prompt = chip.getAttribute("data-prompt");
        if (prompt) handleSendMessage(prompt);
      });
    });
  }

  if (btnClearHistory) {
    btnClearHistory.addEventListener("click", async () => {
      if (confirm("Clear DEEN Assistant conversation history?")) {
        await assistant.clearChatHistory();
        chatStream.innerHTML = `
          <div class="chat-msg chat-msg-bot">
            <div class="chat-avatar">
              <img src="icons/icon32.png" alt="DEEN AI" />
            </div>
            <div class="chat-bubble">
              <div class="chat-sender">DEEN Assistant <span class="chat-tag">Executive Intelligence</span></div>
              <div class="chat-text">
                History cleared. How can I assist you with your courier parcels, COD, or sales analytics today?
              </div>
            </div>
          </div>
        `;
      }
    });
  }

  if (btnToggleByok && byokDrawer) {
    btnToggleByok.addEventListener("click", () => {
      byokDrawer.classList.toggle("hidden");
    });
  }

  if (btnCloseByok && byokDrawer) {
    btnCloseByok.addEventListener("click", () => {
      byokDrawer.classList.add("hidden");
    });
  }

  if (btnVis && apiKeyInput) {
    btnVis.addEventListener("click", () => {
      apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
      btnVis.textContent = apiKeyInput.type === "password" ? "👁️" : "🔒";
    });
  }

  if (providerSelect && modelInput) {
    providerSelect.addEventListener("change", () => {
      if (providerSelect.value === "gemini") {
        modelInput.value = "gemini-2.5-flash";
      } else if (providerSelect.value === "openai") {
        modelInput.value = "gpt-4o-mini";
      } else if (providerSelect.value === "groq") {
        modelInput.value = "llama-3.3-70b-versatile";
      }
    });
  }

  if (btnTest && testStatus) {
    btnTest.addEventListener("click", async () => {
      testStatus.classList.remove("hidden", "byok-test-success", "byok-test-error");
      testStatus.textContent = "⏳ Testing API connection...";

      const res = await assistant.testBYOKConnection({
        provider: providerSelect.value,
        apiKey: apiKeyInput.value.trim(),
        model: modelInput.value.trim()
      });

      if (res.success) {
        testStatus.classList.add("byok-test-success");
        testStatus.textContent = `✅ Connection verified! (${res.provider} / ${res.model})`;
      } else {
        testStatus.classList.add("byok-test-error");
        testStatus.textContent = `❌ ${res.error}`;
      }
    });
  }

  if (btnSaveByok) {
    btnSaveByok.addEventListener("click", async () => {
      const apiKey = apiKeyInput.value.trim();
      const updated = await assistant.saveBYOKConfig({
        provider: providerSelect.value,
        apiKey: apiKey,
        model: modelInput.value.trim(),
        isActive: Boolean(apiKey.length > 0)
      });

      await refreshBYOKUI();
      if (byokDrawer) byokDrawer.classList.add("hidden");
      if (typeof showToast === "function") {
        showToast(updated.isActive ? "🔑 AI key saved & activated!" : "ℹ️ AI key cleared. Using in-memory engine.");
      }
    });
  }
}
