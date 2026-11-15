/**
 * test_pricing_rules_config.js
 * Automated test suite for Dynamic Merchant Configuration & Pricing Rules (Pillar 3)
 */

const assert = require('assert');
const parser = require('./parser.js');

console.log("🧪 Running Dynamic Merchant Pricing Rules Test Suite...\n");

// 1. Verify Default Config in parser.js
assert.strictEqual(parser.DEFAULT_QUICK_REPLY_CONFIG.insideDhakaFee, 50);
assert.strictEqual(parser.DEFAULT_QUICK_REPLY_CONFIG.outsideDhakaFee, 90);
assert.strictEqual(parser.DEFAULT_QUICK_REPLY_CONFIG.freeShippingThreshold, 2500);
console.log("  ✅ Invariant 7 defaults intact (50/90/2500).");

// 2. Test standard fee calculation with defaults
const defaultInsideFee = parser.calculateDeliveryFee({ isOutsideDhaka: false, subtotal: 1500 });
assert.strictEqual(defaultInsideFee, 50);

const defaultOutsideFee = parser.calculateDeliveryFee({ isOutsideDhaka: true, subtotal: 1500 });
assert.strictEqual(defaultOutsideFee, 90);

const defaultFreeEligible = parser.calculateDeliveryFee({ isOutsideDhaka: true, subtotal: 2600, isFreeShipping: true });
assert.strictEqual(defaultFreeEligible, 0, "Subtotal 2600 >= 2500 qualifies for Free Shipping");

const defaultDisqualified = parser.calculateDeliveryFee({ isOutsideDhaka: true, subtotal: 2000, isFreeShipping: true });
assert.strictEqual(defaultDisqualified, 90, "Subtotal 2000 < 2500 is disqualified from automatic free shipping");
console.log("  ✅ Standard delivery fees and default 2500 threshold verified.");

// 3. Test custom Free Shipping threshold (e.g. Flash Campaign: ৳1500)
const flashCampaignConfig = {
  ...parser.DEFAULT_QUICK_REPLY_CONFIG,
  freeShippingThreshold: 1500
};

const flashEligible = parser.calculateDeliveryFee({ isOutsideDhaka: true, subtotal: 1800, isFreeShipping: true }, flashCampaignConfig);
assert.strictEqual(flashEligible, 0, "Subtotal 1800 >= 1500 qualifies under flash campaign threshold");

const flashDisqualified = parser.calculateDeliveryFee({ isOutsideDhaka: true, subtotal: 1200, isFreeShipping: true }, flashCampaignConfig);
assert.strictEqual(flashDisqualified, 90, "Subtotal 1200 < 1500 disqualified");
console.log("  ✅ Custom ৳1500 Free Shipping threshold verified.");

// 4. Test custom delivery fee rates (e.g. Inside ৳60 / Outside ৳100)
const customRatesConfig = {
  ...parser.DEFAULT_QUICK_REPLY_CONFIG,
  insideDhakaFee: 60,
  outsideDhakaFee: 100,
  freeShippingThreshold: 3000
};

const customInFee = parser.calculateDeliveryFee({ isOutsideDhaka: false, subtotal: 1000 }, customRatesConfig);
assert.strictEqual(customInFee, 60, "Inside fee dynamically reflects ৳60");

const customOutFee = parser.calculateDeliveryFee({ isOutsideDhaka: true, subtotal: 1000 }, customRatesConfig);
assert.strictEqual(customOutFee, 100, "Outside fee dynamically reflects ৳100");

const customHigherThresholdDisqualified = parser.calculateDeliveryFee({ isOutsideDhaka: true, subtotal: 2600, isFreeShipping: true }, customRatesConfig);
assert.strictEqual(customHigherThresholdDisqualified, 100, "Subtotal 2600 < 3000 threshold correctly charged ৳100");
console.log("  ✅ Dynamic delivery fee rates (60/100) and higher 3000 threshold verified.");

// 5. Test normalizeCustomerAndOrderData with custom pricing config
const orderData = {
  name: "Tanvir",
  phone: "01711223344",
  address: "Mirpur 10, Dhaka",
  subtotal: "1800",
  cod: "1800",
  isFreeShipping: true,
  config: flashCampaignConfig
};

const normalized = parser.normalizeCustomerAndOrderData(orderData);
assert.strictEqual(normalized.deliveryFee, 0, "Under flash threshold 1500, subtotal 1800 qualifies for free delivery");
assert.strictEqual(normalized.cod, "1800");

console.log("\n🎉 ALL TESTS IN test_pricing_rules_config.js PASSED 100%!");
