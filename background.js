/**
 * DEEN Delivery Parser - Background Service Worker (Manifest V3)
 */

if (typeof chrome !== "undefined" && chrome.runtime) {
  function safeCreateContextMenu(options) {
    try {
      chrome.contextMenus.create(options, () => {
        if (chrome.runtime.lastError) {
          // Explicitly evaluate .message so Chromium marks lastError as handled
          void chrome.runtime.lastError.message;
        }
      });
    } catch (e) {
      // Synchronous catch guard
    }
  }

  function setupContextMenus() {
    if (!chrome.contextMenus) return;
    chrome.contextMenus.removeAll(() => {
      if (chrome.runtime.lastError) {
        void chrome.runtime.lastError.message;
      }

      safeCreateContextMenu({
        id: "deen-send-to-pathao",
        title: "⚡ Detect Customer in Pathao: %s",
        contexts: ["selection"]
      });

      safeCreateContextMenu({
        id: "deen-parse-selection",
        title: "🧩 Parse Courier Records with DEEN Parser",
        contexts: ["selection"]
      });

      safeCreateContextMenu({
        id: "deen-open-sidepanel",
        title: "📌 Open DEEN Rating Side Panel",
        contexts: ["all"]
      });
    });
  }

  chrome.runtime.onInstalled.addListener(() => {
    console.log("DEEN Delivery Parser Extension Installed.");
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove(["pathao_autofill_data"]);
    }
    if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
    }
    setupContextMenus();
  });

  // Purge any stuck autofill data immediately on service worker start / reload
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.remove(["pathao_autofill_data"]);
  }

  // Handle context menu clicks
  if (chrome.contextMenus) {
    chrome.contextMenus.onClicked.addListener((info, tab) => {
      if (info.menuItemId === "deen-parse-selection" && info.selectionText) {
        chrome.storage.local.set({
          "pending_parse_text": info.selectionText,
          "pending_parse_source": "selection"
        }, () => {
          chrome.action.setBadgeText({ text: "NEW", tabId: tab ? tab.id : undefined });
          chrome.action.setBadgeBackgroundColor({ color: "#2563EB" });
        });
      } else if (info.menuItemId === "deen-send-to-pathao" && info.selectionText) {
        const raw = info.selectionText.trim();
        const digits = raw.replace(/[^\d+]/g, "");
        const match = digits.match(/(?:(?:\+?880)|880|0)?(1[3-9]\d{8})\b/);
        let phone = raw.replace(/\D/g, "");
        if (match && match[1]) {
          phone = "0" + match[1];
        } else if (phone.length >= 11) {
          phone = phone.slice(-11);
        }

        const payload = {
          phone: phone,
          name: "",
          address: "",
          cod: "",
          orderId: "",
          source: "contextMenu",
          userTriggered: true,
          timestamp: Date.now()
        };

        // Display immediate desktop notification
        if (chrome.notifications) {
          chrome.notifications.create({
            type: "basic",
            iconUrl: "icons/icon48.png",
            title: "DEEN Delivery Parser",
            message: `⚡ Triggering Pathao for ${phone}... Opening customer result.`,
            priority: 2
          });
        }

        chrome.storage.local.set({ "pathao_autofill_data": payload }, () => {
          findAndSyncPathaoTab(payload, true);
        });
      } else if (info.menuItemId === "deen-open-sidepanel") {
        if (chrome.sidePanel && typeof chrome.sidePanel.open === "function") {
          if (tab && tab.id) {
            chrome.sidePanel.open({ tabId: tab.id }).catch(() => {
              if (tab.windowId) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
            });
          }
        }
      }
    });
  }

  // Handle messages from content scripts or popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.action === "sync_to_pathao") {
      if (request.data && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ "pathao_autofill_data": request.data }, () => {
          findAndSyncPathaoTab(request.data, request.autoSwitch);
        });
      } else {
        findAndSyncPathaoTab(request.data, request.autoSwitch);
      }
      sendResponse({ status: "sync_dispatched" });
    } else if (request && request.action === "focus_or_open_pathao") {
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(["pathao_autofill_data"], (res) => {
          if (res && res.pathao_autofill_data && res.pathao_autofill_data.phone) {
            findAndSyncPathaoTab(res.pathao_autofill_data, true);
          } else {
            focusOrOpenPathao();
          }
        });
      } else {
        focusOrOpenPathao();
      }
      sendResponse({ status: "handled" });
    } else if (request && request.action === "fetch_customer_rating" && request.phone) {
      handleCustomerRatingRequest(request.phone, sendResponse);
      return true; // Keep message channel open for async response
    } else {
      sendResponse({ status: "ignored" });
    }
    return false;
  });
}

