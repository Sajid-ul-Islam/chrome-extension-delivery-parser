/**
 * DEEN Delivery Parser - Popup Controller
 */

let currentRecords = [];
let currentMetrics = null;

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

    // Strategy 1: Directly inspect and extract structured DOM table rows or text from the page
    try {
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const isConsId = (s) => /[A-Z]{2}\d{6}[A-Z0-9]+/i.test(s);
          const isPhone = (s) => /(?:(?:\+?880)|0)1[3-9]\d{8}/.test(s);

          // 1. Check if table rows with consignment IDs exist directly in DOM
          const rows = Array.from(document.querySelectorAll("table tbody tr, .ant-table-tbody tr, tr[class*='row'], div[role='row']"));
          const parcelRows = rows.filter(r => isConsId(r.innerText || ""));

          if (parcelRows.length > 0) {
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

            if (extracted.length > 0) {
              return { mode: "structured", records: extracted };
            }
          }

          // 2. User selection
          const sel = window.getSelection ? window.getSelection().toString().trim() : "";
          if (sel && isConsId(sel)) return { mode: "text", text: sel.replace(/\t/g, "\n") };

          // 3. Scan candidate tables/containers
          const candidates = Array.from(document.querySelectorAll(
            "table, tbody, [class*='table'], [class*='order'], [class*='parcel'], .ant-table-body, .ant-table-content, [role='table'], [role='rowgroup'], main, [role='main']"
          ));
          for (const el of candidates) {
            const txt = el.innerText || "";
            if (isConsId(txt)) return { mode: "text", text: txt.replace(/\t/g, "\n") };
          }

          return { mode: "text", text: (document.body ? document.body.innerText : "").replace(/\t/g, "\n") };
        }
      });

      if (injectionResults && injectionResults[0] && injectionResults[0].result) {
        const resObj = injectionResults[0].result;
        if (resObj.mode === "structured" && resObj.records && resObj.records.length > 0) {
          parsedResult = {
            records: resObj.records,
            metrics: computeMetrics(resObj.records),
            mode: "DOM Table"
          };
        } else if (resObj.mode === "text" && resObj.text) {
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
        parsedResult = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tab.id, { action: "extract_page_data" }, (response) => {
            if (chrome.runtime.lastError || !response || !response.records || response.records.length === 0) {
              resolve(null);
            } else {
              resolve(response);
            }
          });
        });
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
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: "focus_or_open_pathao" });
        showToast("Opening Pathao Create Delivery...");
      }
    });
  }
}

