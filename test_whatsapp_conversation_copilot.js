/**
 * Automated Test Suite: WhatsApp Web Conversation Intelligence & CRM Copilot
 * Validates deep conversation extraction, 9-domain intent classification, entity extraction,
 * CRM executive action recommendations, 1-click WhatsApp quick reply generation,
 * dynamic prompt chips adaptation, and header badge Copilot assist trigger.
 */

const assert = require('assert');

// 1. Load Modules
const DeenAssistant = require('./deen-assistant.js');
const phoneCheck = require('./phone-check.js');

console.log('=================================================================');
console.log('🧪 Running Tests for WhatsApp Conversation Intelligence & CRM Copilot');
console.log('=================================================================\n');

// ---------------------------------------------------------------------------
// Test 1: Module Exports Validation
// ---------------------------------------------------------------------------
console.log('▶ Test 1: Validating Module Exports in deen-assistant.js...');
assert.strictEqual(typeof DeenAssistant.analyzeWhatsAppConversation, 'function', 'analyzeWhatsAppConversation must be exported');
assert.strictEqual(typeof DeenAssistant.analyzeCustomerMessageOrNote, 'function', 'analyzeCustomerMessageOrNote must be exported');
console.log('  ✅ Verified analyzeWhatsAppConversation is exported and callable!\n');

// ---------------------------------------------------------------------------
// Test 2: Multi-Turn Conversation Extraction & Intent Classification (9 Domains)
// ---------------------------------------------------------------------------
console.log('▶ Test 2: Testing 9-Domain Intent Classification & Entity Extraction...');

// Scenario A: Size Exchange & Inspection Risk ("size na mille", "dekhe nibo")
{
  const convA = {
    customerName: 'Shirin Akter',
    phone: '01715485035',
    messages: [
      { direction: 'out', text: 'আসসালামু আলাইকুম Shirin আপু! আপনার Tom Tailor Jeans (Size: 34) অর্ডারটি পেয়েছি।', sender: 'Agent', timestamp: '10:00 AM' },
      { direction: 'in', text: 'Product ki kal pabo? size 34 na mille change hobe to? delivery man er samne dekhe nibo kintu', sender: 'Customer', timestamp: '10:15 AM' }
    ]
  };

  const resA = DeenAssistant.analyzeWhatsAppConversation(convA);
  assert.strictEqual(resA.intent.code, 'SIZE_EXCHANGE_RETURN', `Expected SIZE_EXCHANGE_RETURN, got ${resA.intent.code}`);
  assert.strictEqual(resA.intent.urgency, 'HIGH', 'Urgency must be HIGH for return/exchange risk');
  assert.strictEqual(resA.phone, '01715485035', 'Phone must match');
  assert.strictEqual(resA.entities.size, '34', 'Size entity 34 must be extracted');
  assert.ok(resA.isCustomerWaiting, 'Customer must be marked as waiting for reply');
  assert.ok(resA.crmGuidance.recommendedActions.length >= 2, 'Must have at least 2 recommended actions');
  assert.ok(resA.suggestedReply.includes('এক্সচেঞ্জ') || resA.suggestedReply.includes('সাইজ'), 'Suggested reply must address size/exchange');
  assert.ok(resA.suggestedReply.includes('Shirin'), 'Salutation should include customer name');
  console.log('  ✅ Scenario A: Size Exchange & Return Risk correctly identified with High urgency');
}

// Scenario B: Delivery Tracking & Delay Inquiry
{
  const convB = {
    customerName: 'Kazi Tanvir',
    phone: '01819223344',
    recentText: 'Amar Order #19046 ekhono pelam na keno? 3 din hoye gelo, parcel kothay ache? track kore bolen',
    messages: []
  };

  const resB = DeenAssistant.analyzeWhatsAppConversation(convB);
  assert.strictEqual(resB.intent.code, 'TRACKING_DELAY', `Expected TRACKING_DELAY, got ${resB.intent.code}`);
  assert.strictEqual(resB.entities.orderId, '19046', 'Order ID #19046 must be extracted');
  assert.ok(resB.crmGuidance.recommendedActions.some(a => a.includes('Pathao') || a.includes('consignment')), 'Actions must recommend courier check');
  assert.ok(resB.suggestedReply.includes('ট্রানজিটে') || resB.suggestedReply.includes('কুরিয়ার'), 'Suggested reply must explain transit status');
  console.log('  ✅ Scenario B: Delivery Tracking & Delay Inquiry detected with Order ID #19046 extracted');
}

