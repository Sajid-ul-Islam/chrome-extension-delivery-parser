/**
 * DEEN Delivery Parser - Popup Controller
 */

let currentRecords = [];
let currentMetrics = null;

document.addEventListener("DOMContentLoaded", async () => {
  initTabs();
  initActiveTabInfo();
  initActionHandlers();
  checkPendingStorage();
});

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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const urlEl = document.getElementById("current-url");
    if (tab && tab.url) {
      urlEl.textContent = tab.url;
      urlEl.title = tab.url;
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

  // Export buttons
  document.getElementById("btn-export-excel").addEventListener("click", () => {
    if (!currentRecords.length) return;
    const todayStr = new Date().toISOString().split("T")[0];
    exportToExcelXML(currentRecords, `deliveries_${todayStr}.xls`);
    showToast(`Exported ${currentRecords.length} records to Excel!`);
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
}

/**
 * Extract data from current tab
 */
async function handleExtractFromCurrentTab() {
  const btn = document.getElementById("btn-extract-tab");
  const origText = btn.innerHTML;
  btn.innerHTML = "<span>⏳ Scanning tab...</span>";
  btn.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      showToast("No accessible active tab found.");
      return;
    }

    // Try communicating with content script
    chrome.tabs.sendMessage(tab.id, { action: "extract_page_data" }, async (response) => {
      if (chrome.runtime.lastError || !response) {
        // Fallback: inject a quick script to extract innerText
        try {
          const injectionResults = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => document.body.innerText
          });

          if (injectionResults && injectionResults[0] && injectionResults[0].result) {
            const pageText = injectionResults[0].result;
            const parsed = parseDeliveryData(pageText);
            displayResults(parsed);
          } else {
            showToast("Could not read text from this tab.");
          }
        } catch (injectErr) {
          showToast("Cannot read this page due to browser security settings.");
        }
      } else {
        displayResults(response);
      }
    });
  } catch (err) {
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

  // Update KPIs
  document.getElementById("kpi-total").textContent = metrics.totalParcels;
  document.getElementById("kpi-paid").textContent = metrics.paidCount;
  document.getElementById("kpi-unpaid").textContent = metrics.unpaidCount;
  document.getElementById("kpi-cod").textContent = `৳${Math.round(metrics.totalCOD).toLocaleString()}`;
  document.getElementById("kpi-net").textContent = `৳${Math.round(metrics.netRevenue).toLocaleString()}`;

  // Populate Table
  renderTableRows(currentRecords);

  showToast(`Parsed ${currentRecords.length} records (${mode} mode)!`);
}

/**
 * Render table rows
 */
function renderTableRows(records) {
  const tbody = document.getElementById("table-body");
  tbody.innerHTML = "";

  for (let r of records) {
    const tr = document.createElement("tr");

    const pStatus = (r["Payment Status"] || "Unpaid").toLowerCase();
    const isPaid = pStatus === "paid";
    const statusPillClass = isPaid ? "status-paid" : "status-unpaid";

    tr.innerHTML = `
      <td><strong>${escapeHTML(r["Consignment ID"])}</strong></td>
      <td>${escapeHTML(r["Order ID"] || "-")}</td>
      <td title="${escapeHTML(r["Address"] || "")}">${escapeHTML(r["Recipient Name"] || "-")}</td>
      <td>${escapeHTML(r["Phone"] || "-")}</td>
      <td><span class="status-pill">${escapeHTML(r["Delivery Status"] || "Unknown")}</span></td>
      <td><strong>৳${Number(r["COD Amount"] || 0).toLocaleString()}</strong></td>
      <td><span class="status-pill ${statusPillClass}">${isPaid ? "Paid" : "Unpaid"}</span></td>
    `;

    tbody.appendChild(tr);
  }
}

/**
 * Search filter for table
 */
function filterTable(query) {
  if (!query || !query.trim()) {
    renderTableRows(currentRecords);
    return;
  }
  const q = query.toLowerCase().trim();
  const filtered = currentRecords.filter(r => {
    return (
      (r["Consignment ID"] && r["Consignment ID"].toLowerCase().includes(q)) ||
      (r["Order ID"] && r["Order ID"].toLowerCase().includes(q)) ||
      (r["Recipient Name"] && r["Recipient Name"].toLowerCase().includes(q)) ||
      (r["Phone"] && r["Phone"].includes(q)) ||
      (r["Delivery Status"] && r["Delivery Status"].toLowerCase().includes(q)) ||
      (r["Store"] && r["Store"].toLowerCase().includes(q))
    );
  });
  renderTableRows(filtered);
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
  currentMetrics = null;
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
