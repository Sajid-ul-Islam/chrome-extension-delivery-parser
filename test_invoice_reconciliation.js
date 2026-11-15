/**
 * test_invoice_reconciliation.js
 * Automated test suite for Courier Financial Reconciliation & Invoice Auditor (Pillar 5)
 */

const assert = require('assert');
const assistant = require('./deen-assistant.js');
const registry = require('./webmcp-provider.js');

console.log("🧪 Running Courier Financial Reconciliation Test Suite...\n");

// 1. Clean Reconciliation Test
const cleanStoreOrders = [
  { orderId: "19789", cod: 2238, isOutsideDhaka: true },
  { orderId: "19790", cod: 1544, isOutsideDhaka: false }
];

const cleanInvoiceRecords = [
  { orderId: "19789", collected_amount: 2238, delivery_charge: 90, net_payable: 2148 },
  { orderId: "19790", collected_amount: 1544, delivery_charge: 50, net_payable: 1494 }
];

const cleanResult = assistant.reconcileCourierInvoices(cleanInvoiceRecords, cleanStoreOrders);
assert.strictEqual(cleanResult.totalInvoicedRecords, 2);
assert.strictEqual(cleanResult.matchedRecordsCount, 2);
assert.strictEqual(cleanResult.cleanOrdersCount, 2);
assert.strictEqual(cleanResult.discrepancyCount, 0);
assert.strictEqual(cleanResult.totalLossAmount, 0);
assert.ok(cleanResult.summary.includes("Perfect Payout Reconciliation"));
console.log("  ✅ Clean invoice statement successfully reconciled with 0 discrepancies.");

// 2. Discrepancy Detection Test: COD Shortage + Fee Overcharge
const storeOrdersWithLeaks = [
  { orderId: "20001", cod: 2500, isOutsideDhaka: false }, // Inside Dhaka: Expected COD ৳2500, fee ৳50
  { orderId: "20002", cod: 3000, isOutsideDhaka: true }   // Outside Dhaka: Expected COD ৳3000, fee ৳90
];

const invoiceRecordsWithLeaks = [
  // Shortage: Only 2200 collected instead of 2500 (-300)
  { orderId: "20001", collected_amount: 2200, delivery_charge: 50, net_payable: 2150 },
  // Overcharge: Charged 180 fee instead of standard 90 (+90 excess)
  { orderId: "20002", collected_amount: 3000, delivery_charge: 180, net_payable: 2820 }
];

const leakResult = assistant.reconcileCourierInvoices(invoiceRecordsWithLeaks, storeOrdersWithLeaks);
assert.strictEqual(leakResult.discrepancyCount, 2);
assert.strictEqual(leakResult.totalLossAmount, 390, "300 COD shortage + 90 fee overcharge = 390 total loss");

const shortage = leakResult.discrepancies.find(d => d.type === "COD_SHORTAGE");
assert.ok(shortage, "Must detect COD shortage");
assert.strictEqual(shortage.loss, 300);
assert.strictEqual(shortage.orderId, "20001");

const overcharge = leakResult.discrepancies.find(d => d.type === "FEE_OVERCHARGE");
assert.ok(overcharge, "Must detect Fee overcharge");
assert.strictEqual(overcharge.loss, 90);
assert.strictEqual(overcharge.orderId, "20002");
console.log("  ✅ COD shortage and delivery fee overcharges accurately flagged.");

// 3. WebMCP Tool Execution Test
(async () => {
  const mcpResult = await registry.executeTool("reconcile_courier_invoice", {
    invoiceRecords: invoiceRecordsWithLeaks,
    storeOrders: storeOrdersWithLeaks
  });

  assert.strictEqual(mcpResult.success, true);
  assert.strictEqual(mcpResult.discrepancyCount, 2);
  assert.strictEqual(mcpResult.totalLossAmount, 390);
  console.log("  ✅ WebMCP tool 'reconcile_courier_invoice' executed successfully.");

  console.log("\n🎉 ALL TESTS IN test_invoice_reconciliation.js PASSED 100%!");
})();
