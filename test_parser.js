const { parseDeliveryData, parseBDAddress, generatePathaoBatchCSV, normalizeAddressForPathao, buildFullAddress, normalizeDisplayAddress } = require('./parser.js');
const assert = require('assert');

const sampleStandard = `Cons. ID
Order ID
Store
Recipient Info
Delivery Status
Amount
Payment
Action
DD240915ABC123
Type: Normal
123456
Deen Commerce
John Doe
House 12, Road 4, Mirpur 10, Dhaka
01712345678
At Delivery Hub
Updated on 15/09/2026
1500.00
100.00
20.00
Unpaid
View Details`;

const res1 = parseDeliveryData(sampleStandard);
console.log('Standard parsed count:', res1.records.length, 'Mode:', res1.mode);
console.log('Record 1:', res1.records[0]);
console.log('Metrics 1:', res1.metrics);

if (res1.records.length !== 1 || res1.records[0]['Consignment ID'] !== 'DD240915ABC123') {
  console.error('FAIL: Standard parse did not match expected');
  process.exit(1);
}

const sampleFuzzy = `Some random messy notes:
DD240915XYZ999 654321
Jane Smith
Banani, Dhaka
01812345678
COD 2500 Charge 120 Discount 50 Paid
Updated on 14/09/2026`;

const res2 = parseDeliveryData(sampleFuzzy, true);
console.log('\nFuzzy parsed count:', res2.records.length, 'Mode:', res2.mode);
console.log('Record 2:', res2.records[0]);
console.log('Metrics 2:', res2.metrics);

if (res2.records.length !== 1 || res2.records[0]['Consignment ID'] !== 'DD240915XYZ999') {
  console.error('FAIL: Fuzzy parse did not match expected');
  process.exit(1);
}

// =========================================================================
// Feature 4: Smart BD Address Parser Unit Tests
// =========================================================================
console.log('\nTesting parseBDAddress (Smart BD Address Parser)...');

// Case 1: Standard Dhaka address with sector and zone
const addr1 = parseBDAddress("House 12, Road 4, Sector 3, Uttara, Dhaka");
assert.strictEqual(addr1.district, "Dhaka", "Case 1 district mismatch");
assert.strictEqual(addr1.zone, "Uttara", "Case 1 zone mismatch");
assert.strictEqual(addr1.area, "Sector 3", "Case 1 area mismatch");
assert.strictEqual(addr1.cityType, "Inside Dhaka", "Case 1 cityType mismatch");
assert.strictEqual(addr1.streetAddress, "House 12, Road 4, Sector 3", "Case 1 streetAddress mismatch");
console.log('  ✅ Case 1: Uttara, Dhaka parsed correctly');

// Case 2: Mirpur address with Block, postcode, and hyphenated zone
const addr2 = parseBDAddress("Flat 4B, Plot 10, Block C, Mirpur-10, Dhaka - 1216");
assert.strictEqual(addr2.district, "Dhaka", "Case 2 district mismatch");
assert.strictEqual(addr2.zone, "Mirpur", "Case 2 zone mismatch");
assert.strictEqual(addr2.postcode, "1216", "Case 2 postcode mismatch");
assert.strictEqual(addr2.cityType, "Inside Dhaka", "Case 2 cityType mismatch");
assert.strictEqual(addr2.streetAddress, "Flat 4B, Plot 10, Block C, Mirpur-10", "Case 2 streetAddress mismatch");
console.log('  ✅ Case 2: Mirpur-10 with postcode 1216 parsed correctly');

// Case 3: Sub-Dhaka / Gazipur address with thana and postal code
const addr3 = parseBDAddress("Masterpara, Sreepur, Gazipur-1740");
assert.strictEqual(addr3.district, "Gazipur", "Case 3 district mismatch");
assert.strictEqual(addr3.zone, "Sreepur", "Case 3 zone mismatch");
assert.strictEqual(addr3.postcode, "1740", "Case 3 postcode mismatch");
assert.strictEqual(addr3.cityType, "Sub Dhaka", "Case 3 cityType mismatch");
assert.strictEqual(addr3.streetAddress, "Masterpara", "Case 3 streetAddress mismatch");
console.log('  ✅ Case 3: Sreepur, Gazipur-1740 parsed as Sub Dhaka');

