/**
 * Test Suite for WebMCP (Web Model Context Protocol) Integration
 * Validates tool registration, schema conformance, tool execution,
 * semantic hints, and error handling.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Ensure parser.js is loaded first in Node global scope
const parser = require('./parser.js');
Object.assign(global, parser);

// Load webmcp-provider.js
const webMCP = require('./webmcp-provider.js');

async function runTests() {
  console.log("==================================================");
  console.log("🧪 Running Verification Tests for WebMCP Integration");
  console.log("==================================================");

  // ---------------------------------------------------------------------------
  // Test 1: WebMCP Standard Registry Interface
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 1: Validating WebMCP Registry API Interface...");
  assert.strictEqual(typeof webMCP.registerTool, "function", "registerTool must be a function");
  assert.strictEqual(typeof webMCP.unregisterTool, "function", "unregisterTool must be a function");
  assert.strictEqual(typeof webMCP.getTools, "function", "getTools must be a function");
  assert.strictEqual(typeof webMCP.executeTool, "function", "executeTool must be a function");
  console.log("  ✅ WebMCP registry implements registerTool, unregisterTool, getTools, executeTool!");

  // ---------------------------------------------------------------------------
  // Test 2: Registered Tools Inventory & Schema Conformance
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 2: Checking Registered WebMCP Tools Inventory & JSON Schemas...");
  const tools = await webMCP.getTools();
  assert(Array.isArray(tools), "getTools() must return an array");
  console.log(`  Discovered ${tools.length} registered WebMCP tools:`);
  tools.forEach(t => console.log(`    • ${t.name}: ${t.description.slice(0, 60)}...`));

  assert(tools.length >= 7, "Must have at least 7 core WebMCP tools registered");

  const toolNames = tools.map(t => t.name);
  const expectedTools = [
    "check_customer_courier_rating",
    "normalize_bd_address",
    "build_full_address",
    "calculate_delivery_fee",
    "generate_whatsapp_quick_reply",
    "get_woocommerce_active_orders",
    "autofill_pathao_consignment"
  ];

  for (const exp of expectedTools) {
    assert(toolNames.includes(exp), `Expected tool '${exp}' must be registered in WebMCP`);
    const t = tools.find(x => x.name === exp);
    assert(t.inputSchema && typeof t.inputSchema === "object", `Tool '${exp}' must have a valid inputSchema`);
    assert(t.inputSchema.type === "object", `Tool '${exp}' inputSchema must be of type 'object'`);
  }
  console.log("  ✅ All 7 core e-commerce & courier intelligence WebMCP tools verified!");

  // ---------------------------------------------------------------------------
  // Test 3: Tool Execution: check_customer_courier_rating
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 3: Testing check_customer_courier_rating Execution...");
  const ratingRes = await webMCP.executeTool("check_customer_courier_rating", {
    phone: "+8801712345678"
  });
  assert.strictEqual(ratingRes.success, true, "Rating check must return success: true");
  assert.strictEqual(ratingRes.phone, "01712345678", "Phone must be normalized to standard 11 digits");
  assert(typeof ratingRes.successRate === "number", "Must contain numeric successRate");
  assert(typeof ratingRes.riskLevel === "string", "Must contain riskLevel ('low', 'medium', 'high')");
  console.log(`  ✅ Customer rating check: phone=${ratingRes.phone}, successRate=${ratingRes.successRate}%, risk=${ratingRes.riskLevel}`);

  // Test invalid phone error handling
  const invalidRes = await webMCP.executeTool("check_customer_courier_rating", { phone: "123" });
  assert.strictEqual(invalidRes.success, false, "Invalid phone must return success: false");
  console.log("  ✅ Invalid phone correctly caught and flagged.");

  // ---------------------------------------------------------------------------
  // Test 4: Tool Execution: normalize_bd_address
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 4: Testing normalize_bd_address Execution...");
  const messyAddr = "Home Benapole city,thana sharsha,jela jashore Division khulna Benapole";
  const normRes = await webMCP.executeTool("normalize_bd_address", { rawAddress: messyAddr });
  assert(normRes.normalizedStreetAddress, "Must return normalizedStreetAddress");
  assert(!normRes.normalizedStreetAddress.includes("Benaডাকঘর"), "Must never corrupt Benapole into Benaডাকঘর");
  assert(normRes.district.toLowerCase().includes("jashore") || normRes.district.toLowerCase().includes("jessore"), "Must detect Jashore district");
  assert(normRes.zone.toLowerCase().includes("sharsha") || normRes.zone.toLowerCase().includes("benapole"), "Must detect Sharsha/Benapole zone");
  assert.strictEqual(normRes.isOutsideDhaka, true, "Jashore must be recognized as outside Dhaka");
  console.log(`  ✅ Clean address: '${normRes.normalizedStreetAddress}' (District: ${normRes.district}, Zone: ${normRes.zone})`);

  // ---------------------------------------------------------------------------
  // Test 5: Tool Execution: build_full_address
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 5: Testing build_full_address Execution...");
  const fullRes = await webMCP.executeTool("build_full_address", {
    rawAddress: "House 12, Road 4, Mirpur 10, Dhaka 1216"
  });
  assert(fullRes.fullAddress, "Must return fullAddress");
  assert(fullRes.fullAddress.includes("Mirpur"), "Must contain zone Mirpur");
  assert(fullRes.fullAddress.includes("Dhaka"), "Must contain district Dhaka");
  console.log(`  ✅ Full address built: '${fullRes.fullAddress}'`);

  // ---------------------------------------------------------------------------
  // Test 6: Tool Execution: calculate_delivery_fee
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 6: Testing calculate_delivery_fee Execution...");
  const insideFeeRes = await webMCP.executeTool("calculate_delivery_fee", {
    address: "Dhanmondi 27, Dhaka"
  });
  assert.strictEqual(insideFeeRes.deliveryFee, 50, "Inside Dhaka fee must be ৳50");
  assert.strictEqual(insideFeeRes.isOutsideDhaka, false, "Inside Dhaka must not be outside");

  const outsideFeeRes = await webMCP.executeTool("calculate_delivery_fee", {
    address: "Boalmari, Faridpur"
  });
  assert.strictEqual(outsideFeeRes.deliveryFee, 90, "Outside Dhaka fee must be ৳90");
  assert.strictEqual(outsideFeeRes.isOutsideDhaka, true, "Faridpur must be recognized as outside Dhaka");
  console.log("  ✅ Delivery fee calculation: Inside Dhaka = ৳50, Outside Dhaka = ৳90.");

  // ---------------------------------------------------------------------------
  // Test 7: Tool Execution: generate_whatsapp_quick_reply
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 7: Testing generate_whatsapp_quick_reply Execution...");
  const waRes = await webMCP.executeTool("generate_whatsapp_quick_reply", {
    templateKey: "advance_fee",
    phone: "01715485035",
    orderId: "18304",
    customerName: "Kazi Morshed",
    codAmount: 1590,
    isOutsideDhaka: true
  });
  assert(waRes.messageText.includes("18304"), "Message must contain order #18304");
  assert(waRes.messageText.includes("90"), "Outside Dhaka advance fee must mention ৳90");
  assert(waRes.deepLink.startsWith("https://wa.me/8801715485035?text="), "Deep link must start with https://wa.me/880...");
  console.log("  ✅ WhatsApp advance COD message generated with 1-click wa.me deep link!");

  // ---------------------------------------------------------------------------
  // Test 8: Tool Execution: get_woocommerce_active_orders
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 8: Testing get_woocommerce_active_orders Execution...");
  const ordersRes = await webMCP.executeTool("get_woocommerce_active_orders", { limit: 10 });
  assert(ordersRes && typeof ordersRes.count === "number", "Must return count");
  assert(Array.isArray(ordersRes.orders), "Must return orders array");
  console.log(`  ✅ get_woocommerce_active_orders executed cleanly (source: ${ordersRes.source})!`);

  // ---------------------------------------------------------------------------
  // Test 9: Tool Execution: autofill_pathao_consignment
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 9: Testing autofill_pathao_consignment Execution & Consequential Hint...");
  const autofillRes = await webMCP.executeTool("autofill_pathao_consignment", {
    phone: "01711223344",
    name: "John Doe",
    address: "House 1, Road 2, Gulshan, Dhaka",
    cod: 1550,
    orderId: "18400"
  });
  assert.strictEqual(autofillRes.success, true, "Autofill dispatch must succeed");
  assert.strictEqual(autofillRes.payload.phone, "01711223344", "Payload phone preserved");
  assert.strictEqual(autofillRes.payload.orderId, "18400", "Payload orderId preserved");
  console.log("  ✅ autofill_pathao_consignment payload generated and dispatched!");

  // ---------------------------------------------------------------------------
  // Test 10: Semantic Hints Validation (readOnlyHint vs consequentialHint)
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 10: Validating WebMCP Semantic Hints...");
  const ratingTool = tools.find(t => t.name === "check_customer_courier_rating");
  assert.strictEqual(ratingTool.readOnlyHint, true, "check_customer_courier_rating must have readOnlyHint: true");
  assert.strictEqual(ratingTool.consequentialHint, false, "check_customer_courier_rating must not be consequential");

  const autofillTool = tools.find(t => t.name === "autofill_pathao_consignment");
  assert.strictEqual(autofillTool.consequentialHint, true, "autofill_pathao_consignment must have consequentialHint: true");
  assert.strictEqual(autofillTool.readOnlyHint, false, "autofill_pathao_consignment must not be read-only");
  console.log("  ✅ Semantic hints properly configured: safe read-only queries vs consequential booking actions.");

  // ---------------------------------------------------------------------------
  // Test 11: Schema Validation Error Handling
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 11: Validating Missing Required Parameter Handling...");
  let caughtError = false;
  try {
    await webMCP.executeTool("normalize_bd_address", {});
  } catch (err) {
    caughtError = true;
    assert(err.message.includes("rawAddress"), "Error must mention missing required argument 'rawAddress'");
  }
  assert(caughtError, "Missing required argument must throw an error");
  console.log("  ✅ Missing required schema properties rejected with descriptive error message.");

  console.log("\n==================================================");
  console.log("🎉 ALL 11 WEBMCP INTEGRATION TESTS PASSED SUCCESSFULLY!");
  console.log("==================================================");
}

runTests().catch(err => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
