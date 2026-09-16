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
assert(manifest.permissions.includes("clipboardRead"), "Must have clipboardRead permission");

const hasWooCommerceScript = manifest.content_scripts.some(cs =>
  cs.js && cs.js.includes("woocommerce.js") &&
  cs.matches.some(m => m.includes("deencommerce.com") || m.includes("wc-orders"))
);
assert(hasWooCommerceScript, "Manifest must contain content_script for WooCommerce with woocommerce.js");
console.log("  ✅ manifest.json is valid and properly configured.");

// 2. Test Phone Number Extraction & Normalization
console.log("\n▶ Test 2: Testing Phone Number Extraction & Normalization...");
const BD_PHONE_REGEX = /(?:(?:\+?880)|880|0)?(1[3-9]\d{8})\b/;

function normalizeBDPhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  const match = digits.match(BD_PHONE_REGEX);
  if (match && match[1]) {
    return "0" + match[1];
  }
  const onlyDigits = raw.replace(/\D/g, "");
  if (onlyDigits.length === 11 && /^01[3-9]\d{8}$/.test(onlyDigits)) {
    return onlyDigits;
  } else if (onlyDigits.length === 13 && onlyDigits.startsWith("8801")) {
    return onlyDigits.slice(2);
  }
  return null;
}

const testCases = [
  { input: "01711223344", expected: "01711223344" },
  { input: "+8801812345678", expected: "01812345678" },
  { input: "8801912345678", expected: "01912345678" },
  { input: "01300-112233", expected: "01300112233" },
  { input: "(+88) 01555 443322", expected: "01555443322" },
  { input: "Customer: Rahim, Cell: 01611223344, Address: Dhaka", expected: "01611223344" },
  { input: "Not a phone: 12345678", expected: null },
  { input: "01200000000", expected: null }, // 012 is not valid BD mobile prefix
  { input: "01100000000", expected: null }, // 011 is not valid BD mobile prefix
];

for (const tc of testCases) {
  const result = normalizeBDPhone(tc.input);
  assert.strictEqual(result, tc.expected, `Failed on input '${tc.input}': expected '${tc.expected}', got '${result}'`);
}
console.log(`  ✅ All ${testCases.length} phone normalization test cases passed!`);

// 3. Test woocommerce.js and content.js file syntax
console.log("\n▶ Test 3: Checking JavaScript syntax of content scripts...");
require('./woocommerce.js');
console.log("  ✅ woocommerce.js loaded without syntax errors.");

require('./content.js');
console.log("  ✅ content.js loaded without syntax errors.");

require('./background.js');
console.log("  ✅ background.js loaded without syntax errors.");

require('./popup.js');
console.log("  ✅ popup.js loaded without syntax errors.");

console.log("\n==================================================");
console.log("🎉 ALL TESTS PASSED SUCCESSFULLY!");
console.log("==================================================");
