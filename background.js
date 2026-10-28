/**
 * DEEN Delivery Parser - Background Service Worker (Manifest V3)
 */

try {
  if (typeof importScripts === "function") {
    importScripts("env.js", "parser.js");
  }
} catch (e) {}

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

  if (chrome.runtime && chrome.runtime.onInstalled && chrome.runtime.onInstalled.addListener) {
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
  }

  // Purge expired autofill data on service worker startup (> 5 minutes old)
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(["pathao_autofill_data"], (res) => {
      if (res && res.pathao_autofill_data) {
        const ts = res.pathao_autofill_data.timestamp || 0;
        if (Date.now() - ts > 300 * 1000) {
          chrome.storage.local.remove(["pathao_autofill_data"]);
        }
      }
    });
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
        const phone = (typeof normalizeBDPhone === "function" ? normalizeBDPhone(info.selectionText) : null) ||
                      (() => {
                        const raw = info.selectionText.trim();
                        const digits = raw.replace(/[^\d+]/g, "");
                        const match = digits.match(/(?:(?:\+?880)|880|0)?(1[3-9]\d{8})\b/);
                        let p = raw.replace(/\D/g, "");
                        return match && match[1] ? "0" + match[1] : (p.length >= 11 ? p.slice(-11) : p);
                      })();

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
  if (chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener) {
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
      handleCustomerRatingRequest(request.phone, sendResponse, Boolean(request.forceRefresh));
      return true; // Keep message channel open for async response
    } else if (request && request.action === "guess_address_online") {
      handleOnlineAddressGuess(request.query, sendResponse);
      return true; // Keep message channel open for async response
    } else {
      sendResponse({ status: "ignored" });
    }
    return false;
  });
}
}

/**
 * Handle background customer rating & courier intelligence lookup
 */
/**
 * Issue new Pathao access token using Developer API OAuth credentials (.env / env.js)
 */
async function issuePathaoTokenFromCredentials(creds) {
  if (!creds || !creds.clientId || !creds.clientSecret || !creds.username || !creds.password) {
    return null;
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch("https://api-hermes.pathao.com/aladdin/api/v1/issue-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        grant_type: "password",
        username: creds.username,
        password: creds.password
      })
    });
    clearTimeout(timeoutId);

    if (resp.ok) {
      const data = await resp.json();
      if (data && data.access_token) {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({
            pathao_merchant_token: data.access_token,
            pathao_refresh_token: data.refresh_token || "",
            pathao_token_expiry: Date.now() + ((data.expires_in || 2592000) * 1000)
          });
        }
        return data.access_token;
      }
    }
  } catch (e) {}
  return null;
}

/**
 * Helper to get Pathao token from local storage, .env / env.js credentials, or Chrome cookies
 */