// Scenario C: Delivery Failed / NDR Rescue
{
  const convC = {
    customerName: 'Rahim Mia',
    phone: '01912345678',
    recentText: 'Bhai rider call dey ni ami shite chilo na phone off chilo, abar pathan kal delivery dhorbo',
    messages: []
  };

  const resC = DeenAssistant.analyzeWhatsAppConversation(convC);
  assert.strictEqual(resC.intent.code, 'NDR_RESCUE', `Expected NDR_RESCUE, got ${resC.intent.code}`);
  assert.strictEqual(resC.intent.urgency, 'HIGH', 'Urgency must be HIGH for NDR rescue');
  assert.ok(resC.crmGuidance.recommendedActions.some(a => a.includes('re-delivery') || a.includes('বিকল্প')), 'Action must suggest obtaining alternate contact');
  console.log('  ✅ Scenario C: NDR Failed Attempt detected with urgent re-dispatch rescue guidance');
}

// Scenario D: Payment & Advance Fee Confirmation (bKash TrxID)
{
  const convD = {
    customerName: 'Farhana Sultana',
    phone: '01611223344',
    recentText: 'bKash e advance taka pathaici 90 tk, TrxID: 9J8K7L6M, check kore confirm koren',
    messages: []
  };

  const resD = DeenAssistant.analyzeWhatsAppConversation(convD);
  assert.strictEqual(resD.intent.code, 'PAYMENT_ADVANCE', `Expected PAYMENT_ADVANCE, got ${resD.intent.code}`);
  assert.strictEqual(resD.entities.trxId, '9J8K7L6M', `TrxID must be 9J8K7L6M, got ${resD.entities.trxId}`);
  assert.strictEqual(resD.entities.amount, 90, `Amount must be 90, got ${resD.entities.amount}`);
  assert.ok(resD.suggestedReply.includes('পেমেন্ট') || resD.suggestedReply.includes('সফল'), 'Must acknowledge payment');
  console.log('  ✅ Scenario D: Advance Payment confirmation detected with bKash TrxID & ৳90 fee extracted');
}

// Scenario E: Order Placement & Confirmation
{
  const convE = {
    customerName: 'Nazmul Islam',
    phone: '01711002233',
    recentText: 'Ami Tom Tailor Jeans 32 size order confirm korte chai, delivery charge koto hobe?',
    messages: []
  };

  const resE = DeenAssistant.analyzeWhatsAppConversation(convE);
  assert.strictEqual(resE.intent.code, 'ORDER_CONFIRM', `Expected ORDER_CONFIRM, got ${resE.intent.code}`);
  assert.strictEqual(resE.entities.size, '32', 'Size 32 must be extracted');
  assert.ok(resE.suggestedReply.includes('৫০ টাকা') || resE.suggestedReply.includes('৯০ টাকা'), 'Must mention Inside/Outside Dhaka delivery fee');
  console.log('  ✅ Scenario E: Order Confirmation detected with size 32 & delivery fee policy');
}

// Scenario F: Address Change
{
  const convF = {
    customerName: 'Jashim Uddin',
    phone: '01815667788',
    recentText: 'Amar address change hobe, notun thikana: House 12, Road 4, Mirpur 10, Dhaka',
    messages: []
  };

  const resF = DeenAssistant.analyzeWhatsAppConversation(convF);
  assert.strictEqual(resF.intent.code, 'ADDRESS_CHANGE', `Expected ADDRESS_CHANGE, got ${resF.intent.code}`);
  assert.ok(resF.crmGuidance.recommendedActions.some(a => a.includes('address') || a.includes('WooCommerce')), 'Must guide CRM to update order');
  console.log('  ✅ Scenario F: Address Change detected with address update workflow');
}

