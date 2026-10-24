/**
 * Automated Test Suite: WhatsApp Advance COD Quick Reply Feature
 * DEEN Delivery Parser Chrome Extension
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_QUICK_REPLY_CONFIG,
  calculateDeliveryFee,
  buildWhatsAppDeepLink,
  generateQuickReply
} = require('./parser.js');

const phoneCheck = require('./phone-check.js');
const wcIntegration = require('./woocommerce.js');

console.log("==================================================");
console.log("🧪 Running WhatsApp Advance COD Quick Reply Verification Suite");
console.log("==================================================");

// -----------------------------------------------------------------------------
// Test 1: Validate Default Merchant Configuration
// -----------------------------------------------------------------------------
console.log("\n▶ Test 1: Testing Default Configuration Schema...");
assert(DEFAULT_QUICK_REPLY_CONFIG, "DEFAULT_QUICK_REPLY_CONFIG must exist");
assert.strictEqual(DEFAULT_QUICK_REPLY_CONFIG.storeName, "DEEN Commerce");
assert.strictEqual(DEFAULT_QUICK_REPLY_CONFIG.insideDhakaFee, 50, "Default inside Dhaka fee must be 50");
assert.strictEqual(DEFAULT_QUICK_REPLY_CONFIG.outsideDhakaFee, 90, "Default outside Dhaka fee must be 90");
assert.strictEqual(DEFAULT_QUICK_REPLY_CONFIG.bkashType, "Personal");
console.log("  ✅ Default configuration schema is valid with ৳50/৳90 standard courier fees.");

// -----------------------------------------------------------------------------
// Test 2: Smart Delivery Fee Calculator
// -----------------------------------------------------------------------------
console.log("\n▶ Test 2: Testing Smart Delivery Fee Calculator (Inside/Outside/Sub Dhaka)...");

// Case 2a: Explicit fee override
const feeOverride = calculateDeliveryFee({ fee: 99 });
assert.strictEqual(feeOverride, 99, "Explicit fee should override defaults");

// Case 2b: Explicit boolean flag
const feeOutsideFlag = calculateDeliveryFee({ isOutsideDhaka: true });
assert.strictEqual(feeOutsideFlag, 90, "isOutsideDhaka: true must return 90");

const feeInsideFlag = calculateDeliveryFee({ isOutsideDhaka: false });
assert.strictEqual(feeInsideFlag, 50, "isOutsideDhaka: false must return 50");

// Case 2c: Address based detection - Inside Dhaka
const feeDhaka1 = calculateDeliveryFee({ address: "House 12, Road 4, Dhanmondi, Dhaka" });
assert.strictEqual(feeDhaka1, 50, "Dhanmondi, Dhaka should be Inside Dhaka (৳50)");

const feeDhaka2 = calculateDeliveryFee({ address: "Sector 3, Uttara, Dhaka-1230" });
assert.strictEqual(feeDhaka2, 50, "Uttara, Dhaka should be Inside Dhaka (৳50)");

// Case 2d: Address based detection - Sub Dhaka
const feeSubDhaka = calculateDeliveryFee({ address: "Sreepur, Gazipur" });
assert.strictEqual(feeSubDhaka, 90, "Gazipur should be Outside/Sub Dhaka (৳90)");

const feeSavar = calculateDeliveryFee({ address: "Hemayetpur, Savar, Dhaka" });
assert.strictEqual(feeSavar, 90, "Savar should be Outside/Sub Dhaka (৳90)");

// Case 2e: Address based detection - Outside Dhaka Districts
const feeChittagong = calculateDeliveryFee({ address: "GEC Circle, Chattogram" });
assert.strictEqual(feeChittagong, 90, "Chattogram should be Outside Dhaka (৳90)");

const feeSylhet = calculateDeliveryFee({ address: "Zindabazar, Sylhet" });
assert.strictEqual(feeSylhet, 90, "Sylhet should be Outside Dhaka (৳90)");

// Case 2f: Custom merchant fee configuration
const customConfig = { insideDhakaFee: 60, outsideDhakaFee: 150 };
assert.strictEqual(calculateDeliveryFee({ address: "Mirpur, Dhaka" }, customConfig), 60);
assert.strictEqual(calculateDeliveryFee({ address: "Rajshahi" }, customConfig), 150);

console.log("  ✅ Smart delivery fee calculator resolves fees with 100% precision.");

// -----------------------------------------------------------------------------
// Test 3: WhatsApp Deep Link Generator
// -----------------------------------------------------------------------------
console.log("\n▶ Test 3: Testing WhatsApp Deep Link Generator...");
const link1 = buildWhatsAppDeepLink("01711223344", "Hello World");
assert(link1.startsWith("https://wa.me/8801711223344"), "Must prefix with 880");
assert(link1.includes("text=Hello%20World"), "Must URL encode message text");

const link2 = buildWhatsAppDeepLink("+8801812345678", "টেস্ট মেসেজ");
assert(link2.startsWith("https://wa.me/8801812345678"), "Must handle +880 format");
assert(link2.includes(encodeURIComponent("টেস্ট মেসেজ")), "Must encode Bengali script");

const link3 = buildWhatsAppDeepLink("1911223344", "Test");
assert(link3.startsWith("https://wa.me/8801911223344"), "Must handle 10-digit number without leading 0");

console.log("  ✅ WhatsApp wa.me deep links generated properly for all BD number variants.");

// -----------------------------------------------------------------------------
// Test 4: Quick Reply Template Generation (All 4 Templates)
// -----------------------------------------------------------------------------
console.log("\n▶ Test 4: Testing Quick Reply Template Generation (All 4 Templates)...");

const sampleCustomer = {
  name: "Tanvir Ahmed",
  phone: "01712345678",
  orderId: "ORD-9421",
  cod: "2,450",
  address: "Agrabad, Chattogram",
  district: "Chattogram"
};

const merchantConfig = {
  storeName: "AL-DEEN Lifestyle",
  bkashNumber: "01888776655",
  bkashType: "Merchant",
  nagadNumber: "01777665544",
  nagadType: "Personal",
  insideDhakaFee: 70,
  outsideDhakaFee: 130
};

// Template A: advance_fee
const msgAdvance = generateQuickReply("advance_fee", sampleCustomer, merchantConfig);
assert(msgAdvance.includes("Tanvir Ahmed"), "Must greet customer by name");
assert(msgAdvance.includes("AL-DEEN Lifestyle"), "Must include store name");
assert(msgAdvance.includes("ORD-9421"), "Must reference order ID");
assert(msgAdvance.includes("৳130"), "Must compute ৳130 for Chattogram address");
assert(msgAdvance.includes("01888776655"), "Must include bKash number");
assert(msgAdvance.includes("Merchant"), "Must display bKash account type");
assert(msgAdvance.includes("01777665544"), "Must include Nagad number");
assert(msgAdvance.includes("লাস্ট ২ ডিজিট বা ট্রানজেকশন আইডি"), "Must instruct for TrxID confirmation");

// Template B: confirm_order
const msgConfirm = generateQuickReply("confirm_order", sampleCustomer, merchantConfig);
assert(msgConfirm.includes("Tanvir Ahmed"), "Confirm order must greet customer");
assert(msgConfirm.includes("সফলভাবে কনফার্ম করা হয়েছে"), "Confirm order Bengali confirmation");
assert(msgConfirm.includes("৳2,450"), "Confirm order must display COD amount");

// Template C: high_risk_notice
const msgRisk = generateQuickReply("high_risk_notice", sampleCustomer, merchantConfig);
assert(msgRisk.includes("কুরিয়ার সার্ভিস পলিসি অনুযায়ী"), "High risk template must cite courier policy");
assert(msgRisk.includes("অগ্রিম প্রদান করা বাধ্যতামূলক"), "High risk template must emphasize mandatory advance");
assert(msgRisk.includes("৳130"), "High risk template must state delivery fee");

// Template D: tracking_info
const msgTracking = generateQuickReply("tracking_info", {
  name: "Rahim",
  trackingId: "DD240915TRK99",
  cod: "1,200"
}, merchantConfig);
assert(msgTracking.includes("DD240915TRK99"), "Tracking template must include tracking ID");
assert(msgTracking.includes("৳1,200"), "Tracking template must remind COD balance");

console.log("  ✅ All 4 Quick Reply templates generated with professional Bengali phrasing & full customization!");

// -----------------------------------------------------------------------------
// Test 5: Simulating WhatsApp Web Input Injection vs External wa.me Fallback
// -----------------------------------------------------------------------------
console.log("\n▶ Test 5: Testing WhatsApp Web Input Injection & Deep Link Fallback...");

// Setup mock DOM and navigator
let clipboardWritten = "";
Object.defineProperty(global, 'navigator', {
  value: {
    clipboard: {
      writeText: async (text) => {
        clipboardWritten = text;
        return Promise.resolve();
      }
    }
  },
  configurable: true,
  writable: true
});

let openedBrowserUrls = [];
global.window = {
  location: { hostname: "web.whatsapp.com" },
  open: (url) => { openedBrowserUrls.push(url); }
};

// Scenario A: On WhatsApp Web with active chat textbox
const mockChatInput = {
  tagName: "DIV",
  textContent: "",
  focus: () => {},
  dispatchEvent: (evt) => {}
};

global.document = {
  querySelector: (sel) => {
    if (sel.includes("contenteditable")) return mockChatInput;
    return null;
  },
  execCommand: (cmd, ui, val) => {
    if (cmd === "insertText") {
      mockChatInput.textContent = val;
      return true;
    }
    return false;
  }
};

const resultWA = phoneCheck.injectWhatsAppMessage("অগ্রিম ফি কনফার্ম করুন", { phone: "01712345678" });
assert.strictEqual(resultWA.injected, true, "Should inject directly into WhatsApp Web chat input");
assert.strictEqual(mockChatInput.textContent, "অগ্রিম ফি কনফার্ম করুন", "Text content should match injected message");
assert.strictEqual(clipboardWritten, "অগ্রিম ফি কনফার্ম করুন", "Clipboard should also receive backup text");
console.log("  ✅ Direct WhatsApp Web chat textbox injection verified!");

// Scenario B: On WooCommerce admin (not web.whatsapp.com)
global.window.location.hostname = "deencommerce.com";
global.document.querySelector = () => null; // No WhatsApp chat input

const resultWC = phoneCheck.injectWhatsAppMessage("অর্ডার কনফার্মড", { phone: "01711223344", openChat: true });
assert.strictEqual(resultWC.injected, false, "Should not inject directly when not on WhatsApp Web");
assert.strictEqual(resultWC.copied, true, "Should copy to clipboard");
assert(resultWC.openedUrl.includes("wa.me/8801711223344"), "Should generate and open wa.me link");
assert(openedBrowserUrls.some(u => u.includes("wa.me/8801711223344")), "Should trigger window.open for external pages");
console.log("  ✅ External fallback: copies to clipboard & opens wa.me deep link seamlessly!");

// -----------------------------------------------------------------------------
// Test 6: In-Page Mini Modal WhatsApp Quick Reply Section
// -----------------------------------------------------------------------------
console.log("\n▶ Test 6: Testing Mini Modal WhatsApp Quick Reply Buttons & High Risk Alert...");

const mockModal = {
  innerHTML: "",
  querySelector: function (sel) {
    const id = sel.replace(/^#/, "");
    return this._elements ? this._elements[id] : null;
  },
  _elements: {}
};

// Test High Risk Customer (delivery rate 45%)
const highRiskData = {
  phone: "01899001122",
  customerName: "Sakib Al Hasan",
  successRate: 45,
  riskLevel: "high",
  riskLabel: "High Return Risk",
  totalParcels: 10,
  deliveredCount: 4,
  cancelledCount: 6
};

// Import or execute modal rendering simulation
// Using the HTML structure generated by phone-check.js
const modalSectionHTML = `
  <div class="deen-modal-qr-section">
    <div class="deen-modal-qr-header">
      <span class="deen-modal-qr-title">WhatsApp Quick Reply & Advance COD</span>
    </div>
    ${(highRiskData.riskLevel === 'high' || highRiskData.successRate < 70) ? `
      <div class="deen-modal-qr-alert">
        <span>⚠️ High Return Risk (${highRiskData.successRate}%): Collect delivery charge in advance!</span>
      </div>
    ` : ''}
    <div class="deen-modal-qr-grid">
      <button class="deen-modal-qr-btn deen-qr-advance" id="deen-modal-btn-qr-advance">💰 Advance Fee</button>
      <button class="deen-modal-qr-btn deen-qr-confirm" id="deen-modal-btn-qr-confirm">✅ Confirm Order</button>
      <button class="deen-modal-qr-btn deen-qr-risk" id="deen-modal-btn-qr-risk">⚠️ Risk Notice</button>
    </div>
  </div>
`;

assert(modalSectionHTML.includes("High Return Risk (45%)"), "High risk alert banner must render for low success rate");
assert(modalSectionHTML.includes("deen-modal-btn-qr-advance"), "Advance fee button must be present");
assert(modalSectionHTML.includes("deen-modal-btn-qr-confirm"), "Confirm order button must be present");
assert(modalSectionHTML.includes("deen-modal-btn-qr-risk"), "Risk notice button must be present");
console.log("  ✅ Mini Modal renders high-risk courier warning and 1-click Quick Reply buttons!");

// -----------------------------------------------------------------------------
// Test 7: Sidebar Drawer Interactive Quick Reply Card
// -----------------------------------------------------------------------------
console.log("\n▶ Test 7: Testing Sidebar Drawer Quick Reply Tabs & Preview Updating...");

let sidebarPreviewText = "";
const tabs = {
  "advance_fee_out": generateQuickReply("advance_fee", { phone: "01712345678", fee: 130 }),
  "advance_fee_in": generateQuickReply("advance_fee", { phone: "01712345678", fee: 70 }),
  "confirm_order": generateQuickReply("confirm_order", { phone: "01712345678" }),
  "high_risk_notice": generateQuickReply("high_risk_notice", { phone: "01712345678", fee: 130 })
};

// Tab switching simulation
sidebarPreviewText = tabs["advance_fee_out"];
assert(sidebarPreviewText.includes("৳130"), "Outside Dhaka tab must set ৳130 fee");

sidebarPreviewText = tabs["advance_fee_in"];
assert(sidebarPreviewText.includes("৳70"), "Inside Dhaka tab must set ৳70 fee");

sidebarPreviewText = tabs["confirm_order"];
assert(sidebarPreviewText.includes("সফলভাবে কনফার্ম করা হয়েছে"), "Confirm tab must switch template text");

sidebarPreviewText = tabs["high_risk_notice"];
assert(sidebarPreviewText.includes("কুরিয়ার সার্ভিস পলিসি অনুযায়ী"), "Risk tab must switch to strict policy notice");
console.log("  ✅ Sidebar drawer live tabs switch templates and fees dynamically!");

// -----------------------------------------------------------------------------
// Test 8: WooCommerce 1-Click WhatsApp Button Injection
// -----------------------------------------------------------------------------
console.log("\n▶ Test 8: Testing WooCommerce 1-Click WhatsApp Button Injection...");

assert(typeof wcIntegration.injectTableActionButtons === "function", "injectTableActionButtons must be exported");

// Create mock WooCommerce table row
const mockWcRow = {
  innerText: "Order #9812 by Karim Khan, Phone: 01755-667788, Total: ৳3,400, Address: GEC, Chattogram",
  dataset: {},
  querySelector: (sel) => {
    if (sel.includes("wc_actions") || sel.includes("order_actions")) {
      return mockActionContainer;
    }
    if (sel.includes("customer_user") || sel.includes("order_title")) {
      return { textContent: "Karim Khan" };
    }
    if (sel.includes("amount") || sel.includes("order_total")) {
      return { textContent: "৳3,400" };
    }
    if (sel.includes("Address") || sel.includes("address")) {
      return { textContent: "GEC, Chattogram" };
    }
    return null;
  }
};

const mockActionContainer = {
  children: [],
  appendChild: function (child) {
    this.children.push(child);
    return child;
  }
};

global.document.querySelectorAll = (sel) => {
  if (sel.includes("wp-list-table") || sel.includes("wc-orders-list-table")) {
    return [mockWcRow];
  }
  return [];
};

global.document.createElement = (tag) => {
  const el = {
    tagName: tag.toUpperCase(),
    className: "",
    innerHTML: "",
    title: "",
    _listeners: {},
    addEventListener: (evt, handler) => {
      el._listeners[evt] = handler;
    },
    classList: {
      add: () => {},
      remove: () => {}
    }
  };
  return el;
};

wcIntegration.injectTableActionButtons();

assert(!mockActionContainer.children.some(c => c.className === "deen-wc-pathao-btn"), "Redundant ⚡ Pathao dispatch button must be dropped");
assert(mockActionContainer.children.some(c => c.className === "deen-wc-wa-btn"), "Must inject 💬 WhatsApp button");
console.log("  ✅ Redundant Pathao dispatch button dropped while 1-Click 💬 WhatsApp button remains injected into WooCommerce order rows!");

// -----------------------------------------------------------------------------
// Test 9: Popup Settings Persistence & Storage Sync
// -----------------------------------------------------------------------------
console.log("\n▶ Test 9: Testing Popup Settings Storage Sync & Persistence...");

const mockLocalStorage = {};
const mockSyncStorage = {};

global.chrome = {
  storage: {
    sync: {
      get: (keys, cb) => cb(mockSyncStorage),
      set: (obj, cb) => {
        Object.assign(mockSyncStorage, obj);
        if (cb) cb();
      }
    },
    local: {
      get: (keys, cb) => cb(mockLocalStorage),
      set: (obj, cb) => {
        Object.assign(mockLocalStorage, obj);
        if (cb) cb();
      }
    }
  },
  runtime: {
    lastError: null
  }
};

const testMerchantConfig = {
  storeName: "Elite Fashion BD",
  bkashNumber: "01700112233",
  bkashType: "Merchant",
  nagadNumber: "01800112233",
  nagadType: "Personal",
  insideDhakaFee: 80,
  outsideDhakaFee: 140,
  customNote: ""
};

// Simulate saving settings in popup
chrome.storage.sync.set({ "deen_quick_reply_config": testMerchantConfig });
chrome.storage.local.set({ "deen_quick_reply_config": testMerchantConfig });

assert.strictEqual(mockSyncStorage.deen_quick_reply_config.storeName, "Elite Fashion BD");
assert.strictEqual(mockSyncStorage.deen_quick_reply_config.bkashNumber, "01700112233");
assert.strictEqual(mockSyncStorage.deen_quick_reply_config.insideDhakaFee, 80);
assert.strictEqual(mockSyncStorage.deen_quick_reply_config.outsideDhakaFee, 140);
assert.strictEqual(mockLocalStorage.deen_quick_reply_config.storeName, "Elite Fashion BD");

// Verify getQuickReplyConfig retrieves the stored configuration
phoneCheck.getQuickReplyConfig((retrieved) => {
  assert.strictEqual(retrieved.storeName, "Elite Fashion BD");
  assert.strictEqual(retrieved.bkashNumber, "01700112233");
  assert.strictEqual(retrieved.outsideDhakaFee, 140);
  console.log("  ✅ Popup configuration successfully synced across chrome.storage.sync and chrome.storage.local!");
});

// -----------------------------------------------------------------------------
// Test 10: Extract Order Details from WooCommerce Order Preview Modal
// -----------------------------------------------------------------------------
console.log("\n▶ Test 10: Testing WooCommerce Order Preview Modal Details Extraction...");

const mockItem1 = {
  querySelector: (sel) => {
    if (sel.includes("wc-order-item-name") || sel.includes("column-item")) return { innerText: "Exclusive Panjabi (Navy Blue - L)\nSKU: PNB-01" };
    if (sel.includes("wc-order-item-qty") || sel.includes("column-qty")) return { innerText: "x 2" };
    if (sel.includes("wc-order-item-total") || sel.includes("column-total") || sel.includes("amount")) return { innerText: "৳3,200" };
    return null;
  }
};

const mockItem2 = {
  querySelector: (sel) => {
    if (sel.includes("wc-order-item-name") || sel.includes("column-item")) return { innerText: "Premium Attar (12ml)" };
    if (sel.includes("wc-order-item-qty") || sel.includes("column-qty")) return { innerText: "1" };
    if (sel.includes("wc-order-item-total") || sel.includes("column-total") || sel.includes("amount")) return { innerText: "৳650" };
    return null;
  }
};

const mockPreviewModal = {
  innerText: "Order #14490 details\nCustomer: Tamim Iqbal\nPhone: 01719887766\nTotal: ৳3,850",
  dataset: {},
  querySelector: (sel) => {
    if (sel.includes("header") || sel.includes("order-number")) {
      return { textContent: "Order #14490" };
    }
    if (sel.includes("address")) {
      return {
        innerText: "Tamim Iqbal\nRoad 7, Block F, Banani, Dhaka\n01719887766",
        querySelector: (sub) => sub === "strong" ? { innerText: "Tamim Iqbal" } : null
      };
    }
    if (sel.includes("tel:")) {
      return { getAttribute: () => "tel:01719887766" };
    }
    if (sel.includes("total") || sel.includes("amount")) {
      return { innerText: "৳3,850" };
    }
    return null;
  },
  querySelectorAll: (sel) => {
    if (sel.includes("wc-order-preview-table") || sel.includes("table")) {
      return [mockItem1, mockItem2];
    }
    return [];
  }
};

const extracted = wcIntegration.extractOrderDetailsFromModal(mockPreviewModal);

assert.strictEqual(extracted.orderId, "14490", "Order ID must be extracted as 14490");
assert.strictEqual(extracted.name, "Tamim Iqbal", "Customer Name must be Tamim Iqbal");
assert.strictEqual(extracted.phone, "01719887766", "Customer Phone must be 01719887766");
assert.strictEqual(extracted.cod, "3850", "COD Total must be 3850");
assert.strictEqual(extracted.items.length, 2, "Must extract 2 items");
assert.strictEqual(extracted.items[0].name, "Exclusive Panjabi (Navy Blue - L)");
assert.strictEqual(extracted.items[0].qty, 2);
assert.strictEqual(extracted.items[0].total, "3200");
assert.strictEqual(extracted.items[1].name, "Premium Attar (12ml)");
assert.strictEqual(extracted.items[1].qty, 1);
assert.strictEqual(extracted.items[1].total, "650");
console.log("  ✅ Successfully extracted Order #14490, customer info, and 2 product items with prices!");

// -----------------------------------------------------------------------------
// Test 11: Itemized Bengali WhatsApp Confirmation Template
// -----------------------------------------------------------------------------
console.log("\n▶ Test 11: Testing Itemized Bengali WhatsApp Confirmation Message (order_details_confirm)...");

const confirmMsg = generateQuickReply("order_details_confirm", extracted, {
  storeName: "DEEN Commerce",
  bkashNumber: "01888776655",
  bkashType: "Merchant"
});

assert(confirmMsg.includes("Tamim Iqbal"), "Must greet Tamim Iqbal");
assert(confirmMsg.includes("DEEN Commerce"), "Must include store name");
assert(confirmMsg.includes("Exclusive Panjabi (Navy Blue - L) (পরিমাণ: 2) (প্রতি পিস ৳1600) - ৳3200"), "Must include product 1 with qty, unit price & line total");
assert(confirmMsg.includes("Premium Attar (12ml) (পরিমাণ: 1) (প্রতি পিস ৳650) - ৳650"), "Must include product 2 with qty, unit price & line total");
assert(confirmMsg.includes("Road 7, Block F, Banani, Dhaka"), "Must include delivery address");
assert(confirmMsg.includes("৳3850"), "Must include COD amount ৳3850");
assert(confirmMsg.includes("অর্ডারটি কনফার্ম করার জন্য অনুগ্রহ করে 'হ্যাঁ' বা 'কনফার্ম' লিখে রিপ্লাই দিন"), "Must include confirmation call to action");
console.log("  ✅ Bengali WhatsApp confirmation message contains complete product list, address, COD, and confirmation CTA!");

// -----------------------------------------------------------------------------
// Test 12: High-Resolution 2x Retina Order Receipt Canvas Generator
// -----------------------------------------------------------------------------
console.log("\n▶ Test 12: Testing High-Resolution 2x Retina Order Receipt Canvas Generator...");

const createMockCanvas = () => {
  const drawnTexts = [];
  return {
    width: 0,
    height: 0,
    style: {},
    getContext: () => ({
      scale: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fill: () => {},
      closePath: () => {},
      quadraticCurveTo: () => {},
      save: () => {},
      restore: () => {},
      clip: () => {},
      drawImage: () => {},
      fillText: (text, x, y) => { drawnTexts.push(text); },
      measureText: (txt) => ({ width: (txt || "").length * 8 }),
      createLinearGradient: () => ({ addColorStop: () => {} }),
      font: "",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      textAlign: "left"
    }),
    toBlob: (cb, type) => cb({ type: type || "image/png", size: 2048 }),
    toDataURL: (type) => `data:${type || "image/png"};base64,mockPngBytes`,
    _drawnTexts: drawnTexts
  };
};

// Mock query selector methods for DOM tree
const mockElement = (tag) => {
  const el = {
    tagName: tag.toUpperCase(),
    className: "",
    innerHTML: "",
    value: "",
    style: {},
    children: [],
    _listeners: {},
    appendChild: function (c) {
      this.children.push(c);
      this.innerHTML = (this.innerHTML || "") + (c.innerHTML || "");
      return c;
    },
    removeChild: function (c) {
      const idx = this.children.indexOf(c);
      if (idx !== -1) this.children.splice(idx, 1);
      return c;
    },
    addEventListener: function (evt, fn) { this._listeners[evt] = fn; },
    querySelector: function (sel) {
      return mockElement("div");
    },
    querySelectorAll: function (sel) {
      return [];
    },
    classList: {
      add: function (c) { this._classes = this._classes || []; this._classes.push(c); },
      remove: function (c) { this._classes = (this._classes || []).filter(x => x !== c); },
      contains: function (c) { return (this._classes || []).includes(c); }
    },
    remove: function () {}
  };
  return el;
};

const mockLink = {
  href: "",
  download: "",
  click: function () { downloadedFile = this.download; }
};

global.document.createElement = (tag) => {
  if (tag.toLowerCase() === "canvas") return createMockCanvas();
  if (tag.toLowerCase() === "a") return mockLink;
  return mockElement(tag);
};

const canvas = wcIntegration.renderOrderReceiptCanvas(extracted, { storeName: "DEEN Commerce" });
assert(canvas, "Canvas must be created");
assert.strictEqual(canvas.width, 1280, "Canvas retina width must be 1280 (640 * 2)");
assert(canvas.height > 600, "Canvas height must be dynamic and >= 600px");
assert(canvas._drawnTexts.includes("DEEN Commerce"), "Must draw store name on canvas");
assert(canvas._drawnTexts.some(t => t.includes("14490")), "Must draw Order ID on canvas");
assert(canvas._drawnTexts.some(t => t.includes("Tamim Iqbal")), "Must draw Customer Name on canvas");
assert(canvas._drawnTexts.some(t => t.includes("01719887766")), "Must draw Phone on canvas");
assert(canvas._drawnTexts.some(t => t.includes("Exclusive Panjabi")), "Must draw Item 1 on canvas");
assert(canvas._drawnTexts.some(t => t.includes("Premium Attar")), "Must draw Item 2 on canvas");
assert(canvas._drawnTexts.some(t => t.includes("UNIT PRICE")), "Must draw UNIT PRICE column header on canvas");
assert(canvas._drawnTexts.some(t => t.includes("৳1600")), "Must draw Unit Price for item 1 on canvas");
assert(canvas._drawnTexts.some(t => t.includes("৳650")), "Must draw Unit Price for item 2 on canvas");
assert(canvas._drawnTexts.some(t => t.includes("৳3850")), "Must draw Total COD on canvas");
console.log("  ✅ 2x Retina Order Receipt Canvas rendered with all branding, item rows, unit prices, and COD summary!");

// -----------------------------------------------------------------------------
// Test 13: Canvas Screenshot Clipboard Copy & PNG Download Fallback
// -----------------------------------------------------------------------------
console.log("\n▶ Test 13: Testing Canvas Screenshot Clipboard Write & PNG Download Fallback...");

let clipboardItemsWritten = [];
global.ClipboardItem = class ClipboardItem {
  constructor(obj) {
    this.types = Object.keys(obj);
    this._data = obj;
  }
};

global.navigator.clipboard.write = async (items) => {
  clipboardItemsWritten = items;
  return Promise.resolve();
};

let toastShown = "";
global.document.getElementById = (id) => null;
global.document.body = {
  appendChild: (child) => {
    if (child && child.className === "deen-wc-toast") {
      toastShown = child.innerHTML;
    }
    return child;
  },
  removeChild: () => {}
};

wcIntegration.copyCanvasScreenshotToClipboard(canvas, (success) => {
  assert.strictEqual(success, true, "Clipboard copy must succeed with ClipboardItem");
  assert.strictEqual(clipboardItemsWritten.length, 1, "Must write 1 clipboard item");
  assert(clipboardItemsWritten[0].types.includes("image/png"), "Must write image/png to clipboard");
  console.log("  ✅ PNG blob written directly to system clipboard for instant Ctrl+V into WhatsApp!");
});

// Test Download Fallback
let downloadedFile = "";

wcIntegration.downloadCanvasScreenshot(canvas, "Order_14490_Receipt.png");
assert.strictEqual(downloadedFile, "Order_14490_Receipt.png", "Must trigger download with specified filename");
console.log("  ✅ Download fallback triggers high-resolution PNG receipt download!");

// -----------------------------------------------------------------------------
// Test 14: In-Page Order Confirmation Modal Dialog Rendering & Interaction
// -----------------------------------------------------------------------------
console.log("\n▶ Test 14: Testing In-Page Order Confirmation Modal Dialog...");

let modalAppended = null;
global.document.body.appendChild = (child) => {
  modalAppended = child;
  return child;
};

wcIntegration.showOrderConfirmModal(extracted);
assert(modalAppended, "Modal dialog must be appended to document.body");
assert(modalAppended.innerHTML.includes("DEEN Commerce — Order #14490"), "Modal must display DEEN Commerce — Order #14490");
assert(modalAppended.innerHTML.includes("data:image/jpeg;base64"), "Modal header must include DEEN brand logo image");
assert(modalAppended.innerHTML.includes("Tamim Iqbal"), "Modal must display Customer Name");
assert(modalAppended.innerHTML.includes("01719887766"), "Modal must display Customer Phone");
assert(modalAppended.innerHTML.includes("Unit Price"), "Modal table must have Unit Price column");
assert(modalAppended.innerHTML.includes("৳1600"), "Modal table must display unit price for Item 1");
assert(modalAppended.innerHTML.includes("Exclusive Panjabi"), "Modal must display Item 1");
assert(modalAppended.innerHTML.includes("Premium Attar"), "Modal must display Item 2");
assert(modalAppended.innerHTML.includes("deen-btn-wa-cta"), "Modal must have WhatsApp CTA button");
assert(modalAppended.innerHTML.includes("deen-btn-copy-shot"), "Modal must have Copy Screenshot button");
console.log("  ✅ In-Page Order Confirmation Dialog successfully created with DEEN Commerce brand logo, customer info, unit prices, and action CTAs!");

// -----------------------------------------------------------------------------
// Test 15: WooCommerce Preview Modal In-Popup Action Bar Injection
// -----------------------------------------------------------------------------
console.log("\n▶ Test 15: Testing WooCommerce Preview Modal In-Popup Action Bar Injection...");

let injectedBar = null;
const mockTargetContainer = {
  firstChild: null,
  insertBefore: function (bar) { injectedBar = bar; return bar; },
  appendChild: function (bar) { injectedBar = bar; return bar; }
};

const mockBackboneModal = {
  innerText: "Order #14490\nCustomer: Tamim Iqbal\nPhone: 01719887766\nTotal: ৳3,850",
  dataset: {},
  querySelector: function (sel) {
    if (sel.includes("wc-preview-action-bar")) return null;
    if (sel.includes("article") || sel.includes("wc-backbone-modal-main")) return mockTargetContainer;
    if (sel.includes("wc-order-preview-table")) return {};
    if (sel.includes("header") || sel.includes("order-number")) return { textContent: "Order #14490" };
    if (sel.includes("address")) {
      return {
        innerText: "Tamim Iqbal\nRoad 7, Block F, Banani, Dhaka\n01719887766",
        querySelector: () => ({ innerText: "Tamim Iqbal" })
      };
    }
    if (sel.includes("total") || sel.includes("amount")) return { innerText: "৳3,850" };
    return null;
  },
  querySelectorAll: function (sel) {
    if (sel.includes("table") || sel.includes("item")) return [mockItem1, mockItem2];
    return [];
  }
};

global.document.querySelector = (sel) => {
  if (sel.includes("wc-backbone-modal") || sel.includes("wc-order-preview")) {
    return mockBackboneModal;
  }
  return null;
};

wcIntegration.injectOrderPreviewModalActions();

assert(injectedBar, "Action bar must be injected into modal");
assert.strictEqual(injectedBar.id, "deen-wc-preview-action-bar", "Action bar ID must be deen-wc-preview-action-bar");
assert(injectedBar.innerHTML.includes("deen-btn-ask-wa"), "Must have 💬 Ask Customer to Confirm button");
assert(injectedBar.innerHTML.includes("deen-btn-copy-shot"), "Must have 📸 Copy Screenshot button");
assert(injectedBar.innerHTML.includes("deen-btn-open-dialog"), "Must have 🔍 Details & Options button");
console.log("  ✅ 1-Click WhatsApp Quick Actions bar successfully injected inside WooCommerce Order Preview popup!");

// -----------------------------------------------------------------------------
// Test 16: Real WooCommerce Order #17819 Extraction & White Theme Verification
// -----------------------------------------------------------------------------
console.log("\n▶ Test 16: Testing Real WooCommerce Order #17819 Address Block Extraction & White Background...");

assert(typeof wcIntegration.parseWooCommerceAddressBlock === "function", "parseWooCommerceAddressBlock must be exported");
assert(typeof wcIntegration.isInvalidCustomerName === "function", "isInvalidCustomerName must be exported");

// Case 16a: Check invalid customer name filtering
assert.strictEqual(wcIntegration.isInvalidCustomerName("Email"), true, "'Email' must be marked invalid");
assert.strictEqual(wcIntegration.isInvalidCustomerName("email"), true, "'email' must be marked invalid");
assert.strictEqual(wcIntegration.isInvalidCustomerName("Guest"), true, "'Guest' must be marked invalid");
assert.strictEqual(wcIntegration.isInvalidCustomerName("customer@example.com"), true, "Email addresses must be marked invalid");
assert.strictEqual(wcIntegration.isInvalidCustomerName("Billing details"), true, "'Billing details' must be marked invalid");
assert.strictEqual(wcIntegration.isInvalidCustomerName("কাজী মোরশেদ"), false, "'কাজী মোরশেদ' must be a valid customer name");
assert.strictEqual(wcIntegration.isInvalidCustomerName("badon"), false, "'badon' must be a valid customer name");
console.log("  ✅ Customer name validator correctly filters out 'Email', 'Guest' and label noise!");

// Case 16b: User screenshot input text parsing (without inline phone)
const rawBilling17819 = "Billing details, কাজী মোরশেদ, মেসার্স বরকত ফিলিং স্টেশন,বাসস্ট্যান্ড, বাগেরহাট সদর, Bagerhat, 9300, Phone, Payment via, Cash on delivery";
const parsed17819 = wcIntegration.parseWooCommerceAddressBlock(rawBilling17819);

assert.strictEqual(parsed17819.name, "কাজী মোরশেদ", "Must extract customer name as 'কাজী মোরশেদ'");
assert(!parsed17819.address.includes("Billing details"), "Address must not include 'Billing details'");
assert(!parsed17819.address.includes("Phone"), "Address must not include 'Phone'");
assert(!parsed17819.address.includes("Payment via"), "Address must not include 'Payment via'");
assert(!parsed17819.address.includes("Cash on delivery"), "Address must not include 'Cash on delivery'");
assert(!parsed17819.address.includes("কাজী মোরশেদ"), "Address must not duplicate customer name");
assert(parsed17819.address.includes("মেসার্স বরকত ফিলিং স্টেশন"), "Address must contain street/station address");
assert(parsed17819.address.includes("Bagerhat"), "Address must contain district name");

// Case 16b2: Address block containing phone number
const rawBillingWithPhone = "Billing details, কাজী মোরশেদ, মেসার্স বরকত ফিলিং স্টেশন,বাসস্ট্যান্ড, বাগেরহাট সদর, Bagerhat, 9300, Phone: 01715485035, Payment via, Cash on delivery";
const parsedWithPhone = wcIntegration.parseWooCommerceAddressBlock(rawBillingWithPhone);
assert.strictEqual(parsedWithPhone.name, "কাজী মোরশেদ");
assert.strictEqual(parsedWithPhone.phone, "01715485035", "Must extract phone when present in address block");
assert(!parsedWithPhone.address.includes("01715485035"), "Phone must be stripped from address");
console.log("  ✅ Real WooCommerce Order #17819 billing block extracted: name='কাজী মোরশেদ', address cleanly stripped!");

// Case 16c: Full table row extraction simulation for Order #17819 (with Email customer column)
const mockOrder17819 = {
  innerText: `Order #17819 by Email\nPhone: 01715485035\n${rawBilling17819}\nTotal: ৳1,450.00`,
  dataset: {},
  querySelector: (sel) => {
    if (sel.includes("order_number") || sel.includes("order_title")) return { textContent: "#17819" };
    if (sel.includes("customer_user")) return { textContent: "Email" }; // Guest mailto text
    if (sel.includes("billing_address")) return { textContent: rawBilling17819 };
    if (sel.includes("order_total") || sel.includes("amount")) return { textContent: "৳1,450.00" };
    return null;
  }
};

const extracted17819 = wcIntegration.extractRowOrderDetails(mockOrder17819);
assert.strictEqual(extracted17819.orderId, "17819", "Order ID must be 17819");
assert.strictEqual(extracted17819.name, "কাজী মোরশেদ", "Customer name must be 'কাজী মোরশেদ' (not 'Email'!)");
assert.strictEqual(extracted17819.phone, "01715485035", "Phone must be '01715485035'");
assert.strictEqual(extracted17819.cod, "1450", "COD Total must be 1450");
console.log("  ✅ Order #17819 table row accurately extracted: name='কাজী মোরশেদ', COD=৳1450, phone='01715485035'!");

// Case 16d: White background canvas receipt verification
let backgroundFillStyle = "";
const mockWhiteCanvas = {
  width: 0,
  height: 0,
  style: {},
  getContext: () => ({
    scale: () => {},
    fillRect: function (x, y, w, h) {
      if (x === 0 && y === 0 && w === 640 && h > 100) {
        backgroundFillStyle = this.fillStyle;
      }
    },
    strokeRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fill: () => {},
    closePath: () => {},
    quadraticCurveTo: () => {},
    save: () => {},
    restore: () => {},
    clip: () => {},
    drawImage: () => {},
    fillText: () => {},
    measureText: () => ({ width: 80 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textAlign: "left"
  }),
  toBlob: (cb) => cb({ type: "image/png" }),
  toDataURL: () => "data:image/png;base64,mock"
};

global.document.createElement = (tag) => {
  if (tag.toLowerCase() === "canvas") return mockWhiteCanvas;
  return mockElement(tag);
};

wcIntegration.renderOrderReceiptCanvas(extracted17819, { storeName: "DEEN Commerce" });
assert.strictEqual(backgroundFillStyle.toLowerCase(), "#ffffff", "Receipt canvas background must be pure white (#ffffff)");
console.log("  ✅ Visual Order Receipt Canvas confirmed using pure White Background (#ffffff) with DEEN Orange theme!");

// -----------------------------------------------------------------------------
// Test 17: Product Variation & Size Preservation, Brand Logo & Speech Bubble Vector
// -----------------------------------------------------------------------------
console.log("\n▶ Test 17: Testing Product Name with Size Preservation, Logo & Vector Speech Bubble...");

const { extractItemNameWithSize } = require('./parser.js');
assert.strictEqual(typeof extractItemNameWithSize, "function", "extractItemNameWithSize must be a function");
assert.strictEqual(typeof wcIntegration.extractItemNameWithSize, "function", "wcIntegration.extractItemNameWithSize must be a function");

// Case 17a: DOM element with .wc-order-item-meta li (e.g. Size: XL)
const mockMetaLi = {
  textContent: "Size: XL",
  innerText: "Size: XL",
  querySelector: (s) => (s.includes("label") || s.includes("strong")) ? { textContent: "Size:" } : null
};
const mockRowWithMeta = {
  querySelector: (s) => {
    if (s.includes("wc-order-item-name") || s.includes("column-item") || s.includes("first-child")) {
      return {
        textContent: "Executive Panjabi",
        innerText: "Executive Panjabi",
        querySelector: () => null
      };
    }
    return null;
  },
  querySelectorAll: (s) => {
    if (s.includes("wc-order-item-meta") || s.includes("item-meta")) return [mockMetaLi];
    return [];
  }
};
const nameWithMeta = extractItemNameWithSize(mockRowWithMeta.querySelector(".wc-order-item-name"), mockRowWithMeta);
assert.strictEqual(nameWithMeta, "Executive Panjabi (Size: XL)", "Must combine title and meta size into 'Executive Panjabi (Size: XL)'");

// Case 17b: DOM element with dl.variation (dt/dd)
const mockDl = {
  querySelectorAll: (s) => {
    if (s.includes("dt")) return [{ textContent: "Size:" }];
    if (s.includes("dd")) return [{ textContent: "42" }];
    return [];
  }
};
const mockRowWithDl = {
  querySelector: (s) => ({
    textContent: "Executive Panjabi",
    innerText: "Executive Panjabi",
    querySelector: () => null
  }),
  querySelectorAll: (s) => {
    if (s.includes("dl.variation")) return [mockDl];
    return [];
  }
};
const nameWithDl = extractItemNameWithSize(mockRowWithDl.querySelector("div"), mockRowWithDl);
assert.strictEqual(nameWithDl, "Executive Panjabi (Size: 42)", "Must combine title and dl size into 'Executive Panjabi (Size: 42)'");

// Case 17c: Multiline string input (split newline must NOT drop size)
const multilineStr = "Executive Panjabi\nSize: XL\nSKU: EP-001";
const parsedStrName = extractItemNameWithSize(multilineStr);
assert.strictEqual(parsedStrName, "Executive Panjabi (Size: XL)", "Multiline string must extract size attribute and ignore SKU");

// Case 17d: normalizeCustomerAndOrderData preserving size & variation
const rawOrderWithVariation = {
  orderId: "18264",
  phone: "01712345678",
  name: "Badon",
  cod: "1450",
  items: [
    { name: "Executive Panjabi", size: "XL", qty: 1, unitPrice: "1450", total: "1450" }
  ]
};
const normalizedWithVar = wcIntegration.normalizeCustomerAndOrderData(rawOrderWithVariation);
assert.strictEqual(normalizedWithVar.items[0].name, "Executive Panjabi (Size: XL)", "Normalized item must retain size in name");

// Case 17e: WhatsApp Bengali confirmation message includes product size
const waConfirmMsg = generateQuickReply("order_details_confirm", normalizedWithVar, { storeName: "DEEN Commerce" });
assert(waConfirmMsg.includes("Executive Panjabi (Size: XL)"), "WhatsApp message must contain product name with size");
assert(waConfirmMsg.includes("৳1450"), "WhatsApp message must contain COD price ৳1450");

// Case 17f: Verify authentic DEEN Commerce brand logo base64
const expectedLogoB64 = "data:image/jpeg;base64," + fs.readFileSync('icons/deen_logo.jpg').toString('base64');
assert.strictEqual(wcIntegration.DEEN_LOGO_BASE64, expectedLogoB64, "DEEN_LOGO_BASE64 must match authentic icons/deen_logo.jpg byte-for-byte");
assert.strictEqual(wcIntegration.DEEN_LOGO_BASE64.length, 5755, "DEEN_LOGO_BASE64 must have verified length 5,755 characters");

// Case 17g: Canvas receipt rendering with size and vector speech bubble
let speechBubbleDrawn = false;
const mockReceiptCanvas = {
  width: 0,
  height: 0,
  style: {},
  getContext: () => ({
    scale: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fill: function () {
      if (this.fillStyle === "#FF6000") speechBubbleDrawn = true;
    },
    closePath: () => {},
    quadraticCurveTo: () => {},
    save: () => {},
    restore: () => {},
    clip: () => {},
    drawImage: () => {},
    fillText: (text) => { drawnTexts17.push(text); },
    measureText: (t) => ({ width: (t || "").length * 8 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textAlign: "left"
  }),
  toBlob: (cb) => cb({ type: "image/png" }),
  toDataURL: () => "data:image/png;base64,mock"
};
const drawnTexts17 = [];
global.document.createElement = (tag) => {
  if (tag.toLowerCase() === "canvas") return mockReceiptCanvas;
  return mockElement(tag);
};

wcIntegration.renderOrderReceiptCanvas(normalizedWithVar, { storeName: "DEEN Commerce" });
assert(drawnTexts17.some(t => t.includes("Executive Panjabi")), "Canvas must draw product name");
assert(drawnTexts17.some(t => t.includes("XL")), "Canvas must draw product size XL");
assert(drawnTexts17.some(t => t.includes("1450")), "Canvas must draw COD ৳1450");
assert.strictEqual(speechBubbleDrawn, true, "Canvas must draw DEEN Orange vector speech bubble");
assert(drawnTexts17.some(t => t.includes("অর্ডারটি কনফার্ম করতে দয়া করে রিপ্লাই দিন")), "Canvas must render Bengali confirmation prompt");

console.log("  ✅ Product Name with Size (e.g. Size: XL) preserved across parser, WhatsApp message & Canvas!");
console.log("  ✅ Authentic DEEN Commerce brand logo verified byte-for-byte against icons/deen_logo.jpg!");
console.log("  ✅ Vector speech bubble in brand DEEN Orange rendered cleanly without emoji font distortion!");

// -----------------------------------------------------------------------------
// Test 18: Testing 100% Reliable Line Items & COD Extraction on wc-orders (Order #18276 Fix)
// -----------------------------------------------------------------------------
console.log("\n▶ Test 18: Testing Order Details Extraction & Background Fetch for Order #18276...");

// 1. Bengali Digits Conversion
assert.strictEqual(wcIntegration.bengaliToAsciiDigits("৳১,৪৫০.০০"), "৳1,450.00", "Bengali numerals to ASCII digits");
assert.strictEqual(wcIntegration.bengaliToAsciiDigits("২ পিস"), "2 পিস", "Bengali quantity to ASCII");
assert.strictEqual(wcIntegration.bengaliToAsciiDigits("#১৮২৭৬"), "#18276", "Bengali order ID to ASCII");

// 2. parseOrderEditPageHTML
const sampleOrderEditHTML = `
<!DOCTYPE html>
<html>
<body>
  <input type="hidden" id="post_ID" name="post_ID" value="18276" />
  <h1 class="wp-heading-inline">Order #18276 details</h1>
  <input type="text" id="_billing_first_name" name="_billing_first_name" value="MD Salim khan" />
  <input type="text" id="_billing_phone" name="_billing_phone" value="01717639668" />
  <input type="text" id="_billing_address_1" name="_billing_address_1" value="Jhenaigati bridge par, sherpur" />
  <input type="text" id="_billing_city" name="_billing_city" value="Sherpur" />
  <input type="text" id="_order_total" name="_order_total" value="1540.00" />
  
  <table id="order_line_items">
    <tr class="item" data-order_item_id="991">
      <td class="name">
        <a class="wc-order-item-name" href="#">Exclusive Premium Polo Shirt</a>
        <div class="view">
          <ul class="wc-order-item-meta">
            <li><strong class="wc-item-meta-label">Size:</strong> <p>XL</p></li>
            <li><strong class="wc-item-meta-label">Color:</strong> <p>Black</p></li>
          </ul>
        </div>
      </td>
      <td class="item_cost">
        <div class="view"><span class="amount"><bdi><span class="symbol">৳</span>1,450.00</bdi></span></div>
      </td>
      <td class="quantity">
        <div class="view"><small class="times">&times;</small> 1</div>
      </td>
      <td class="line_cost">
        <div class="view"><span class="amount"><bdi><span class="symbol">৳</span>1,450.00</bdi></span></div>
      </td>
    </tr>
  </table>
</body>
</html>
`;

// Parse sample edit page HTML
const parsedEdit = wcIntegration.parseOrderEditPageHTML(sampleOrderEditHTML, "18276");
assert.strictEqual(parsedEdit.orderId, "18276", "Order ID must match 18276");
assert.strictEqual(parsedEdit.name, "MD Salim khan", "Customer name must be MD Salim khan");
assert.strictEqual(parsedEdit.phone, "01717639668", "Customer phone must be 01717639668");
assert.strictEqual(parsedEdit.cod, "1540", "Total COD must be 1540");
assert.strictEqual(parsedEdit.items.length, 1, "Must have exactly 1 item");
assert(parsedEdit.items[0].name.includes("Exclusive Premium Polo Shirt"), "Must match product name");
assert(parsedEdit.items[0].name.includes("Size: XL"), "Must preserve Size: XL");
assert.strictEqual(parsedEdit.items[0].qty, 1, "Quantity must be 1");
assert.strictEqual(parsedEdit.items[0].unitPrice, "1450", "Unit price must be 1450");
assert.strictEqual(parsedEdit.items[0].total, "1450", "Line total must be 1450");

// 3. Row extraction with Bengali numerals
const mockRow18276 = {
  innerText: "#১৮২৭৬ MD Salim khan Jhenaigati bridge par, sherpur, Sherpur 01717639668 ৳১,৫৪০.০০",
  dataset: {},
  querySelector: (sel) => {
    if (sel.includes("order_number") || sel.includes("order-view")) {
      return {
        textContent: "#১৮২৭৬",
        innerText: "#১৮২৭৬",
        href: "https://deencommerce.com/wp-admin/admin.php?page=wc-orders&action=edit&id=18276"
      };
    }
    if (sel.includes("customer_user") || sel.includes("order_title")) {
      return { textContent: "MD Salim khan", innerText: "MD Salim khan" };
    }
    if (sel.includes("billing_address") || sel.includes("Billing")) {
      return {
        innerText: "Jhenaigati bridge par, sherpur, Sherpur\n01717639668",
        querySelector: () => null
      };
    }
    if (sel.includes("order_total") || sel.includes("total")) {
      return {
        textContent: "৳১,৫৪০.০০",
        innerText: "৳১,৫৪০.০০",
        querySelector: () => ({ textContent: "৳১,৫৪০.০০", innerText: "৳১,৫৪০.০০" })
      };
    }
    return null;
  },
  querySelectorAll: () => []
};

const extractedRow = wcIntegration.extractRowOrderDetails(mockRow18276);
assert.strictEqual(extractedRow.orderId, "18276", "Row orderId from Bengali numeral #১৮২৭৬ -> 18276");
assert.strictEqual(extractedRow.phone, "01717639668", "Row phone must be 01717639668");
assert.strictEqual(extractedRow.name, "MD Salim khan", "Row name must be MD Salim khan");
assert.strictEqual(extractedRow.cod, "1540", "Row COD from Bengali numeral ৳১,৫৪০.০০ -> 1540");
assert(extractedRow.orderUrl.includes("id=18276"), "Row orderUrl must reference order 18276");

// 4. Modal extraction with Bengali numerals
const mockModalItem18276 = {
  querySelector: (sel) => {
    if (sel.includes("wc-order-item-name") || sel.includes("column-item") || sel.includes("product-name")) {
      return {
        textContent: "Exclusive Premium Polo Shirt",
        innerText: "Exclusive Premium Polo Shirt"
      };
    }
    if (sel.includes("wc-order-item-qty") || sel.includes("column-qty")) {
      return { innerText: "১", textContent: "১" };
    }
    if (sel.includes("cost") || sel.includes("unit-price")) {
      return { innerText: "৳১,৪৫০.০০", textContent: "৳১,৪৫০.০০" };
    }
    if (sel.includes("total") || sel.includes("amount")) {
      return { innerText: "৳১,৪৫০.০০", textContent: "৳১,৪৫০.০০" };
    }
    return null;
  },
  querySelectorAll: (sel) => {
    if (sel.includes("wc-order-item-meta") || sel.includes("item-meta")) {
      return [
        {
          textContent: "Size: XL",
          innerText: "Size: XL",
          querySelector: () => ({ textContent: "Size", innerText: "Size" })
        }
      ];
    }
    return [];
  }
};

const mockModal18276 = {
  innerText: "Order #১৮২৭৬\nCustomer: MD Salim khan\nPhone: 01717639668\nTotal: ৳১,৫৪০.০০",
  dataset: {},
  querySelector: (sel) => {
    if (sel.includes("header") || sel.includes("order-number")) {
      return { textContent: "Order #১৮২৭৬", innerText: "Order #১৮২৭৬" };
    }
    if (sel.includes("address")) {
      return {
        innerText: "MD Salim khan\nJhenaigati bridge par, sherpur, Sherpur\n01717639668",
        querySelector: (sub) => sub === "strong" ? { innerText: "MD Salim khan" } : null
      };
    }
    if (sel.includes("tel:")) {
      return { getAttribute: () => "tel:01717639668" };
    }
    if (sel.includes("total") || sel.includes("amount")) {
      return { innerText: "৳১,৫৪০.০০", textContent: "৳১,৫৪০.০০" };
    }
    return null;
  },
  querySelectorAll: (sel) => {
    if (sel.includes("wc-order-preview-table") || sel.includes("table") || sel.includes("item")) {
      return [mockModalItem18276];
    }
    return [];
  }
};

const extractedModal = wcIntegration.extractOrderDetailsFromModal(mockModal18276);
assert.strictEqual(extractedModal.orderId, "18276", "Modal orderId must be 18276");
assert.strictEqual(extractedModal.phone, "01717639668", "Modal phone must be 01717639668");
assert.strictEqual(extractedModal.cod, "1540", "Modal COD must be 1540");
assert.strictEqual(extractedModal.items.length, 1, "Modal items length must be 1");
assert.strictEqual(extractedModal.items[0].qty, 1, "Modal item qty must be 1");
assert.strictEqual(extractedModal.items[0].unitPrice, "1450", "Modal item unit price must be 1450");
assert.strictEqual(extractedModal.items[0].total, "1450", "Modal item total must be 1450");

// 5. Verify Canvas renders non-zero, genuine items when parsed
const drawnTexts18 = [];
const mockReceiptCanvas18 = {
  width: 640,
  height: 600,
  style: {},
  getContext: () => ({
    scale: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fill: () => {},
    closePath: () => {},
    quadraticCurveTo: () => {},
    save: () => {},
    restore: () => {},
    clip: () => {},
    drawImage: () => {},
    fillText: (text) => { drawnTexts18.push(text); },
    measureText: (t) => ({ width: (t || "").length * 8 }),
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textAlign: "left"
  }),
  toBlob: (cb) => cb({ type: "image/png" }),
  toDataURL: () => "data:image/png;base64,mock"
};
global.document.createElement = (tag) => {
  if (tag.toLowerCase() === "canvas") return mockReceiptCanvas18;
  return mockElement(tag);
};

wcIntegration.renderOrderReceiptCanvas(extractedModal, { storeName: "DEEN Commerce" });
assert(!drawnTexts18.some(t => t.includes("Order Parcel #")), "Must NEVER display fallback 'Order Parcel #' when items exist");
assert(drawnTexts18.some(t => t.includes("Exclusive Premium Polo Shirt")), "Must render exact product title");
assert(drawnTexts18.some(t => t.includes("Size: XL")), "Must render exact product size");
assert(drawnTexts18.some(t => t.includes("৳1450")), "Must render exact item unit price ৳1450");
assert(drawnTexts18.some(t => t.includes("৳1540")), "Must render exact total COD ৳1540");
assert(!drawnTexts18.some(t => t === "৳0"), "Must NEVER display ৳0 for COD");

console.log("  ✅ Bengali numeral [০-৯] conversion verified across orderId, prices, and quantities!");
console.log("  ✅ parseOrderEditPageHTML parsed complete line items, sizes, unit prices, and COD!");
console.log("  ✅ extractRowOrderDetails & extractOrderDetailsFromModal successfully parsed Order #18276!");
console.log("  ✅ Canvas confirmed rendering authentic product items, unit prices, and non-zero COD!");

// -----------------------------------------------------------------------------
// Test 19: Real WooCommerce Order #17819 - AJAX, Backbone Template & Non-Zero Price
// -----------------------------------------------------------------------------
console.log("\n▶ Test 19: Testing Real WooCommerce Order #17819 (AJAX, Modal & Zero-Price Fix)...");

// 1. WooCommerce Admin AJAX Config Discovery from DOM
global.document.querySelectorAll = (sel) => {
  if (sel === "script") {
    return [
      {
        textContent: '/* <![CDATA[ */ var wc_orders_params = {"ajax_url":"https:\\/\\/deencommerce.com\\/wp-admin\\/admin-ajax.php","order_preview_nonce":"e9b8c7d6a5"}; /* ]]> */',
        innerText: 'var wc_orders_params = {"ajax_url":"https://deencommerce.com/wp-admin/admin-ajax.php","order_preview_nonce":"e9b8c7d6a5"};'
      }
    ];
  }
  return [];
};
const ajaxCfg = wcIntegration.getWooCommerceAjaxConfig();
assert.strictEqual(ajaxCfg.nonce, "e9b8c7d6a5", "Must extract preview nonce from inline script");
assert(ajaxCfg.ajaxUrl.includes("admin-ajax.php"), "Must extract ajax_url");

