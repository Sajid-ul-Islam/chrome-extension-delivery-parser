/**
 * DEEN Delivery Parser - Background Service Worker (Manifest V3)
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log("DEEN Delivery Parser Extension Installed.");

  // Safely create context menu for quick parsing of selected text
  if (chrome.contextMenus) {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: "deen-parse-selection",
        title: "🧩 Parse Courier Records with DEEN Parser",
        contexts: ["selection"]
      });
    });
  }
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "deen-parse-selection" && info.selectionText) {
    // Store selected text into local storage for the popup to open and inspect
    chrome.storage.local.set({
      "pending_parse_text": info.selectionText,
      "pending_parse_source": "selection"
    }, () => {
      // Open the action popup or notify
      chrome.action.setBadgeText({ text: "NEW", tabId: tab ? tab.id : undefined });
      chrome.action.setBadgeBackgroundColor({ color: "#2563EB" });
    });
  }
});
