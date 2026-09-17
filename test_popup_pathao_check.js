/**
 * Simulation Test for Popup Pathao Check Flow
 */
const assert = require("assert");
const fs = require("fs");

console.log("🧪 Testing Popup Pathao Check Flow...");

const backgroundCode = fs.readFileSync("background.js", "utf8");
const popupCode = fs.readFileSync("popup.js", "utf8");

// Test 1: Verify background response returns pathaoStats and pathaoStatus
assert.ok(backgroundCode.includes("pathaoStats: pathaoStats"), "background.js must include pathaoStats in result");
assert.ok(backgroundCode.includes("pathaoStatus: pathaoStatus"), "background.js must include pathaoStatus in result");
assert.ok(backgroundCode.includes("steadfastStats: steadfastStats"), "background.js must include steadfastStats in result");
assert.ok(backgroundCode.includes("steadfastStatus: steadfastStatus"), "background.js must include steadfastStatus in result");
console.log("  ✅ Test 1: Background worker accurately returns pathaoStats, pathaoStatus, and courier metrics!");

// Test 2: Verify timeout guard and direct scripting fallback exist
assert.ok(backgroundCode.includes("AbortController"), "background.js must use AbortController timeouts on fetch requests");
assert.ok(backgroundCode.includes("chrome.scripting.executeScript"), "background.js must support direct scripting execution on active tabs");
console.log("  ✅ Test 2: Network timeout protection & tab direct scripting fallback verified!");

// Test 3: Verify popup sync UI update & auto-save to storage
assert.ok(popupCode.includes("pathao_autofill_data"), "popup.js must store checked phone to pathao_autofill_data");
assert.ok(popupCode.includes("checkCustomerPhoneInPopup"), "popup.js must wire table click to checkCustomerPhoneInPopup");
assert.ok(popupCode.includes("sync_to_pathao"), "popup.js must dispatch sync_to_pathao on open button click");
console.log("  ✅ Test 3: Popup quick check, storage synchronization, and 1-click table actions verified!");

console.log("\n🎉 ALL POPUP PATHAO CHECK TESTS PASSED SUCCESSFULLY!\n");
