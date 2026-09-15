const { parseDeliveryData } = require('./parser.js');

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

console.log('\n>>> ALL EXTENSION PARSER TESTS PASSED SUCCESSFULLY! <<<');