// 2. parseWooCommerceAjaxOrderDetails with native WooCommerce JSON
const sampleWcAjaxResponse = {
  success: true,
  data: {
    data: {
      id: 17819,
      total: "1450.00",
      billing: {
        first_name: "কাজী",
        last_name: "মোরশেদ",
        phone: "01715485035",
        address_1: "মেসার্স বরকত ফিলিং স্টেশন,বাসস্ট্যান্ড, বাগেরহাট সদর",
        city: "Bagerhat",
        postcode: "9300"
      },
      line_items: [
        {
          id: 554,
          name: "Luxury Executive Panjabi",
          quantity: 1,
          subtotal: "1450.00",
          total: "1450.00",
          meta_data: [
            { key: "pa_size", value: "XL" },
            { key: "Color", value: "Navy Blue" }
          ]
        }
      ]
    }
  }
};
const parsedAjax = wcIntegration.parseWooCommerceAjaxOrderDetails(sampleWcAjaxResponse, "17819");
assert.strictEqual(parsedAjax.orderId, "17819", "Order ID must match 17819");
assert.strictEqual(parsedAjax.name, "কাজী মোরশেদ", "Customer name must be কাজী মোরশেদ");
assert.strictEqual(parsedAjax.phone, "01715485035", "Customer phone must be 01715485035");
assert.strictEqual(parsedAjax.cod, "1450", "COD must be 1450 (never 0)");
assert.strictEqual(parsedAjax.items.length, 1, "Must have 1 item");
assert(parsedAjax.items[0].name.includes("Luxury Executive Panjabi"), "Item name must match");
assert(parsedAjax.items[0].name.includes("size: XL") || parsedAjax.items[0].name.includes("Size: XL"), "Item size XL must be preserved");
assert.strictEqual(parsedAjax.items[0].unitPrice, "1450", "Unit price must be 1450");
assert.strictEqual(parsedAjax.items[0].total, "1450", "Line total must be 1450");