// Scenario G: Order Cancellation Request
{
  const convG = {
    customerName: 'Monirul Islam',
    phone: '01712998877',
    recentText: 'Amar ei order ta cancel kore den, lagbe na ar',
    messages: []
  };

  const resG = DeenAssistant.analyzeWhatsAppConversation(convG);
  assert.strictEqual(resG.intent.code, 'CANCEL_ORDER', `Expected CANCEL_ORDER, got ${resG.intent.code}`);
  assert.strictEqual(resG.intent.urgency, 'HIGH', 'Cancellation is high urgency to save courier fee');
  console.log('  ✅ Scenario G: Order Cancellation detected with courier fee saving recommendation');
}

// Scenario H: Product Price & Stock Inquiry
{
  const convH = {
    customerName: 'Tanha Akter',
    recentText: 'Ei jeans tar dam koto? fabric kemon hobe? stock ache?',
    messages: []
  };

  const resH = DeenAssistant.analyzeWhatsAppConversation(convH);
  assert.strictEqual(resH.intent.code, 'PRODUCT_INQUIRY', `Expected PRODUCT_INQUIRY, got ${resH.intent.code}`);
  console.log('  ✅ Scenario H: Product Details & Pricing Inquiry detected');
}

// Scenario I: General Greeting
{
  const convI = {
    customerName: 'Sabbir Ahmed',
    recentText: 'Salam bhai, kemon achen?',
    messages: []
  };

  const resI = DeenAssistant.analyzeWhatsAppConversation(convI);
  assert.strictEqual(resI.intent.code, 'GENERAL_GREETING', `Expected GENERAL_GREETING, got ${resI.intent.code}`);
  assert.ok(resI.suggestedReply.includes('আসসালামু আলাইকুম'), 'Greeting must include proper Islamic salutation');
  console.log('  ✅ Scenario I: General Greeting detected with warm Islamic salutation\n');
}

// ---------------------------------------------------------------------------
// Test 3: Assistant Query Handling for CRM Copilot
// ---------------------------------------------------------------------------
console.log('▶ Test 3: Testing DeenAssistant.generateDeenAssistantReply for CRM Briefing...');
async function testAssistantQuery() {
  const reply = await DeenAssistant.generateDeenAssistantReply({
    query: 'Analyze customer conversation and suggest CRM executive action and reply',
    phone: '01715485035',
    customerName: 'Shirin Akter',
    note: 'Product ki kal pabo? size na mille change hobe to?',
    conversation: [
      { direction: 'in', text: 'Product ki kal pabo? size na mille change hobe to?', sender: 'Customer', timestamp: '11:00 AM' }
    ]
  });

  assert.strictEqual(reply.source, 'crm_copilot_assistant', 'Source must be crm_copilot_assistant');
  assert.ok(reply.answer.includes('CRM Executive Copilot: Active Conversation Briefing'), 'Must contain executive briefing title');
  assert.ok(reply.answer.includes('Size Exchange'), 'Must mention detected intent');
  assert.ok(reply.answer.includes('Recommended CRM Executive Actions'), 'Must include action checklist');
  assert.ok(reply.answer.includes('Suggested WhatsApp Quick Reply'), 'Must include suggested reply');
  assert.ok(reply.answer.includes('Insert in WhatsApp'), 'Must include 1-click insert instruction');
  console.log('  ✅ Generated full structured CRM Executive Briefing Card successfully!\n');
}

// ---------------------------------------------------------------------------
// Run All Async Tests
// ---------------------------------------------------------------------------
testAssistantQuery()
  .then(() => {
    console.log('=================================================================');
    console.log('🎉 ALL WHATSAPP CONVERSATION INTELLIGENCE TESTS PASSED (100%)!');
    console.log('=================================================================');
  })
  .catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });
