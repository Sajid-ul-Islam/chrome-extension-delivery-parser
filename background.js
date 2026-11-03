/**
 * DEEN Delivery Parser - Background Service Worker (Manifest V3)
 */

try {
  if (typeof importScripts === "function") {
    try { importScripts("env.js"); } catch (e) { }
    try { importScripts("parser.js"); } catch (e) { }
    try { importScripts("storage-engine.js"); } catch (e) { }
    try { importScripts("courier-adapters.js"); } catch (e) { }
  }
} catch (e) { }

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
        chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => { });
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
              if (tab.windowId) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => { });
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
      } else if (request && request.action === "fetch_customer_rating") {
        if (!request.phone) {
          sendResponse({ success: false, error: "Missing phone parameter" });
          return false;
        }
        handleCustomerRatingRequest(request.phone, sendResponse, Boolean(request.forceRefresh));
        return true; // Keep message channel open for async response
      } else if (request && request.action === "guess_address_online") {
        handleOnlineAddressGuess(request.query, sendResponse);
        return true; // Keep message channel open for async response
      } else if (request && request.action === "evaluate_optimal_courier") {
        const couriersModule = (typeof DeenCouriers !== "undefined" ? DeenCouriers : null) || (typeof require !== "undefined" ? (() => { try { return require("./courier-adapters.js"); } catch (e) { return null; } })() : null);
        if (couriersModule && typeof couriersModule.evaluateOptimalCourier === "function") {
          sendResponse({ success: true, ...couriersModule.evaluateOptimalCourier(request.order || {}, request.rating || {}) });
        } else {
          sendResponse({ success: true, recommendedCourier: "pathao", reason: "Standard express delivery" });
        }
        return true;
      } else if (request && request.action === "calculate_multifactor_risk") {
        const couriersModule = (typeof DeenCouriers !== "undefined" ? DeenCouriers : null) || (typeof require !== "undefined" ? (() => { try { return require("./courier-adapters.js"); } catch (e) { return null; } })() : null);
        if (couriersModule && typeof couriersModule.calculateMultiFactorRisk === "function") {
          sendResponse({ success: true, ...couriersModule.calculateMultiFactorRisk(request.rating || {}, request.order || {}) });
        } else {
          sendResponse({ success: true, riskLevel: "low", recommendedAdvanceFee: 0 });
        }
        return true;
      } else if (request && request.action === "process_ndr_event") {
        const couriersModule = (typeof DeenCouriers !== "undefined" ? DeenCouriers : null) || (typeof require !== "undefined" ? (() => { try { return require("./courier-adapters.js"); } catch (e) { return null; } })() : null);
        const storageModule = (typeof DeenStorage !== "undefined" ? DeenStorage : null) || (typeof require !== "undefined" ? (() => { try { return require("./storage-engine.js"); } catch (e) { return null; } })() : null);
        if (couriersModule && typeof couriersModule.processNDRTrackingEvent === "function") {
          const ndrAlert = couriersModule.processNDRTrackingEvent(request.event || {});
          if (ndrAlert && ndrAlert.isNDR && storageModule && typeof storageModule.saveNDRAlertAsync === "function") {
            storageModule.saveNDRAlertAsync(ndrAlert.trackingId, ndrAlert).catch(() => { });
          }
          sendResponse({ success: true, alert: ndrAlert });
        } else {
          sendResponse({ success: false, alert: null });
        }
        return true;
      } else if (request && request.action === "get_ndr_alerts") {
        const storageModule = (typeof DeenStorage !== "undefined" ? DeenStorage : null) || (typeof require !== "undefined" ? (() => { try { return require("./storage-engine.js"); } catch (e) { return null; } })() : null);
        if (storageModule && typeof storageModule.getNDRAlertsAsync === "function") {
          storageModule.getNDRAlertsAsync().then(alerts => sendResponse({ success: true, alerts })).catch(() => sendResponse({ success: false, alerts: [] }));
          return true;
        } else {
          sendResponse({ success: true, alerts: [] });
          return true;
        }
      } else if (request && request.action === "notify_ndr_alert") {
        if (typeof chrome !== "undefined" && chrome.notifications && chrome.notifications.create) {
          const alert = request.alert || {};
          const recipientPhone = alert.recipientPhone || "";
          const trackingId = alert.trackingId || "";
          const reason = alert.reason || alert.issueLabel || "Failed Delivery Attempt";
          chrome.notifications.create({
            type: "basic",
            iconUrl: (typeof chrome.runtime !== "undefined" && chrome.runtime.getURL) ? chrome.runtime.getURL("icons/icon128.png") : "icons/icon128.png",
            title: `🚨 DEEN Alert: Delivery Failed (${recipientPhone || trackingId || "Consignment"})`,
            message: `Reason: ${reason}. Recipient: ${alert.recipientName || "Valued Customer"}. Click to send WhatsApp rescue message!`,
            priority: 2
          }, (notificationId) => {
            if (chrome.runtime && chrome.runtime.lastError) void chrome.runtime.lastError.message;
            sendResponse({ success: true, notificationId });
          });
          return true;
        } else {
          sendResponse({ success: false, error: "Notifications not supported" });
          return false;
        }
      } else if (request && request.action === "check_for_updates") {
        checkForExtensionUpdate(Boolean(request.force)).then(info => {
          sendResponse({ success: true, ...info });
        }).catch(err => {
          sendResponse({ success: false, error: err.message });
        });
        return true;
      } else if (request && request.action === "dismiss_update") {
        if (request.commit && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ "deen_update_dismissed": request.commit }, () => {
            sendResponse({ success: true });
          });
          return true;
        } else {
          sendResponse({ success: false });
          return false;
        }
      } else if (request && request.action === "reload_extension") {
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.reload) {
          sendResponse({ success: true });
          setTimeout(() => chrome.runtime.reload(), 250);
        } else {
          sendResponse({ success: false, message: "chrome.runtime.reload not available" });
        }
        return true;
      } else if (request && request.action === "load_env_runtime") {
        loadRuntimeEnv().then(creds => {
          sendResponse({
            success: Boolean(creds && (creds.PATHAO_CLIENT_ID || creds.PATHAO_BEARER_TOKEN)),
            hasCredentials: Boolean(creds && (creds.PATHAO_CLIENT_ID || creds.PATHAO_BEARER_TOKEN)),
            clientId: creds && creds.PATHAO_CLIENT_ID ? creds.PATHAO_CLIENT_ID.substring(0, 4) + "..." : "",
            username: creds ? (creds.PATHAO_USERNAME || "") : "",
            hasBearerToken: Boolean(creds && creds.PATHAO_BEARER_TOKEN && creds.PATHAO_BEARER_TOKEN.length > 20)
          });
        });
        return true;
      } else if (request && request.action === "save_api_credentials") {
        if (request.credentials && chrome.storage && chrome.storage.local) {
          const c = request.credentials;
          chrome.storage.local.set({
            "pathao_client_id": c.clientId || "",
            "pathao_client_secret": c.clientSecret || "",
            "pathao_username": c.username || "",
            "pathao_password": c.password || "",
            "pathao_bearer_token": c.bearerToken || ""
          }, () => {
            chrome.storage.local.remove(["pathao_merchant_token", "pathao_token_expiry"], () => {
              if (typeof self !== "undefined") {
                self.DEEN_ENV = Object.assign({}, self.DEEN_ENV || {}, {
                  PATHAO_CLIENT_ID: c.clientId || "",
                  PATHAO_CLIENT_SECRET: c.clientSecret || "",
                  PATHAO_USERNAME: c.username || "",
                  PATHAO_PASSWORD: c.password || "",
                  PATHAO_BEARER_TOKEN: c.bearerToken || ""
                });
              }
              sendResponse({ success: true, message: "Credentials saved and active!" });
            });
          });
          return true;
        } else {
          sendResponse({ success: false, message: "No credentials provided" });
          return false;
        }
      } else if (request && request.action === "get_api_credentials") {
        loadRuntimeEnv().then(creds => {
          sendResponse({
            success: true,
            clientId: creds ? (creds.PATHAO_CLIENT_ID || "") : "",
            username: creds ? (creds.PATHAO_USERNAME || "") : "",
            hasSecret: Boolean(creds && creds.PATHAO_CLIENT_SECRET),
            hasPassword: Boolean(creds && creds.PATHAO_PASSWORD),
            hasBearerToken: Boolean(creds && creds.PATHAO_BEARER_TOKEN)
          });
        });
        return true;
      } else if (request && request.action === "login_with_wordpress") {
        authenticateWordPressUser(request.username, request.password, request.storeUrl).then(res => {
          sendResponse(res);
        }).catch(err => {
          sendResponse({ success: false, error: err ? err.message : String(err) });
        });
        return true;
      } else if (request && request.action === "sync_from_wordpress") {
        syncFromWordPressAdmin(request.siteUrl).then(res => {
          sendResponse(res);
        }).catch(err => {
          sendResponse({ success: false, error: err ? err.message : String(err) });
        });
        return true;
      } else if (request && request.action === "get_wordpress_connection_status") {
        getWordPressConnectionStatus().then(res => {
          sendResponse(res);
        }).catch(err => {
          sendResponse({ connected: false, siteUrl: "https://deencommerce.com", error: err ? err.message : String(err) });
        });
        return true;
      } else if (request && request.action === "disconnect_wordpress") {
        disconnectWordPressSession().then(res => {
          sendResponse(res);
        }).catch(err => {
          sendResponse({ success: false, error: err ? err.message : String(err) });
        });
        return true;
      } else if (request && request.action === "sync_wordpress_credentials") {
        saveWordPressExtractedCredentials(request.credentials, request.siteUrl, request.adminUser, request.userRole, request.userPermissions, request.userLogin).then(res => {
          sendResponse(res);
        }).catch(err => {
          sendResponse({ success: false, error: err ? err.message : String(err) });
        });
        return true;
      } else {
        sendResponse({ status: "ignored" });
      }
      return false;
    });
  }
}

