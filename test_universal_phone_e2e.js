const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log("🧪 Running Universal Phone Detection & In-Page Rating E2E Simulation Test...");

// Mock window, document, chrome for a headless simulation of WhatsApp Web
const sentMessages = [];
const storageStore = {};

function createMockElement(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    id: "",
    className: "",
    innerHTML: "",
    textContent: "",
    value: "",
    classList: {
      classes: [],
      add: (c) => el.classList.classes.push(c),
      remove: (c) => { el.classList.classes = el.classList.classes.filter(x => x !== c); },
      contains: (c) => el.classList.classes.includes(c)
    },
    style: {},
    children: [],
    appendChild: (child) => {
      el.children.push(child);
      child.parentElement = el;
      return child;
    },
    removeChild: (child) => {
      const idx = el.children.indexOf(child);
      if (idx !== -1) el.children.splice(idx, 1);
      child.parentElement = null;
      return child;
    },
    remove: () => {
      if (el.parentElement && el.parentElement.removeChild) {
        el.parentElement.removeChild(el);
      }
    },
    setAttribute: () => {},
    addEventListener: (evt, handler) => {
      el._handlers = el._handlers || {};
      el._handlers[evt] = el._handlers[evt] || [];
      el._handlers[evt].push(handler);
    },
    dispatchEvent: (evt) => {
      if (el._handlers && el._handlers[evt.type]) {
        el._handlers[evt.type].forEach(h => h(evt));
      }
    },
    querySelector: (sel) => {
      const idMatch = sel.match(/#([a-zA-Z0-9_-]+)/);
      if (idMatch) {
        el._queriedStubs = el._queriedStubs || {};
        if (el._queriedStubs[idMatch[1]]) return el._queriedStubs[idMatch[1]];
        const found = global.mockDOM.find(x => x.id === idMatch[1]);
        if (found) return found;
        const childFound = el.children.find(x => x.id === idMatch[1]);
        if (childFound) return childFound;
        // Auto-stub element if not found
        const stub = createMockElement("div");
        stub.id = idMatch[1];
        el._queriedStubs[idMatch[1]] = stub;
        return stub;
      }
      return null;
    },
    getBoundingClientRect: () => ({ left: 200, top: 300, width: 200, height: 35, right: 400, bottom: 335 })
  };
  return el;
}

global.window = {
  scrollX: 0,
  scrollY: 0,
  innerWidth: 1200,
  innerHeight: 800,
  location: { hostname: "web.whatsapp.com", href: "https://web.whatsapp.com" },
  addEventListener: (evt, handler) => {
    global.winHandlers[evt] = global.winHandlers[evt] || [];
    global.winHandlers[evt].push(handler);
  },
  removeEventListener: () => {},
  getSelection: () => global.mockSelection
};

global.document = {
  readyState: "complete",
  body: {
    appendChild: (el) => {
      global.mockDOM.push(el);
      el.parentElement = global.document.body;
      return el;
    },
    removeChild: (el) => {
      const idx = global.mockDOM.indexOf(el);
      if (idx !== -1) global.mockDOM.splice(idx, 1);
      el.parentElement = null;
      return el;
    }
  },
  activeElement: null,
  getElementById: (id) => {
    return global.mockDOM.find(e => e.id === id) || null;
  },
  createElement: createMockElement,
  addEventListener: (evt, handler) => {
    global.docHandlers[evt] = global.docHandlers[evt] || [];
    global.docHandlers[evt].push(handler);
  }
};

global.navigator = {
  clipboard: {
    writeText: () => Promise.resolve()
  }
};

global.chrome = {
  runtime: {
    id: "mock-deen-extension",
    sendMessage: (msg, callback) => {
      sentMessages.push(msg);
      if (msg.action === "fetch_customer_rating") {
        const dummyResult = {
          success: true,
          phone: msg.phone,
          successRate: 92,
          totalParcels: 12,
          deliveredCount: 11,
          cancelledCount: 1,
          riskLevel: "low",
          riskLabel: "Safe Customer (Low Risk)",
          riskColor: "#10b981",
          isNewCustomer: false
        };
        if (callback) callback(dummyResult);
        return Promise.resolve(dummyResult);
      }
      if (callback) callback({ status: "ok" });
      return Promise.resolve({ status: "ok" });
    }
  },
  storage: {
    local: {
      set: (obj, cb) => {
        Object.assign(storageStore, obj);
        if (cb) cb();
      },
      get: (keys, cb) => {
        const res = {};
        keys.forEach(k => { res[k] = storageStore[k]; });
        if (cb) cb(res);
      }
    }
  }
};

