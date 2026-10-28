/**
 * Verification Test Suite for Full Fetch Improvements
 * Covers:
 * 1. Shipping priority over billing address (parseWooCommerceAjaxOrderDetails & parseOrderEditPageHTML)
 * 2. Address 2 (apartment/suite/flat) preservation across fetch mechanisms
 * 3. Customer note / instruction extraction across AJAX, edit page, modal, and table row
 * 4. inFlightOrderRequests concurrent request deduplication & timeout protection
 * 5. Special instructions in Pathao batch CSV export
 * 6. Free shipping advance charge omission in WhatsApp Quick Reply
 */

const assert = require("assert");
const woocommerce = require("./woocommerce.js");
const parser = require("./parser.js");

console.log("==================================================");
console.log("🧪 Running Verification Tests for Full Fetch Improvements");
console.log("==================================================");

// Test 1: Shipping priority over billing address in parseWooCommerceAjaxOrderDetails
console.log("\n▶ Test 1: Testing Shipping Priority over Billing in parseWooCommerceAjaxOrderDetails...");
const ajaxMockWithBoth = {
  data: {
    id: 19550,
    shipping: {
      first_name: "Rahim",
      last_name: "Shipping",
      phone: "01711112222",
      address_1: "House 25, Road 7",
      address_2: "Apt 4B (South)",
      city: "Dhanmondi",
      state: "Dhaka",
      postcode: "1209"
    },
    billing: {
      first_name: "Karim",
      last_name: "Billing",
      phone: "01833334444",
      address_1: "Office 10, Gulshan 1",
      address_2: "Level 6",
      city: "Gulshan",
      state: "Dhaka",
      postcode: "1212"
    },
    line_items: [
      { name: "Premium Polo Shirt - L", quantity: 1, total: "1200", price: "1200" }
    ],
    customer_note: "Please ring the bell twice and call Rahim before arrival.",
    total: "1250"
  }
};

const parsedAjax = woocommerce.parseWooCommerceAjaxOrderDetails(ajaxMockWithBoth, "19550");
assert.strictEqual(parsedAjax.name, "Rahim Shipping", "Should prioritize shipping name over billing");
assert.strictEqual(parsedAjax.phone, "01711112222", "Should prioritize shipping phone over billing");
assert.ok(parsedAjax.address.includes("House 25, Road 7"), "Address should contain shipping address_1");
assert.ok(parsedAjax.address.includes("4B (South)"), "Address should preserve shipping address_2");
assert.ok(parsedAjax.notes.includes("ring the bell twice"), "Should extract customer_note into notes");
console.log("  ✅ parseWooCommerceAjaxOrderDetails prioritized shipping details, preserved address_2, and captured customer note!");

// Test 2: Shipping priority and address_2 in parseOrderEditPageHTML
console.log("\n▶ Test 2: Testing Shipping Priority and address_2 in parseOrderEditPageHTML...");
const editPageHtml = `
<!DOCTYPE html>
<html>
<head><title>Order #19551</title></head>
<body>
  <h1 class="wp-heading-inline">Order #19551</h1>
  <input name="_shipping_first_name" value="Tanvir" />
  <input name="_shipping_last_name" value="Ahmed" />
  <input name="_shipping_phone" value="01955556666" />
  <input name="_shipping_address_1" value="Holding 42, Block C" />
  <input name="_shipping_address_2" value="Flat 3A" />
  <input name="_shipping_city" value="Chittagong" />
  <input name="_shipping_postcode" value="4000" />

  <input name="_billing_first_name" value="Ignored Billing Name" />
  <input name="_billing_phone" value="01800000000" />
  <input name="_billing_address_1" value="Ignored Billing Street" />

  <textarea name="customer_note">Deliver after 5 PM please</textarea>

  <table id="order_line_items">
    <tr class="item">
      <td class="name">Executive Denim Jeans - 34</td>
      <td class="item_cost"><span class="amount">৳1500</span></td>
      <td class="quantity"><input class="quantity" value="1" /></td>
      <td class="line_cost"><span class="amount">৳1500</span></td>
    </tr>
  </table>
  <input name="_order_total" value="1590" />
</body>
</html>
`;