/**
 * Extract courier API credentials and admin metadata from WordPress admin HTML
 */
function extractCredentialsFromWordPressHTML(html, originUrl) {
  if (!html || typeof html !== "string") {
    return {
      isLoggedIn: false,
      adminUser: "",
      userLogin: "",
      userRole: "",
      userPermissions: "",
      capabilities: [],
      siteUrl: originUrl || "",
      credentials: {},
      hasCredentials: false
    };
  }

  // 1. Detect login redirect or login form
  const isLoginRedirect = /wp-login\.php/i.test(html) ||
                          /<form[^>]+id=["']loginform["']/i.test(html) ||
                          /id=["']user_login["']/i.test(html);

  // 2. Detect admin indicators
  const hasAdminMarkers = /#wpadminbar|class=["'][^"']*wp-admin[^"']*["']|id=["']wpbody["']|admin\.php|wp-admin/i.test(html);
  const isLoggedIn = !isLoginRedirect && hasAdminMarkers;

  // 3. Extract admin user display name & username
  let adminUser = "";
  const userMatch = html.match(/class=["']display-name["'][^>]*>([^<]+)<\/span>/i) ||
                    html.match(/Howdy,\s*<span[^>]*>([^<]+)<\/span>/i) ||
                    html.match(/["']user_display_name["']\s*:\s*["']([^"']+)["']/i) ||
                    html.match(/id=["']wp-admin-bar-my-account["'][^>]*>[\s\S]*?<span[^>]+class=["']display-name["'][^>]*>([^<]+)<\/span>/i);
  if (userMatch) adminUser = userMatch[1].trim();

  let userLogin = "";
  const loginMatch = html.match(/<span[^>]+class=["']username["'][^>]*>([^<]+)<\/span>/i) ||
                     html.match(/id=["']wp-admin-bar-user-info["'][^>]*>[\s\S]*?<span[^>]+class=["']username["'][^>]*>([^<]+)<\/span>/i) ||
                     html.match(/["']user_login["']\s*:\s*["']([^"']+)["']/i) ||
                     html.match(/<input[^>]+name=["']user_login["'][^>]+value=["']([^"']*)["']/i);
  if (loginMatch) userLogin = loginMatch[1].trim();
  if (!userLogin) userLogin = adminUser || "admin";

  // 4. Extract User Role & Permissions from HTML body, scripts, or admin menus
  let userRole = "";
  const bodyRoleMatch = html.match(/<body[^>]+class=["'][^"']*role-([a-z0-9_-]+)[^"']*["']/i) ||
                        html.match(/<body[^>]+class=["'][^"']*\b(administrator|shop_manager|editor|author|contributor)\b[^"']*["']/i);
  if (bodyRoleMatch && bodyRoleMatch[1]) {
    const rawRole = bodyRoleMatch[1].toLowerCase().replace(/[-_]/g, " ");
    userRole = rawRole.replace(/\b\w/g, c => c.toUpperCase());
  }

  if (!userRole) {
    const scriptRoleMatch = html.match(/["']roles["']\s*:\s*\[\s*["']([^"']+)["']/i) ||
                            html.match(/["']role["']\s*:\s*["']([^"']+)["']/i);
    if (scriptRoleMatch && scriptRoleMatch[1]) {
      const rawRole = scriptRoleMatch[1].toLowerCase().replace(/[-_]/g, " ");
      userRole = rawRole.replace(/\b\w/g, c => c.toUpperCase());
    }
  }

  // Capability checks via menu indicators
  const hasOptionsCap = /id=["']menu-settings["']|id=["']menu-plugins["']|id=["']menu-tools["']|options-general\.php|plugins\.php/i.test(html);
  const hasWooCap = /id=["']menu-woocommerce["']|page=wc-settings|page=wc-orders|woocommerce/i.test(html);

  if (!userRole) {
    if (hasOptionsCap) {
      userRole = "Administrator";
    } else if (hasWooCap) {
      userRole = "Shop Manager";
    } else if (/id=["']menu-posts["']/i.test(html)) {
      userRole = "Store Staff";
    } else if (isLoggedIn) {
      userRole = adminUser.toLowerCase().includes("admin") ? "Administrator" : "Shop Manager";
    }
  }

  let userPermissions = "";
  let capabilities = [];
  if (userRole.toLowerCase().includes("admin") || hasOptionsCap) {
    userRole = "Administrator";
    userPermissions = "Full Store & Settings Access (manage_options, manage_woocommerce)";
    capabilities = ["manage_options", "manage_woocommerce", "view_woocommerce_reports", "edit_shop_orders"];
  } else if (userRole.toLowerCase().includes("shop") || hasWooCap) {
    userRole = "Shop Manager";
    userPermissions = "WooCommerce & Courier Dispatch Access (manage_woocommerce)";
    capabilities = ["manage_woocommerce", "view_woocommerce_reports", "edit_shop_orders"];
  } else {
    userRole = userRole || "Store Staff";
    userPermissions = "Standard Orders & Shipping Access";
    capabilities = ["view_woocommerce_reports", "edit_shop_orders"];
  }

  // Helper to extract input values regardless of attribute order
  function getInputValue(names) {
    for (const name of names) {
      const escaped = name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      // Pattern A: name/id before value
      const r1 = new RegExp('<input[^>]+(?:name|id)=["\']' + escaped + '["\'][^>]+value=["\']([^"\']*)["\']', "i");
      const m1 = html.match(r1);
      if (m1 && m1[1]) return m1[1].trim();

      // Pattern B: value before name/id
      const r2 = new RegExp('<input[^>]+value=["\']([^"\']*)["\'][^>]+(?:name|id)=["\']' + escaped + '["\']', "i");
      const m2 = html.match(r2);
      if (m2 && m2[1]) return m2[1].trim();

      // Pattern C: textarea
      const r3 = new RegExp('<textarea[^>]+(?:name|id)=["\']' + escaped + '["\'][^>]*>([^<]*)<\\/textarea>', "i");
      const m3 = html.match(r3);
      if (m3 && m3[1]) return m3[1].trim();
    }
    return "";
  }

  // 5. Extract credentials
  let clientId = getInputValue([
    "ptc_client_id", "client_id", "pathao_client_id", "wc_pathao_client_id",
    "woocommerce_pathao_client_id", "ptc_merchant_id", "pathao_merchant_id"
  ]);

  let clientSecret = getInputValue([
    "ptc_client_secret", "client_secret", "pathao_client_secret", "wc_pathao_client_secret",
    "woocommerce_pathao_client_secret"
  ]);

  let username = getInputValue([
    "ptc_username", "username", "pathao_username", "pathao_email", "ptc_email",
    "wc_pathao_username", "woocommerce_pathao_username"
  ]);

  let password = getInputValue([
    "ptc_password", "password", "pathao_password", "wc_pathao_password",
    "woocommerce_pathao_password"
  ]);

  let bearerToken = getInputValue([
    "ptc_token", "pathao_token", "bearer_token", "access_token", "pathao_bearer_token",
    "pathao_access_token", "api_token"
  ]);

  let storeId = getInputValue([
    "ptc_store_id", "pathao_store_id", "store_id", "merchant_id"
  ]);

  let steadfastApiKey = getInputValue([
    "steadfast_api_key", "api_key", "sf_api_key", "woocommerce_steadfast_api_key"
  ]);

  let steadfastSecretKey = getInputValue([
    "steadfast_secret_key", "secret_key", "sf_secret_key", "woocommerce_steadfast_secret_key"
  ]);

  // 6. Script tag / JSON config extraction fallback
  if (!clientId || !clientSecret) {
    const jsonMatch = html.match(/(?:ptc_params|pathao_params|ptcSettings|pathaoSettings)\s*=\s*({[\s\S]*?});/i);
    if (jsonMatch && jsonMatch[1]) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (!clientId) clientId = String(parsed.client_id || parsed.clientId || "");
        if (!clientSecret) clientSecret = String(parsed.client_secret || parsed.clientSecret || "");
        if (!username) username = String(parsed.username || parsed.email || "");
        if (!password) password = String(parsed.password || "");
        if (!storeId) storeId = String(parsed.store_id || parsed.storeId || "");
      } catch (e) {}
    }
  }

  const hasCredentials = Boolean((clientId && clientSecret) || bearerToken || steadfastApiKey);

  return {
    isLoggedIn,
    adminUser,
    userLogin,
    userRole,
    userPermissions,
    capabilities,
    siteUrl: originUrl || "",
    credentials: {
      clientId,
      clientSecret,
      username,
      password,
      bearerToken,
      storeId,
      steadfastApiKey,
      steadfastSecretKey
    },
    hasCredentials
  };
}

async function authenticateWordPressUser(username, password, storeUrl) {
  const cleanUser = username ? String(username).trim() : "";
  const cleanPass = password ? String(password).trim() : "";
  if (!cleanUser || !cleanPass) {
    return { success: false, error: "Username and password are required.", statusCode: 400 };
  }

  let baseUrl = storeUrl ? String(storeUrl).trim() : "https://deencommerce.com";
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    baseUrl = "https://" + baseUrl;
  }
  baseUrl = baseUrl.replace(/\/+$/, "").replace(/\/wp-admin.*$/i, "");

  try {
    // Step 1: Pre-flight GET to wp-login.php to initialize testcookie in cookie jar
    try {
      const preflightCtrl = new AbortController();
      const preflightTimeout = setTimeout(() => preflightCtrl.abort(), 4000);
      await fetch(`${baseUrl}/wp-login.php`, {
        method: "GET",
        credentials: "include",
        signal: preflightCtrl.signal,
        headers: {
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "User-Agent": "DEEN-Delivery-Parser-Auth-Agent/2.0"
        }
      });
      clearTimeout(preflightTimeout);
    } catch (e) {}

    // Step 2: POST credentials to wp-login.php
    const bodyParams = new URLSearchParams({
      log: cleanUser,
      pwd: cleanPass,
      rememberme: "forever",
      redirect_to: `${baseUrl}/wp-admin/`,
      testcookie: "1",
      "wp-submit": "Log In"
    });

    let redirectedToAdmin = false;
    let resText = "";

    // Attempt 1: Standard follow redirect (browser runtime in MV3)
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const followRes = await fetch(`${baseUrl}/wp-login.php`, {
        method: "POST",
        redirect: "follow",
        credentials: "include",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "User-Agent": "DEEN-Delivery-Parser-Auth-Agent/2.0"
        },
        body: bodyParams.toString(),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (followRes.ok) {
        resText = await followRes.text();
        const urlStr = followRes.url || "";
        if (urlStr.includes("wp-admin") || (!urlStr.includes("wp-login.php") && (resText.includes("wp-admin") || resText.includes("wpbody") || resText.includes("wpadminbar")))) {
          redirectedToAdmin = true;
        }
      } else {
        resText = await followRes.text().catch(() => "");
      }
    } catch (e) {}

    // Attempt 2: Manual redirect check (for Node.js test environments or strict redirects)
    if (!redirectedToAdmin) {
      try {
        const manualCtrl = new AbortController();
        const manualTimeout = setTimeout(() => manualCtrl.abort(), 6000);
        const manualRes = await fetch(`${baseUrl}/wp-login.php`, {
          method: "POST",
          redirect: "manual",
          credentials: "include",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "DEEN-Delivery-Parser-Auth-Agent/2.0"
          },
          body: bodyParams.toString(),
          signal: manualCtrl.signal
        });
        clearTimeout(manualTimeout);

        // In Node: status 302. In Chromium: status 0 or type 'opaqueredirect'
        if (manualRes.status === 302 || manualRes.status === 0 || manualRes.type === "opaqueredirect") {
          redirectedToAdmin = true;
        } else if (manualRes.ok) {
          const mText = await manualRes.text();
          if (!mText.includes("login_error") && !mText.includes("wp-login.php")) {
            redirectedToAdmin = true;
            resText = mText;
          } else {
            resText = mText;
          }
        }
      } catch (e) {}
    }

    // Step 3: Check chrome.cookies for authoritative verification in Chrome
    let foundWpCookie = false;
    let cookieUsername = cleanUser;
    if (typeof chrome !== "undefined" && chrome.cookies) {
      try {
        const domain = new URL(baseUrl).hostname;
        const allCookies = await new Promise(r => chrome.cookies.getAll({ domain: domain }, r));
        for (const c of (allCookies || [])) {
          if (c && c.name && c.name.startsWith("wordpress_logged_in_")) {
            foundWpCookie = true;
            if (c.value) {
              const uMatch = decodeURIComponent(c.value).split("|")[0];
              if (uMatch) cookieUsername = uMatch;
            }
            break;
          }
        }
      } catch (e) {}
    }

    // Success branch
    if (redirectedToAdmin || foundWpCookie) {
      let extractedUsername = cookieUsername || cleanUser;
      if (resText) {
        const userMatch = resText.match(/class=["']display-name["'][^>]*>([^<]+)<\/span>/i) ||
                          resText.match(/Howdy,\s*<span[^>]*>([^<]+)<\/span>/i);
        if (userMatch) extractedUsername = userMatch[1].trim();
      }

      // Automatically sync courier API keys from WordPress Admin settings
      const syncResult = await syncFromWordPressAdmin(baseUrl);

      return {
        success: true,
        authenticated: true,
        siteUrl: baseUrl,
        adminUser: extractedUsername || "Admin",
        credentialsFound: Boolean(syncResult && syncResult.credentialsFound),
        message: syncResult && syncResult.credentialsFound
          ? `Authenticated as ${extractedUsername}! Auto-synced Pathao & courier API keys.`
          : `Authenticated as ${extractedUsername}! WordPress session is active.`
      };
    }

    // Step 4: Extract specific WordPress error from HTML if available
    let wpError = "";
    if (resText) {
      const errMatch = resText.match(/<div[^>]+id=["']login_error["'][^>]*>([\s\S]*?)<\/div>/i);
      if (errMatch && errMatch[1]) {
        wpError = errMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      }
    }

    // Step 5: Strategy B fallback: Application Password via /wp-json/wp/v2/users/me
    const basicAuth = typeof btoa === "function" ? btoa(`${cleanUser}:${cleanPass}`) : Buffer.from(`${cleanUser}:${cleanPass}`).toString("base64");
    const apiRes = await fetch(`${baseUrl}/wp-json/wp/v2/users/me`, {
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "User-Agent": "DEEN-Delivery-Parser-Auth-Agent/2.0"
      }
    }).catch(() => null);

    if (apiRes && apiRes.ok) {
      const wpUser = await apiRes.json().catch(() => ({}));
      const displayName = wpUser.name || wpUser.slug || cleanUser;
      const syncResult = await syncFromWordPressAdmin(baseUrl);

      return {
        success: true,
        authenticated: true,
        siteUrl: baseUrl,
        adminUser: displayName,
        credentialsFound: Boolean(syncResult && syncResult.credentialsFound),
        message: `Authenticated as ${displayName} via WordPress API!`
      };
    }

    return {
      success: false,
      error: wpError || ("Invalid WordPress username or password for " + baseUrl),
      statusCode: 401
    };
  } catch (err) {
    const isAbort = err && (err.name === "AbortError" || String(err.message || "").includes("aborted"));
    return {
      success: false,
      error: isAbort
        ? "Authentication timed out connecting to " + baseUrl
        : "Network error connecting to WordPress authentication server: " + (err ? err.message : String(err)),
      statusCode: 504
    };
  }
}

/**
 * Auto-detect and sync courier API credentials from WordPress Admin session
 */
async function syncFromWordPressAdmin(siteUrl) {
  let targetUrl = siteUrl ? String(siteUrl).trim() : "https://deencommerce.com";
  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    targetUrl = "https://" + targetUrl;
  }
  // Strip trailing slashes and /wp-admin
  targetUrl = targetUrl.replace(/\/+$/, "").replace(/\/wp-admin.*$/i, "");

  const candidateEndpoints = [
    `${targetUrl}/wp-admin/admin.php?page=pathao-courier`,
    `${targetUrl}/wp-admin/admin.php?page=wc-settings&tab=shipping&section=pathao`,
    `${targetUrl}/wp-admin/admin.php?page=ptc-settings`,
    `${targetUrl}/wp-admin/admin.php?page=pathao_courier`,
    `${targetUrl}/wp-admin/admin.php?page=wc-settings&tab=shipping`,
    `${targetUrl}/wp-admin/admin.php?page=wc-settings&tab=integration`,
    `${targetUrl}/wp-admin/admin.php?page=steadfast-courier`,
    `${targetUrl}/wp-admin/admin.php?page=wc-settings&tab=shipping&section=steadfast`,
    `${targetUrl}/wp-admin/admin.php?page=wc-orders`,
    `${targetUrl}/wp-admin/`
  ];

  let foundLogin = false;
  let adminUser = "";
  let userRole = "";
  let userPermissions = "";
  let userLogin = "";
  let extractedCreds = null;

  // Proactive check in Chrome cookie jar for active WordPress session
  if (typeof chrome !== "undefined" && chrome.cookies) {
    try {
      const domain = new URL(targetUrl).hostname;
      const allCookies = await new Promise(r => chrome.cookies.getAll({ domain: domain }, r));
      for (const c of (allCookies || [])) {
        if (c && c.name && c.name.startsWith("wordpress_logged_in_")) {
          foundLogin = true;
          if (c.value) {
            const uMatch = decodeURIComponent(c.value).split("|")[0];
            if (uMatch) {
              adminUser = uMatch;
              userLogin = uMatch;
            }
          }
          break;
        }
      }
    } catch (e) {}
  }

  for (const ep of candidateEndpoints) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7000);
      const resp = await fetch(ep, {
        method: "GET",
        credentials: "include",
        signal: controller.signal,
        headers: {
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      });
      clearTimeout(timeoutId);

      // Check if redirected to login
      if (resp.url && (resp.url.includes("wp-login.php") || resp.url.includes("redirect_to"))) {
        continue;
      }
      if (resp.status === 401 || resp.status === 403) {
        continue;
      }

      if (resp.ok) {
        const html = await resp.text();
        const parsed = extractCredentialsFromWordPressHTML(html, targetUrl);

        if (parsed.isLoggedIn) {
          foundLogin = true;
          if (parsed.adminUser && !adminUser) adminUser = parsed.adminUser;
          if (parsed.userRole && !userRole) userRole = parsed.userRole;
          if (parsed.userPermissions && !userPermissions) userPermissions = parsed.userPermissions;
          if (parsed.userLogin && !userLogin) userLogin = parsed.userLogin;
        }

        if (parsed.hasCredentials) {
          extractedCreds = parsed.credentials;
          if (parsed.adminUser) adminUser = parsed.adminUser;
          if (parsed.userRole) userRole = parsed.userRole;
          if (parsed.userPermissions) userPermissions = parsed.userPermissions;
          if (parsed.userLogin) userLogin = parsed.userLogin;
          break; // Found working credentials, stop probing
        }
      }
    } catch (err) {
      // Endpoint error or timeout, continue probing next candidate
    }
  }

  // Process outcome
  if (extractedCreds && (extractedCreds.clientId || extractedCreds.bearerToken || extractedCreds.steadfastApiKey)) {
    return await saveWordPressExtractedCredentials(extractedCreds, targetUrl, adminUser, userRole, userPermissions, userLogin);
  }

  if (foundLogin) {
    const role = userRole || (adminUser.toLowerCase().includes("admin") ? "Administrator" : "Shop Manager");
    const perm = userPermissions || (role === "Administrator" ? "Full Store & Settings Access (manage_options, manage_woocommerce)" : "WooCommerce & Courier Dispatch Access (manage_woocommerce)");
    const login = userLogin || adminUser || "admin";
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        wp_connected_site: targetUrl,
        wp_connected_user: adminUser || "Admin",
        wp_connected_login: login,
        wp_user_role: role,
        wp_user_permissions: perm,
        wp_connected_at: Date.now(),
        wp_auth_status: "connected_no_creds"
      });
    }
    return {
      success: true,
      loggedIn: true,
      noCredentialsFound: true,
      siteUrl: targetUrl,
      adminUser: adminUser || "Admin",
      userLogin: login,
      userRole: role,
      userPermissions: perm,
      message: `Connected to WordPress as ${adminUser || "Admin"} (${role}), but no Pathao/courier plugin settings found on ${targetUrl}.`
    };
  }

  return {
    success: false,
    notLoggedIn: true,
    siteUrl: targetUrl,
    loginUrl: `${targetUrl}/wp-login.php?redirect_to=%2Fwp-admin%2F`,
    message: `Not logged in to WordPress. Please log in at ${targetUrl}/wp-admin.`
  };
}

async function getWordPressConnectionStatus() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    const stored = await new Promise(r => chrome.storage.local.get([
      "wp_connected_site", "wp_connected_user", "wp_connected_login", "wp_user_role",
      "wp_user_permissions", "wp_connected_at", "wp_auth_status",
      "pathao_client_id", "pathao_bearer_token"
    ], r));
    const site = stored && stored.wp_connected_site;
    const user = stored && stored.wp_connected_user;
    const login = stored && stored.wp_connected_login;
    const role = stored && stored.wp_user_role;
    const perm = stored && stored.wp_user_permissions;
    const time = stored && stored.wp_connected_at;
    const status = stored && stored.wp_auth_status;
    const hasCreds = Boolean(stored && (stored.pathao_client_id || stored.pathao_bearer_token));
    return {
      connected: Boolean(site && status && status.startsWith("connected")),
      siteUrl: site || "https://deencommerce.com",
      adminUser: user || "",
      userLogin: login || user || "",
      userRole: role || (user && user.toLowerCase().includes("admin") ? "Administrator" : "Shop Manager"),
      userPermissions: perm || "Full Store & API Access (manage_options, manage_woocommerce)",
      syncedAt: time || null,
      authStatus: status || "disconnected",
      hasCredentials: hasCreds
    };
  }
  return { connected: false, siteUrl: "https://deencommerce.com", hasCredentials: false };
}

/**
 * Disconnect WordPress connection metadata
 */
async function disconnectWordPressSession() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    await new Promise(r => chrome.storage.local.remove([
      "wp_connected_site", "wp_connected_user", "wp_connected_login", "wp_user_role",
      "wp_user_permissions", "wp_connected_at", "wp_auth_status"
    ], r));
  }
  return { success: true, message: "WordPress session disconnected" };
}

async function saveWordPressExtractedCredentials(credentials, siteUrl, adminUser, userRole, userPermissions, userLogin) {
  if (!credentials) return { success: false, message: "No credentials provided" };
  const c = credentials;
  const targetUrl = siteUrl ? String(siteUrl).trim().replace(/\/+$/, "") : "https://deencommerce.com";
  const user = adminUser || "Admin";
  const role = userRole || (user.toLowerCase().includes("admin") ? "Administrator" : "Shop Manager");
  const perm = userPermissions || (role === "Administrator" ? "Full Store & Settings Access (manage_options, manage_woocommerce)" : "WooCommerce & Courier Dispatch Access (manage_woocommerce)");
  const login = userLogin || user;

  const credPayload = {
    pathao_client_id: c.clientId || "",
    pathao_client_secret: c.clientSecret || "",
    pathao_username: c.username || "",
    pathao_password: c.password || "",
    pathao_bearer_token: c.bearerToken || "",
    pathao_store_id: c.storeId || "",
    steadfast_api_key: c.steadfastApiKey || "",
    steadfast_secret_key: c.steadfastSecretKey || "",
    wp_connected_site: targetUrl,
    wp_connected_user: user,
    wp_connected_login: login,
    wp_user_role: role,
    wp_user_permissions: perm,
    wp_connected_at: Date.now(),
    wp_auth_status: "connected"
  };

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    await new Promise(r => chrome.storage.local.set(credPayload, r));
    await new Promise(r => chrome.storage.local.remove(["pathao_merchant_token", "pathao_token_expiry"], r));
  }

  if (typeof self !== "undefined") {
    self.DEEN_ENV = Object.assign({}, self.DEEN_ENV || {}, {
      PATHAO_CLIENT_ID: credPayload.pathao_client_id,
      PATHAO_CLIENT_SECRET: credPayload.pathao_client_secret,
      PATHAO_USERNAME: credPayload.pathao_username,
      PATHAO_PASSWORD: credPayload.pathao_password,
      PATHAO_BEARER_TOKEN: credPayload.pathao_bearer_token
    });
  }

  if (credPayload.pathao_client_id && credPayload.pathao_client_secret && credPayload.pathao_username && credPayload.pathao_password) {
    issuePathaoTokenFromCredentials({
      clientId: credPayload.pathao_client_id,
      clientSecret: credPayload.pathao_client_secret,
      username: credPayload.pathao_username,
      password: credPayload.pathao_password
    }).catch(() => {});
  }

  return {
    success: true,
    credentialsFound: true,
    siteUrl: targetUrl,
    adminUser: user,
    userLogin: login,
    userRole: role,
    userPermissions: perm,
    clientId: credPayload.pathao_client_id ? credPayload.pathao_client_id.substring(0, 4) + "..." : "",
    username: credPayload.pathao_username,
    hasSecret: Boolean(credPayload.pathao_client_secret),
    hasPassword: Boolean(credPayload.pathao_password),
    hasBearerToken: Boolean(credPayload.pathao_bearer_token),
    hasSteadfast: Boolean(credPayload.steadfast_api_key),
    message: `Successfully connected as ${user} (${role}) & auto-synced API credentials!`
  };
}

/**
 * Handle background customer rating & courier intelligence lookup
 */
/**
 * Issue new Pathao access token using Developer API OAuth credentials (.env / env.js)
 */
async function issuePathaoTokenFromCredentials(creds) {
  if (!creds || !creds.clientId || !creds.clientSecret) {
    return null;
  }

  // 1. Try B2B External Login first (as used by WooCommerce Pathao Courier plugin)
  const externalEndpoints = [
    "https://api-hermes.pathao.com/aladdin/api/v1/external/login",
    "https://merchant.pathao.com/aladdin/api/v1/external/login"
  ];
  for (const ep of externalEndpoints) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const extResp = await fetch(ep, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({
          client_id: creds.clientId,
          client_secret: creds.clientSecret
        })
      });
      clearTimeout(timeoutId);
      if (extResp.ok) {
        const data = await extResp.json();
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
    } catch (e) { }
  }

  // 2. Legacy / Password grant fallback if username & password are provided
  if (creds.username && creds.password) {
    const issueEndpoints = [
      "https://api-hermes.pathao.com/aladdin/api/v1/issue-token",
      "https://merchant.pathao.com/aladdin/api/v1/issue-token"
    ];
    for (const ep of issueEndpoints) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const resp = await fetch(ep, {
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
      } catch (e) { }
    }
  }

  return null;
}

/**
 * Zero-Node Direct .env & Storage Runtime Loader
 * Automatically reads and parses .env file via fetch(chrome.runtime.getURL(".env"))
 * or retrieves credentials saved in chrome.storage.local without requiring Node.js.
 */
async function loadRuntimeEnv() {
  let envCreds = null;
  if (typeof self !== "undefined" && self.DEEN_ENV) {
    envCreds = Object.assign({}, self.DEEN_ENV);
  } else if (typeof DEEN_ENV !== "undefined") {
    envCreds = Object.assign({}, DEEN_ENV);
  }
  if (!envCreds && typeof require !== "undefined") {
    try { envCreds = Object.assign({}, require("./env.js")); } catch (e) { }
  }

  // 1. Check chrome.storage.local for credentials saved via popup/options UI
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      const stored = await new Promise(r => chrome.storage.local.get([
        "pathao_client_id", "pathao_client_secret", "pathao_username", "pathao_password", "pathao_bearer_token"
      ], r));
      if (stored && stored.pathao_client_id) {
        envCreds = Object.assign({}, envCreds || {}, {
          PATHAO_CLIENT_ID: stored.pathao_client_id || (envCreds ? envCreds.PATHAO_CLIENT_ID : ""),
          PATHAO_CLIENT_SECRET: stored.pathao_client_secret || (envCreds ? envCreds.PATHAO_CLIENT_SECRET : ""),
          PATHAO_USERNAME: stored.pathao_username || (envCreds ? envCreds.PATHAO_USERNAME : ""),
          PATHAO_PASSWORD: stored.pathao_password || (envCreds ? envCreds.PATHAO_PASSWORD : ""),
          PATHAO_BEARER_TOKEN: stored.pathao_bearer_token || (envCreds ? envCreds.PATHAO_BEARER_TOKEN : "")
        });
        if (typeof self !== "undefined") self.DEEN_ENV = envCreds;
      }
    } catch (e) { }
  }

  // 2. If credentials missing, fetch env.js or .env file directly from extension directory (Zero Node.js dependency)
  if (!envCreds || !envCreds.PATHAO_CLIENT_ID || !envCreds.PATHAO_CLIENT_SECRET) {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL && typeof fetch === "function") {
      try {
        const envJsUrl = chrome.runtime.getURL("env.js");
        const jsResp = await fetch(envJsUrl);
        if (jsResp && jsResp.ok) {
          const jsText = await jsResp.text();
          const cidMatch = jsText.match(/["']PATHAO_CLIENT_ID["']\s*:\s*["']([^"']+)["']/);
          const secMatch = jsText.match(/["']PATHAO_CLIENT_SECRET["']\s*:\s*["']([^"']+)["']/);
          const userMatch = jsText.match(/["']PATHAO_USERNAME["']\s*:\s*["']([^"']+)["']/);
          const passMatch = jsText.match(/["']PATHAO_PASSWORD["']\s*:\s*["']([^"']+)["']/);
          if (cidMatch && secMatch) {
            envCreds = Object.assign({}, envCreds || {}, {
              PATHAO_CLIENT_ID: cidMatch[1],
              PATHAO_CLIENT_SECRET: secMatch[1],
              PATHAO_USERNAME: userMatch ? userMatch[1] : "",
              PATHAO_PASSWORD: passMatch ? passMatch[1] : ""
            });
            if (typeof self !== "undefined") self.DEEN_ENV = envCreds;
          }
        }
      } catch (e) { }
    }
  }

  // 3. Fallback to .env file directly from extension directory
  if (!envCreds || !envCreds.PATHAO_CLIENT_ID || !envCreds.PATHAO_CLIENT_SECRET) {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL && typeof fetch === "function") {
      try {
        const envUrl = chrome.runtime.getURL(".env");
        const res = await fetch(envUrl);
        if (res && res.ok) {
          const text = await res.text();
          if (text && !text.includes("<html") && !text.includes("<!DOCTYPE")) {
            const parsed = {};
            const lines = text.split(/\r?\n/);
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith("#")) continue;
              const match = trimmed.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
              if (match) {
                const k = match[1].trim();
                const v = match[2].trim().replace(/^['"](.*)['"]$/, "$1");
                parsed[k] = v;
              }
            }
            if (Object.keys(parsed).length > 0) {
              envCreds = Object.assign({}, envCreds || {}, parsed);
              if (typeof self !== "undefined") self.DEEN_ENV = envCreds;
              if (chrome.storage && chrome.storage.local && parsed.PATHAO_CLIENT_ID) {
                chrome.storage.local.set({
                  "pathao_client_id": parsed.PATHAO_CLIENT_ID,
                  "pathao_client_secret": parsed.PATHAO_CLIENT_SECRET || "",
                  "pathao_username": parsed.PATHAO_USERNAME || "",
                  "pathao_password": parsed.PATHAO_PASSWORD || "",
                  "pathao_bearer_token": parsed.PATHAO_BEARER_TOKEN || ""
                });
              }
            }
          }
        }
      } catch (err) { }
    }
  }

  return envCreds;
}

/**
 * GitHub Auto-Update Checker for Unpacked Extension
 * Checks https://api.github.com/repos/Sajid-ul-Islam/chrome-extension-delivery-parser/commits/main
 * Compares latest remote commit against the installed commit SHA.
 */
const GITHUB_REPO = "Sajid-ul-Islam/chrome-extension-delivery-parser";
const INSTALLED_COMMIT_SHORT = "6f5e3f6"; // Fallback base commit

/**
 * Local version information resolver
 * Reads version.json or manifest.json dynamically without hardcoding
 */
async function getLocalVersionInfo() {
  let version = "1.2.1";
  let commit = INSTALLED_COMMIT_SHORT;

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest) {
    try {
      const manifest = chrome.runtime.getManifest();
      if (manifest && manifest.version) version = manifest.version;
    } catch (e) { }
  }

  if (typeof fetch === "function" && typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) {
    try {
      const res = await fetch(chrome.runtime.getURL("version.json"));
      if (res.ok) {
        const vJson = await res.json();
        if (vJson && vJson.commit) commit = vJson.commit;
        if (vJson && vJson.version) version = vJson.version;
      }
    } catch (e) { }
  }

  return {
    version: version,
    commit: commit ? commit.substring(0, 7) : INSTALLED_COMMIT_SHORT,
    commitFull: commit || INSTALLED_COMMIT_SHORT
  };
}

async function checkForExtensionUpdate(force = false) {
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return null;

  try {
    const local = await getLocalVersionInfo();
    const currentCommit = local.commit;

    const cached = await new Promise(r => chrome.storage.local.get([
      "deen_update_info", "deen_update_last_check", "deen_update_dismissed"
    ], r));

    const now = Date.now();
    // Cache for 30 minutes unless force is requested
    if (!force && cached && cached.deen_update_last_check && (now - cached.deen_update_last_check < 30 * 60 * 1000)) {
      if (cached.deen_update_info) {
        cached.deen_update_info.isDismissed = (cached.deen_update_dismissed === cached.deen_update_info.latestCommitFull);
        return cached.deen_update_info;
      }
    }

    if (typeof fetch !== "function") return null;

    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits/main`, {
      headers: { "Accept": "application/vnd.github.v3+json" }
    });

    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.sha) return null;

    const latestSha = data.sha;
    const latestShort = latestSha.substring(0, 7);
    const commitMsg = data.commit && data.commit.message ? data.commit.message.split("\n")[0] : "New update available";
    const commitDate = data.commit && data.commit.committer ? data.commit.committer.date : new Date().toISOString();

    const isDifferent = !latestSha.startsWith(currentCommit);
    const isDismissed = (cached && cached.deen_update_dismissed === latestSha);

    const updateInfo = {
      updateAvailable: isDifferent,
      isDismissed: isDismissed,
      currentCommit: currentCommit,
      currentVersion: local.version,
      latestCommit: latestShort,
      latestCommitFull: latestSha,
      commitMessage: commitMsg,
      commitDate: commitDate,
      downloadUrl: `https://github.com/${GITHUB_REPO}/archive/refs/heads/main.zip`,
      repoUrl: `https://github.com/${GITHUB_REPO}`,
      checkedAt: now
    };

    chrome.storage.local.set({
      "deen_update_info": updateInfo,
      "deen_update_last_check": now
    });

    return updateInfo;
  } catch (err) {
    return null;
  }
}

// Background auto-check on startup & install
if (typeof chrome !== "undefined" && chrome.runtime) {
  if (chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(() => {
      loadRuntimeEnv();
      checkForExtensionUpdate();
    });
  }
  if (chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(() => {
      loadRuntimeEnv();
      checkForExtensionUpdate(true);
    });
  }
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
    } catch (e) { }
  }

  // 2. Check credentials from loadRuntimeEnv() (reads env.js, .env directly, or chrome.storage.local)
  const envCreds = await loadRuntimeEnv();

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
      "jwt", "id_token", "idToken", "user_token", "api_token",
      "_p_token", "pathao_token", "auth._token.local", "auth.strategy", "bearer_token"
    ];
    for (const name of candidateNames) {
      try {
        const c = await new Promise(r => chrome.cookies.get({ url: "https://merchant.pathao.com", name: name }, r));
        if (c && c.value) {
          let val = c.value;
          try { val = decodeURIComponent(val); } catch (e) { }
          val = val.replace(/^Bearer\s+/i, "").trim();
          if (val.length > 20) return val;
        }
      } catch (e) { }
      try {
        const c = await new Promise(r => chrome.cookies.get({ url: "https://www.pathao.com", name: name }, r));
        if (c && c.value) {
          let val = c.value;
          try { val = decodeURIComponent(val); } catch (e) { }
          val = val.replace(/^Bearer\s+/i, "").trim();
          if (val.length > 20) return val;
        }
      } catch (e) { }
    }
    // Scan all pathao.com domain cookies for JWT pattern
    try {
      const all = await new Promise(r => chrome.cookies.getAll({ domain: "pathao.com" }, r));
      for (const c of (all || [])) {
        if (!c || !c.value) continue;
        let val = c.value;
        try { val = decodeURIComponent(val); } catch (e) { }
        val = val.replace(/^Bearer\s+/i, "").trim();
        if (val.startsWith("eyJ")) return val;
        if (val.length > 50 && /^[a-zA-Z0-9\-_\.]+$/.test(val)) return val;
      }
    } catch (e) { }
  }

  // 4. Fallback: If no direct Pathao credentials exist, auto-bridge to WooCommerce Pathao plugin
  try {
    const wcToken = await fetchPathaoTokenFromWooCommercePlugin();
    if (wcToken) return wcToken;
  } catch (e) { }

  return null;
}

/**
 * Auto-bridge to WooCommerce Pathao plugin to obtain credentials and issue token
 * when direct Pathao credentials do not exist in extension.
 */
async function fetchPathaoTokenFromWooCommercePlugin() {
  let targetUrl = "https://deencommerce.com";

  // 1. Check if user has a connected WordPress site in storage
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      const stored = await new Promise(r => chrome.storage.local.get(["wp_connected_site", "pathao_client_id", "pathao_client_secret", "pathao_username", "pathao_password"], r));
      if (stored && stored.wp_connected_site) {
        targetUrl = stored.wp_connected_site;
      }
      if (stored && stored.pathao_client_id && stored.pathao_client_secret) {
        const issued = await issuePathaoTokenFromCredentials({
          clientId: stored.pathao_client_id,
          clientSecret: stored.pathao_client_secret,
          username: stored.pathao_username || "",
          password: stored.pathao_password || ""
        });
        if (issued) return issued;
      }
    } catch (e) { }
  }

  // 2. Check open WooCommerce tabs in browser
  if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query) {
    try {
      const wcTabs = await new Promise(r => chrome.tabs.query({ url: ["*://*/wp-admin/*"] }, r));
      if (wcTabs && wcTabs.length > 0) {
        for (const tab of wcTabs) {
          if (tab.url) {
            try {
              const u = new URL(tab.url);
              targetUrl = u.origin;
            } catch (e) { }
          }
          const tabCreds = await new Promise(res => {
            const timer = setTimeout(() => res(null), 2500);
            chrome.tabs.sendMessage(tab.id, { action: "get_wc_pathao_credentials" }, (ans) => {
              clearTimeout(timer);
              if (chrome.runtime.lastError) void chrome.runtime.lastError.message;
              if (ans && ans.success && ans.credentials) res(ans.credentials);
              else res(null);
            });
          });

          if (tabCreds && (tabCreds.clientId || tabCreds.bearerToken)) {
            if (tabCreds.bearerToken) {
              return tabCreds.bearerToken;
            }
            if (tabCreds.clientId && tabCreds.clientSecret) {
              await saveWordPressExtractedCredentials(tabCreds, targetUrl, tabCreds.adminUser || "Admin", tabCreds.userRole, tabCreds.userPermissions, tabCreds.userLogin);
              const issued = await issuePathaoTokenFromCredentials(tabCreds);
              if (issued) return issued;
            }
          }
        }
      }
    } catch (e) { }
  }

  // 3. Proactive headless sync from WordPress admin settings
  try {
    const syncRes = await syncFromWordPressAdmin(targetUrl);
    if (syncRes && syncRes.credentialsFound) {
      const envCreds = await loadRuntimeEnv();
      if (envCreds && envCreds.PATHAO_CLIENT_ID && envCreds.PATHAO_CLIENT_SECRET) {
        const issued = await issuePathaoTokenFromCredentials({
          clientId: envCreds.PATHAO_CLIENT_ID,
          clientSecret: envCreds.PATHAO_CLIENT_SECRET,
          username: envCreds.PATHAO_USERNAME || "",
          password: envCreds.PATHAO_PASSWORD || ""
        });
        if (issued) return issued;
      }
    }
  } catch (e) { }

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
  } catch (e) { }
  return null;
}

const customerRatingMemoryCache = new Map();
const RATING_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache
const MAX_RATING_CACHE_ENTRIES = 500;

/**
 * Handle background customer rating & courier intelligence lookup
 */
async function handleCustomerRatingRequest(rawPhone, sendResponse, forceRefresh = false) {
  if (!rawPhone || (typeof rawPhone !== "string" && typeof rawPhone !== "number") || !String(rawPhone).trim()) {
    if (typeof sendResponse === "function") {
      sendResponse({ success: false, error: "Missing phone parameter", phone: "" });
    }
    return;
  }
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
        const cachedResult = Object.assign({}, memEntry.result, {
          cached: true,
          cacheSource: "memory",
          cachedAt: memEntry.timestamp,
          cacheAgeMs: Date.now() - memEntry.timestamp
        });
        sendResponse(cachedResult);
        return;
      }
    }
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      try {
        const store = await new Promise(r => chrome.storage.local.get(["customer_rating_cache"], r));
        const storedEntry = store && store.customer_rating_cache && store.customer_rating_cache[cleanPhone];
        if (storedEntry && storedEntry.timestamp && (Date.now() - storedEntry.timestamp < RATING_CACHE_TTL_MS) && storedEntry.result) {
          if (customerRatingMemoryCache.size >= MAX_RATING_CACHE_ENTRIES) {
            const oldestKey = customerRatingMemoryCache.keys().next().value;
            if (oldestKey) customerRatingMemoryCache.delete(oldestKey);
          }
          customerRatingMemoryCache.set(cleanPhone, storedEntry);
          const cachedResult = Object.assign({}, storedEntry.result, {
            cached: true,
            cacheSource: "storage",
            cachedAt: storedEntry.timestamp,
            cacheAgeMs: Date.now() - storedEntry.timestamp
          });
          sendResponse(cachedResult);
          return;
        } else if (storedEntry) {
          customerRatingMemoryCache.delete(cleanPhone);
        }
      } catch (cacheErr) { }
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
  } catch (e) { }

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
            } catch (e) { }

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
      } catch (scriptErr) { }
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
          } catch (e) { }
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
              } catch (e) { }
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
  } catch (histErr) { }

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

  // Cache result in memory map with max capacity enforcement
  if (customerRatingMemoryCache.size >= MAX_RATING_CACHE_ENTRIES) {
    const oldestKey = customerRatingMemoryCache.keys().next().value;
    if (oldestKey) customerRatingMemoryCache.delete(oldestKey);
  }
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
        if (keys.length > 500) {
          const oldestKey = keys.reduce((minK, k) => (cache[k].timestamp < cache[minK].timestamp ? k : minK), keys[0]);
          delete cache[oldestKey];
        }
        chrome.storage.local.set({ customer_rating_cache: cache });
      });
    } catch (persistErr) { }
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
          }).catch(() => { });
        }

        if (targetTab.windowId) {
          chrome.windows.update(targetTab.windowId, { focused: true });
        }
      } else {
        // Send autofill message to Pathao tab safely
        chrome.tabs.sendMessage(targetTab.id, {
          action: "autofill_pathao_recipient",
          data: data
        }).catch(() => { });
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
const ONLINE_ADDRESS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours cache
const MAX_ONLINE_ADDRESS_CACHE_ENTRIES = 500;

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
    } catch (e) { }
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
    try { buildFull = require("./parser.js").buildFullAddress; } catch (e) { }
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
    const cached = onlineAddressCache.get(cacheKey);
    const entryTime = (cached && cached.timestamp) ? cached.timestamp : (cached ? Date.now() : 0);
    if (Date.now() - entryTime < ONLINE_ADDRESS_CACHE_TTL_MS) {
      sendResponse(cached);
      return;
    } else {
      onlineAddressCache.delete(cacheKey);
    }
  }

  // 1. Try local parse first if district is explicit or specific zone is recognized
  let parseBD = typeof parseBDAddress !== "undefined" ? parseBDAddress : null;
  let buildFull = typeof buildFullAddress !== "undefined" ? buildFullAddress : null;
  if (typeof require !== "undefined") {
    try {
      const p = require("./parser.js");
      if (!parseBD) parseBD = p.parseBDAddress;
      if (!buildFull) buildFull = p.buildFullAddress;
    } catch (e) { }
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
        source: "Local Engine",
        timestamp: Date.now()
      };
      if (onlineAddressCache.size >= MAX_ONLINE_ADDRESS_CACHE_ENTRIES) {
        const oldestKey = onlineAddressCache.keys().next().value;
        if (oldestKey) onlineAddressCache.delete(oldestKey);
      }
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
    } catch (err) { }
  }

  if (resolvedResult) {
    resolvedResult.timestamp = Date.now();
    if (onlineAddressCache.size >= MAX_ONLINE_ADDRESS_CACHE_ENTRIES) {
      const oldestKey = onlineAddressCache.keys().next().value;
      if (oldestKey) onlineAddressCache.delete(oldestKey);
    }
    onlineAddressCache.set(cacheKey, resolvedResult);
    sendResponse(resolvedResult);
  } else {
    sendResponse({
      success: false,
      error: "Could not guess address online via OpenStreetMap"
    });
  }
}

