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
    setupContextMenus();
  });

  if (chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(() => {
      setupContextMenus();
    });
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

  // Handle messages from content scripts
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "sync_to_pathao") {
      findAndSyncPathaoTab(request.data, request.autoSwitch);
      sendResponse({ status: "sync_dispatched" });
    } else if (request.action === "focus_or_open_pathao") {
      focusOrOpenPathao();
      sendResponse({ status: "handled" });
    }
    return true;
  });
}

function findAndSyncPathaoTab(data, autoSwitch = false) {
  chrome.tabs.query({ url: ["*://merchant.pathao.com/*", "*://*.pathao.com/*"] }, (tabs) => {
    if (tabs && tabs.length > 0) {
      const pathaoTab = tabs[0];
      // Send autofill message to Pathao tab
      chrome.tabs.sendMessage(pathaoTab.id, {
        action: "autofill_pathao_recipient",
        data: data
      }, () => {
        if (chrome.runtime.lastError) {
          // Tab might be loading or on an un-injected subpage
        }
      });

      if (autoSwitch) {
        chrome.tabs.update(pathaoTab.id, { active: true });
        if (pathaoTab.windowId) {
          chrome.windows.update(pathaoTab.windowId, { focused: true });
        }
      }
    } else if (autoSwitch) {
      // Pathao is not currently open, open a new active tab directly!
      chrome.tabs.create({ url: "https://merchant.pathao.com/", active: true });
    }
  });
}

function focusOrOpenPathao() {
  chrome.tabs.query({ url: ["*://merchant.pathao.com/*", "*://*.pathao.com/*"] }, (tabs) => {
    if (tabs && tabs.length > 0) {
      const pathaoTab = tabs[0];
      chrome.tabs.update(pathaoTab.id, { active: true });
      if (pathaoTab.windowId) {
        chrome.windows.update(pathaoTab.windowId, { focused: true });
      }
    } else {
      chrome.tabs.create({ url: "https://merchant.pathao.com/", active: true });
    }
  });
}