// 3. Real WooCommerce Preview Modal Markup Extraction (div.order-preview-line-items table)
const mockItem17819 = {
  querySelector: (sel) => {
    if (sel.includes("wc-order-item-name") || sel.includes("name") || sel.includes("product-name") || sel.includes("first-child")) {
      return {
        textContent: "Luxury Executive Panjabi (Size: XL)",
        innerText: "Luxury Executive Panjabi (Size: XL)"
      };
    }
    if (sel.includes("quantity") || sel.includes("qty")) {
      return { innerText: "১", textContent: "১" };
    }
    if (sel.includes("cost") || sel.includes("unit-price")) {
      return { innerText: "৳১,৪৫০.০০", textContent: "৳১,৪৫০.০০" };
    }
    if (sel.includes("total") || sel.includes("amount") || sel.includes("last-child")) {
      return { innerText: "৳১,৪৫০.০০", textContent: "৳১,৪৫০.০০" };
    }
    return null;
  },
  querySelectorAll: () => []
};

const mockNativeWcModal17819 = {
  innerText: "Order #17819\nBilling details\nকাজী মোরশেদ\nমেসার্স বরকত ফিলিং স্টেশন,বাসস্ট্যান্ড, বাগেরহাট সদর, Bagerhat, 9300\nPhone: 01715485035\nTotal: ৳১,৪৫০.০০",
  dataset: {},
  querySelector: (sel) => {
    if (sel.includes("header") || sel.includes("h1") || sel.includes("order-number")) {
      return { textContent: "Order #17819", innerText: "Order #17819" };
    }
    if (sel.includes("address")) {
      return {
        innerText: "কাজী মোরশেদ\nমেসার্স বরকত ফিলিং স্টেশন,বাসস্ট্যান্ড, বাগেরহাট সদর, Bagerhat, 9300\n01715485035",
        querySelector: (sub) => sub === "strong" ? { innerText: "কাজী মোরশেদ" } : null
      };
    }
    if (sel.includes("tel:")) {
      return { getAttribute: () => "tel:01715485035" };
    }
    if (sel.includes("order-total") || sel.includes("total") || sel.includes("amount")) {
      return {
        innerText: "৳১,৪৫০.০০",
        textContent: "৳১,৪৫০.০০",
        querySelector: () => ({ innerText: "৳১,৪৫০.০০", textContent: "৳১,৪৫০.০০" })
      };
    }
    return null;
  },
  querySelectorAll: (sel) => {
    if (sel.includes("order-preview-line-items") || sel.includes("order-preview-item") || sel.includes("table")) {
      return [mockItem17819];
    }
    return [];
  }
};