/**
 * Periodic eviction for expired memory caches
 */
function pruneExpiredCaches() {
  const now = Date.now();
  for (const [phone, entry] of customerRatingMemoryCache.entries()) {
    if (!entry || !entry.timestamp || (now - entry.timestamp >= RATING_CACHE_TTL_MS)) {
      customerRatingMemoryCache.delete(phone);
    }
  }
  for (const [query, entry] of onlineAddressCache.entries()) {
    if (!entry || !entry.timestamp || (now - entry.timestamp >= ONLINE_ADDRESS_CACHE_TTL_MS)) {
      onlineAddressCache.delete(query);
    }
  }
}

if (typeof setInterval !== "undefined") {
  // Run cache prune every 15 minutes
  const pruneTimer = setInterval(pruneExpiredCaches, 15 * 60 * 1000);
  if (pruneTimer && typeof pruneTimer.unref === "function") {
    pruneTimer.unref();
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    handleCustomerRatingRequest,
    handleOnlineAddressGuess,
    parseNominatimAddressResult,
    onlineAddressCache,
    customerRatingMemoryCache,
    pruneExpiredCaches,
    RATING_CACHE_TTL_MS,
    ONLINE_ADDRESS_CACHE_TTL_MS,
    MAX_RATING_CACHE_ENTRIES,
    MAX_ONLINE_ADDRESS_CACHE_ENTRIES,
    extractCredentialsFromWordPressHTML,
    authenticateWordPressUser,
    syncFromWordPressAdmin,
    getWordPressConnectionStatus,
    disconnectWordPressSession,
    saveWordPressExtractedCredentials,
    issuePathaoTokenFromCredentials,
    loadRuntimeEnv,
    getPathaoToken,
    fetchPathaoTokenFromWooCommercePlugin
  };
}



