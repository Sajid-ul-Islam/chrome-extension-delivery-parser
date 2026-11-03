/**
 * Automated Verification Test Suite: Automated Non-Delivery Report (NDR) Rescue Listener
 * Validates failed attempt auto-detection, WhatsApp rescue messages, table row badges,
 * background desktop notifications, and modal rescue flow.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log("==================================================");
console.log("🚨 Testing DEEN Non-Delivery Report (NDR) Rescue Listener");
console.log("==================================================");

// 1. Verify courier-adapters NDR Processing
console.log("\n▶ Test 1: Testing courier-adapters NDR Event Processing...");
const courierAdapters = require('./courier-adapters.js');
assert.strictEqual(typeof courierAdapters.processNDRTrackingEvent, 'function', 'courierAdapters must export processNDRTrackingEvent');

const mockEventUnreachable = {
  trackingId: 'DH19045NDR',
  status: 'Delivery Attempt Failed',
  statusDetail: 'Customer phone was switched off / unreachable',
  recipientName: 'Tariqul Islam',
  recipientPhone: '01711223344',
  courier: 'pathao'
};

const ndrResult1 = courierAdapters.processNDRTrackingEvent(mockEventUnreachable);
assert.strictEqual(ndrResult1.isNDR, true, 'Delivery Attempt Failed must be flagged as NDR');
assert.strictEqual(ndrResult1.trackingId, 'DH19045NDR', 'Tracking ID must be preserved');
assert.strictEqual(ndrResult1.customerPhone, '01711223344', 'Phone number must match customerPhone');
assert.strictEqual(ndrResult1.recipientPhone, '01711223344', 'Phone number must match recipientPhone');
assert.ok(ndrResult1.whatsappDeepLink.includes('01711223344'), 'WhatsApp deep link should target recipient phone');
assert.ok(ndrResult1.rescueMessage.includes('DH19045NDR'), 'Rescue message should include tracking ID');
assert.ok(ndrResult1.rescueMessage.includes('DEEN'), 'Rescue message should reference DEEN brand');
console.log("  ✅ courier-adapters correctly flags failed delivery attempts and generates branded rescue messages.");

// 2. Verify Bengali status detection
console.log("\n▶ Test 2: Testing Bengali failed attempt status detection...");
const mockEventBengali = {
  trackingId: 'DH19046BN',
  status: 'ব্যর্থ',
  statusDetail: 'গ্রাহকের সাথে যোগাযোগ করা সম্ভব হয়নি',
  recipientName: 'রফিকুল ইসলাম',
  recipientPhone: '01899887766',
  courier: 'pathao'
};

const ndrResultBengali = courierAdapters.processNDRTrackingEvent(mockEventBengali);
assert.strictEqual(ndrResultBengali.isNDR, true, 'Bengali failed status must be flagged as NDR');
console.log("  ✅ Bengali status keywords (ব্যর্থ, যোগাযোগ) correctly detected.");

// 3. Verify normal delivered statuses are NOT flagged as NDR
console.log("\n▶ Test 3: Testing delivered status exclusion...");
const mockDelivered = {
  trackingId: 'DH19047OK',
  status: 'Delivered',
  statusDetail: 'Parcel delivered successfully to customer',
  recipientPhone: '01911223344',
  courier: 'pathao'
};
const normalResult = courierAdapters.processNDRTrackingEvent(mockDelivered);
assert.strictEqual(normalResult, null, 'Delivered parcel must return null (NOT flagged as NDR)');
console.log("  ✅ Delivered and successful consignments cleanly excluded from NDR.");

// 4. Verify storage engine NDR persistence
console.log("\n▶ Test 4: Testing storage-engine NDR saving & retrieval...");
const storageEngine = require('./storage-engine.js');
assert.strictEqual(typeof storageEngine.saveNDRAlertAsync, 'function', 'storageEngine must export saveNDRAlertAsync');
assert.strictEqual(typeof storageEngine.getNDRAlertsAsync, 'function', 'storageEngine must export getNDRAlertsAsync');

// Mock chrome.storage.local for Node environment
const mockStorage = {};
global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        const res = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => { if (k) res[k] = mockStorage[k]; });
        if (cb) cb(res);
      },
      set: (items, cb) => {
        Object.assign(mockStorage, items);
        if (cb) cb();
      }
    }
  }
};

(async () => {
  await storageEngine.saveNDRAlertAsync('DH19045NDR', ndrResult1);
  const alerts = await storageEngine.getNDRAlertsAsync();
  assert.strictEqual(Array.isArray(alerts), true, 'getNDRAlertsAsync must return array');
  assert.strictEqual(alerts.length, 1, 'Should contain 1 saved alert');
  assert.strictEqual(alerts[0].trackingId, 'DH19045NDR', 'Saved tracking ID must match');
  console.log("  ✅ storage-engine successfully persists and retrieves NDR alerts.");

  // 5. Verify content script NDR row scanning & badge decoration
  console.log("\n▶ Test 5: Testing content.js NDR row scanning & badge decoration...");
  const contentModule = require('./content.js');
  assert.strictEqual(typeof contentModule.scanAndDecorateNDRRows, 'function', 'content.js must export scanAndDecorateNDRRows');
  assert.strictEqual(typeof contentModule.showNDRRescueModal, 'function', 'content.js must export showNDRRescueModal');

  // Setup mock DOM table with NDR rows
  const mockRows = [
    {
      innerText: 'DH190123AB Arifur Rahman 01712345678 Delivery Attempt Failed: Customer unreachable',
      querySelector: (sel) => null,
      querySelectorAll: () => [],
      appendChild: (badge) => { mockRows[0]._badge = badge; },
      setAttribute: () => {},
      classList: { contains: () => false, add: () => {} }
    },
    {
      innerText: 'DH190124CD Shamim Hasan 01812345678 Delivered paid successfully',
      querySelector: (sel) => null,
      querySelectorAll: () => [],
      appendChild: () => {},
      setAttribute: () => {},
      classList: { contains: () => false, add: () => {} }
    }
  ];

  global.document = {
    readyState: 'complete',
    body: {
      appendChild: () => {}
    },
    querySelectorAll: (sel) => {
      if (sel.includes('tr')) return mockRows;
      return [];
    },
    querySelector: () => null,
    getElementById: () => null,
    createElement: (tag) => {
      const el = {
        tagName: tag.toUpperCase(),
        className: '',
        innerHTML: '',
        setAttribute: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        querySelector: (s) => ({
          addEventListener: () => {}
        }),
        querySelectorAll: () => [],
        appendChild: () => {},
        remove: () => {}
      };
      return el;
    }
  };

  const detected = contentModule.scanAndDecorateNDRRows();
  assert.strictEqual(detected.length, 1, 'Should detect exactly 1 NDR row');
  assert.strictEqual(detected[0].trackingId, 'DH190123AB', 'Detected tracking ID must match');
  assert.strictEqual(detected[0].customerPhone || detected[0].recipientPhone || detected[0].phone, '01712345678', 'Detected phone must match');
  assert.ok(mockRows[0]._badge, 'Failed row must be decorated with NDR badge');
  console.log("  ✅ content.js scans table rows, flags failed deliveries, and decorates rows with 1-click rescue badges.");

  // 6. Verify WhatsApp Deep Link Generation
  console.log("\n▶ Test 6: Testing WhatsApp rescue deep link formatting...");
  assert.ok(detected[0].whatsappDeepLink.startsWith('https://wa.me/8801712345678?text='), 'Deep link must target customer WhatsApp with phone');
  assert.ok(detected[0].whatsappDeepLink.includes(encodeURIComponent('DEEN')), 'Deep link must carry URL-encoded rescue text');
  console.log("  ✅ WhatsApp rescue deep links generated with direct message insertion.");

  // 7. Verify Background Notification Handler
  console.log("\n▶ Test 7: Testing background.js notify_ndr_alert handler...");
  let createdNotification = null;
  let messageHandler = null;

  global.chrome.notifications = {
    create: (opts, cb) => {
      createdNotification = opts;
      if (cb) cb('notif-id-123');
    },
    onClicked: { addListener: () => {} }
  };
  global.chrome.runtime = {
    lastError: null,
    getURL: (p) => 'chrome-extension://mock/' + p,
    onMessage: {
      addListener: (fn) => { messageHandler = fn; }
    },
    onInstalled: { addListener: () => {} }
  };
  global.chrome.contextMenus = {
    create: () => {},
    removeAll: (cb) => { if (cb) cb(); },
    onClicked: { addListener: () => {} }
  };

  delete require.cache[require.resolve('./background.js')];
  require('./background.js');

  assert.ok(typeof messageHandler === 'function', 'background.js must register chrome.runtime.onMessage listener');

  messageHandler({ action: 'notify_ndr_alert', alert: detected[0] }, {}, (res) => {
    assert.strictEqual(res.success, true, 'notify_ndr_alert should respond with success: true');
  });

  assert.ok(createdNotification, 'Desktop notification must be triggered');
  assert.ok(createdNotification.title.includes('DEEN Alert'), 'Notification title should include DEEN Alert');
  assert.ok(createdNotification.title.includes('01712345678'), 'Notification title should include recipient phone');
  console.log("  ✅ background.js notify_ndr_alert successfully creates high-priority desktop notification.");

  // 8. Verify Rescue Modal Rendering
  console.log("\n▶ Test 8: Testing showNDRRescueModal UI creation...");
  let modalInjected = false;
  global.document.body.appendChild = (el) => {
    if (el && el.className && el.className.includes('deen-ndr-modal-backdrop')) {
      modalInjected = true;
    }
  };
  contentModule.showNDRRescueModal(detected);
  assert.strictEqual(modalInjected, true, 'Rescue modal backdrop must be appended to body');
  console.log("  ✅ showNDRRescueModal creates interactive rescue center with 1-click rescue buttons.");

  console.log("\n==================================================");
  console.log("🎉 ALL 8 NDR RESCUE LISTENER TESTS PASSED 100%!");
  console.log("==================================================");
  process.exit(0);
})();