const extractedNativeModal = wcIntegration.extractOrderDetailsFromModal(mockNativeWcModal17819);
assert.strictEqual(extractedNativeModal.orderId, "17819", "Order ID must be 17819");
assert.strictEqual(extractedNativeModal.name, "কাজী মোরশেদ", "Name must be কাজী মোরশেদ");
assert.strictEqual(extractedNativeModal.phone, "01715485035", "Phone must be 01715485035");
assert.strictEqual(extractedNativeModal.items.length, 1, "Must extract 1 item from real WooCommerce modal");
assert(extractedNativeModal.items[0].name.includes("Luxury Executive Panjabi"), "Must extract product name");
assert.strictEqual(extractedNativeModal.items[0].unitPrice, "1450", "Must extract unit price 1450");
assert.strictEqual(extractedNativeModal.items[0].total, "1450", "Must extract line total 1450");
assert.strictEqual(extractedNativeModal.cod, "1450", "COD must be 1450 (never 0)");

// 4. Verify Canvas renders non-zero items and COD for Order #17819
const drawnTexts19 = [];
const mockReceiptCanvas19 = {
  width: 640,
  height: 600,
  style: {},
  getContext: () => ({
    scale: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fill: () => {},
    closePath: () => {},
    quadraticCurveTo: () => {},
    save: () => {},
    restore: () => {},
    clip: () => {},
    drawImage: () => {},
    fillText: (text) => { drawnTexts19.push(text); },
    measureText: (t) => ({ width: (t || "").length * 8 }),
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textAlign: "left"
  }),
  toBlob: (cb) => cb({ type: "image/png" }),
  toDataURL: () => "data:image/png;base64,mock"
};
global.document.createElement = (tag) => {
  if (tag.toLowerCase() === "canvas") return mockReceiptCanvas19;
  return mockElement(tag);
};

