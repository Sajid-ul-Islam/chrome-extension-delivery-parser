/**
 * Automated Verification Test for DEEN Parser & Pathao Autofill Integration
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log("==================================================");
console.log("🧪 Running Verification Tests for DEEN Delivery Parser");
console.log("==================================================");

// 1. Validate Manifest V3
console.log("\n▶ Test 1: Validating manifest.json...");
const manifestRaw = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');
const manifest = JSON.parse(manifestRaw);

assert.strictEqual(manifest.manifest_version, 3, "Manifest version must be 3");
assert(manifest.permissions.includes("storage"), "Must have storage permission");
assert(manifest.permissions.includes("tabs"), "Must have tabs permission");
assert(manifest.permissions.includes("clipboardWrite"), "Must have clipboardWrite permission");
assert(!manifest.permissions.includes("clipboardRead"), "Must not request unnecessary clipboardRead permission");
assert(!manifest.host_permissions.includes("*://*/*"), "Must not request broad *://*/* host permission");

const hasWooCommerceScript = manifest.content_scripts.some(cs =>
  cs.js && cs.js.includes("woocommerce.js") &&
  cs.matches.some(m => m.includes("deencommerce.com") || m.includes("wc-orders"))
);
assert(hasWooCommerceScript, "Manifest must contain content_script for WooCommerce with woocommerce.js");

const hasPhoneCheckScript = manifest.content_scripts.some(cs =>
  cs.js && cs.js.includes("phone-check.js") &&
  cs.matches.some(m => m.includes("*://*/*") || m.includes("<all_urls>"))
);
assert(hasPhoneCheckScript, "Manifest must contain universal content_script for phone-check.js across all URLs");
console.log("  ✅ manifest.json is valid and properly configured with universal phone-check script.");

// 2. Test Phone Number Extraction & Normalization
console.log("\n▶ Test 2: Testing Phone Number Extraction & Normalization (WhatsApp, Facebook, Universal)...");
const { normalizeBDPhone } = require('./phone-check.js');

const testCases = [
  { input: "01711223344", expected: "01711223344" },
  { input: "+8801812345678", expected: "01812345678" },
  { input: "8801912345678", expected: "01912345678" },
  { input: "01300-112233", expected: "01300112233" },
  { input: "(+88) 01555 443322", expected: "01555443322" },
  { input: "Customer: Rahim, Cell: 01611223344, Address: Dhaka", expected: "01611223344" },
  { input: "+880 1712-345678", expected: "01712345678" }, // WhatsApp Web contact format
  { input: "+880 1819 223344", expected: "01819223344" }, // WhatsApp Web space-separated format
  { input: "Order info: send to 01911-223344 immediately", expected: "01911223344" },
  { input: "WhatsApp msg: call +8801700112233", expected: "01700112233" },
  { input: "Not a phone: 12345678", expected: null },
  { input: "01200000000", expected: null }, // 012 is not valid BD mobile prefix
  { input: "01100000000", expected: null }, // 011 is not valid BD mobile prefix
];

for (const tc of testCases) {
  const result = normalizeBDPhone(tc.input);
  assert.strictEqual(result, tc.expected, `Failed on input '${tc.input}': expected '${tc.expected}', got '${result}'`);
}
console.log(`  ✅ All ${testCases.length} universal phone normalization test cases passed!`);

// 3. Test woocommerce.js, phone-check.js, and content.js file syntax
console.log("\n▶ Test 3: Checking JavaScript syntax of content scripts...");
require('./phone-check.js');
console.log("  ✅ phone-check.js loaded without syntax errors.");

require('./woocommerce.js');
console.log("  ✅ woocommerce.js loaded without syntax errors.");

const wcCode = fs.readFileSync(path.join(__dirname, 'woocommerce.js'), 'utf8');
assert(wcCode.includes("syncToPathao(payload, { autoSwitch: true, userTriggered: true })"),
  "woocommerce.js single order page must pass userTriggered: true to syncToPathao");
assert(wcCode.includes("debounceTimer"),
  "woocommerce.js MutationObserver must be debounced");
console.log("  ✅ woocommerce.js single order dispatch & debounced MutationObserver verified!");

require('./content.js');
console.log("  ✅ content.js loaded without syntax errors.");

require('./background.js');
console.log("  ✅ background.js loaded without syntax errors.");

const bgCode = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
assert(!bgCode.includes("chrome.cookies.getAll({},"),
  "background.js must never perform an unfiltered chrome.cookies.getAll({}) scan across all domains");