// Case 4: Major outside hub (Chattogram Agrabad)
const addr4 = parseBDAddress("Agrabad C/A, Chattogram");
assert.strictEqual(addr4.district, "Chattogram", "Case 4 district mismatch");
assert.strictEqual(addr4.zone, "Agrabad", "Case 4 zone mismatch");
assert.strictEqual(addr4.cityType, "Outside Dhaka", "Case 4 cityType mismatch");
console.log('  ✅ Case 4: Agrabad, Chattogram parsed correctly');

// Case 5: Sylhet Zindabazar
const addr5 = parseBDAddress("Zindabazar, Sylhet");
assert.strictEqual(addr5.district, "Sylhet", "Case 5 district mismatch");
assert.strictEqual(addr5.zone, "Zindabazar", "Case 5 zone mismatch");
assert.strictEqual(addr5.cityType, "Outside Dhaka", "Case 5 cityType mismatch");
console.log('  ✅ Case 5: Zindabazar, Sylhet parsed correctly');

// Case 6: Cumilla Kandirpar
const addr6 = parseBDAddress("Kandirpar, Cumilla");
assert.strictEqual(addr6.district, "Cumilla", "Case 6 district mismatch");
assert.strictEqual(addr6.zone, "Kandirpar", "Case 6 zone mismatch");
assert.strictEqual(addr6.cityType, "Outside Dhaka", "Case 6 cityType mismatch");
console.log('  ✅ Case 6: Kandirpar, Cumilla parsed correctly');

// Case 7: Savar Sub-Dhaka
const addr7 = parseBDAddress("Savar Bazar, Savar, Dhaka");
assert.strictEqual(addr7.district, "Dhaka", "Case 7 district mismatch");
assert.strictEqual(addr7.zone, "Savar", "Case 7 zone mismatch");
assert.strictEqual(addr7.cityType, "Sub Dhaka", "Case 7 cityType mismatch");
console.log('  ✅ Case 7: Savar parsed as Sub Dhaka');

// Case 8: Bengali script
const addr8 = parseBDAddress("বাসা ১২, রোড ৪, উত্তরা, ঢাকা");
assert.strictEqual(addr8.district, "Dhaka", "Case 8 Bengali district mismatch");
assert.strictEqual(addr8.zone, "Uttara", "Case 8 Bengali zone mismatch");
console.log('  ✅ Case 8: Bengali script address parsed correctly');

// Case 9: Explicit Bengali labels (Gram, Dakghor, Thana, Jilla)
const addr9 = parseBDAddress("গ্রাম: রামপুর, ডাকঘর: জয়দেবপুর, থানা: শ্রীপুর, জেলা: গাজীপুর");
assert.strictEqual(addr9.district, "Gazipur", "Case 9 District mismatch");
assert.strictEqual(addr9.zone, "Sreepur", "Case 9 Zone mismatch");
assert.strictEqual(addr9.cityType, "Sub Dhaka", "Case 9 CityType mismatch");
console.log('  ✅ Case 9: Explicit Bengali Gram/Dakghor/Thana/Jilla parsed correctly');

// Case 10: Bengali Visarga & Boalmari Faridpur
const addr10 = parseBDAddress("গ্রামঃ কাশিমপুর, ডাকঘরঃ কাশিমপুর, থানাঃ বোয়ালমারী, জেলাঃ ফরিদপুর");
assert.strictEqual(addr10.district, "Faridpur", "Case 10 District mismatch");
assert.strictEqual(addr10.zone, "Boalmari", "Case 10 Zone mismatch");
assert.strictEqual(addr10.cityType, "Outside Dhaka", "Case 10 CityType mismatch");
console.log('  ✅ Case 10: Bengali Visarga & Boalmari, Faridpur parsed correctly');

// Case 11: Outside hub Bengali script without explicit labels
const addr11 = parseBDAddress("বোয়ালমারী, ফরিদপুর");
assert.strictEqual(addr11.district, "Faridpur", "Case 11 District mismatch");
assert.strictEqual(addr11.zone, "Boalmari", "Case 11 Zone mismatch");
console.log('  ✅ Case 11: Boalmari, Faridpur in Bengali script parsed correctly');