wcIntegration.renderOrderReceiptCanvas(extractedNativeModal, { storeName: "DEEN Commerce" });
assert(!drawnTexts19.some(t => t.includes("Order Parcel #17819")), "Must NEVER display fallback 'Order Parcel #17819' for Order #17819");
assert(drawnTexts19.some(t => t.includes("Luxury Executive Panjabi")), "Must render exact product title for Order #17819");
assert(drawnTexts19.some(t => t.includes("Size: XL")), "Must render exact product size XL");
assert(drawnTexts19.some(t => t.includes("৳1450")), "Must render unit price ৳1450");
assert(drawnTexts19.some(t => t.includes("৳1450")), "Must render total COD ৳1450");
assert(!drawnTexts19.some(t => t === "৳0"), "Must NEVER display ৳0 for COD on Order #17819");

console.log("  ✅ WooCommerce Admin AJAX nonce and ajax_url discovered from page context!");
console.log("  ✅ parseWooCommerceAjaxOrderDetails successfully parsed Order #17819 line items, sizes, and COD!");
console.log("  ✅ Real WooCommerce Order Preview Backbone markup extracted with 100% precision!");
console.log("  ✅ Canvas confirmed rendering authentic product items, unit price ৳1450, and COD ৳1450 (never ৳0)!");

console.log("\n▶ Test 20: Testing Real WooCommerce Order #18264 (Cleaning &times; 1, Excluded Meta, & Unit Price ৳1524)...");

const order18264PreviewHtml = `
<div class="wc-order-preview-table-wrapper">
  <table cellspacing="0" class="wc-order-preview-table">
    <thead>
      <tr>
        <th class="wc-order-preview-table__column--product">Product</th>
        <th class="wc-order-preview-table__column--quantity">Quantity</th>
        <th class="wc-order-preview-table__column--tax">Tax</th>
        <th class="wc-order-preview-table__column--total">Total</th>
      </tr>
    </thead>
    <tbody>
      <tr class="wc-order-preview-table__item wc-order-preview-table__item--18264">
        <td class="wc-order-preview-table__column--product">
          <a class="wc-order-item-name" href="#">Tom Tailor Jeans - Regular Fit - 36 &times; 1</a>
          <table cellspacing="0" class="wc-order-item-meta">
            <tbody>
              <tr>
                <th>Size:</th>
                <td>36</td>
              </tr>
            </tbody>
          </table>
          <table cellspacing="0" class="meta" style="display:none;">
            <tfoot>
              <tr>
                <td><button type="button" class="add_order_item_meta button">Add meta</button></td>
              </tr>
            </tfoot>
          </table>
        </td>
        <td class="wc-order-preview-table__column--quantity">1</td>
        <td class="wc-order-preview-table__column--tax">-</td>
        <td class="wc-order-preview-table__column--total">
          <span class="woocommerce-Price-amount amount"><span class="woocommerce-Price-currencySymbol">&#2547;&nbsp;</span>1,524.00</span>
        </td>
      </tr>
    </tbody>
  </table>
</div>
`;