/**
 * Handle background customer rating & courier intelligence lookup
 */
/**
 * Helper to get Pathao token from local storage or Chrome cookies
 */
async function getPathaoToken() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      const store = await new Promise(r => chrome.storage.local.get(["pathao_merchant_token"], r));
      if (store && store.pathao_merchant_token && store.pathao_merchant_token.length > 20) {
        return store.pathao_merchant_token;
      }
    } catch (e) {}
  }

  // Check chrome.cookies for merchant.pathao.com
  if (typeof chrome !== "undefined" && chrome.cookies) {
    const candidateNames = ["token", "access_token", "accessToken", "auth_token", "auth"];
    for (const name of candidateNames) {
      try {
        const c = await new Promise(r => chrome.cookies.get({ url: "https://merchant.pathao.com", name: name }, r));
        if (c && c.value && c.value.length > 20) return c.value;
      } catch (e) {}
    }
    // Scan all pathao.com domain cookies for JWT pattern
    try {
      const all = await new Promise(r => chrome.cookies.getAll({ domain: "pathao.com" }, r));
      for (const c of (all || [])) {
        if (c.value && c.value.startsWith("eyJ")) return c.value;
      }
    } catch (e) {}
  }

  return null;
}

/**
 * Query Steadfast courier fraud database headlessly
 */
async function fetchSteadfastRating(cleanPhone) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const fetchResp = await fetch(`https://steadfast.com.bd/user/frauds/check/${cleanPhone}`, {
      headers: { "Accept": "application/json, text/plain, */*" },
      credentials: "include",
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (fetchResp.ok) {
      const ct = fetchResp.headers.get("content-type") || "";
      if (ct.includes("json")) {
        const json = await fetchResp.json();
        return json;
      }
    }
  } catch (e) {}
  return null;
}

/**
 * Handle background customer rating & courier intelligence lookup
 */