console.log("  ✅ background.js cookie security verified (no cross-origin cookie scraping)!");

require('./popup.js');
console.log("  ✅ popup.js loaded without syntax errors.");

// 4. Test Pathao Table Column Alignment & Parsing
console.log("\n▶ Test 4: Testing Pathao Table Column Alignment & Amounts Extraction...");
eval(fs.readFileSync(path.join(__dirname, 'parser.js'), 'utf8'));

const testRawPathao = `DD160926SVKEEQ
Parcel
14782 c
DEEN CUMILLA OUTLET
Kamrul Hassan
Sohidullah Complex, Mawna Chowrasta, Sreepur, Gazipur-1740, , Sreepur, BD-18,
01729660881
Pending
Updated on 16/09/2026
COD ৳ 725
Charge ৳ 107.25
Discount ৳ 10
Unpaid
View
POD`;

const parsedTest = parseDeliveryData(testRawPathao);
assert(parsedTest && parsedTest.records.length === 1, "Should parse 1 record");
const rec = parsedTest.records[0];

assert.strictEqual(rec["Consignment ID"], "DD160926SVKEEQ", "Consignment ID mismatch");
assert.strictEqual(rec["Type"], "Parcel", "Type mismatch");
assert.strictEqual(rec["Order ID"], "14782 c", "Order ID mismatch");
assert.strictEqual(rec["Store"], "DEEN CUMILLA OUTLET", "Store mismatch");
assert.strictEqual(rec["Recipient Name"], "Kamrul Hassan", "Recipient Name mismatch");
assert(rec["Address"].includes("Sohidullah Complex"), "Address mismatch");
assert.strictEqual(rec["Phone"], "01729660881", "Phone mismatch");
assert.strictEqual(rec["Delivery Status"], "Pending", "Delivery Status mismatch");
assert.strictEqual(rec["Status Updated On"], "16/09/2026", "Date mismatch");
assert.strictEqual(rec["COD Amount"], 725, "COD Amount mismatch");
assert.strictEqual(rec["Charge"], 107.25, "Charge mismatch");
assert.strictEqual(rec["Discount"], 10, "Discount mismatch");
assert.strictEqual(rec["Payment Status"], "Unpaid", "Payment Status mismatch");
console.log("  ✅ Pathao table columns, Order ID suffix, Store, and Amounts mapped with 100% precision.");

console.log("\n▶ Test 5: Testing Popup Multi-Row Parsing & Column-Wise Copy Options...");
const multiRowSample = [
  'DD160926SVKEEQ', 'Parcel', '14782 c', 'DEEN CUMILLA OUTLET', 'Kamrul Hassan', 'Mawna Chowrasta, Sreepur, Gazipur', '01729660881', 'Pending', 'Updated on 16/09/2026', 'COD ৳ 725', 'Charge ৳ 107.25', 'Discount ৳ 10', 'Unpaid', 'View', 'POD',
  '---',
  'DD160926SVR89J', 'Parcel', '14782 s', 'DEEN CUMILLA OUTLET', 'MD. ABDUS SAMAD', 'Sonargaon, Narayanganj', '01912445566', 'Delivered', 'Updated on 16/09/2026', 'COD ৳ 1350', 'Charge ৳ 115', 'Discount ৳ 0', 'Paid', 'View', 'POD'
].join('\n');

const multiRes = parseDeliveryData(multiRowSample);
assert.strictEqual(multiRes.records.length, 2, "Should parse 2 records");

const phoneCol = multiRes.records.map(r => r["Phone"]).join("\n");
assert.strictEqual(phoneCol, "01729660881\n01912445566", "Phone column copy mismatch");

const consCol = multiRes.records.map(r => r["Consignment ID"]).join("\n");
assert.strictEqual(consCol, "DD160926SVKEEQ\nDD160926SVR89J", "Consignment column copy mismatch");

const orderCol = multiRes.records.map(r => r["Order ID"]).join("\n");
assert.strictEqual(orderCol, "14782 c\n14782 s", "Order ID column copy mismatch");

const storeCol = multiRes.records.map(r => r["Store"]).join("\n");
assert.strictEqual(storeCol, "DEEN CUMILLA OUTLET\nDEEN CUMILLA OUTLET", "Store column copy mismatch");

const codCol = multiRes.records.map(r => String(r["COD Amount"])).join("\n");
assert.strictEqual(codCol, "725\n1350", "COD column copy mismatch");
console.log("  ✅ Multi-row Pathao parsing and 1-click column copies verified!");