const parsedEdit = woocommerce.parseOrderEditPageHTML(editPageHtml, "19551");
assert.strictEqual(parsedEdit.name, "Tanvir Ahmed", "Should prioritize shipping name");
assert.strictEqual(parsedEdit.phone, "01955556666", "Should prioritize shipping phone");
assert.ok(parsedEdit.address.includes("Holding 42, Block C"), "Should contain shipping address 1");
assert.ok(parsedEdit.address.includes("Flat 3A"), "Should contain shipping address 2 (flat/apartment)");
assert.ok(parsedEdit.notes.includes("Deliver after 5 PM"), "Should extract customer note");
assert.strictEqual(parsedEdit.items.length, 1, "Should extract 1 line item");
console.log("  ✅ parseOrderEditPageHTML prioritized shipping details, preserved address_2, and captured customer note!");

// Test 3: Table row and modal customer note extraction
console.log("\n▶ Test 3: Testing Customer Note Extraction in Modal & Table Row...");
const mockModal = {
  innerText: "Order #19552\nCustomer: Farhan\nPhone: 01777888999\nHouse 10, Road 2, Banani, Dhaka\nItem: Smart Watch x 1 ৳2000\nTotal: ৳2050",
  querySelector: function(sel) {
    if (sel.includes("customer-note") || sel.includes("customer_note") || sel.includes("wc-order-preview-customer-note")) {
      return { textContent: "Please call 30 mins before delivery" };
    }
    if (sel.includes("address")) {
      return { textContent: "Farhan\nHouse 10, Road 2, Banani, Dhaka\n01777888999" };
    }
    return null;
  },
  querySelectorAll: function(sel) {
    return [];
  }
};

const modalDetails = woocommerce.extractOrderDetailsFromModal(mockModal);
assert.strictEqual(modalDetails.notes, "Please call 30 mins before delivery", "Modal should extract customer note");

const mockRow = {
  innerText: "19553 Farhan 01777888999 Mirpur 10, Dhaka ৳1500",
  querySelector: function(sel) {
    if (sel.includes("order_number") || sel.includes("order-view")) {
      return { textContent: "#19553", href: "/wp-admin/post.php?post=19553&action=edit" };
    }
    if (sel.includes("order_notes") || sel.includes("order-notes") || sel.includes("Notes")) {
      return { textContent: "ফ্রি ডেলিভারি কুপন প্রযোজ্য" };
    }
    return null;
  },
  querySelectorAll: function(sel) {
    return [];
  }
};

const rowDetails = woocommerce.extractRowOrderDetails(mockRow);
assert.strictEqual(rowDetails.notes, "ফ্রি ডেলিভারি কুপন প্রযোজ্য", "Row should extract customer note");
console.log("  ✅ extractOrderDetailsFromModal and extractRowOrderDetails captured customer notes!");

// Test 4: inFlightOrderRequests concurrent request deduplication & timeout protection
console.log("\n▶ Test 4: Testing inFlightOrderRequests Deduplication & Timeout Protection...");
assert.ok(woocommerce.inFlightOrderRequests instanceof Map, "inFlightOrderRequests must be a Map");
assert.strictEqual(typeof woocommerce.fetchWithTimeout, "function", "fetchWithTimeout must be a function");

// Simulate simultaneous requests for order 19999
let callCount = 0;
global.fetch = function(url, opts) {
  callCount++;
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        ok: true,
        text: () => Promise.resolve(editPageHtml)
      });
    }, 50);
  });
};

let res1 = null;
let res2 = null;
let completed = 0;

woocommerce.fetchOrderDetailsViaEditPage("19999", "/wp-admin/post.php?post=19999&action=edit", (data) => {
  res1 = data;
  completed++;
  checkBothDone();
});

woocommerce.fetchOrderDetailsViaEditPage("19999", "/wp-admin/post.php?post=19999&action=edit", (data) => {
  res2 = data;
  completed++;
  checkBothDone();
});