global.mockDOM = [];
global.docHandlers = {};
global.winHandlers = {};

// Load phone-check.js
eval(fs.readFileSync(path.join(__dirname, 'phone-check.js'), 'utf8'));

// Test 1: Highlight simulation on WhatsApp Web
console.log("\n▶ Test 1: Simulating Phone Selection / Highlight on WhatsApp Web...");
global.mockSelection = {
  isCollapsed: false,
  rangeCount: 1,
  toString: () => "+880 1712-345678",
  getRangeAt: () => ({
    getBoundingClientRect: () => ({ left: 250, top: 400, width: 150, height: 20, right: 400, bottom: 420 })
  })
};

// Trigger mouseup event
assert(global.docHandlers["mouseup"], "mouseup handler must be registered");
global.docHandlers["mouseup"].forEach(h => h({ target: {} }));

// Wait for setTimeout in handleSelectionEnd
setTimeout(() => {
  const pill = global.mockDOM.find(e => e.id === "deen-phone-pill-host");
  assert(pill, "Floating action pill should be created in DOM upon highlighting phone");
  assert(pill.innerHTML.includes("01712345678"), "Pill should display normalized phone 01712345678");
  assert(pill.innerHTML.includes("Check Rating"), "Pill should offer Check Rating action");
  console.log("  ✅ Floating action pill successfully rendered near WhatsApp phone selection with Check Rating action!");

  // Test 2: Clicking the pill -> Opens In-Page Customer Rating Mini Modal
  console.log("\n▶ Test 2: Simulating Click on Floating Action Pill -> Opens In-Page Mini Modal...");
  pill._handlers["click"].forEach(h => h({
    preventDefault: () => {},
    stopPropagation: () => {}
  }));

  const modalBackdrop = global.mockDOM.find(e => e.id === "deen-rating-modal-backdrop");
  assert(modalBackdrop, "In-page rating modal backdrop must be created without opening Pathao page");
  assert(sentMessages.some(m => m.action === "fetch_customer_rating" && m.phone === "01712345678"),
    "Opening modal must request fetch_customer_rating from background");
  console.log("  ✅ In-page mini modal opened immediately on the active page without switching tabs!");

  // Test 3: Modal data verification
  console.log("\n▶ Test 3: Verifying In-Page Modal Customer Rating Content...");
  const modal = modalBackdrop.children.find(e => e.id === "deen-rating-modal");
  assert(modal, "Modal card element should be rendered inside backdrop");
  assert(modal.innerHTML.includes("92%"), "Modal must display 92% success rate");
  assert(modal.innerHTML.includes("Safe Customer"), "Modal must display Safe Customer risk badge");
  assert(modal.innerHTML.includes("Total Parcels"), "Modal must display 3-col stats grid");
  console.log("  ✅ Customer rating, risk score, and parcel metrics rendered in mini popup!");

  // Test 4: Modal Open Pathao Form Action
  console.log("\n▶ Test 4: Testing Modal Action Button 'Open Pathao Create'...");
  const btnOpenPathao = modal.querySelector("#deen-modal-btn-open-pathao");
  assert(btnOpenPathao, "Modal must provide Open Pathao Create button");
  btnOpenPathao._handlers["click"].forEach(h => h({
    preventDefault: () => {},
    stopPropagation: () => {}
  }));
  assert(storageStore.pathao_autofill_data.phone === "01712345678", "Opening Pathao from modal must store recipient phone");
  assert(sentMessages.some(m => m.action === "sync_to_pathao" && m.data.phone === "01712345678" && m.autoSwitch === true),
    "Opening Pathao from modal must trigger sync_to_pathao with autoSwitch: true");
  console.log("  ✅ Open Pathao Create button from modal properly synced phone and requested tab focus!");

  // Test 5: Native Copy Event with dual actions
  console.log("\n▶ Test 5: Simulating Native Copy Event with Rating & Open Options...");
  global.mockSelection = {
    isCollapsed: false,
    toString: () => "Customer contact: 01811-223344"
  };

  assert(global.docHandlers["copy"], "copy handler must be registered");
  global.docHandlers["copy"].forEach(h => h({}));

  setTimeout(() => {
    const toastContainer = global.mockDOM.find(e => e.id === "deen-universal-toast-container");
    assert(toastContainer, "Toast container should be created upon copy");
    assert(sentMessages.some(m => m.action === "sync_to_pathao" && m.data.phone === "01811223344" && m.autoSwitch === false),
      "Copy event must sync phone 01811223344 in background with autoSwitch: false");
    // Test 6: In-Page Dockable Sidebar Drawer verification
    console.log("\n▶ Test 6: Verifying In-Page Dockable Sidebar Tab and Drawer...");
    const dockTab = global.mockDOM.find(e => e.id === "deen-sidebar-dock-tab");
    assert(dockTab, "Dock tab '#deen-sidebar-dock-tab' must be attached to body");
    assert(dockTab.innerHTML.includes("Rating Check"), "Dock tab should show 'Rating Check'");

    const sidebar = global.mockDOM.find(e => e.id === "deen-rating-sidebar");
    assert(sidebar, "Sidebar drawer '#deen-rating-sidebar' must be attached to body");
    assert(!sidebar.classList.contains("open"), "Sidebar should initially be closed");

    // Click dock tab to open sidebar
    console.log("  Clicking dock tab to open sidebar drawer...");
    dockTab._handlers["click"].forEach(h => h({}));
    assert(sidebar.classList.contains("open"), "Sidebar must have class 'open' after clicking dock tab");
    console.log("  ✅ Dock tab successfully toggled sidebar drawer open!");

    // Test 7: Manual Phone Search inside Sidebar
    console.log("\n▶ Test 7: Testing Phone Check directly in Sidebar Drawer...");
    const sidebarInput = sidebar.querySelector("#deen-sidebar-phone-input");
    const sidebarBtnSearch = sidebar.querySelector("#deen-sidebar-btn-search");
    assert(sidebarInput && sidebarBtnSearch, "Sidebar must have phone input and search button");

    sidebarInput.value = "01999887766";
    sidebarBtnSearch._handlers["click"].forEach(h => h({}));

    assert(sentMessages.some(m => m.action === "fetch_customer_rating" && m.phone === "01999887766"),
      "Sidebar search must trigger fetch_customer_rating for 01999887766");

    const sidebarCard = sidebar.querySelector("#deen-sidebar-card-container");
    assert(sidebarCard.innerHTML.includes("01999887766"), "Sidebar active card must display searched phone");
    assert(sidebarCard.innerHTML.includes("92%"), "Sidebar active card must display rating score");
    console.log("  ✅ Direct phone check inside sidebar rendered rating card and stats!");

    // Test 8: Recent History Tracking in Sidebar
    console.log("\n▶ Test 8: Verifying Recent History Tracking in Sidebar...");
    assert(storageStore.recent_checked_ratings && storageStore.recent_checked_ratings.length > 0,
      "Recent checked ratings must be saved in storage");
    assert(storageStore.recent_checked_ratings[0].phone === "01999887766",
      "Most recently checked number must be at the top of history");
    console.log("  ✅ Recent checked numbers properly stored and indexed in history!");

    // Close sidebar
    const sidebarCloseBtn = sidebar.querySelector("#deen-sidebar-btn-close");
    sidebarCloseBtn._handlers["click"].forEach(h => h({}));
    assert(!sidebar.classList.contains("open"), "Sidebar should be closed after clicking close button");
    console.log("  ✅ Sidebar drawer closed cleanly!");

    console.log("\n==================================================");
    console.log("🎉 ALL IN-PAGE RATING, DOCK TAB & SIDEBAR TESTS PASSED!");
    console.log("==================================================");
    process.exit(0);
  }, 100);
}, 60);