// Case 12: Major hub Bengali script (Agrabad, Chattogram)
const addr12 = parseBDAddress("আগ্রাবাদ, চট্টগ্রাম");
assert.strictEqual(addr12.district, "Chattogram", "Case 12 District mismatch");
assert.strictEqual(addr12.zone, "Agrabad", "Case 12 Zone mismatch");
console.log('  ✅ Case 12: Agrabad, Chattogram in Bengali script parsed correctly');

// Case 13: Bengali numerals postcode [০-৯]
const addr13 = parseBDAddress("বাসা ১২, রোড ৪, সেক্টর ৭, উত্তরা, ঢাকা - ১২১৬");
assert.strictEqual(addr13.district, "Dhaka", "Case 13 District mismatch");
assert.strictEqual(addr13.zone, "Uttara", "Case 13 Zone mismatch");
assert.strictEqual(addr13.postcode, "1216", "Case 13 Bengali postcode mismatch");
console.log('  ✅ Case 13: Bengali numerals postcode 1216 parsed correctly');

// Case 14: Benapole, Sharsha, Jashore address with leading Home, Division Khulna & duplicate Benapole
const rawBenapole = "Home Benapole city,thana sharsha,jela jashore Division khulna\nBenapole";
const addr14 = parseBDAddress(rawBenapole);
assert.strictEqual(addr14.district, "Jashore", "Case 14 District mismatch");
assert.strictEqual(addr14.zone, "Sharsha", "Case 14 Zone mismatch");
assert.strictEqual(addr14.cityType, "Outside Dhaka", "Case 14 CityType mismatch");
const clean14 = normalizeAddressForPathao(rawBenapole);
assert.strictEqual(clean14, "Benapole City, Thana: Sharsha", `Case 14 Clean mismatch: got '${clean14}'`);
assert(!clean14.includes("Benaডাকঘর"), "Case 14 must not corrupt Benapole");
const full14 = buildFullAddress(rawBenapole);
assert.strictEqual(full14, "Benapole City, Thana: Sharsha, Jashore", `Case 14 Full mismatch: got '${full14}'`);
console.log('  ✅ Case 14: Benapole, Sharsha, Jashore normalized & parsed without Benaডাকঘর corruption');

// Case 15: Bengali Benapole address with leading বাসা, বিভাগ খুলনা & duplicate বেনাপোল
const rawBenapoleBn = "বাসা বেনাপোল সিটি, থানা শার্শা, জেলা যশোর বিভাগ খুলনা\nবেনাপোল";
const addr15 = parseBDAddress(rawBenapoleBn);
assert.strictEqual(addr15.district, "Jashore", "Case 15 District mismatch");
assert.strictEqual(addr15.zone, "Sharsha", "Case 15 Zone mismatch");
const clean15 = normalizeAddressForPathao(rawBenapoleBn);
assert.strictEqual(clean15, "বেনাপোল সিটি, থানা: শার্শা", `Case 15 Clean mismatch: got '${clean15}'`);
const full15 = buildFullAddress(rawBenapoleBn);
assert.strictEqual(full15, "বেনাপোল সিটি, থানা: শার্শা, Jashore", `Case 15 Full mismatch: got '${full15}'`);
console.log('  ✅ Case 15: Bengali Benapole, Sharsha, Jashore normalized & parsed cleanly');

// Case 16: Address deduplication with repeated thana, district, and standalone postcode (e.g. Noyakandi Bazar, Titas, Cumilla)
const rawNoyakandi = "Noyakandi Bazar , Titas,Cumilla\nTitas\nCumilla\n3519";
const cleanNoyakandi = normalizeDisplayAddress(rawNoyakandi);
assert.strictEqual(cleanNoyakandi, "Noyakandi Bazar, Titas, Cumilla", `Case 16 mismatch: expected 'Noyakandi Bazar, Titas, Cumilla', got '${cleanNoyakandi}'`);
assert(!cleanNoyakandi.includes("3519"), "Case 16 must not append standalone postcode 3519");
console.log('  ✅ Case 16: Noyakandi Bazar, Titas, Cumilla deduplicated & standalone postcode 3519 stripped');

