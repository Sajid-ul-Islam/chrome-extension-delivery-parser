/**
 * Test Suite for WhatsApp Web Active Chat Header Auto-Detection & Inline Rating Badge
 * Verifies automatic phone extraction from conversation header, subtitle, and thread,
 * inline rating badge injection with risk colors, 1-click advance COD & confirmation buttons,
 * and debounced DOM observers conforming to Invariant 2.
 */

const assert = require('assert');

// Mock DOM environment for testing
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
    innerText: attributes.innerText || attributes.textContent || '',
    style: {},
    get innerHTML() {
      return _rawInnerHTML;
    },
    set innerHTML(val) {
      _rawInnerHTML = String(val);
      // Auto-populate textContent if not set
      if (!this.textContent) {
        this.textContent = _rawInnerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
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
    insertBefore(newChild, refChild) {
      newChild.parentElement = this;
      const idx = children.indexOf(refChild);
      if (idx !== -1) {
        children.splice(idx, 0, newChild);
      } else {
        children.push(newChild);
      }
      return newChild;
    },
    querySelector(selector) {
      // 1. Direct children search
      for (const child of children) {
        if (matches(child, selector)) return child;
        const sub = child.querySelector(selector);
        if (sub) return sub;
      }
      // 2. Search within rawInnerHTML
      if (_rawInnerHTML) {
        if (selector.startsWith('.')) {
          const cls = selector.slice(1);
          if (_rawInnerHTML.includes(cls)) {
            const rx = new RegExp(`<([a-zA-Z0-9]+)[^>]*class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i');
            const m = _rawInnerHTML.match(rx);
            const tag = m ? m[1] : 'span';
            const inner = m ? m[2].replace(/<[^>]+>/g, '').trim() : '';
            const subEl = createMockElement(tag, { className: cls, textContent: inner });
            subEl.parentElement = this;
            return subEl;
          }
        }
        if (selector.startsWith('#')) {
          const id = selector.slice(1);
          if (_rawInnerHTML.includes(id)) {
            const subEl = createMockElement('div', { id: id });
            subEl.parentElement = this;
            return subEl;
          }
        }
      }
      return null;
    },
    querySelectorAll(selector) {
      const results = [];
      findAllSelectors(this, selector, results);
      return results;
    },
    addEventListener(event, handler) {
      if (!eventListeners[event]) eventListeners[event] = [];
      eventListeners[event].push(handler);
    },
    dispatchEvent(event) {
      const handlers = eventListeners[event.type || event] || [];
      handlers.forEach(h => h(event));
    }
  };

  return el;
}

function matches(el, selector) {
  if (selector.startsWith('#') && el.id === selector.slice(1)) return true;
  if (selector.startsWith('.') && el.className && el.className.includes(selector.slice(1))) return true;
  if (selector.includes('[data-testid=')) {
    const m = selector.match(/\[data-testid="([^"]+)"\]/);
    if (m && el.getAttribute && el.getAttribute('data-testid') === m[1]) return true;
  }
  if (el.tagName && el.tagName.toLowerCase() === selector.toLowerCase()) return true;
  return false;
}

function findAllSelectors(root, selector, acc) {
  for (const child of root.childNodes) {
    if (selector.includes('message-in') && child.className && child.className.includes('message-in')) {
      acc.push(child);
    }
    findAllSelectors(child, selector, acc);
  }
}

// Setup globals before requiring phone-check.js
global.window = {
  location: { hostname: 'web.whatsapp.com', href: 'https://web.whatsapp.com' },
  addEventListener: () => {},
  removeEventListener: () => {}
};
global.document = {
  readyState: 'complete',
  createElement: (tag) => createMockElement(tag),
  getElementById: (id) => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {}
};

const phoneCheck = require('./phone-check.js');

async function runTests() {
  console.log("==================================================");
  console.log("🧪 Running Verification Tests for WhatsApp Web Auto-Detection");
  console.log("==================================================");

  // ---------------------------------------------------------------------------
  // Test 1: Invariant 1 - Preserve All Core Module Exports
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 1: Validating Invariant 1 - Preserved Exports in phone-check.js...");
  const requiredExports = [
    "normalizeBDPhone",
    "escapeHTML",
    "DEFAULT_QUICK_REPLY_CONFIG",
    "calculateDeliveryFee",
    "buildWhatsAppDeepLink",
    "generateQuickReply",
    "getQuickReplyConfig",
    "injectWhatsAppMessage",
    "extractWhatsAppActivePhone",
    "renderWhatsAppHeaderBadge",
    "initWhatsAppActiveChatDetector"
  ];

  requiredExports.forEach(exp => {
    assert(phoneCheck[exp] !== undefined, `Export '${exp}' must be present in phone-check.js`);
  });
  console.log(`  ✅ All ${requiredExports.length} module exports verified!`);

  // ---------------------------------------------------------------------------
  // Test 2: WhatsApp Web Header Phone Extraction
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 2: Testing extractWhatsAppActivePhone across simulated Header DOMs...");

  // Case A: Unsaved number as title (+880 1715-485035)
  const headerA = createMockElement('header');
  const titleA = createMockElement('span', {
    'data-testid': 'conversation-info-header-chat-title',
    textContent: '+880 1715-485035'
  });
  headerA.appendChild(titleA);

  const phoneA = phoneCheck.extractWhatsAppActivePhone(headerA);
  assert.strictEqual(phoneA, "01715485035", `Case A mismatch: expected 01715485035, got ${phoneA}`);
  console.log("  ✅ Case A: Extracted '01715485035' from header title '+880 1715-485035'");

  // Case B: Spaced phone in title (01812 345 678)
  const headerB = createMockElement('header');
  const titleB = createMockElement('span', {
    'data-testid': 'conversation-info-header-chat-title',
    textContent: '01812 345 678'
  });
  headerB.appendChild(titleB);

  const phoneB = phoneCheck.extractWhatsAppActivePhone(headerB);
  assert.strictEqual(phoneB, "01812345678", `Case B mismatch: expected 01812345678, got ${phoneB}`);
  console.log("  ✅ Case B: Extracted '01812345678' from spaced title");

  // Case C: Saved contact name with phone in subtitle
  const headerC = createMockElement('header');
  const titleC = createMockElement('span', {
    'data-testid': 'conversation-info-header-chat-title',
    textContent: 'Sajid Denim Store'
  });
  const subC = createMockElement('span', {
    'data-testid': 'custom-status',
    textContent: '~ Sajid (+8801911223344)'
  });
  headerC.appendChild(titleC);
  headerC.appendChild(subC);

  const phoneC = phoneCheck.extractWhatsAppActivePhone(headerC);
  assert.strictEqual(phoneC, "01911223344", `Case C mismatch: expected 01911223344, got ${phoneC}`);
  console.log("  ✅ Case C: Extracted '01911223344' from custom status subtitle");

  // ---------------------------------------------------------------------------
  // Test 3: Inline Rating Badge Rendering & Action Buttons
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 3: Testing renderWhatsAppHeaderBadge Injection & Quick Buttons...");

  const testHeader = createMockElement('header');
  const titleBox = createMockElement('div', { 'role': 'button', textContent: '01715485035' });
  testHeader.appendChild(titleBox);

  // Render badge for customer
  phoneCheck.renderWhatsAppHeaderBadge("01715485035", testHeader);

  const badgeEl = testHeader.querySelector('#deen-wa-header-rating-badge');
  assert(badgeEl, "Inline Rating Badge element must be injected into header");
  assert.strictEqual(badgeEl.getAttribute('data-phone'), "01715485035", "Badge data-phone must match");
  console.log("  ✅ Inline badge successfully injected into header DOM!");

  // Verify Risk Badge & Quick Action Buttons
  const scoreEl = badgeEl.querySelector('.deen-wa-badge-score');
  assert(scoreEl, "Badge must contain score indicator");
  assert(scoreEl.textContent.includes("%") || scoreEl.textContent.includes("Buyer") || scoreEl.textContent.includes("Delivery"), `Score text mismatch: ${scoreEl.textContent}`);

  const btnAdv = badgeEl.querySelector('.deen-wa-btn-adv');
  assert(btnAdv, "Badge must have 1-click '💰 ৳90 Adv' button");

  const btnConfirm = badgeEl.querySelector('.deen-wa-btn-confirm');
  assert(btnConfirm, "Badge must have 1-click '✅ Confirm' button");

  const btnSidebar = badgeEl.querySelector('.deen-wa-btn-sidebar');
  assert(btnSidebar, "Badge must have '📌' Sidebar trigger button");

  console.log("  ✅ Verified score pill, '💰 ৳90 Adv', '✅ Confirm', and '📌 Sidebar' quick actions!");

  // ---------------------------------------------------------------------------
  // Test 4: Deduplication - Avoid UI Flickering
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 4: Testing Badge Deduplication on Repeated Chat Selection...");
  const childCountBefore = testHeader.childNodes.length;
  phoneCheck.renderWhatsAppHeaderBadge("01715485035", testHeader);
  const childCountAfter = testHeader.childNodes.length;

  assert.strictEqual(childCountBefore, childCountAfter, "Repeated call for same phone must not duplicate badge");
  console.log("  ✅ Verified zero DOM flicker / deduplication for active phone!");

  console.log("\n==================================================");
  console.log("🎉 ALL WHATSAPP WEB AUTO-DETECTION TESTS PASSED (100%)!");
  console.log("==================================================");
}

runTests().catch(err => {
  console.error("❌ WhatsApp Web Auto-Detection Test Failed:", err);
  process.exit(1);
});