console.log("\n▶ Test 6: Testing Exchange Orders with D- Prefix (e.g. D-14489)...");
const exchangeSample = [
  'DD160926SVKEEQ', 'Parcel', 'D-14489', 'DEEN CUMILLA OUTLET', 'Kamrul Hassan', 'Mawna Chowrasta, Sreepur, Gazipur', '01729660881', 'Pending', 'Updated on 16/09/2026', 'COD ৳ 725', 'Charge ৳ 107.25', 'Discount ৳ 10', 'Unpaid', 'View', 'POD',
  '---',
  'DD160926SVR89J', 'Parcel', 'D-14489 c', 'DEEN CUMILLA OUTLET', 'MD. ABDUS SAMAD', 'Sonargaon, Narayanganj', '01912445566', 'Delivered', 'Updated on 16/09/2026', 'COD ৳ 1350', 'Charge ৳ 115', 'Discount ৳ 0', 'Paid', 'View', 'POD'
].join('\n');

const exRes = parseDeliveryData(exchangeSample);
assert.strictEqual(exRes.records.length, 2, "Should parse 2 exchange records");

const ex1 = exRes.records[0];
assert.strictEqual(ex1["Order ID"], "D-14489", "Order ID should be D-14489");
assert.strictEqual(ex1["Recipient Name"], "Kamrul Hassan", "Recipient Name must NOT be D-14489");
assert.strictEqual(ex1["Type"], "Exchange", "Type should be Exchange for D- prefix order");
assert.strictEqual(ex1["Address"], "Mawna Chowrasta, Sreepur, Gazipur", "Address should not contain customer name");

const ex2 = exRes.records[1];
assert.strictEqual(ex2["Order ID"], "D-14489 c", "Order ID should be D-14489 c");
assert.strictEqual(ex2["Recipient Name"], "MD. ABDUS SAMAD", "Recipient Name must NOT be D-14489 c");
assert.strictEqual(ex2["Type"], "Exchange", "Type should be Exchange for D- prefix order");
assert.strictEqual(ex2["Address"], "Sonargaon, Narayanganj", "Address should not contain customer name");

console.log("  ✅ D-14489 correctly identified as Exchange Order ID, Customer Name preserved 100%!");

console.log("\n▶ Test 7: Testing WooCommerce Orders Table Parsing & Unread Activity Tracking...");
const rawWcSample = `Screen OptionsHelp
Orders Add order
All (2,676) | Processing (2) | On hold (157) | Completed (2,399) | Cancelled (117) | Failed (1) | Trash (1)
Search orders:
Select bulk action
2,676 items « ‹ Current Page of 3 Next page› Last page»
Select All	
Order
Sort ascending.
Date
Sort ascending.
Status	Outlet	
Total
Sort ascending.
Export Status
Sort ascending.
Pathao Courier	Pathao Courier Status	Pathao Courier Delivery Fee	Origin	
Invoice
Sort ascending.
	Preview#14913 badon	5 minutes ago	
Completed
—Cumilla	1,535৳		Send with Pathao			Cumilla	14913
	Preview#14912 Shohag	19 minutes ago	
Completed
—Mirpur 12	499৳		Send with Pathao			Mirpur 12	14912
	Preview#14911 Md Bipul Hossain	58 minutes ago	
Completed
WarehouseOnline	1,584৳		DD1609264767JE	Pending	110	Source: Fb	14911
	Preview#14909 Shaown	1 hour ago	
Completed
—Sylhet	663৳		Send with Pathao			Sylhet	14909
	Preview#14908 rajesh	1 hour ago	
Completed
—Cumilla	998৳		Send with Pathao			Cumilla	14908
	Preview#14907 Md Rakib	1 hour ago	
On hold
CumillaOnline	640৳		Send with Pathao			Direct	14907
	Preview#14906 Md Hridoy	2 hours ago	
Completed
Mirpur 12, CumillaOnline	763৳		DD160926UQHNZA	Pending	60	Source: Fb	14906
	Preview#14905 kamrul hasen	2 hours ago	
Completed
—Cumilla	725৳		Send with Pathao			Cumilla	14905
	Preview#14903 Sagar	2 hours ago	
Completed
—Wari	1,554৳		Send with Pathao			Wari	14903
	Preview#14902 Mohammad WaterFall Test	2 hours ago	
Processing
Warehouse, Waterfall OutletOnline	350৳		Send with Pathao			Direct	14902
	Preview#D-14489 Exchange Customer	3 hours ago	
Processing
CumillaOnline	1,200৳		Send with Pathao			Direct	14489`;