function checkBothDone() {
  if (completed < 2) return;
  assert.strictEqual(callCount, 1, "Should deduplicate concurrent network calls to exactly 1 request");
  assert.ok(res1 && res1.name === "Tanvir Ahmed", "First caller should receive parsed order");
  assert.ok(res2 && res2.name === "Tanvir Ahmed", "Second caller should receive identical parsed order");
  assert.strictEqual(woocommerce.inFlightOrderRequests.has("19999"), false, "inFlightOrderRequests should be cleared after resolution");
  console.log("  ✅ inFlightOrderRequests successfully deduplicated simultaneous network calls!");

  runRemainingTests();
}

function runRemainingTests() {
  // Test 5: Special instructions in Pathao batch CSV export
  console.log("\n▶ Test 5: Testing Special Instructions in Pathao Batch CSV Export...");
  const sampleOrders = [
    {
      orderId: "19555",
      name: "Tariqul Islam",
      phone: "01712345678",
      address: "House 10, Road 4, Sector 3, Uttara, Dhaka",
      cod: 1550,
      instruction: "Do not fold parcel",
      notes: "Gate code: #1234"
    }
  ];

  const csv = parser.generatePathaoBatchCSV(sampleOrders);
  assert.ok(csv.includes("Order #19555 - Do not fold parcel"), "Pathao CSV should include customer instruction/notes");
  console.log("  ✅ generatePathaoBatchCSV attached instructions & notes to CSV output!");

  // Test 6: Free shipping advance charge omission in WhatsApp Quick Reply
  console.log("\n▶ Test 6: Testing Free Shipping Advance Charge Omission in WhatsApp Quick Reply...");
  const freeShippingOrder = {
    orderId: "19556",
    name: "Mahmud Hasan",
    phone: "01788889999",
    address: "Kandirpar, Cumilla",
    subtotal: 2800,
    cod: 2800,
    isFreeShipping: true,
    isOutsideDhaka: true
  };

  const reply = parser.generateQuickReply("order_details_confirm", freeShippingOrder);
  assert.ok(!reply.includes("অগ্রিম প্রযোজ্য"), "Free shipping order outside Dhaka should NOT ask for advance delivery fee");
  assert.ok(!reply.includes("৳0 অগ্রিম"), "Should never output ৳0 advance fee");
  console.log("  ✅ generateQuickReply cleanly omitted advance delivery fee request on free shipping order!");

  // Test 7: High-Risk Return Auto-Highlighter & Advance Gate Automation
  console.log("\n▶ Test 7: Testing High-Risk Return Auto-Highlighter & Advance Fee Gate Automation...");
  
  // Set up mock DOM elements to test modal auto-preselection
  let createdElements = [];
  const mockBackdrop = {
    id: "",
    className: "",
    children: [],
    appendChild: function(child) { this.children.push(child); return child; },
    addEventListener: () => {},
    remove: () => {}
  };

  const mockTabButtons = [
    { dataset: { tpl: "order_details_confirm" }, classList: { classes: ["deen-tab-btn", "deen-tab-active"], add: function(c) { this.classes.push(c); }, remove: function(c) { this.classes = this.classes.filter(x => x !== c); } }, addEventListener: () => {} },
    { dataset: { tpl: "confirm_order" }, classList: { classes: ["deen-tab-btn"], add: function(c) { this.classes.push(c); }, remove: function(c) { this.classes = this.classes.filter(x => x !== c); } }, addEventListener: () => {} },
    { dataset: { tpl: "high_risk_notice" }, classList: { classes: ["deen-tab-btn"], add: function(c) { this.classes.push(c); }, remove: function(c) { this.classes = this.classes.filter(x => x !== c); } }, addEventListener: () => {} }
  ];

  const mockRatingBox = { style: {}, parentNode: { insertBefore: () => {} }, nextSibling: null };
  const mockRatingBadge = { textContent: "", style: {} };
  const mockRatingText = { textContent: "", innerHTML: "" };
  const mockTextarea = { value: "", dataset: {}, addEventListener: () => {} };
  const mockSendBtn = { textContent: "", addEventListener: () => {} };

  const modalMockDom = {
    querySelector: function(sel) {
      if (sel === "#deen-order-confirm-rating-box") return mockRatingBox;
      if (sel === "#deen-order-rating-badge") return mockRatingBadge;
      if (sel === "#deen-order-rating-text") return mockRatingText;
      if (sel === "#deen-order-msg-text") return mockTextarea;
      if (sel === "#deen-footer-btn-send") return mockSendBtn;
      if (sel === ".deen-tab-btn[data-tpl='high_risk_notice']") return mockTabButtons[2];
      return null;
    },
    querySelectorAll: function(sel) {
      if (sel === ".deen-tab-btn") return mockTabButtons;
      return [];
    },
    appendChild: () => {}
  };

  // Mock global document.createElement and body for modal
  const origCreate = global.document ? global.document.createElement : null;
  global.document = global.document || {};
  global.document.getElementById = (id) => null;
  global.document.createElement = function(tag) {
    if (tag === "div") {
      return {
        id: "",
        className: "",
        innerHTML: "",
        style: {},
        querySelector: modalMockDom.querySelector,
        querySelectorAll: modalMockDom.querySelectorAll,
        appendChild: () => {},
        addEventListener: () => {}
      };
    }
    return { style: {}, classList: { add: () => {}, remove: () => {} }, addEventListener: () => {} };
  };
  global.document.body = { appendChild: () => {} };

  // Mock fetchCustomerRatingBackground returning a high-risk customer with 4 cancellations
  const origFetchRating = woocommerce.fetchCustomerRatingBackground;
  global.chrome = global.chrome || {};
  global.chrome.storage = global.chrome.storage || {
    sync: { get: (k, cb) => cb({}) },
    local: { get: (k, cb) => cb({}) }
  };
  global.chrome.runtime = global.chrome.runtime || {
    sendMessage: (msg, cb) => {
      if (msg.action === "fetch_customer_rating") {
        cb({
          success: true,
          phone: "01799990000",
          successRate: 45,
          totalParcels: 9,
          deliveredCount: 4,
          cancelledCount: 5,
          riskLevel: "high",
          riskLabel: "High Return Risk"
        });
      }
    }
  };

  woocommerce.showOrderConfirmModal({
    orderId: "19557",
    name: "Risky Customer",
    phone: "01799990000",
    address: "Mirpur 1, Dhaka",
    subtotal: 1500,
    cod: 1550
  });

  // Verify advance gate auto-preselection
  assert.ok(mockTabButtons[2].classList.classes.includes("deen-tab-active"), "High risk notice tab must be auto-selected");
  assert.ok(!mockTabButtons[0].classList.classes.includes("deen-tab-active"), "Order details tab must be de-selected for high risk");
  assert.ok(mockTextarea.value.includes("অগ্রিম প্রদান করা বাধ্যতামূলক"), "Textarea must auto-populate with advance fee requirement");
  assert.strictEqual(mockSendBtn.textContent, "⚠️ Send Advance Charge Notice (WhatsApp)", "Send button must adapt to advance notice");
  console.log("  ✅ showOrderConfirmModal successfully gated high-risk customer and auto-selected advance fee notice!");

  // =========================================================================
  // Test 8: Dedicated Customer Rating Table Column & LocalStorage 24h Caching
  // =========================================================================
  console.log("\n▶ Test 8: Testing Dedicated Customer Rating Table Column & LocalStorage 24h Caching...");

  assert.strictEqual(typeof woocommerce.injectCustomerRatingColumn, "function", "injectCustomerRatingColumn must be a function");
  assert.strictEqual(typeof woocommerce.getLocalRatingCache, "function", "getLocalRatingCache must be a function");
  assert.strictEqual(typeof woocommerce.setLocalRatingCache, "function", "setLocalRatingCache must be a function");
  assert.strictEqual(typeof woocommerce.clearLocalRatingCache, "function", "clearLocalRatingCache must be a function");

  // Test setLocalRatingCache and getLocalRatingCache
  const sampleRating = {
    success: true,
    phone: "01711223344",
    successRate: 96,
    totalParcels: 25,
    deliveredCount: 24,
    cancelledCount: 1,
    riskLevel: "low",
    riskLabel: "Safe Buyer (96% Success)",
    isNewCustomer: false
  };

  woocommerce.setLocalRatingCache("01711223344", sampleRating);
  const retrievedRating = woocommerce.getLocalRatingCache("01711223344");
  assert.ok(retrievedRating, "Rating must be retrievable from local cache");
  assert.strictEqual(retrievedRating.phone, "01711223344");
  assert.strictEqual(retrievedRating.successRate, 96);
  assert.strictEqual(retrievedRating.deliveredCount, 24);

  // Test clearLocalRatingCache
  woocommerce.clearLocalRatingCache("01711223344");
  assert.strictEqual(woocommerce.getLocalRatingCache("01711223344"), null, "Rating must be null after clearing cache");
  console.log("  ✅ LocalStorage rating cache storage, retrieval, and invalidation verified!");

  // =========================================================================
  // Test 9: Zero-Latency Table Column Injection & High-Risk Auto-Highlighting
  // =========================================================================
  console.log("\n▶ Test 9: Testing Zero-Latency Table Column Injection & High-Risk Auto-Highlighting...");

  // Mock DOM implementation for orders table
  function matchesSingle(el, p) {
    if (!el || !p) return false;
    p = p.trim();
    if (p.startsWith(".")) {
      const cls = p.slice(1);
      return Boolean(el.classList && el.classList.contains && el.classList.contains(cls));
    }
    if (p.startsWith("#")) {
      const id = p.slice(1);
      return el.id === id;
    }
    if (p.includes(".")) {
      const [tag, cls] = p.split(".");
      return (!tag || (el.tagName && el.tagName.toLowerCase() === tag.toLowerCase())) &&
             Boolean(el.classList && el.classList.contains && el.classList.contains(cls));
    }
    return p.toLowerCase() === (el.tagName || "").toLowerCase();
  }

  function matchesSel(el, sel) {
    if (!el || !sel) return false;
    const parts = sel.split(",").map(s => s.trim());
    for (const p of parts) {
      if (p.includes(" ")) {
        const segs = p.split(/\s+/);
        const last = segs[segs.length - 1];
        if (!matchesSingle(el, last)) continue;
        let cur = el.parentNode;
        let segIdx = segs.length - 2;
        while (cur && segIdx >= 0) {
          if (matchesSingle(cur, segs[segIdx])) {
            segIdx--;
          }
          cur = cur.parentNode;
        }
        if (segIdx < 0) return true;
      } else {
        if (matchesSingle(el, p)) return true;
      }
    }
    return false;
  }

  function parseMockHtml(html) {
    const list = [];
    const re = /<([a-z0-9_-]+)([^>]*)>([\s\S]*?)<\/\1>|<([a-z0-9_-]+)([^>]*)\/>/gi;
    let match;
    while ((match = re.exec(html)) !== null) {
      const tag = match[1] || match[4];
      const attrs = match[2] || match[5] || "";
      const body = match[3] || "";
      const clsMatch = attrs.match(/class=["']([^"']+)["']/i);
      const titleMatch = attrs.match(/title=["']([^"']+)["']/i);
      const child = createTestEl(tag, {
        className: clsMatch ? clsMatch[1] : "",
        textContent: body.replace(/<[^>]+>/g, "").trim()
      });
      if (titleMatch) child.title = titleMatch[1];
      if (body.includes("<")) {
        const subChildren = parseMockHtml(body);
        for (const sub of subChildren) {
          child.appendChild(sub);
        }
      }
      list.push(child);
    }
    return list;
  }

  function createTestEl(tag, props = {}) {
    let rawHtml = props.innerHTML || "";
    let rawCls = props.className || "";

    const classListObj = {
      contains: function(c) {
        return rawCls.split(/\s+/).filter(Boolean).includes(c);
      },
      add: function(c) {
        if (!this.contains(c)) rawCls = (rawCls + " " + c).trim();
      },
      remove: function(c) {
        rawCls = rawCls.split(/\s+/).filter(x => x && x !== c).join(" ");
      }
    };

    const el = {
      tagName: tag.toUpperCase(),
      children: [],
      style: {},
      dataset: {},
      textContent: props.textContent || "",
      setAttribute: function(k, v) { this[k] = v; },
      getAttribute: function(k) { return this[k]; },
      addEventListener: function(evt, handler) { this._events = this._events || {}; this._events[evt] = handler; },
      appendChild: function(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
      },
      insertBefore: function(newNode, refNode) {
        newNode.parentNode = this;
        const idx = this.children.indexOf(refNode);
        if (idx !== -1) {
          this.children.splice(idx, 0, newNode);
        } else {
          this.children.push(newNode);
        }
        return newNode;
      },
      querySelector: function(sel) {
        for (const ch of this.children) {
          if (matchesSel(ch, sel)) return ch;
          const sub = ch.querySelector ? ch.querySelector(sel) : null;
          if (sub) return sub;
        }
        return null;
      },
      querySelectorAll: function(sel) {
        let res = [];
        for (const ch of this.children) {
          if (matchesSel(ch, sel)) res.push(ch);
          if (ch.querySelectorAll) res = res.concat(ch.querySelectorAll(sel));
        }
        return res;
      }
    };

    Object.defineProperty(el, "className", {
      get() { return rawCls; },
      set(val) { rawCls = val || ""; }
    });
    el.classList = classListObj;

    Object.defineProperty(el, "innerHTML", {
      get() { return rawHtml; },
      set(val) {
        rawHtml = val;
        this.children = [];
        const parsed = parseMockHtml(val);
        for (const p of parsed) {
          this.appendChild(p);
        }
      }
    });

    if (props.innerHTML) {
      el.innerHTML = props.innerHTML;
    }

    return el;
  }

  // Pre-seed local ratings cache for two test customers
  woocommerce.setLocalRatingCache("01711002233", {
    success: true,
    phone: "01711002233",
    successRate: 95,
    totalParcels: 20,
    deliveredCount: 19,
    cancelledCount: 1,
    riskLevel: "low",
    riskLabel: "Safe Buyer (95% Success)",
    isNewCustomer: false
  });

  woocommerce.setLocalRatingCache("01899001122", {
    success: true,
    phone: "01899001122",
    successRate: 35,
    totalParcels: 10,
    deliveredCount: 3,
    cancelledCount: 7,
    riskLevel: "high",
    riskLabel: "High Return Risk (7 Returns)",
    isNewCustomer: false
  });

  // Construct mock WooCommerce table
  const mockTable = createTestEl("table", { className: "wp-list-table wc-orders-list-table" });
  const thead = createTestEl("thead");
  const theadRow = createTestEl("tr");
  const thOrder = createTestEl("th", { className: "column-order_number", textContent: "Order" });
  const thShip = createTestEl("th", { className: "column-shipping_address", textContent: "Ship to" });
  const thTotal = createTestEl("th", { className: "column-order_total", textContent: "Total" });
  theadRow.appendChild(thOrder);
  theadRow.appendChild(thShip);
  theadRow.appendChild(thTotal);
  thead.appendChild(theadRow);
  mockTable.appendChild(thead);

  const tfoot = createTestEl("tfoot");
  const tfootRow = createTestEl("tr");
  tfootRow.appendChild(createTestEl("th", { className: "column-order_number", textContent: "Order" }));
  tfootRow.appendChild(createTestEl("th", { className: "column-shipping_address", textContent: "Ship to" }));
  tfootRow.appendChild(createTestEl("th", { className: "column-order_total", textContent: "Total" }));
  tfoot.appendChild(tfootRow);
  mockTable.appendChild(tfoot);

  const tbody = createTestEl("tbody");

  // Row 1: Safe customer
  const row1 = createTestEl("tr", { className: "order-row" });
  row1.appendChild(createTestEl("td", { className: "column-order_number", textContent: "#19801" }));
  row1.appendChild(createTestEl("td", { className: "column-shipping_address", textContent: "Rahim, Mirpur, 01711002233" }));
  row1.appendChild(createTestEl("td", { className: "column-order_total", textContent: "৳1,500" }));
  tbody.appendChild(row1);

  // Row 2: High risk customer
  const row2 = createTestEl("tr", { className: "order-row" });
  row2.appendChild(createTestEl("td", { className: "column-order_number", textContent: "#19802" }));
  row2.appendChild(createTestEl("td", { className: "column-shipping_address", textContent: "Karim, Chattogram, 01899001122" }));
  row2.appendChild(createTestEl("td", { className: "column-order_total", textContent: "৳2,800" }));
  tbody.appendChild(row2);

  mockTable.appendChild(tbody);

  // Set global document.querySelectorAll to return mockTable and createElement to build test elements
  global.document.querySelectorAll = function(sel) {
    if (sel.includes("table.wp-list-table") || sel.includes("table.wc-orders-list-table")) {
      return [mockTable];
    }
    return [];
  };
  global.document.createElement = function(tag) {
    return createTestEl(tag);
  };

  // Run injectCustomerRatingColumn
  woocommerce.injectCustomerRatingColumn();

  // 1. Verify thead has th.column-deen_rating inserted before Total column
  const ratingThThead = theadRow.querySelector(".column-deen_rating");
  assert.ok(ratingThThead, "thead must contain th.column-deen_rating");
  assert.strictEqual(ratingThThead.textContent, "Customer Rating");
  const theadChildren = theadRow.children;
  assert.strictEqual(theadChildren[2], ratingThThead, "Customer Rating column must be inserted before Total in thead");

  // 2. Verify tfoot has th.column-deen_rating
  const ratingThTfoot = tfootRow.querySelector(".column-deen_rating");
  assert.ok(ratingThTfoot, "tfoot must contain th.column-deen_rating");

  // 3. Verify Row 1 (Safe Customer) cell and contents
  const cell1 = row1.querySelector(".column-deen_rating");
  assert.ok(cell1, "Row 1 must contain td.column-deen_rating");
  assert.strictEqual(row1.children[2], cell1, "td.column-deen_rating must sit right before Total column in Row 1");
  assert.ok(cell1.innerHTML.includes("🛡️ 95% Safe"), "Cell 1 must instantly render 95% Safe rating badge from localStorage");
  assert.ok(cell1.innerHTML.includes("19/20 Delivered • 1 Return"), "Cell 1 must display delivery breakdown");
  assert.ok(cell1.innerHTML.includes("💬 WhatsApp"), "Cell 1 must have 1-click WhatsApp order confirm button");
  assert.ok(cell1.innerHTML.includes("🔄"), "Cell 1 must have live refresh button");

  // 4. Verify Row 2 (High Risk Customer) cell, auto-highlighting, and alert badge
  const cell2 = row2.querySelector(".column-deen_rating");
  assert.ok(cell2, "Row 2 must contain td.column-deen_rating");
  assert.ok(row2.classList.contains("deen-high-risk-order-row"), "Row 2 must have deen-high-risk-order-row class applied");
  assert.ok(cell2.innerHTML.includes("🚨 High Risk (7)"), "Cell 2 must render High Risk alert badge with cancellation count");
  assert.ok(cell2.innerHTML.includes("3/10 Delivered • 7 Return"), "Cell 2 must display high return breakdown");

  console.log("  ✅ Dedicated Customer Rating column inserted with 100% table alignment and instant localStorage render!");
  console.log("  ✅ High-risk return auto-highlighting verified on orders table row!");

  console.log("\n==================================================");
  console.log("🎉 ALL 9 FULL FETCH, RATING COLUMN & AUTOMATION TESTS PASSED 100%!");
  console.log("==================================================");
}