async function getPathaoToken() {
  // 1. Check storage for existing valid token
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      const store = await new Promise(r => chrome.storage.local.get(["pathao_merchant_token", "pathao_token_expiry"], r));
      if (store && store.pathao_merchant_token && store.pathao_merchant_token.length > 20) {
        if (!store.pathao_token_expiry || Date.now() < store.pathao_token_expiry - 60000) {
          return store.pathao_merchant_token;
        }
      }
    } catch (e) {}
  }

  // 2. Check credentials from env.js / DEEN_ENV / .env
  let envCreds = null;
  if (typeof self !== "undefined" && self.DEEN_ENV) {
    envCreds = self.DEEN_ENV;
  } else if (typeof DEEN_ENV !== "undefined") {
    envCreds = DEEN_ENV;
  }
  if (!envCreds && typeof require !== "undefined") {
    try { envCreds = require("./env.js"); } catch (e) {}
  }

  // Also check chrome.storage.local for credentials saved via options
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      const storedCreds = await new Promise(r => chrome.storage.local.get(["pathao_client_id", "pathao_client_secret", "pathao_username", "pathao_password"], r));
      if (storedCreds && storedCreds.pathao_client_id) {
        envCreds = Object.assign({}, envCreds || {}, {
          PATHAO_CLIENT_ID: storedCreds.pathao_client_id,
          PATHAO_CLIENT_SECRET: storedCreds.pathao_client_secret,
          PATHAO_USERNAME: storedCreds.pathao_username,
          PATHAO_PASSWORD: storedCreds.pathao_password
        });
      }
    } catch (e) {}
  }

  if (envCreds) {
    if (envCreds.PATHAO_BEARER_TOKEN && envCreds.PATHAO_BEARER_TOKEN.length > 20) {
      return envCreds.PATHAO_BEARER_TOKEN;
    }
    if (envCreds.PATHAO_CLIENT_ID && envCreds.PATHAO_CLIENT_SECRET && envCreds.PATHAO_USERNAME && envCreds.PATHAO_PASSWORD) {
      const issued = await issuePathaoTokenFromCredentials({
        clientId: envCreds.PATHAO_CLIENT_ID,
        clientSecret: envCreds.PATHAO_CLIENT_SECRET,
        username: envCreds.PATHAO_USERNAME,
        password: envCreds.PATHAO_PASSWORD
      });
      if (issued) return issued;
    }
  }

  // 3. Check chrome.cookies for merchant.pathao.com
  if (typeof chrome !== "undefined" && chrome.cookies) {
    const candidateNames = [
      "token", "access_token", "accessToken", "auth_token", "auth",
      "session_token", "session", "sid", "__session", "refresh_token",
      "jwt", "id_token", "idToken", "user_token", "api_token"
    ];
    for (const name of candidateNames) {
      try {
        const c = await new Promise(r => chrome.cookies.get({ url: "https://merchant.pathao.com", name: name }, r));
        if (c && c.value && c.value.length > 20) return c.value;
      } catch (e) {}
      try {
        const c = await new Promise(r => chrome.cookies.get({ url: "https://www.pathao.com", name: name }, r));
        if (c && c.value && c.value.length > 20) return c.value;
      } catch (e) {}
    }
    // Scan all pathao.com domain cookies for JWT pattern
    try {
      const all = await new Promise(r => chrome.cookies.getAll({ domain: "pathao.com" }, r));
      for (const c of (all || [])) {
        if (c.value && c.value.startsWith("eyJ")) return c.value;
        if (c.value && c.value.length > 50 && /^[a-zA-Z0-9\-_\.]+$/.test(c.value)) return c.value;
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

const customerRatingMemoryCache = new Map();
const RATING_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache

/**
 * Handle background customer rating & courier intelligence lookup
 */
async function handleCustomerRatingRequest(rawPhone, sendResponse, forceRefresh = false) {
  const cleanPhone = (typeof normalizeBDPhone === "function" ? normalizeBDPhone(rawPhone) : null) || (() => {
    const digits = (rawPhone || "").replace(/\D/g, "");
    let p = digits.length >= 11 ? (digits.startsWith("880") ? digits.slice(2) : digits.slice(-11)) : digits;
    return p.startsWith("0") ? p : "0" + p;
  })();

  // Check 10-minute cache if forceRefresh is not requested
  if (!forceRefresh) {
    if (customerRatingMemoryCache.has(cleanPhone)) {
      const memEntry = customerRatingMemoryCache.get(cleanPhone);
      if (memEntry && memEntry.timestamp && (Date.now() - memEntry.timestamp < RATING_CACHE_TTL_MS) && memEntry.result) {
        sendResponse(memEntry.result);
        return;
      }
    }
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      try {
        const store = await new Promise(r => chrome.storage.local.get(["customer_rating_cache"], r));
        const storedEntry = store && store.customer_rating_cache && store.customer_rating_cache[cleanPhone];
        if (storedEntry && storedEntry.timestamp && (Date.now() - storedEntry.timestamp < RATING_CACHE_TTL_MS) && storedEntry.result) {
          customerRatingMemoryCache.set(cleanPhone, storedEntry);
          sendResponse(storedEntry.result);
          return;
        }
      } catch (cacheErr) {}
    }
  }

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

        const endpoints = [
          "https://api-hermes.pathao.com/aladdin/api/v1/user/success",
          "https://merchant.pathao.com/api/v1/user/success"
        ];

        for (const ep of endpoints) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);
            const fetchResp = await fetch(ep, {
              method: "POST",
              headers: headers,
              signal: controller.signal,
              body: JSON.stringify({ phone: cleanPhone })
            });
            clearTimeout(timeoutId);
            const json = await fetchResp.json().catch(() => null);
            if (fetchResp.ok && json) {
              pathaoData = json;
              break;
            } else if (fetchResp.status === 401) {
              pathaoData = { error: true, status: 401, details: json || "token_expired" };
            }
          } catch (e) {}
        }

        // If 401 token expired, re-issue token via credentials and retry once
        if (pathaoData && pathaoData.status === 401) {
          if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
            chrome.storage.local.remove(["pathao_merchant_token"]);
          }
          const freshToken = await getPathaoToken();
          if (freshToken && freshToken !== token) {
            const retryHeaders = {
              "Content-Type": "application/json",
              "Accept": "application/json",
              "Authorization": "Bearer " + freshToken
            };
            for (const ep of endpoints) {
              try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 4000);
                const retryResp = await fetch(ep, {
                  method: "POST",
                  headers: retryHeaders,
                  signal: controller.signal,
                  body: JSON.stringify({ phone: cleanPhone })
                });
                clearTimeout(timeoutId);
                const json = await retryResp.json().catch(() => null);
                if (retryResp.ok && json) {
                  pathaoData = json;
                  break;
                }
              } catch (e) {}
            }
          }
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
  let pathaoRatingGrade = "";

  if (pathaoData && !pathaoData.error) {
    if (pathaoData.data && pathaoData.data.customer_rating) {
      pathaoRatingGrade = pathaoData.data.customer_rating;
    } else if (pathaoData.customer_rating) {
      pathaoRatingGrade = pathaoData.customer_rating;
    }

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

  const formattedGrade = pathaoRatingGrade ? String(pathaoRatingGrade).replace(/_/g, " ").trim().replace(/\b\w/g, c => c.toUpperCase()) : "";
  if (pathaoStats) {
    pathaoStats.ratingGrade = formattedGrade;
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
      riskLabel = formattedGrade ? `${formattedGrade} (${successRate}%)` : `Safe Buyer (${successRate}% Success)`;
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
    ratingGrade: formattedGrade,
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
        checked: Boolean(pathaoStats),
        ratingGrade: formattedGrade,
        successRate: pathaoStats && pathaoStats.total > 0 ? Math.round((pathaoStats.delivered / pathaoStats.total) * 100) : 100,
        total: pathaoStats ? pathaoStats.total : 0,
        delivered: pathaoStats ? pathaoStats.delivered : 0,
        cancelled: pathaoStats ? pathaoStats.cancelled : 0
      },
      steadfastNetwork: {
        checked: Boolean(steadfastStats),
        total: steadfastStats ? steadfastStats.total : 0,
        delivered: steadfastStats ? steadfastStats.delivered : 0,
        cancelled: steadfastStats ? steadfastStats.cancelled : 0,
        riskScore: riskLevel === "high" ? "High Risk" : (riskLevel === "medium" ? "Moderate" : "Low Risk"),
        cancellationRatio: steadfastStats && steadfastStats.total > 0 ? Math.round((steadfastStats.cancelled / steadfastStats.total) * 100) : 0
      }
    }
  };

  // Cache result in memory map
  customerRatingMemoryCache.set(cleanPhone, {
    timestamp: Date.now(),
    result: result
  });

  // Persist result in chrome.storage.local
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      chrome.storage.local.get(["customer_rating_cache"], (store) => {
        const cache = (store && store.customer_rating_cache) || {};
        cache[cleanPhone] = {
          timestamp: Date.now(),
          result: result
        };
        const keys = Object.keys(cache);
        if (keys.length > 300) {
          const oldestKey = keys.reduce((minK, k) => (cache[k].timestamp < cache[minK].timestamp ? k : minK), keys[0]);
          delete cache[oldestKey];
        }
        chrome.storage.local.set({ customer_rating_cache: cache });
      });
    } catch (persistErr) {}
  }

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
        const isAlreadyOnCreate = targetTab.url && targetTab.url.includes("/courier/orders/create");
        if (!isAlreadyOnCreate) {
          chrome.tabs.update(targetTab.id, {
            url: PATHAO_CREATE_ORDER_URL,
            active: true
          });
          // Newly loaded page content.js will read pathao_autofill_data from storage on load
        } else {
          chrome.tabs.update(targetTab.id, { active: true });
          // Send autofill message to active Pathao tab safely
          chrome.tabs.sendMessage(targetTab.id, {
            action: "autofill_pathao_recipient",
            data: data
          }).catch(() => {});
        }

        if (targetTab.windowId) {
          chrome.windows.update(targetTab.windowId, { focused: true });
        }
      } else {
        // Send autofill message to Pathao tab safely
        chrome.tabs.sendMessage(targetTab.id, {
          action: "autofill_pathao_recipient",
          data: data
        }).catch(() => {});
      }
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