async function handleCustomerRatingRequest(rawPhone, sendResponse) {
  const digits = (rawPhone || "").replace(/\D/g, "");
  let cleanPhone = digits.length >= 11 ? (digits.startsWith("880") ? digits.slice(2) : digits.slice(-11)) : digits;
  if (!cleanPhone.startsWith("0")) cleanPhone = "0" + cleanPhone;

  let pathaoData = null;

  // 1. Try querying an active Pathao tab headlessly
  let openTabs = [];
  try {
    openTabs = await new Promise(r => chrome.tabs.query({ url: ["*://merchant.pathao.com/*", "*://*.pathao.com/*"] }, r));
    if (openTabs && openTabs.length > 0) {
      for (const t of openTabs) {
        const resp = await new Promise(res => {
          const timer = setTimeout(() => res(null), 2500);
          chrome.tabs.sendMessage(t.id, { action: "query_pathao_rating", phone: cleanPhone }, (ans) => {
            clearTimeout(timer);
            if (chrome.runtime.lastError) {
              void chrome.runtime.lastError.message;
            }
            if (!ans) res(null);
            else res(ans);
          });
        });
        if (resp && resp.success && resp.data && !resp.data.error) {
          pathaoData = resp.data;
          break;
        }
      }
    }
  } catch (e) {}

  // 1b. If tab message failed (e.g. extension reloaded and content script invalidated), execute directly in tab context
  if ((!pathaoData || pathaoData.error) && openTabs && openTabs.length > 0 && chrome.scripting && chrome.scripting.executeScript) {
    for (const t of openTabs) {
      try {
        const injected = await chrome.scripting.executeScript({
          target: { tabId: t.id },
          func: async (phoneToQuery) => {
            const JWT_REGEX = /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/;
            let token = null;
            try {
              const priorityKeys = ["token", "access_token", "accessToken", "auth_token", "pathao_token", "user", "auth", "persist:root"];
              for (const k of priorityKeys) {
                const v = localStorage.getItem(k);
                if (v) {
                  const m = v.match(JWT_REGEX);
                  if (m) { token = m[0]; break; }
                }
              }
              if (!token) {
                for (let i = 0; i < localStorage.length; i++) {
                  const v = localStorage.getItem(localStorage.key(i));
                  if (v) {
                    const m = v.match(JWT_REGEX);
                    if (m) { token = m[0]; break; }
                  }
                }
              }
            } catch (e) {}

            const headers = {
              "Content-Type": "application/json",
              "Accept": "application/json"
            };
            if (token) headers["Authorization"] = "Bearer " + token;

            try {
              const resp = await fetch("https://merchant.pathao.com/api/v1/user/success", {
                method: "POST",
                headers: headers,
                credentials: "include",
                body: JSON.stringify({ phone: phoneToQuery })
              });
              const json = await resp.json().catch(() => null);
              return { success: resp.ok, token: token, data: json, status: resp.status };
            } catch (err) {
              return { success: false, token: token, error: err ? err.message : "fetch_failed" };
            }
          },
          args: [cleanPhone]
        });

        if (injected && injected[0] && injected[0].result) {
          const res = injected[0].result;
          if (res.token && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ "pathao_merchant_token": res.token, "pathao_token_updated": Date.now() });
          }
          if (res.success && res.data && !res.data.error) {
            pathaoData = res.data;
            break;
          } else if (res.status === 401 || res.status === 400) {
            pathaoData = { error: true, status: res.status, details: res.data || "token_missing" };
          }
        }
      } catch (scriptErr) {}
    }
  }

  // 2. If no valid tab response, query Pathao merchant API directly with cached/cookie token
  if (!pathaoData || pathaoData.error) {
    try {
      const token = await getPathaoToken();
      if (token) {
        const headers = {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": "Bearer " + token
        };
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        const fetchResp = await fetch("https://merchant.pathao.com/api/v1/user/success", {
          method: "POST",
          headers: headers,
          credentials: "include",
          signal: controller.signal,
          body: JSON.stringify({ phone: cleanPhone })
        });
        clearTimeout(timeoutId);
        const json = await fetchResp.json().catch(() => null);
        if (fetchResp.ok && json) {
          pathaoData = json;
        } else if (fetchResp.status === 401 || fetchResp.status === 400) {
          pathaoData = { error: true, status: fetchResp.status, details: json || "token_missing" };
        }
      } else {
        pathaoData = { error: true, status: "token_missing" };
      }
    } catch (apiErr) {
      pathaoData = { error: true, message: apiErr ? apiErr.message : "network_error" };
    }
  }

  // 3. Query Steadfast Courier
  let steadfastData = await fetchSteadfastRating(cleanPhone);

  // 4. Check store historical records from parsed cache
  let storeHistory = null;
  try {
    const store = await new Promise(r => chrome.storage.local.get(["parsed_records_cache", "customer_history_cache"], r));
    if (store && store.customer_history_cache && store.customer_history_cache[cleanPhone]) {
      storeHistory = store.customer_history_cache[cleanPhone];
    }
  } catch (histErr) {}

  // 5. Parse Pathao stats accurately from all possible response shapes
  let pathaoStats = null;
  let pathaoStatus = "not_connected"; // "live", "clean_record", "token_missing"

  if (pathaoData && !pathaoData.error) {
    const c = (pathaoData.data && pathaoData.data.customer)
      || pathaoData.customer
      || (pathaoData.data && typeof pathaoData.data === "object" && !Array.isArray(pathaoData.data) ? pathaoData.data : null)
      || pathaoData;

    if (c && typeof c === "object") {
      const t = Number(c.total_delivery || c.total || c.total_orders || c.total_order || 0);
      const d = Number(c.successful_delivery || c.delivered || c.success || 0);
      const f = Number(c.failed_delivery || c.cancelled || c.cancel || Math.max(0, t - d));
      pathaoStats = {
        total: t,
        delivered: d,
        cancelled: f,
        name: c.name || ""
      };
      pathaoStatus = t > 0 ? "live" : "clean_record";
    }
  } else if (pathaoData && (pathaoData.status === "token_missing" || pathaoData.status === 401 || pathaoData.status === 400)) {
    pathaoStatus = "token_missing";
  }

  // 6. Parse Steadfast stats accurately
  let steadfastStats = null;
  let steadfastStatus = "not_connected";
  if (steadfastData && (typeof steadfastData.total_delivered !== "undefined" || typeof steadfastData.total_cancelled !== "undefined")) {
    const d = Number(steadfastData.total_delivered || 0);
    const c = Number(steadfastData.total_cancelled || 0);
    const t = d + c;
    steadfastStats = { total: t, delivered: d, cancelled: c };
    steadfastStatus = "live";
  }

  // 7. Aggregate composite metrics across couriers
  const total = (pathaoStats ? pathaoStats.total : 0) + (steadfastStats ? steadfastStats.total : 0) + (storeHistory ? storeHistory.total : 0);
  const delivered = (pathaoStats ? pathaoStats.delivered : 0) + (steadfastStats ? steadfastStats.delivered : 0) + (storeHistory ? storeHistory.delivered : 0);
  const cancelled = (pathaoStats ? pathaoStats.cancelled : 0) + (steadfastStats ? steadfastStats.cancelled : 0) + (storeHistory ? storeHistory.cancelled : 0);

  const isNewCustomer = total === 0;
  let successRate = 100;
  let riskLevel = "low";
  let riskLabel = "Safe Customer (Low Risk)";
  let riskColor = "#10b981";

  if (!isNewCustomer && total > 0) {
    successRate = Math.round((delivered / total) * 100);
    if (successRate >= 80) {
      riskLevel = "low";
      riskLabel = `Safe Buyer (${successRate}% Success)`;
      riskColor = "#10b981";
    } else if (successRate >= 60) {
      riskLevel = "medium";
      riskLabel = `Caution: Moderate Risk (${cancelled} Returns)`;
      riskColor = "#f59e0b";
    } else {
      riskLevel = "high";
      riskLabel = `High Return Risk (${successRate}% Delivery Rate!)`;
      riskColor = "#ef4444";
    }
  } else {
    // Brand new customer with 0 delivery records
    if (pathaoStatus === "token_missing") {
      riskLabel = "Pathao Session Inactive (Open Tab Once)";
      riskColor = "#f59e0b";
    } else if (pathaoStatus === "clean_record" || pathaoStatus === "live") {
      riskLabel = "New Customer (Clean History)";
      riskColor = "#3b82f6";
    } else {
      riskLabel = "Customer Ready (No Returns Reported)";
      riskColor = "#10b981";
    }
  }

  const result = {
    success: true,
    phone: cleanPhone,
    successRate: successRate,
    totalParcels: total,
    deliveredCount: delivered,
    cancelledCount: Math.max(0, cancelled),
    riskLevel: riskLevel,
    riskLabel: riskLabel,
    riskColor: riskColor,
    isNewCustomer: isNewCustomer,
    pathaoStats: pathaoStats,
    pathaoStatus: pathaoStatus,
    steadfastStats: steadfastStats,
    steadfastStatus: steadfastStatus,
    sources: {
      pathao: {
        checked: true,
        successRate: successRate,
        total: total,
        delivered: delivered,
        cancelled: Math.max(0, cancelled)
      },
      steadfastNetwork: {
        checked: true,
        riskScore: riskLevel === "high" ? "High Risk" : (riskLevel === "medium" ? "Moderate" : "Low Risk"),
        cancellationRatio: total > 0 ? Math.round((cancelled / total) * 100) : 0
      }
    }
  };

  sendResponse(result);
}