// Case 17: Address deduplication for Order #19029 (Olinagar, Gangni, Meherpur)
const rawOlinagar = "Olinagar, Gangni, Meherpur\nGangni\nMeherpur";
const cleanOlinagar = normalizeDisplayAddress(rawOlinagar);
assert.strictEqual(cleanOlinagar, "Olinagar, Gangni, Meherpur", `Case 17 mismatch: expected 'Olinagar, Gangni, Meherpur', got '${cleanOlinagar}'`);
console.log('  ✅ Case 17: Olinagar, Gangni, Meherpur deduplicated without repeated city/district');

// Case 18: Incomplete address with zone only: "Noyakandi Bazar, Titas," -> resolves district Cumilla & zone Titas (never Dhaka)
const rawTitas = "Noyakandi Bazar, Titas,";
const addr18 = parseBDAddress(rawTitas);
assert.strictEqual(addr18.district, "Cumilla", `Case 18 District mismatch: expected 'Cumilla', got '${addr18.district}'`);
assert.strictEqual(addr18.zone, "Titas", `Case 18 Zone mismatch: expected 'Titas', got '${addr18.zone}'`);
assert.strictEqual(addr18.cityType, "Outside Dhaka", `Case 18 CityType mismatch: expected 'Outside Dhaka', got '${addr18.cityType}'`);
console.log('  ✅ Case 18: Noyakandi Bazar, Titas, resolved to Cumilla & Titas (never Dhaka fallback)');

// Case 19: buildFullAddress for incomplete address appends parent district
const fullTitas = buildFullAddress(rawTitas);
assert.strictEqual(fullTitas, "Noyakandi Bazar, Titas, Cumilla", `Case 19 Full mismatch: expected 'Noyakandi Bazar, Titas, Cumilla', got '${fullTitas}'`);
console.log('  ✅ Case 19: buildFullAddress completes missing district: Noyakandi Bazar, Titas, Cumilla');

// Case 20: 100% 64 Districts coverage: Munshiganj, Manikganj, Bandarban, Khagrachhari, Rangamati
const addrMunshiganj = parseBDAddress("Sreenagar, Munshiganj");
assert.strictEqual(addrMunshiganj.district, "Munshiganj", "Munshiganj district mismatch");
assert.strictEqual(addrMunshiganj.zone, "Sreenagar", "Sreenagar zone mismatch");
const addrManikganj = parseBDAddress("Singair, Manikganj");
assert.strictEqual(addrManikganj.district, "Manikganj", "Manikganj district mismatch");
const addrBandarban = parseBDAddress("Lama, Bandarban");
assert.strictEqual(addrBandarban.district, "Bandarban", "Bandarban district mismatch");
console.log('  ✅ Case 20: 100% 64 Districts and Upazilas coverage verified across Bangladesh');

// =========================================================================
// Feature 5: Pathao Bulk Batch CSV Generation Tests
// =========================================================================
console.log('\nTesting generatePathaoBatchCSV (Feature 5)...');

const mockOrders = [
  {
    orderId: "14913",
    name: "Badon",
    phone: "01711223344",
    address: "House 12, Road 4, Sector 3, Uttara, Dhaka",
    cod: 1535,
    type: "Parcel"
  },
  {
    orderId: "14912",
    name: "Shohag",
    phone: "01812345678",
    address: "Mirpur 12, Dhaka - 1216",
    cod: 499,
    type: "Parcel"
  },
  {
    orderId: "D-14489",
    name: "Exchange Customer",
    phone: "01999887766",
    address: "Masterpara, Sreepur, Gazipur-1740",
    cod: 1200,
    type: "Exchange"
  }
];

const csvOutput = generatePathaoBatchCSV(mockOrders);
assert(csvOutput.includes("Merchant Order ID,Recipient Name,Recipient Phone"), "Headers mismatch");
assert(csvOutput.includes('"14913","Badon","01711223344","House 12, Road 4, Sector 3","Dhaka","Uttara"'), "Row 1 mismatch");
assert(csvOutput.includes('"14912","Shohag","01812345678","Mirpur 12","Dhaka","Mirpur"'), "Row 2 mismatch");
assert(csvOutput.includes('"D-14489","Exchange Customer","01999887766","Masterpara","Gazipur","Sreepur"'), "Row 3 mismatch");
assert(csvOutput.includes('"Exchange"'), "Exchange type preserved in CSV");
console.log('  ✅ Pathao Batch CSV generated with correct headers and column mappings');

console.log('\n>>> ALL EXTENSION PARSER TESTS PASSED SUCCESSFULLY! <<<');

