/**
 * DEEN Delivery Parser - Background Service Worker (Manifest V3)
 */

if (typeof chrome !== "undefined" && chrome.runtime) {
  function setupContextMenus() {
    if (chrome.contextMenus) {
      chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
          id: "deen-send-to-pathao",
          title: "⚡ Detect Customer in Pathao: %s",
          contexts: ["selection"]
        });

        chrome.contextMenus.create({
          id: "deen-parse-selection",
          title: "🧩 Parse Courier Records with DEEN Parser",
          contexts: ["selection"]
        });
      });
    }
  }

  chrome.runtime.onInstalled.addListener(() => {
    console.log("DEEN Delivery Parser Extension Installed.");
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove(["pathao_autofill_data"]);
    }
    setupContextMenus();
  });

  if (chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(() => {
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove(["pathao_autofill_data"]);
      }
      setupContextMenus();
    });
  }

  // Purge any stuck autofill data immediately on service worker start / reload
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.remove(["pathao_autofill_data"]);
  }

  // Register immediately as well
  setupContextMenus();

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
      }
    });
  }

  // Handle messages from content scripts or popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.action === "sync_to_pathao") {
      findAndSyncPathaoTab(request.data, request.autoSwitch);
      sendResponse({ status: "sync_dispatched" });
    } else if (request && request.action === "focus_or_open_pathao") {
      focusOrOpenPathao();
      sendResponse({ status: "handled" });
    } else {
      sendResponse({ status: "ignored" });
    }
    return false;
  });
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