const PATHAO_CREATE_ORDER_URL = "https://merchant.pathao.com/courier/orders/create";

function findAndSyncPathaoTab(data, autoSwitch = false) {
  chrome.tabs.query({ url: ["*://merchant.pathao.com/*", "*://*.pathao.com/*"] }, (tabs) => {
    if (tabs && tabs.length > 0) {
      // Prioritize tab that is already on /courier/orders/create
      const createTab = tabs.find(t => t.url && t.url.includes("/courier/orders/create"));
      const targetTab = createTab || tabs[0];

      if (autoSwitch) {
        // If the target tab is not on the order creation page (e.g. on /orders/list), navigate directly to /create!
        if (!targetTab.url || !targetTab.url.includes("/courier/orders/create")) {
          chrome.tabs.update(targetTab.id, {
            url: PATHAO_CREATE_ORDER_URL,
            active: true
          });
        } else {
          chrome.tabs.update(targetTab.id, { active: true });
        }

        if (targetTab.windowId) {
          chrome.windows.update(targetTab.windowId, { focused: true });
        }
      }

      // Send autofill message to Pathao tab safely
      chrome.tabs.sendMessage(targetTab.id, {
        action: "autofill_pathao_recipient",
        data: data
      }).catch(() => {
        // Tab might be loading or on an un-injected subpage
      });
    } else if (autoSwitch) {
      // Pathao is not currently open, open directly to the order creation page!
      chrome.tabs.create({ url: PATHAO_CREATE_ORDER_URL, active: true });
    }
  });
}

function focusOrOpenPathao() {
  chrome.tabs.query({ url: ["*://merchant.pathao.com/*", "*://*.pathao.com/*"] }, (tabs) => {
    if (tabs && tabs.length > 0) {
      const createTab = tabs.find(t => t.url && t.url.includes("/courier/orders/create"));
      const targetTab = createTab || tabs[0];
      if (!targetTab.url || !targetTab.url.includes("/courier/orders/create")) {
        chrome.tabs.update(targetTab.id, { url: PATHAO_CREATE_ORDER_URL, active: true });
      } else {
        chrome.tabs.update(targetTab.id, { active: true });
      }
      if (targetTab.windowId) {
        chrome.windows.update(targetTab.windowId, { focused: true });
      }
    } else {
      chrome.tabs.create({ url: PATHAO_CREATE_ORDER_URL, active: true });
    }
  });
}



