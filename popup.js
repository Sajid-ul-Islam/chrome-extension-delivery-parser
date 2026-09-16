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

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", async () => {
    initTabs();
    initActiveTabInfo();
    initActionHandlers();
    checkPendingStorage();
    initSyncTab();
  });
}

/**
 * Tab switching logic
 */
function initTabs() {
  const tabs = document.querySelectorAll(".nav-tab");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

      tab.classList.add("active");
      const targetId = tab.getAttribute("data-tab");
      const targetEl = document.getElementById(targetId);
      if (targetEl) targetEl.classList.add("active");
    });
  });
}

/**
 * Display active page URL
 */
async function initActiveTabInfo() {
  try {
    if (typeof chrome === "undefined" || !chrome.tabs) return;
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    }
    const urlEl = document.getElementById("current-url");
    if (tab && (tab.url || tab.title)) {
      const displayStr = tab.url || tab.title;
      urlEl.textContent = displayStr;
      urlEl.title = displayStr;
    } else {
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
              const cells = Array.from(row.querySelectorAll("td, th, [role='cell'], div[class*='cell']"));
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
  const { records, metrics, mode } = result;
  currentRecords = records || [];
  displayedRecords = currentRecords;
  currentMetrics = metrics;

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
      <td><code>${escapeHTML(r["Phone"] || "-")}</code></td>
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

    tbody.appendChild(tr);
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
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
                chrome.runtime.sendMessage({ action: "focus_or_open_pathao" }).catch(() => {});
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
          showToast("🗑️ Stored phone number removed!");
        });
      } else {
        updateSyncUI(null);
      }
    });
  }
}