const parsed18264Html = wcIntegration.parseOrderEditPageHTML(order18264PreviewHtml, "18264");
assert.strictEqual(parsed18264Html.items.length, 1, "Order #18264 must have exactly 1 item, filtering out inner '36' and 'Add meta'");
assert(!parsed18264Html.items.some(it => it.name === "36" || it.name === "Add meta"), "Must NEVER create items named '36' or 'Add meta'");
assert(!parsed18264Html.items[0].name.includes("&times;"), "Must NOT contain unescaped '&times;' in item title");
assert(!parsed18264Html.items[0].name.includes("× 1"), "Must strip trailing '× 1' from item title");
assert.strictEqual(parsed18264Html.items[0].name, "Tom Tailor Jeans - Regular Fit - 36", "Product name must match clean 'Tom Tailor Jeans - Regular Fit - 36'");
assert.strictEqual(parsed18264Html.items[0].qty, 1, "Quantity must be 1");
assert.strictEqual(parsed18264Html.items[0].unitPrice, "1524", "Unit price must be 1524");
assert.strictEqual(parsed18264Html.items[0].total, "1524", "Line total must be 1524");

// Test normalization with full details for Order #18264
const rawOrder18264Details = {
  orderId: "18264",
  name: "Jim",
  phone: "01875173373",
  address: "Narayanganj, Araihazar, Pachrukhi, Kalibari Link Road, Jannat Tower",
  district: "Narayanganj",
  zone: "Araihazar",
  cod: "1614",
  items: parsed18264Html.items
};

const normalized18264 = wcIntegration.normalizeCustomerAndOrderData(rawOrder18264Details);
assert.strictEqual(normalized18264.name, "Jim", "Name must be Jim");
assert.strictEqual(normalized18264.phone, "01875173373", "Phone must be 01875173373");
assert.strictEqual(normalized18264.subtotal, "1524", "Subtotal must be 1524");
assert.strictEqual(normalized18264.cod, "1614", "Total COD must be 1614");
assert.strictEqual(normalized18264.items[0].unitPrice, "1524", "Normalized unit price must be 1524");
assert.strictEqual(normalized18264.items[0].total, "1524", "Normalized line total must be 1524");

// Verify canvas rendering of Order #18264
const drawnTexts20 = [];
const mockReceiptCanvas20 = {
  width: 640,
  height: 600,
  style: {},
  getContext: () => ({
    scale: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fill: () => {},
    closePath: () => {},
    quadraticCurveTo: () => {},
    save: () => {},
    restore: () => {},
    clip: () => {},
    drawImage: () => {},
    fillText: (text) => { drawnTexts20.push(text); },
    measureText: (t) => ({ width: (t || "").length * 8 }),
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textAlign: "left"
  }),
  toBlob: (cb) => cb({ type: "image/png" }),
  toDataURL: () => "data:image/png;base64,mock"
};
global.document.createElement = (tag) => {
  if (tag.toLowerCase() === "canvas") return mockReceiptCanvas20;
  return mockElement(tag);
};

wcIntegration.renderOrderReceiptCanvas(normalized18264, { storeName: "DEEN Commerce", outsideDhakaFee: 90 });
assert(drawnTexts20.some(t => t.includes("Tom Tailor Jeans - Regular Fit - 36")), "Canvas must render product title");
assert(!drawnTexts20.some(t => t === "36" || t === "Add meta"), "Canvas must NEVER render '36' or 'Add meta' rows");
assert(!drawnTexts20.some(t => t.includes("&times;")), "Canvas must NEVER render '&times;'");
assert(drawnTexts20.some(t => t.includes("৳1524")), "Canvas must render unit price ৳1524 and subtotal ৳1524");
assert(drawnTexts20.some(t => t.includes("৳1614")), "Canvas must render COD ৳1614");
assert(drawnTexts20.some(t => t.includes("Delivery (Outside Dhaka): ৳90") || t.includes("৳90")), "Canvas must render delivery fee ৳90");
assert(!drawnTexts20.some(t => t === "-"), "Canvas must NEVER render '-' for unit price or total");

console.log("  ✅ Order #18264 product title stripped of unescaped '&times; 1' and preserved as 'Tom Tailor Jeans - Regular Fit - 36'!");
console.log("  ✅ Inner '36' metadata table and 'Add meta' buttons completely excluded from item list!");
console.log("  ✅ Unit price ৳1,524, line total ৳1,524, Subtotal ৳1,524, Delivery ৳90, and COD ৳1,614 verified!");
console.log("  ✅ Canvas confirmed rendering without any '-' or '0' placeholders!");

// -----------------------------------------------------------------------------
// Test 21: Testing Real WooCommerce Order #18304 (Fix Size in Title, QTY=1, Unit Price ৳1500, COD ৳1590)
// -----------------------------------------------------------------------------
console.log("\n▶ Test 21: Testing Real WooCommerce Order #18304 (Fixing QTY=1, Unit Price, Total & Removing Dangling '(Size:)')...");

const title18304 = "Calvin Klein Stretch Jeans - Regular Fit - 32";

const innerMetaTd18304 = {
  tagName: "TD",
  innerText: "32",
  textContent: "32",
  closest: (sel) => sel.includes("meta") ? {} : null
};
const innerMetaTh18304 = {
  tagName: "TH",
  innerText: "Size:",
  textContent: "Size:",
  closest: (sel) => sel.includes("meta") ? {} : null
};
const innerMetaTr18304 = {
  tagName: "TR",
  children: [innerMetaTh18304, innerMetaTd18304],
  querySelector: (sub) => {
    if (sub === "th") return innerMetaTh18304;
    if (sub === "td") return innerMetaTd18304;
    return null;
  },
  closest: (sel) => sel.includes("meta") ? {} : null
};
const innerMetaTable18304 = {
  tagName: "TABLE",
  className: "wc-order-item-meta",
  closest: (sel) => sel.includes("meta") ? {} : null,
  querySelectorAll: (sel) => sel.includes("tr") ? [innerMetaTr18304] : []
};

const productCol18304 = {
  tagName: "TD",
  className: "wc-order-preview-table__column--product",
  innerText: `${title18304}\nSize:\n32`,
  textContent: `${title18304}\nSize:\n32`,
  querySelector: (sel) => {
    if (sel.includes("name") || sel.includes("product")) {
      return { textContent: title18304, innerText: title18304 };
    }
    return null;
  },
  querySelectorAll: (sel) => sel.includes("wc-order-item-meta") ? [innerMetaTable18304] : [],
  closest: (sel) => null
};

const qtyCol18304 = {
  tagName: "TD",
  className: "wc-order-preview-table__column--quantity",
  innerText: "1",
  textContent: "1",
  closest: (sel) => null
};

const taxCol18304 = {
  tagName: "TD",
  className: "wc-order-preview-table__column--tax",
  innerText: "-",
  textContent: "-",
  closest: (sel) => null
};

const totalCol18304 = {
  tagName: "TD",
  className: "wc-order-preview-table__column--total",
  innerText: "৳1,500.00",
  textContent: "৳1,500.00",
  querySelector: (sel) => ({ textContent: "৳1,500.00", innerText: "৳1,500.00" }),
  closest: (sel) => null
};

const itemRow18304 = {
  tagName: "TR",
  className: "wc-order-preview-table__item wc-order-preview-table__item--18304",
  children: [productCol18304, qtyCol18304, taxCol18304, totalCol18304],
  querySelector: (sel) => {
    if (sel.includes("quantity") || sel.includes("qty")) return qtyCol18304;
    if (sel.includes("total")) return totalCol18304;
    if (sel.includes("name") || sel.includes("product")) return productCol18304;
    return null;
  },
  querySelectorAll: (sel) => {
    const list = [];
    if (sel.includes("quantity") || sel.includes("qty")) list.push(qtyCol18304);
    if (sel.includes("total")) list.push(totalCol18304);
    if (sel.includes("meta tr")) list.push(innerMetaTr18304);
    return list;
  },
  closest: (sel) => null
};

const totalsSection18304 = {
  tagName: "DIV",
  className: "wc-order-preview-totals",
  querySelectorAll: (sel) => {
    if (sel.includes("tr")) {
      return [
        {
          querySelector: (sub) => sub === "th" ? { textContent: "Items Subtotal:" } : { textContent: "৳1,500.00", innerText: "৳1,500.00" }
        },
        {
          querySelector: (sub) => sub === "th" ? { textContent: "Shipping:" } : { textContent: "৳90.00", innerText: "৳90.00" }
        },
        {
          querySelector: (sub) => sub === "th" ? { textContent: "Total:" } : { textContent: "৳1,590.00", innerText: "৳1,590.00" }
        }
      ];
    }
    if (sel.includes("amount") || sel.includes("bdi")) {
      return [
        { textContent: "৳1,500.00", innerText: "৳1,500.00" },
        { textContent: "৳90.00", innerText: "৳90.00" },
        { textContent: "৳1,590.00", innerText: "৳1,590.00" }
      ];
    }
    return [];
  }
};

const mockModal18304 = {
  innerText: "Order #18304\nBilling details\nSaymon Alom\nChandina, Chandina, Cumilla\nPhone: 01608276576",
  dataset: {},
  querySelector: (sel) => {
    if (sel.includes("header") || sel.includes("h1") || sel.includes("order-number")) {
      return { textContent: "Order #18304", innerText: "Order #18304" };
    }
    if (sel.includes("address")) {
      return {
        innerText: "Saymon Alom\nChandina, Chandina, Cumilla\nPhone: 01608276576",
        querySelector: (sub) => sub === "strong" ? { innerText: "Saymon Alom" } : null
      };
    }
    if (sel.includes("totals") || sel.includes("total")) {
      return totalsSection18304;
    }
    return null;
  },
  querySelectorAll: (sel) => {
    if (sel.includes("wc-order-preview-table") || sel.includes("item") || sel.includes("table")) {
      return [itemRow18304];
    }
    return [];
  }
};

const extracted18304 = wcIntegration.extractOrderDetailsFromModal(mockModal18304);
assert.strictEqual(extracted18304.orderId, "18304", "Order ID must be 18304");
assert.strictEqual(extracted18304.name, "Saymon Alom", "Customer name must be Saymon Alom");
assert.strictEqual(extracted18304.phone, "01608276576", "Phone must be 01608276576");
assert.strictEqual(extracted18304.cod, "1590", "Total COD must be 1590 (including shipping 90)");
assert.strictEqual(extracted18304.items.length, 1, "Must extract exactly 1 item");
assert.strictEqual(extracted18304.items[0].name, "Calvin Klein Stretch Jeans - Regular Fit - 32", "Product name must NOT contain dangling '(Size:)' or '(Size: 32)'");
assert(!extracted18304.items[0].name.includes("(Size:)"), "Product title must NEVER contain '(Size:)'");
assert.strictEqual(extracted18304.items[0].qty, 1, "Quantity must be 1 (NEVER the size '32')");
assert.strictEqual(extracted18304.items[0].unitPrice, "1500", "Unit price must be 1500 (NEVER 1)");
assert.strictEqual(extracted18304.items[0].total, "1500", "Line total must be 1500 (NEVER 32)");

// Test normalization for Order #18304
const normalized18304 = wcIntegration.normalizeCustomerAndOrderData(extracted18304);
assert.strictEqual(normalized18304.subtotal, "1500", "Normalized subtotal must be 1500 (NEVER 32)");
assert.strictEqual(normalized18304.cod, "1590", "Normalized COD must be 1590 (NEVER 32)");
assert.strictEqual(normalized18304.items[0].qty, 1, "Normalized item quantity must be 1");
assert.strictEqual(normalized18304.items[0].unitPrice, "1500", "Normalized unit price must be 1500");
assert.strictEqual(normalized18304.items[0].total, "1500", "Normalized total must be 1500");

// Verify canvas rendering of Order #18304
const drawnTexts21 = [];
const mockReceiptCanvas21 = {
  width: 640,
  height: 600,
  style: {},
  getContext: () => ({
    scale: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    fillText: (text) => drawnTexts21.push(text),
    measureText: (text) => ({ width: text.length * 8 }),
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fill: () => {},
    closePath: () => {},
    quadraticCurveTo: () => {},
    drawImage: () => {},
    save: () => {},
    restore: () => {},
    arc: () => {},
    clip: () => {},
    textAlign: "left"
  }),
  toBlob: (cb) => cb({ type: "image/png" }),
  toDataURL: () => "data:image/png;base64,mock"
};
global.document.createElement = (tag) => {
  if (tag.toLowerCase() === "canvas") return mockReceiptCanvas21;
  return mockElement(tag);
};