// In-memory cache for online address guesses (query string -> result)
const onlineAddressCache = new Map();

/**
 * Parses OpenStreetMap Nominatim response item into standardized Bangladesh district, zone, and postcode
 */
function parseNominatimAddressResult(item, originalQuery) {
  if (!item || !item.address) return null;
  const addr = item.address;

  let parseBD = typeof parseBDAddress !== "undefined" ? parseBDAddress : null;
  let isoDetect = typeof detectDistrictFromISOCode !== "undefined" ? detectDistrictFromISOCode : null;
  let dists = typeof BD_DISTRICTS !== "undefined" ? BD_DISTRICTS : [];
  let otherZones = typeof OTHER_CITY_ZONES !== "undefined" ? OTHER_CITY_ZONES : {};
  let dhakaZones = typeof DHAKA_ZONES !== "undefined" ? DHAKA_ZONES : [];

  if (typeof require !== "undefined") {
    try {
      const p = require("./parser.js");
      if (!parseBD) parseBD = p.parseBDAddress;
      if (!isoDetect) isoDetect = p.detectDistrictFromISOCode;
      if (dists.length === 0) dists = p.BD_DISTRICTS;
      if (Object.keys(otherZones).length === 0) otherZones = p.OTHER_CITY_ZONES;
      if (dhakaZones.length === 0) dhakaZones = p.DHAKA_ZONES;
    } catch (e) {}
  }

  let matchedDistrict = "";
  let matchedZone = "";
  let postcode = (addr.postcode || "").trim();

  // 1. Check ISO 3166-2:BD code (e.g. BD-08 -> Cumilla, BD-26 -> Kishoreganj)
  const isoCode = addr["ISO3166-2-lvl5"] || addr["ISO3166-2-lvl4"] || "";
  if (isoCode && isoDetect) {
    const fromIso = isoDetect(isoCode);
    if (fromIso) matchedDistrict = fromIso;
  }

  // 2. Check state_district (e.g. "কুমিল্লা জেলা" or "Kishoreganj District")
  if (!matchedDistrict && addr.state_district) {
    const rawDist = addr.state_district.replace(/(?:জেলা|district|zila|zilla|jela)/gi, "").trim();
    const dMatch = dists.find(d => d.name.toLowerCase() === rawDist.toLowerCase() || (d.aliases && d.aliases.some(a => a.toLowerCase() === rawDist.toLowerCase())));
    if (dMatch) matchedDistrict = dMatch.name;
  }

  // 3. Check city / county / state
  if (!matchedDistrict && addr.city) {
    const dMatch = dists.find(d => d.name.toLowerCase() === addr.city.toLowerCase() || (d.aliases && d.aliases.some(a => a.toLowerCase() === addr.city.toLowerCase())));
    if (dMatch) matchedDistrict = dMatch.name;
  }

  // 4. Resolve Zone from county (upazila), town, municipality, suburb, or name
  const candidateZoneTexts = [
    addr.county,
    addr.town,
    addr.municipality,
    addr.suburb,
    addr.village,
    item.name
  ].filter(Boolean);

  if (matchedDistrict && otherZones[matchedDistrict]) {
    for (const zText of candidateZoneTexts) {
      const cleanZ = zText.replace(/(?:উপজেলা|upazila|thana|থানা|পৌরসভা|municipality)/gi, "").trim();
      const zObj = otherZones[matchedDistrict].find(z => {
        const zName = typeof z === "string" ? z : z.name;
        const aliases = typeof z === "string" ? [z] : (z.aliases || [z.name]);
        return zName.toLowerCase() === cleanZ.toLowerCase() || aliases.some(a => a.toLowerCase() === cleanZ.toLowerCase() || cleanZ.toLowerCase().includes(a.toLowerCase()));
      });
      if (zObj) {
        matchedZone = typeof zObj === "string" ? zObj : zObj.name;
        break;
      }
    }
  }

  // Check Dhaka zones if district is Dhaka
  if ((!matchedDistrict || matchedDistrict === "Dhaka") && !matchedZone) {
    for (const zText of candidateZoneTexts) {
      const cleanZ = zText.replace(/(?:থানা|thana)/gi, "").trim();
      const zObj = dhakaZones.find(z => {
        const zName = typeof z === "string" ? z : z.name;
        const aliases = typeof z === "string" ? [z] : (z.aliases || [z.name]);
        return zName.toLowerCase() === cleanZ.toLowerCase() || aliases.some(a => a.toLowerCase() === cleanZ.toLowerCase());
      });
      if (zObj) {
        matchedZone = typeof zObj === "string" ? zObj : zObj.name;
        matchedDistrict = "Dhaka";
        break;
      }
    }
  }

  // If zone still not matched from zones list, take the cleaned county/upazila name
  if (!matchedZone && addr.county) {
    matchedZone = addr.county.replace(/(?:উপজেলা|upazila|thana|থানা)/gi, "").trim();
  }

  if (!matchedDistrict && !matchedZone) return null;

  // Build modified full address
  let buildFull = typeof buildFullAddress !== "undefined" ? buildFullAddress : null;
  if (!buildFull && typeof require !== "undefined") {
    try { buildFull = require("./parser.js").buildFullAddress; } catch (e) {}
  }

  let fullAddress = "";
  if (buildFull && originalQuery) {
    fullAddress = buildFull(originalQuery, {
      district: matchedDistrict,
      zone: matchedZone,
      postcode: postcode
    });
  }

  return {
    success: true,
    district: matchedDistrict,
    zone: matchedZone,
    postcode: postcode,
    fullAddress: fullAddress,
    osmName: item.display_name || "",
    source: "OpenStreetMap"
  };
}

