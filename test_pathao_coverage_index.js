/**
 * test_pathao_coverage_index.js
 * Automated test suite for Real-Time Pathao Coverage Engine (Pillar 1)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const parser = require('./parser.js');

console.log("🧪 Running Real-Time Pathao Coverage Engine Test Suite...\n");

// 1. Verify pathao_zone_index.json exists and is valid
const indexPath = path.join(__dirname, 'pathao_zone_index.json');
assert.ok(fs.existsSync(indexPath), "pathao_zone_index.json must exist");
const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

assert.ok(indexData.cities && Object.keys(indexData.cities).length >= 64, "Must index at least 64 cities");
assert.ok(indexData.zones && Object.keys(indexData.zones).length >= 1000, "Must index at least 1000 zones");
console.log(`  ✅ Index file verified: ${Object.keys(indexData.cities).length} cities, ${Object.keys(indexData.zones).length} zone keys.`);

// 2. Test City Lookups across English and Bengali aliases
const kishoreganj = parser.lookupPathaoCity("Kishoreganj");
assert.strictEqual(kishoreganj.id, 42, "Kishoreganj city_id must be 42");
assert.strictEqual(kishoreganj.name, "Kishoreganj");

const kishoreganjBn = parser.lookupPathaoCity("কিশোরগঞ্জ");
assert.strictEqual(kishoreganjBn.id, 42, "Bengali কিশোরগঞ্জ must resolve to 42");

const dhaka = parser.lookupPathaoCity("Dhaka");
assert.strictEqual(dhaka.id, 1, "Dhaka city_id must be 1");

const ctg = parser.lookupPathaoCity("Chattogram");
assert.strictEqual(ctg.id, 2, "Chattogram must resolve to city_id 2");

const ctgOld = parser.lookupPathaoCity("Chittagong");
assert.strictEqual(ctgOld.id, 2, "Chittagong alias must resolve to city_id 2");
console.log("  ✅ City lookups verified across English, Bengali, and historical aliases.");

// 3. Test Zone Lookups (Screenshot 2 case: Mithamain)
const mithamain = parser.lookupPathaoZone("Mithamain");
assert.ok(mithamain, "Mithamain must resolve in Pathao Zone Index");
assert.strictEqual(mithamain.c_id, 42, "Mithamain c_id must be 42 (Kishoreganj)");
assert.strictEqual(mithamain.z_id, 994, "Mithamain z_id must be 994");
assert.strictEqual(mithamain.z_name, "Mithamoin", "Mithamain official Pathao zone name is Mithamoin");

const mithamainFullAddr = parser.lookupPathaoZone("Mithamain Sadar Heliped");
assert.ok(mithamainFullAddr, "Mithamain Sadar Heliped must resolve zone");
assert.strictEqual(mithamainFullAddr.c_id, 42);
assert.strictEqual(mithamainFullAddr.z_id, 994);

const mithamainBn = parser.lookupPathaoZone("মিঠামইন");
assert.ok(mithamainBn, "Bengali মিঠামইন must resolve zone");
assert.strictEqual(mithamainBn.z_id, 994);
console.log("  ✅ Mithamain (Image 2 issue) 100% resolved to Kishoreganj (42) > Mithamoin (994).");

// 4. Test Screenshot 1 case: Chandgaon, Chattogram
const chandgaon = parser.lookupPathaoZone("Chandgaon");
assert.ok(chandgaon, "Chandgaon must resolve in Pathao Zone Index");
assert.strictEqual(chandgaon.c_id, 2, "Chandgaon c_id must be 2 (Chattogram)");
assert.strictEqual(chandgaon.z_id, 375, "Chandgaon z_id must be 375");

// 5. Test Reverse Zone lookups without explicit district
const titas = parser.lookupPathaoZone("Titas");
assert.ok(titas, "Titas must resolve to Cumilla");
assert.strictEqual(titas.c_id, 5, "Titas c_id must be 5 (Cumilla)");

const benapole = parser.lookupPathaoZone("Benapole");
assert.ok(benapole, "Benapole must resolve to Jashore");
assert.strictEqual(benapole.c_id, 19, "Benapole c_id must be 19 (Jashore)");
console.log("  ✅ Reverse zone inference verified for Chandgaon, Titas, and Benapole.");

// 6. Test parseBDAddress integration with Pathao IDs
const parsedMithamain = parser.parseBDAddress("Mithamain Sadar Heliped");
assert.strictEqual(parsedMithamain.district, "Kishoreganj");
assert.strictEqual(parsedMithamain.pathaoCityId, 42);
assert.strictEqual(parsedMithamain.pathaoZoneId, 994);
assert.strictEqual(parsedMithamain.cityType, "Outside Dhaka");
assert.strictEqual(parsedMithamain.isDefaulted, false);

const parsedCtg = parser.parseBDAddress("House 12, Chandgaon Thana, Chattogram");
assert.strictEqual(parsedCtg.pathaoCityId, 2);
assert.strictEqual(parsedCtg.pathaoZoneId, 375);
console.log("  ✅ parseBDAddress returns exact Pathao city and zone IDs.");

// 7. Mock WooCommerce Pathao Modal Dropdown Direct Selection
const mockCitySelect = {
  options: [
    { value: "", text: "Select City" },
    { value: "1", text: "Dhaka" },
    { value: "2", text: "Chittagong" },
    { value: "42", text: "Kishoreganj" }
  ],
  value: "1",
  dispatchEvent: () => {}
};

const mockZoneSelect = {
  options: [
    { value: "", text: "Select Zone" },
    { value: "994", text: "Mithamoin" },
    { value: "100", text: "Bhairab" }
  ],
  value: "",
  dispatchEvent: () => {}
};

// Simulate WooCommerce matchBtn logic
let matchedCityOpt = mockCitySelect.options.find(o => String(o.value) === String(parsedMithamain.pathaoCityId));
assert.ok(matchedCityOpt, "Must match city option by exact Pathao City ID 42");
mockCitySelect.value = matchedCityOpt.value;
assert.strictEqual(mockCitySelect.value, "42", "City dropdown switched to Kishoreganj (42)");

let matchedZoneOpt = mockZoneSelect.options.find(o => String(o.value) === String(parsedMithamain.pathaoZoneId));
assert.ok(matchedZoneOpt, "Must match zone option by exact Pathao Zone ID 994");
mockZoneSelect.value = matchedZoneOpt.value;
assert.strictEqual(mockZoneSelect.value, "994", "Zone dropdown switched to Mithamoin (994)");

console.log("  ✅ Mock WooCommerce dropdown auto-switches to Kishoreganj (42) and Mithamoin (994) without online geocoding!");

console.log("\n🎉 ALL TESTS IN test_pathao_coverage_index.js PASSED 100%!");