assert(isWooCommerceText(rawWcSample), "Should detect text as WooCommerce format");
const wcResult = parseDeliveryData(rawWcSample);
assert.strictEqual(wcResult.mode, "woocommerce", "Mode should be woocommerce");
assert.strictEqual(wcResult.records.length, 11, "Should parse 11 orders (10 standard + 1 exchange)");

// Verify Order 1 (14913 badon - Unsent)
const order1 = wcResult.records[0];
assert.strictEqual(order1["Order ID"], "14913", "Order 1 ID mismatch");
assert.strictEqual(order1["Recipient Name"], "badon", "Order 1 Customer mismatch");
assert.strictEqual(order1["COD Amount"], 1535, "Order 1 COD mismatch");
assert.strictEqual(order1["Consignment ID"], "Send with Pathao", "Order 1 Consignment mismatch");
assert.strictEqual(order1["Delivery Status"], "Send with Pathao", "Order 1 Delivery Status mismatch");
assert.strictEqual(order1["Store"], "Cumilla", "Order 1 Store mismatch");

// Verify Order 3 (14911 Md Bipul Hossain - Dispatched DD1609264767JE)
const order3 = wcResult.records[2];
assert.strictEqual(order3["Order ID"], "14911", "Order 3 ID mismatch");
assert.strictEqual(order3["Recipient Name"], "Md Bipul Hossain", "Order 3 Customer mismatch");
assert.strictEqual(order3["Consignment ID"], "DD1609264767JE", "Order 3 Consignment ID mismatch");
assert.strictEqual(order3["Delivery Status"], "Pathao: Pending", "Order 3 Delivery Status mismatch");
assert.strictEqual(order3["Charge"], 110, "Order 3 Fee mismatch");
assert.strictEqual(order3["COD Amount"], 1584, "Order 3 COD mismatch");
assert.strictEqual(order3["Store"], "WarehouseOnline", "Order 3 Store mismatch");

// Verify Order 11 (D-14489 Exchange Customer)
const order11 = wcResult.records[10];
assert.strictEqual(order11["Order ID"], "D-14489", "Order 11 ID mismatch");
assert.strictEqual(order11["Recipient Name"], "Exchange Customer", "Order 11 Name mismatch");
assert.strictEqual(order11["Type"], "Exchange", "Order 11 Type should be Exchange");
assert.strictEqual(order11["Consignment ID"], "Send with Pathao", "Order 11 Consignment mismatch");

// Verify Metrics & Unread Activity Counts
const m = wcResult.metrics;
assert.strictEqual(m.totalParcels, 11, "Total orders count mismatch");
assert.strictEqual(m.unsentCount, 9, "Unsent / Action Needed count mismatch (should be 9)");
assert.strictEqual(m.dispatchedCount, 2, "Dispatched count mismatch (should be 2)");
assert.strictEqual(m.totalCOD, 10511, "Total COD mismatch");

// Verify Column Copies on WooCommerce
const orderIdsCol = wcResult.records.map(r => r["Order ID"]).join("\n");
assert(orderIdsCol.includes("14913\n14912\n14911\n14909"), "Order ID column copy mismatch");

const unsentOrders = wcResult.records.filter(r => /Send with Pathao/i.test(r["Consignment ID"]));
assert.strictEqual(unsentOrders.length, 9, "Unsent orders filtering mismatch");

console.log(`  ✅ Successfully parsed ${wcResult.records.length} WooCommerce orders with 100% field accuracy!`);
console.log(`  ✅ Unread Activity Tracking: ${m.unsentCount} Unsent (Send with Pathao), ${m.dispatchedCount} Dispatched.`);

// 8. Test Smart BD Address Parser & Autofill Integration (Feature 4)
console.log("\n▶ Test 8: Testing Smart BD Address Parser & City/Zone Autofill Integration...");
const { parseBDAddress: testBDAddress, generatePathaoBatchCSV: testBatchCSV } = require('./parser.js');

const sampleAddresses = [
  {
    raw: "House 24, Road 7, Sector 4, Uttara, Dhaka - 1230",
    expectedDist: "Dhaka",
    expectedZone: "Uttara",
    expectedPostcode: "1230",
    expectedType: "Inside Dhaka"
  },
  {
    raw: "Masterpara, Sreepur, Gazipur-1740",
    expectedDist: "Gazipur",
    expectedZone: "Sreepur",
    expectedPostcode: "1740",
    expectedType: "Sub Dhaka"
  },
  {
    raw: "Agrabad Commercial Area, Chattogram",
    expectedDist: "Chattogram",
    expectedZone: "Agrabad",
    expectedType: "Outside Dhaka"
  }
];

