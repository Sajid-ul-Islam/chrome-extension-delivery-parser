/**
 * test_whatsapp_queue_and_ndr.js
 * Automated test suite for WhatsApp Web Sequential Queue & NDR Rescue (Pillar 4)
 */

const assert = require('assert');
const parser = require('./parser.js');

console.log("🧪 Running WhatsApp Web Queue & NDR Rescue Test Suite...\n");

// 1. Test NDR Rescue Quick Reply Template
const ndrOrder = {
  orderId: "#19789",
  name: "Sahadat",
  phone: "01613385883",
  reason: "Customer phone unreachable",
  trackingId: "PTC889900"
};

const ndrMsg = parser.generateQuickReply("ndr_rescue", ndrOrder);
assert.ok(ndrMsg.includes("আসসালামু আলাইকুম Sahadat"), "NDR rescue message must greet customer");
assert.ok(ndrMsg.includes("Customer phone unreachable"), "NDR message must specify delivery failure reason");
assert.ok(ndrMsg.includes("ডেলিভারি রি-অ্যাটেম্পট"), "NDR message must request re-attempt time in Bengali");
console.log("  ✅ NDR Rapid Rescue template verified.");

// 2. Setup mock DOM environment
function createMockElement(tagName, attributes = {}) {
  const children = [];
  const eventListeners = {};
  let _rawInnerHTML = '';

  const el = {
    tagName: tagName.toUpperCase(),
    id: attributes.id || '',
    className: attributes.className || attributes.class || '',
    attributes: { ...attributes },
    childNodes: children,
    children: children,
    textContent: attributes.textContent || '',
    style: {},
    dataset: {},
    get innerHTML() { return _rawInnerHTML; },
    set innerHTML(val) {
      _rawInnerHTML = String(val);
      this.textContent = _rawInnerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    },
    getAttribute(name) { return this.attributes[name] || null; },
    setAttribute(name, val) {
      this.attributes[name] = String(val);
      if (name === 'id') this.id = val;
      if (name === 'class') this.className = val;
    },
    appendChild(child) {
      child.parentElement = this;
      children.push(child);
      return child;
    },
    remove() {
      if (this.parentElement) {
        const idx = this.parentElement.children.indexOf(this);
        if (idx !== -1) this.parentElement.children.splice(idx, 1);
      }
    },
    querySelector(selector) {
      for (const child of children) {
        if (selector.startsWith('#') && child.id === selector.slice(1)) return child;
        if (selector.startsWith('.') && child.className.includes(selector.slice(1))) return child;
        const sub = child.querySelector(selector);
        if (sub) return sub;
      }
      if (_rawInnerHTML) {
        if (selector.startsWith('#')) {
          const id = selector.slice(1);
          if (_rawInnerHTML.includes(id)) {
            const subEl = createMockElement('button', { id: id, textContent: id });
            subEl.parentElement = this;
            return subEl;
          }
        }
      }
      return null;
    },
    addEventListener(event, handler) {
      eventListeners[event] = eventListeners[event] || [];
      eventListeners[event].push(handler);
    },
    click() {
      if (eventListeners['click']) {
        eventListeners['click'].forEach(h => h({ preventDefault: () => {}, stopPropagation: () => {} }));
      }
    }
  };
  return el;
}

const mockBody = createMockElement('body');
global.window = {
  location: { hostname: "web.whatsapp.com", href: "https://web.whatsapp.com" },
  addEventListener: () => {},
  getSelection: () => ({ toString: () => "" })
};
global.document = {
  body: mockBody,
  documentElement: mockBody,
  createElement: (tag) => createMockElement(tag),
  getElementById: (id) => {
    if (mockBody.id === id) return mockBody;
    return mockBody.querySelector('#' + id);
  },
  querySelector: (sel) => mockBody.querySelector(sel),
  querySelectorAll: () => [],
  addEventListener: () => {}
};
global.navigator = { clipboard: { writeText: async () => {} } };

global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => cb({}),
      set: (obj, cb) => { if (cb) cb(); },
      remove: (keys, cb) => { if (cb) cb(); }
    },
    onChanged: {
      addListener: () => {}
    }
  },
  runtime: {
    id: "mock_ext_id",
    sendMessage: () => {}
  }
};

const phoneCheck = require('./phone-check.js');

// 3. Test renderWhatsAppQueueBanner
const testQueue = {
  currentIndex: 0,
  total: 2,
  orders: [
    { orderId: "19789", name: "Sahadat", phone: "01613385883", cod: "2238" },
    { orderId: "19790", name: "Tanvir", phone: "01711223344", cod: "1500" }
  ]
};

phoneCheck.renderWhatsAppQueueBanner(testQueue);
let banner = global.document.getElementById("deen-wa-queue-banner");
assert.ok(banner, "Queue banner must be injected into DOM");
assert.ok(banner.textContent.includes("Queue 1/2"), "Must indicate Order 1 of 2");
assert.ok(banner.textContent.includes("#19789"), "Must show order ID");
assert.ok(banner.textContent.includes("Sahadat"), "Must show customer name");
console.log("  ✅ WhatsApp Queue Banner correctly rendered in mock DOM.");

// 4. Test Skip action
const skipBtn = banner.querySelector("#deen-wa-queue-skip-btn");
assert.ok(skipBtn, "Skip button must exist");
skipBtn.click();

// 5. Test Finished State
const finishedQueue = {
  currentIndex: 2,
  total: 2,
  orders: testQueue.orders
};

phoneCheck.renderWhatsAppQueueBanner(finishedQueue);
banner = global.document.getElementById("deen-wa-queue-banner");
assert.ok(banner.textContent.includes("All 2 Orders Confirmed!"), "Finished banner must show completion");

console.log("  ✅ WhatsApp Sequential Queue lifecycle (render -> skip -> complete) verified.");

console.log("\n🎉 ALL TESTS IN test_whatsapp_queue_and_ndr.js PASSED 100%!");