/**
 * Handle background intelligent address guessing via local parser & OpenStreetMap Nominatim
 */
async function handleOnlineAddressGuess(rawQuery, sendResponse) {
  if (!rawQuery || typeof rawQuery !== "string" || !rawQuery.trim()) {
    sendResponse({ success: false, error: "Empty query" });
    return;
  }

  const cleanQuery = rawQuery.trim().replace(/[\r\n\t]+/g, ", ").replace(/\s{2,}/g, " ").replace(/[,.\s-]+$/, "");
  const cacheKey = cleanQuery.toLowerCase();

  if (onlineAddressCache.has(cacheKey)) {
    sendResponse(onlineAddressCache.get(cacheKey));
    return;
  }

  // 1. Try local parse first if district is explicit or specific zone is recognized
  let parseBD = typeof parseBDAddress !== "undefined" ? parseBDAddress : null;
  let buildFull = typeof buildFullAddress !== "undefined" ? buildFullAddress : null;
  if (typeof require !== "undefined") {
    try {
      const p = require("./parser.js");
      if (!parseBD) parseBD = p.parseBDAddress;
      if (!buildFull) buildFull = p.buildFullAddress;
    } catch (e) {}
  }

  if (parseBD) {
    const localParsed = parseBD(cleanQuery);
    // If local parsed found a non-Dhaka district or if Dhaka was explicitly in the text
    const hasExplicitDhaka = /\b(?:dhaka|dacca|ঢাকা)\b/i.test(cleanQuery);
    if ((localParsed.district && localParsed.district !== "Dhaka") || (localParsed.district === "Dhaka" && hasExplicitDhaka)) {
      const result = {
        success: true,
        district: localParsed.district,
        zone: localParsed.zone,
        postcode: localParsed.postcode || "",
        fullAddress: buildFull ? buildFull(cleanQuery, localParsed) : cleanQuery,
        source: "Local Engine"
      };
      onlineAddressCache.set(cacheKey, result);
      sendResponse(result);
      return;
    }
  }

  // 2. Prepare search candidates for OpenStreetMap Nominatim
  // Remove phone numbers, email, and extraneous labels
  let sanitized = cleanQuery
    .replace(/(?:\+?88)?01[3-9]\d{8}\b/g, "")
    .replace(/\b(?:House|Road|Flat|Block|Holding|Vill|Village|Post|Thana|District|P\.O\.)[\s:,-]*[^\s,;]+/gi, "")
    .replace(/[,.\s-]+$/, "")
    .trim();

  const segments = cleanQuery.split(/[,;\n]+/).map(s => s.trim().replace(/^[,.\s-]+|[,.\s-]+$/g, "")).filter(Boolean);
  const candidates = [];
  if (sanitized && sanitized.length >= 3) candidates.push(sanitized);

  // Add individual segments (rightmost first, e.g. thana or bazar)
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg.length >= 3 && !/^\d+$/.test(seg) && !candidates.includes(seg)) {
      candidates.push(seg);
    }
  }

  // Limit to 3 candidate searches
  const toSearch = candidates.slice(0, 3);
  let resolvedResult = null;

  for (const candidate of toSearch) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(candidate + " Bangladesh")}&format=json&addressdetails=1&limit=1`;
      let data = null;

      if (typeof fetch === "function") {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        try {
          const resp = await fetch(url, {
            signal: controller.signal,
            headers: {
              "User-Agent": "DEEN-Delivery-Parser/1.0 (contact@deencommerce.com)",
              "Accept": "application/json"
            }
          });
          clearTimeout(timeoutId);
          if (resp.ok) {
            data = await resp.json();
          }
        } catch (fetchErr) {
          clearTimeout(timeoutId);
        }
      }

      if (Array.isArray(data) && data.length > 0) {
        const parsed = parseNominatimAddressResult(data[0], cleanQuery);
        if (parsed && (parsed.district || parsed.zone)) {
          resolvedResult = parsed;
          break;
        }
      }
    } catch (err) {}
  }

  if (resolvedResult) {
    onlineAddressCache.set(cacheKey, resolvedResult);
    sendResponse(resolvedResult);
  } else {
    sendResponse({
      success: false,
      error: "Could not guess address online via OpenStreetMap"
    });
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    handleCustomerRatingRequest,
    handleOnlineAddressGuess,
    parseNominatimAddressResult,
    onlineAddressCache
  };
}