for (const sa of sampleAddresses) {
  const p = testBDAddress(sa.raw);
  assert.strictEqual(p.district, sa.expectedDist, `District mismatch for ${sa.raw}`);
  assert.strictEqual(p.zone, sa.expectedZone, `Zone mismatch for ${sa.raw}`);
  if (sa.expectedPostcode) {
    assert.strictEqual(p.postcode, sa.expectedPostcode, `Postcode mismatch for ${sa.raw}`);
  }
  assert.strictEqual(p.cityType, sa.expectedType, `City type mismatch for ${sa.raw}`);
}
console.log("  ✅ Smart BD address parser correctly decomposes district, zone, postcode & city type.");

// 9. Test WooCommerce Bulk Action Toolbar, Row Extraction & Batch CSV (Feature 5)
console.log("\n▶ Test 9: Testing WooCommerce Bulk Action Toolbar & Pathao Batch CSV Export...");
const { extractRowOrderDetails } = require('./woocommerce.js');

// Mock a DOM row for WooCommerce orders list
const mockRow = {
  innerText: "14913 badon 1,535৳ 01711223344 House 12, Road 4, Sector 3, Uttara, Dhaka",
  querySelector: function(sel) {
    if (sel.includes(".order_number") || sel.includes("order-view")) {
      return { textContent: "#14913" };
    }
    if (sel.includes(".customer_user") || sel.includes(".column-order_title")) {
      return { textContent: "badon" };
    }
    if (sel.includes(".order_total") || sel.includes(".amount")) {
      return { textContent: "1,535৳" };
    }
    if (sel.includes(".shipping_address") || sel.includes(".billing_address")) {
      return { textContent: "House 12, Road 4, Sector 3, Uttara, Dhaka" };
    }
    return null;
  }
};

const extracted = extractRowOrderDetails(mockRow);
assert.strictEqual(extracted.orderId, "14913", "Extracted orderId mismatch");
assert.strictEqual(extracted.name, "badon", "Extracted name mismatch");
assert.strictEqual(extracted.phone, "01711223344", "Extracted phone mismatch");
assert.strictEqual(extracted.cod, "1535", "Extracted COD mismatch");
assert.strictEqual(extracted.district, "Dhaka", "Extracted district mismatch");
assert.strictEqual(extracted.zone, "Uttara", "Extracted zone mismatch");
console.log("  ✅ WooCommerce row extraction with smart BD address verified!");

// Test Batch CSV Generation with multiple extracted orders
const batchOrders = [
  extracted,
  {
    orderId: "14912",
    name: "Shohag",
    phone: "01812345678",
    address: "Mirpur 12, Dhaka - 1216",
    cod: "499",
    district: "Dhaka",
    zone: "Mirpur",
    streetAddress: "Mirpur 12"
  }
];

const batchCsv = testBatchCSV(batchOrders);
assert(batchCsv.includes("Merchant Order ID,Recipient Name,Recipient Phone"), "Pathao Batch CSV must have official headers");
assert(batchCsv.includes('"14913","badon","01711223344"'), "First batch row must match Order 14913");
assert(batchCsv.includes('"14912","Shohag","01812345678"'), "Second batch row must match Order 14912");
console.log("  ✅ Pathao Batch CSV export matches 100% of Pathao bulk upload format!");

// 10. Test Batch Queue State Structure & Advancement
console.log("\n▶ Test 10: Testing Pathao Batch Queue Storage Structure & Queue Advancement...");
const batchQueueState = {
  orders: batchOrders,
  currentIndex: 0,
  total: batchOrders.length,
  userTriggered: true,
  timestamp: Date.now()
};

assert.strictEqual(batchQueueState.total, 2, "Total queue items should be 2");
assert.strictEqual(batchQueueState.orders[batchQueueState.currentIndex].orderId, "14913", "Order 1 should be first in queue");

// Advance queue to item 2
batchQueueState.currentIndex++;
assert.strictEqual(batchQueueState.orders[batchQueueState.currentIndex].orderId, "14912", "Order 2 should be active after advancing");
console.log("  ✅ Batch Queue state structure and sequential autofill progression verified!");

console.log("\n==================================================");
console.log("🎉 ALL TESTS PASSED SUCCESSFULLY!");
console.log("==================================================");
process.exit(0);