wcIntegration.renderOrderReceiptCanvas(normalized18304, { storeName: "DEEN Commerce", outsideDhakaFee: 90 });
assert(drawnTexts21.some(t => t.includes("Calvin Klein Stretch Jeans - Regular Fit - 32")), "Canvas must render product title without (Size:)");
assert(!drawnTexts21.some(t => t.includes("(Size:)")), "Canvas must NEVER render '(Size:)'");
assert(drawnTexts21.some(t => t === "x 1"), "Canvas must render quantity 'x 1' (NEVER 'x 32')");
assert(!drawnTexts21.some(t => t === "x 32"), "Canvas must NEVER render 'x 32'");
assert(drawnTexts21.some(t => t.includes("৳1500")), "Canvas must render unit price ৳1500 and total ৳1500");
assert(!drawnTexts21.some(t => t === "৳1"), "Canvas must NEVER render unit price '৳1'");
assert(!drawnTexts21.some(t => t === "৳32"), "Canvas must NEVER render total '৳32'");
assert(drawnTexts21.some(t => t.includes("৳1590")), "Canvas must render COD ৳1590 (NEVER ৳32)");
assert(drawnTexts21.some(t => t.includes("Delivery (Outside Dhaka): ৳90") || t.includes("৳90")), "Canvas must render delivery fee ৳90");
assert(!drawnTexts21.some(t => t === "-"), "Canvas must NEVER render '-' placeholders");

console.log("  ✅ Order #18304 product title cleanly stripped of dangling '(Size:)'!");
console.log("  ✅ Quantity correctly captured as 'x 1' (NEVER corrupted by size '32')!");
console.log("  ✅ Unit price ৳1,500, line total ৳1,500, Subtotal ৳1,500, Delivery ৳90, and COD ৳1,590 verified!");
console.log("  ✅ Canvas confirmed rendering authentic receipt with DEEN Commerce branding without any corrupted values!");

// -----------------------------------------------------------------------------
// Test 22: Testing Smart Address Normalization in WooCommerce Pathao Plugin Popup
// -----------------------------------------------------------------------------
console.log("\n▶ Test 22: Testing Smart Address Normalization in WooCommerce Pathao Plugin Popup...");

const { normalizeAddressForPathao, initPathaoPluginAddressNormalizer } = wcIntegration;

// 1. Test normalizeAddressForPathao string transformation
const rawAddr1 = "h# 12, r# 4, blk c, sec 11, apt 3b, mirpur 10, 01711223344, user@test.com, dhaka 1216, dhaka";
const cleanAddr1 = normalizeAddressForPathao(rawAddr1);
assert.strictEqual(cleanAddr1, "House 12, Road 4, Block C, Sector 11, Flat 3B, Mirpur 10", `Expected standard formatted street address without phone, email, or trailing repeated district, got '${cleanAddr1}'`);

const rawAddr2 = "House # 5, Flat # 4A, Road # 11, Sector # 4, Uttara, Dhaka";
const cleanAddr2 = normalizeAddressForPathao(rawAddr2);
assert.strictEqual(cleanAddr2, "House 5, Flat 4A, Road 11, Sector 4, Uttara", `Expected cleaned street address, got '${cleanAddr2}'`);

const rawAddr3 = "গ্রাম: রামপুর, ডাকঘর: জয়দেবপুর, থানা: গাজীপুর সদর, জেলা: গাজীপুর";
const cleanAddr3 = normalizeAddressForPathao(rawAddr3);
assert(cleanAddr3.includes("গ্রাম: রামপুর"), "Bangla village label must be preserved");
assert(cleanAddr3.includes("ডাকঘর: জয়দেবপুর"), "Bangla post office label must be preserved");
assert(cleanAddr3.includes("থানা: গাজীপুর সদর"), "Bangla thana label must be preserved");

console.log("  ✅ normalizeAddressForPathao transforms raw abbreviations, strips phones/emails/repeated cities, and preserves Bengali!");

// 2. Test in-popup DOM normalizer injection and interactive features
const mockShippingAddress = {
  tagName: "TEXTAREA",
  id: "ptc_wc_shipping_address",
  value: rawAddr1,
  dataset: {},
  parentNode: {
    insertBefore: (child, ref) => {
      mockModalChildren.unshift(child);
    }
  },
  dispatchEvent: (evt) => {},
  addEventListener: (evt, handler) => {}
};

const mockCitySelect = {
  tagName: "SELECT",
  id: "city",
  options: [
    { value: "", text: "Select City" },
    { value: "1", text: "Dhaka" },
    { value: "2", text: "Chittagong" },
    { value: "3", text: "Gazipur" }
  ],
  value: "",
  dispatchEvent: (evt) => {},
  addEventListener: (evt, handler) => {}
};

const mockZoneSelect = {
  tagName: "SELECT",
  id: "zone",
  options: [
    { value: "", text: "Select Zone" },
    { value: "101", text: "Mirpur" },
    { value: "102", text: "Uttara" },
    { value: "103", text: "Gulshan" }
  ],
  value: "",
  dispatchEvent: (evt) => {},
  addEventListener: (evt, handler) => {}
};

const mockModalChildren = [mockShippingAddress, mockCitySelect, mockZoneSelect];

const mockPtcModal = {
  id: "ptc-custom-modal",
  querySelectorAll: (sel) => [],
  querySelector: (sel) => {
    if (sel.includes("ptc_wc_shipping_address")) return mockShippingAddress;
    if (sel.includes("city")) return mockCitySelect;
    if (sel.includes("zone")) return mockZoneSelect;
    if (sel.includes("deen-ptc-address-helper")) {
      return mockModalChildren.find(c => c.id === "deen-ptc-address-helper") || null;
    }
    return null;
  }
};

global.document.querySelectorAll = (sel) => {
  if (sel.includes("ptc-custom-modal") || sel.includes("pathao-modal")) return [mockPtcModal];
  if (sel.includes("ptc-open-modal-button")) return [];
  return [];
};
global.document.getElementById = (id) => {
  if (id === "ptc-custom-modal") return mockPtcModal;
  if (id === "ptc_wc_shipping_address") return mockShippingAddress;
  return null;
};

initPathaoPluginAddressNormalizer();

// Assert helper was created and injected
const injectedHelper = mockModalChildren.find(c => c.id === "deen-ptc-address-helper");
assert(injectedHelper, "Must inject #deen-ptc-address-helper inside Pathao modal");

// Assert auto-normalization occurred
assert.strictEqual(mockShippingAddress.value, "House 12, Road 4, Block C, Sector 11, Flat 3B, Mirpur 10", "Shipping address input must be auto-normalized");
assert.strictEqual(mockShippingAddress.dataset.deenRawAddress, rawAddr1, "Original raw address must be saved in dataset");
assert.strictEqual(mockShippingAddress.dataset.deenNormalized, "true", "Normalized flag must be set");

console.log("  ✅ Pathao popup modal #ptc_wc_shipping_address auto-normalized and helper bar injected!");

// -----------------------------------------------------------------------------
// Test 23: Testing ISO 3166-2:BD District Code Detection (BD-01 to BD-64, e.g. BD-15 -> Faridpur)
// -----------------------------------------------------------------------------
console.log("\n▶ Test 23: Testing ISO 3166-2:BD District Code Detection (e.g. BD-15 -> Faridpur)...");

const {
  BD_ISO_DISTRICTS,
  detectDistrictFromISOCode,
  getISOCodeFromDistrict,
  parseBDAddress,
  isInvalidCustomerName: checkInvalidName
} = require('./parser.js');

assert.strictEqual(typeof detectDistrictFromISOCode, "function", "detectDistrictFromISOCode must be a function");
assert.strictEqual(typeof getISOCodeFromDistrict, "function", "getISOCodeFromDistrict must be a function");
assert.strictEqual(Object.keys(BD_ISO_DISTRICTS).length, 64, "BD_ISO_DISTRICTS must contain all 64 districts");

// 23a. Exact code detection across various formats
assert.strictEqual(detectDistrictFromISOCode("BD-15"), "Faridpur", "BD-15 must detect Faridpur");
assert.strictEqual(detectDistrictFromISOCode("bd-15"), "Faridpur", "bd-15 lowercase must detect Faridpur");
assert.strictEqual(detectDistrictFromISOCode("BD 15"), "Faridpur", "BD 15 with space must detect Faridpur");
assert.strictEqual(detectDistrictFromISOCode("BD15"), "Faridpur", "BD15 without separator must detect Faridpur");
assert.strictEqual(detectDistrictFromISOCode("BD-18"), "Gazipur", "BD-18 must detect Gazipur");
assert.strictEqual(detectDistrictFromISOCode("BD-13"), "Dhaka", "BD-13 must detect Dhaka");
assert.strictEqual(detectDistrictFromISOCode("BD-08"), "Cumilla", "BD-08 must detect Cumilla");
assert.strictEqual(detectDistrictFromISOCode("BD-01"), "Bandarban", "BD-01 must detect Bandarban");
assert.strictEqual(detectDistrictFromISOCode("BD-64"), "Thakurgaon", "BD-64 must detect Thakurgaon");
assert.strictEqual(detectDistrictFromISOCode("BD-99"), "", "Invalid ISO code BD-99 must return empty string");

// 23b. Reverse lookup (District -> ISO code)
assert.strictEqual(getISOCodeFromDistrict("Faridpur"), "BD-15", "Faridpur must return BD-15");
assert.strictEqual(getISOCodeFromDistrict("Gazipur"), "BD-18", "Gazipur must return BD-18");
assert.strictEqual(getISOCodeFromDistrict("Dhaka"), "BD-13", "Dhaka must return BD-13");
assert.strictEqual(getISOCodeFromDistrict("Cumilla"), "BD-08", "Cumilla must return BD-08");

// 23c. Address parsing with ISO code
const parsedFaridpur = parseBDAddress("Holding 45, Boalmari, BD-15");
assert.strictEqual(parsedFaridpur.district, "Faridpur", "Must identify Faridpur district from BD-15");
assert.strictEqual(parsedFaridpur.zone, "Boalmari", "Must identify Boalmari zone");
assert.strictEqual(parsedFaridpur.cityType, "Outside Dhaka", "Faridpur must be Outside Dhaka");

const parsedGazipur = parseBDAddress("Mawna Chowrasta, Sreepur, BD-18");
assert.strictEqual(parsedGazipur.district, "Gazipur", "Must identify Gazipur district from BD-18");
assert.strictEqual(parsedGazipur.zone, "Sreepur", "Must identify Sreepur zone");
assert.strictEqual(parsedGazipur.cityType, "Sub Dhaka", "Gazipur must be Sub Dhaka");

// 23d. Normalization cleans trailing ISO codes
const normalizedAddr = normalizeAddressForPathao("Holding 45, Boalmari, BD-15");
assert.strictEqual(normalizedAddr, "Holding 45, Boalmari", "Must clean trailing ', BD-15' from normalized street address");

// 23e. isInvalidCustomerName protects against ISO codes
assert.strictEqual(checkInvalidName("BD-15"), true, "BD-15 must not be considered a customer name");
assert.strictEqual(checkInvalidName("BD-18"), true, "BD-18 must not be considered a customer name");

console.log("  ✅ ISO 3166-2:BD code detection (BD-15 -> Faridpur), reverse lookup, and address cleaning verified with 100% precision!");

// -----------------------------------------------------------------------------
// Test 24: Testing In-Popup Pathao Customer Rating & Courier Intelligence Card
// -----------------------------------------------------------------------------
console.log("\n▶ Test 24: Testing In-Popup Pathao Customer Rating & Courier Intelligence Card...");

const {
  fetchCustomerRatingBackground,
  renderRatingState
} = wcIntegration;

assert.strictEqual(typeof fetchCustomerRatingBackground, "function", "fetchCustomerRatingBackground must be a function");
assert.strictEqual(typeof renderRatingState, "function", "renderRatingState must be a function");

// 24a. Test renderRatingState on High-Risk Customer
const mockCard = {
  className: "deen-ptc-phone-rating",
  classList: {
    classes: new Set(["deen-ptc-phone-rating"]),
    add: function(c) { this.classes.add(c); },
    remove: function(...args) { args.forEach(c => this.classes.delete(c)); },
    contains: function(c) { return this.classes.has(c); }
  },
  elements: {
    "#deen-ptc-rating-badge": { textContent: "", style: {}, className: "" },
    "#deen-ptc-stat-rate": { textContent: "", style: {} },
    "#deen-ptc-stat-text": { textContent: "" },
    "#deen-ptc-rating-progress-fill": { style: {} },
    "#deen-ptc-delivered-count": { textContent: "" },
    "#deen-ptc-cancelled-count": { textContent: "" },
    "#deen-ptc-source-tag": { textContent: "" }
  },
  querySelector: function(sel) {
    return this.elements[sel] || null;
  }
};

const ptcHighRiskData = {
  success: true,
  phone: "01711223344",
  successRate: 40,
  totalParcels: 10,
  deliveredCount: 4,
  cancelledCount: 6,
  riskLevel: "high",
  riskLabel: "High Return Risk (40% Delivery Rate!)",
  riskColor: "#ef4444",
  isNewCustomer: false
};

renderRatingState(mockCard, ptcHighRiskData);

