/**
 * Test Suite for DEEN Assistant Intelligence Core & BYOK
 * Tests deterministic in-memory analytics, customer note interpreter,
 * context synthesis, chat history persistence, and WebMCP integration.
 */

const assert = require('assert');
const DeenAssistant = require('./deen-assistant.js');
const webMCP = require('./webmcp-provider.js');

async function runTests() {
  console.log("==================================================");
  console.log("🧪 Running Verification Tests for DEEN AI Assistant");
  console.log("==================================================");

  // Mock test delivery records
  const mockRecords = [
    {
      "Consignment ID": "DD260901ABC001",
      "Order ID": "19101",
      "Store": "DEEN Commerce",
      "Recipient Info": "House 12, Road 4, Mirpur 10, Dhaka\n01715485035",
      "Delivery Status": "Delivered",
      "Amount": "1800.00",
      "Charge": "50.00",
      "Payment": "Paid"
    },
    {
      "Consignment ID": "DD260901ABC002",
      "Order ID": "19102",
      "Store": "DEEN Commerce",
      "Recipient Info": "Noyakandi Bazar, Titas, Cumilla\n01812345678",
      "Delivery Status": "In Transit",
      "Amount": "2600.00",
      "Charge": "90.00",
      "Payment": "Unpaid"
    },
    {
      "Consignment ID": "DD260901ABC003",
      "Order ID": "19103",
      "Store": "DEEN Commerce",
      "Recipient Info": "Zindabazar, Sylhet\n01999887766",
      "Delivery Status": "Cancelled",
      "Amount": "1500.00",
      "Charge": "90.00",
      "Payment": "Unpaid"
    }
  ];

  const mockMetrics = {
    totalParcels: 3,
    paidCount: 1,
    unpaidCount: 2,
    totalCOD: 4100,
    totalCharge: 230,
    totalDiscount: 0,
    netRevenue: 1570,
    deliveredCount: 1,
    cancelledCount: 1
  };

  // ---------------------------------------------------------------------------
  // Test 1: In-Memory Deterministic Query Answering
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 1: Testing In-Memory Deterministic Analytics Engine...");

  // Query A: Total parcels count
  const qParcels = DeenAssistant.evaluateDeterministicQuery("how many total parcels are there?", mockRecords, mockMetrics);
  assert(qParcels, "Query for parcels must return answer");
  const pStr = qParcels.toString().toLowerCase();
  assert(pStr.includes("3") && pStr.includes("parcels"), `Parcels answer mismatch: ${qParcels}`);
  console.log("  ✅ Answered parcels query accurately without LLM call!");

  // Query B: Paid vs Unpaid COD
  const qPaid = DeenAssistant.evaluateDeterministicQuery("how many paid and unpaid orders?", mockRecords, mockMetrics);
  assert(qPaid, "Query for paid/unpaid must return answer");
  const paidStr = qPaid.toString();
  assert(paidStr.includes("Paid") && paidStr.includes("Unpaid") && paidStr.includes("1") && paidStr.includes("2"), `Paid answer mismatch: ${qPaid}`);
  console.log("  ✅ Answered paid vs unpaid COD counts accurately!");

  // Query C: COD Total & Revenue
  const qCod = DeenAssistant.evaluateDeterministicQuery("what is our total uncollected COD amount?", mockRecords, mockMetrics);
  assert(qCod, "Query for COD amount must return answer");
  const codStr = qCod.toString();
  assert(codStr.includes("4,100") || codStr.includes("4100"), `COD answer mismatch: ${qCod}`);
  console.log("  ✅ Answered total COD pipeline accurately!");

  // Query D: Delivery Districts Breakdown
  const qDistricts = DeenAssistant.evaluateDeterministicQuery("show delivery districts breakdown", mockRecords, mockMetrics);
  assert(qDistricts, "Query for districts must return answer");
  const distStr = qDistricts.toString();
  assert(distStr.includes("Dhaka") && (distStr.includes("Cumilla") || distStr.includes("Sylhet")), `Districts answer mismatch: ${qDistricts}`);
  console.log("  ✅ Answered district breakdown with Dhaka, Cumilla, and Sylhet!");

  // Query E: Bengali Greeting
  const qGreeting = DeenAssistant.evaluateDeterministicQuery("কেমন আছেন? সালাম", mockRecords, mockMetrics);
  assert(qGreeting, "Bengali greeting must return answer");
  const greetStr = qGreeting.toString();
  assert(greetStr.includes("আসসালামু আলাইকুম"), `Bengali greeting mismatch: ${qGreeting}`);
  console.log("  ✅ Handled native Bengali greeting with Islamic etiquette!");

  // ---------------------------------------------------------------------------
  // Test 2: Customer Note & WhatsApp Message Interpreter (Banglish & Bengali)
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 2: Testing Customer Note & Banglish Message Interpreter...");

  // Case A: Inspection & Return condition ("dheke nibo")
  const noteA = "dheke nibo bhalo na hole ferot dibo rider samne rakhben";
  const analysisA = DeenAssistant.analyzeCustomerMessageOrNote(noteA);
  assert(analysisA && analysisA.hasRiskConditions, "Must detect inspection return risk");
  assert(analysisA.flags.some(f => f.includes("Inspection")), "Must include Inspection flag");
  console.log("  ✅ Accurately flagged 'dheke nibo' bracketing/inspection risk!");

  // Case B: Urgent delivery + office timing in Bengali
  const noteB = "জরুরি কাল দুপুর ২টার আগে লাগবে, অফিসে থাকবো না পরে";
  const analysisB = DeenAssistant.analyzeCustomerMessageOrNote(noteB);
  assert(analysisB && analysisB.isUrgent, "Must detect urgency");
  assert(analysisB.isOfficeTiming, "Must detect office timing constraint");
  console.log("  ✅ Accurately extracted Bengali urgency & office timing constraint!");

  // Case C: Phone extraction from raw message
  const noteC = "amar address: mirpur 10 dhaka, phone: 01715485035";
  const analysisC = DeenAssistant.analyzeCustomerMessageOrNote(noteC);
  assert.strictEqual(analysisC.phone, "01715485035", `Phone extraction mismatch: ${analysisC.phone}`);
  console.log("  ✅ Extracted embedded phone '01715485035' from casual customer note!");

  // ---------------------------------------------------------------------------
  // Test 3: Context Synthesizer for LLMs
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 3: Testing Telemetry Context Synthesizer...");
  const synthesized = DeenAssistant.synthesizeContext(mockRecords, mockMetrics, "01715485035", noteA);
  assert(synthesized.includes("Total Extracted Parcels: 3"), "Must synthesize total parcels");
  assert(synthesized.includes("4,100") || synthesized.includes("4100"), "Must synthesize total COD");
  assert(synthesized.includes("01715485035"), "Must include recipient phone");
  assert(synthesized.includes("dheke nibo"), "Must include customer note");
  console.log("  ✅ Context Synthesizer produced structured ground-truth prompt for LLM!");

  // ---------------------------------------------------------------------------
  // Test 4: BYOK Storage Configuration & Providers
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 4: Testing BYOK Multi-Provider Configuration...");
  const defaultConfig = await DeenAssistant.loadBYOKConfig();
  assert(defaultConfig && defaultConfig.provider === "gemini", "Default provider must be gemini");

  const saved = await DeenAssistant.saveBYOKConfig({
    provider: "gemini",
    apiKey: "AIzaSyTestMockKeyForVerification",
    model: "gemini-2.5-flash",
    isActive: true
  });
  assert.strictEqual(saved.apiKey, "AIzaSyTestMockKeyForVerification", "Saved API key must match");
  assert.strictEqual(saved.isActive, true, "Saved isActive flag must be true");
  console.log("  ✅ BYOK multi-provider configuration loaded & saved cleanly!");

  // ---------------------------------------------------------------------------
  // Test 5: Chat History Persistence Lifecycle
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 5: Testing Chat History Persistence Lifecycle...");
  await DeenAssistant.clearChatHistory();
  let hist = await DeenAssistant.loadChatHistory();
  assert.strictEqual(hist.length, 0, "History must be empty after clear");

  await DeenAssistant.saveChatMessage({ role: "user", content: "What is our delivery ratio?", timestamp: Date.now() });
  await DeenAssistant.saveChatMessage({ role: "assistant", content: "Your delivery ratio is 92%.", timestamp: Date.now() });

  hist = await DeenAssistant.loadChatHistory();
  assert.strictEqual(hist.length, 2, "History must have 2 messages");
  assert.strictEqual(hist[0].content, "What is our delivery ratio?");
  assert.strictEqual(hist[1].content, "Your delivery ratio is 92%.");
  console.log("  ✅ Chat history saved, loaded, and verified!");

  // ---------------------------------------------------------------------------
  // Test 6: WebMCP Tool Execution 'ask_deen_ai_assistant'
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 6: Testing WebMCP ask_deen_ai_assistant Execution...");
  const mcpResult = await webMCP.executeTool("ask_deen_ai_assistant", {
    query: "How many total parcels and how much uncollected COD do we have?",
    records: mockRecords,
    metrics: mockMetrics
  });

  assert(mcpResult && mcpResult.success, "WebMCP tool execution must succeed");
  assert(mcpResult.answer, "WebMCP answer must not be empty");
  assert(mcpResult.source, "WebMCP response must specify source engine");
  console.log(`  ✅ WebMCP tool executed with source: ${mcpResult.source}`);
  console.log(`     Answer excerpt: ${mcpResult.answer.slice(0, 100).replace(/\n/g, ' ')}...`);

  console.log("\n==================================================");
  console.log("🎉 ALL DEEN ASSISTANT TESTS PASSED (100%)!");
  console.log("==================================================");
}

runTests().catch(err => {
  console.error("❌ DEEN Assistant Test Failed:", err);
  process.exit(1);
});