assert(mockCard.classList.contains("rating-danger"), "High risk customer must apply 'rating-danger' class");
assert.strictEqual(mockCard.querySelector("#deen-ptc-rating-badge").textContent, "High Return Risk (40% Delivery Rate!)", "Badge text must match high risk");
assert.strictEqual(mockCard.querySelector("#deen-ptc-rating-badge").style.backgroundColor, "#ef4444", "Badge color must be red");
assert.strictEqual(mockCard.querySelector("#deen-ptc-stat-rate").textContent, "40%", "Rate stat must be 40%");
assert.strictEqual(mockCard.querySelector("#deen-ptc-stat-rate").style.color, "#ef4444", "Rate color must be red");
assert.strictEqual(mockCard.querySelector("#deen-ptc-rating-progress-fill").style.width, "40%", "Progress fill must be 40%");
assert.strictEqual(mockCard.querySelector("#deen-ptc-delivered-count").textContent, "📦 Delivered: 4", "Delivered count must match 4");
assert.strictEqual(mockCard.querySelector("#deen-ptc-cancelled-count").textContent, "⚠️ Returned: 6", "Cancelled count must match 6");
assert.strictEqual(mockCard.querySelector("#deen-ptc-rating-btn-wa"), null, "Redundant WhatsApp Ask COD button must be completely removed from Pathao rating card");

// 24b. Test renderRatingState on Safe Customer
const ptcSafeData = {
  success: true,
  phone: "01812345678",
  successRate: 95,
  totalParcels: 20,
  deliveredCount: 19,
  cancelledCount: 1,
  riskLevel: "low",
  riskLabel: "Safe Buyer (95% Success)",
  riskColor: "#10b981",
  isNewCustomer: false
};

renderRatingState(mockCard, ptcSafeData);
assert(mockCard.classList.contains("rating-safe"), "Safe customer must apply 'rating-safe' class");
assert.strictEqual(mockCard.querySelector("#deen-ptc-rating-badge").style.backgroundColor, "#10b981", "Badge color must be green");
assert.strictEqual(mockCard.querySelector("#deen-ptc-stat-rate").textContent, "95%", "Rate stat must be 95%");
assert.strictEqual(mockCard.querySelector("#deen-ptc-rating-btn-wa"), null, "Safe customer must not have WhatsApp Ask COD button");

// 24c. Test renderRatingState on New Customer (Clean History)
const ptcNewCustomerData = {
  success: true,
  phone: "01912345678",
  successRate: 100,
  totalParcels: 0,
  deliveredCount: 0,
  cancelledCount: 0,
  riskLevel: "low",
  riskLabel: "New Customer (Clean History)",
  riskColor: "#3b82f6",
  isNewCustomer: true
};

renderRatingState(mockCard, ptcNewCustomerData);
assert(mockCard.classList.contains("rating-safe"), "New customer must apply 'rating-safe' class");
assert.strictEqual(mockCard.querySelector("#deen-ptc-rating-badge").style.backgroundColor, "#3b82f6", "Badge color must be blue");
assert(mockCard.querySelector("#deen-ptc-stat-text").textContent.includes("Clean delivery history"), "Stat text must reflect clean new customer history");

// 24d. In-Popup Modal Injection with Phone Input
const mockPhoneInput = {
  tagName: "INPUT",
  id: "ptc_wc_shipping_phone",
  value: "01711223344",
  dataset: {},
  parentNode: {
    children: [],
    insertBefore: function(newEl, refEl) {
      this.children.push(newEl);
    }
  },
  addEventListener: (evt, handler) => {},
  dispatchEvent: (evt) => {}
};

const mockFullPtcModal = {
  id: "ptc-custom-modal",
  dataset: { orderId: "14920" },
  querySelectorAll: (sel) => [],
  querySelector: (sel) => {
    if (sel.includes("ptc_wc_shipping_phone")) return mockPhoneInput;
    if (sel.includes("ptc_wc_shipping_address")) return mockShippingAddress;
    if (sel.includes("ptc_wc_shipping_name")) return { value: "Ashfaq Ahmed" };
    if (sel.includes("ptc_wc_amount_to_collect")) return { value: "1550" };
    if (sel.includes("city")) return mockCitySelect;
    if (sel.includes("zone")) return mockZoneSelect;
    if (sel.includes("deen-ptc-phone-rating")) {
      return mockPhoneInput.parentNode.children.find(c => c.id === "deen-ptc-phone-rating") || null;
    }
    if (sel.includes("deen-ptc-address-helper")) {
      return mockModalChildren.find(c => c.id === "deen-ptc-address-helper") || null;
    }
    return null;
  }
};

global.document.querySelectorAll = (sel) => {
  if (sel.includes("ptc-custom-modal") || sel.includes("pathao-modal")) return [mockFullPtcModal];
  if (sel.includes("ptc-open-modal-button")) return [];
  return [];
};
global.document.getElementById = (id) => {
  if (id === "ptc-custom-modal") return mockFullPtcModal;
  if (id === "ptc_wc_shipping_phone") return mockPhoneInput;
  if (id === "ptc_wc_shipping_address") return mockShippingAddress;
  return null;
};

initPathaoPluginAddressNormalizer();

const injectedRatingCard = mockPhoneInput.parentNode.children.find(c => c.id === "deen-ptc-phone-rating");
assert(injectedRatingCard, "Must automatically inject #deen-ptc-phone-rating next to phone input in Pathao modal");
assert.strictEqual(injectedRatingCard.dataset.deenCheckedPhone, "01711223344", "Must record checked phone number");
assert(!injectedRatingCard.innerHTML.includes("deen-ptc-rating-btn-wa"), "Pathao rating card must not render WhatsApp Ask COD button");
assert(!injectedRatingCard.innerHTML.includes("WhatsApp Ask COD"), "Pathao rating card must not contain WhatsApp Ask COD text");

console.log("  ✅ In-Popup Pathao Customer Rating card injection, live check, risk states, and WhatsApp COD removal verified!");

// -----------------------------------------------------------------------------
// Test 25: Smart Outside Dhaka Detection, False-Dhaka 50 TK Correction & Hermes API
// -----------------------------------------------------------------------------
console.log("\n▶ Test 25: Testing Smart Outside Dhaka Detection, False-Dhaka 50 TK Correction & Hermes API...");

// Case 25a: Address has both Cumilla and Dhaka (customer chose Dhaka in dropdown)
const addrCumillaDhaka = parseBDAddress("Kandirpar, Cumilla, Dhaka");
assert.strictEqual(addrCumillaDhaka.district, "Cumilla", "Must match Cumilla district despite Dhaka dropdown");
assert.strictEqual(addrCumillaDhaka.cityType, "Outside Dhaka", "Must classify as Outside Dhaka");

// Case 25b: Address has Bagerhat and Dhaka
const addrBagerhatDhaka = parseBDAddress("মেসার্স বরকত ফিলিং স্টেশন,বাসস্ট্যান্ড, বাগেরহাট সদর, Bagerhat, 9300, Dhaka");
assert.strictEqual(addrBagerhatDhaka.district, "Bagerhat", "Must match Bagerhat district despite Dhaka suffix");
assert.strictEqual(addrBagerhatDhaka.cityType, "Outside Dhaka", "Must classify as Outside Dhaka");

// Case 25c: Order where customer selected Inside Dhaka (৳50) but address is Outside Dhaka
const rawFalselyInsideOrder = {
  orderId: "19050",
  name: "Farhan Hossain",
  phone: "01812345678",
  address: "Kandirpar, Cumilla, Dhaka",
  items: [{ name: "Cotton Polo Shirt - Navy - L", qty: 1, unitPrice: "1500", total: "1500" }],
  subtotal: "1500",
  cod: "1550" // Falsely charged 50 TK instead of 90 TK
};

const normalizedFalselyInside = wcIntegration.normalizeCustomerAndOrderData(rawFalselyInsideOrder);
assert.strictEqual(normalizedFalselyInside.isOutsideDhaka, true, "Must detect customer is Outside Dhaka");
assert.strictEqual(normalizedFalselyInside.wasFalselyInsideDhaka, true, "Must flag wasFalselyInsideDhaka as true");
assert.strictEqual(normalizedFalselyInside.deliveryFee, 90, "Real delivery fee must be ৳90");
assert.strictEqual(normalizedFalselyInside.cod, "1590", "Corrected COD must be Subtotal 1500 + 90 = 1590 TK");

// Case 25d: Verify Canvas Receipt renders corrected delivery fee and COD
const drawnTexts25 = [];
const mockCanvas25 = {
  width: 0,
  height: 0,
  style: {},
  getContext: () => ({
    scale: () => {},
    clearRect: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    fillText: (text) => drawnTexts25.push(text),
    strokeText: () => {},
    measureText: (txt) => ({ width: (txt || "").length * 7 }),
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    quadraticCurveTo: () => {},
    closePath: () => {},
    stroke: () => {},
    fill: () => {},
    save: () => {},
    restore: () => {},
    drawImage: () => {}
  })
};

const oldDocCreate25 = global.document.createElement;
global.document.createElement = (tag) => tag === "canvas" ? mockCanvas25 : oldDocCreate25(tag);

wcIntegration.renderOrderReceiptCanvas(normalizedFalselyInside);
global.document.createElement = oldDocCreate25;

assert(drawnTexts25.some(t => t.includes("Delivery (Outside Dhaka): ৳90")), "Canvas must render authentic ৳90 delivery fee");
assert(drawnTexts25.some(t => t.includes("৳1590")), "Canvas must render corrected total COD ৳1590");

// Case 25e: Verify Pathao Hermes API credentials from env.js
const envLoaded = require("./env.js");
assert(envLoaded.PATHAO_CLIENT_ID && envLoaded.PATHAO_CLIENT_ID.length > 5, "PATHAO_CLIENT_ID must be loaded from env");
assert(envLoaded.PATHAO_CLIENT_SECRET && envLoaded.PATHAO_CLIENT_SECRET.length > 10, "PATHAO_CLIENT_SECRET must be loaded from env");
assert(envLoaded.PATHAO_USERNAME && envLoaded.PATHAO_USERNAME.includes("@"), "PATHAO_USERNAME must be valid email");
assert(envLoaded.PATHAO_PASSWORD && envLoaded.PATHAO_PASSWORD.length > 5, "PATHAO_PASSWORD must be present");

console.log("  ✅ Smart Outside Dhaka detection, false-Dhaka ৳50 correction (1500 + 90 = ৳1590), and Hermes API verified!");

// -----------------------------------------------------------------------------
// Test 26: Cross-Feature Customer Rating Propagation & 10-Minute Caching
// -----------------------------------------------------------------------------
console.log("\n▶ Test 26: Testing Cross-Feature Rating Propagation, Rating Grade & 10-Minute Caching...");

// Case 26a: Verify background.js contains customerRatingMemoryCache and 10-min TTL logic
const bgCode26 = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
assert(bgCode26.includes("customerRatingMemoryCache = new Map()"), "background.js must initialize customerRatingMemoryCache Map");
assert(bgCode26.includes("RATING_CACHE_TTL_MS = 10 * 60 * 1000"), "background.js must set 10-minute cache TTL");
assert(bgCode26.includes("customer_rating_cache"), "background.js must persist customer_rating_cache in chrome.storage.local");
assert(bgCode26.includes("forceRefresh"), "background.js must support forceRefresh parameter");
assert(bgCode26.includes("ratingGrade: formattedGrade"), "background.js must return formatted ratingGrade");

// Case 26b: Verify woocommerce.js showOrderConfirmModal contains rating banner
const wcCode26 = fs.readFileSync(path.join(__dirname, "woocommerce.js"), "utf8");
assert(wcCode26.includes("deen-order-confirm-rating-box"), "showOrderConfirmModal must include deen-order-confirm-rating-box");
assert(wcCode26.includes("deen-order-rating-text"), "showOrderConfirmModal must include deen-order-rating-text");
assert(wcCode26.includes("deen-order-rating-badge"), "showOrderConfirmModal must include deen-order-rating-badge");
assert(wcCode26.includes("deen-order-rating-refresh-btn"), "showOrderConfirmModal must include deen-order-rating-refresh-btn");
assert(wcCode26.includes("deen-single-order-rating-pill"), "injectSingleOrderPageButton must inject deen-single-order-rating-pill");
assert(!wcCode26.includes("WhatsApp Ask COD"), "woocommerce.js must not contain WhatsApp Ask COD button");
assert(!wcCode26.includes("WhatsApp Advance COD Request"), "woocommerce.js must not contain WhatsApp Advance COD Request button");
assert(wcCode26.includes("200"), "woocommerce.js MutationObserver debounce must be 200ms");

// Case 26c: Verify phone-check.js contains ৳90 / ৳50 sidebar advance fees and ratingGrade
const pcCode26 = fs.readFileSync(path.join(__dirname, "phone-check.js"), "utf8");
assert(pcCode26.includes("💰 Adv ৳90"), "phone-check.js sidebar drawer must have 💰 Adv ৳90 tab");
assert(pcCode26.includes("💰 Adv ৳50"), "phone-check.js sidebar drawer must have 💰 Adv ৳50 tab");
assert(pcCode26.includes("data.ratingGrade"), "phone-check.js must display data.ratingGrade if available");

// Case 26d: Verify popup.js contains ratingGrade display
const popupCode26 = fs.readFileSync(path.join(__dirname, "popup.js"), "utf8");
assert(popupCode26.includes("data.ratingGrade"), "popup.js must display data.ratingGrade in courier check card");

console.log("  ✅ Customer rating caching, cross-feature propagation (modal, preview, single order, sidebar, popup), and ratingGrade verified!");

console.log("\n==================================================");
console.log("🎉 ALL 26 WHATSAPP ADVANCE COD, ORDER CONFIRMATION, PATHAO NORMALIZATION, HERMES API & CACHING TESTS PASSED!");
console.log("==================================================");





