/**
 * test_steadfast_dispatch.js
 * Automated test suite for Multi-Carrier Order Dispatch - Steadfast Integration (Pillar 2)
 */

const assert = require('assert');
const bg = require('./background.js');
const wc = require('./woocommerce.js');
const couriers = require('./courier-adapters.js');

console.log("🧪 Running Steadfast Multi-Carrier Dispatch Test Suite...\n");

// 1. Verify SteadfastAdapter consignment formatting
const sampleOrder = {
  orderId: "#19789",
  name: "Sahadat",
  phone: "01613385883",
  address: "House 12, Chandgaon, Chattogram",
  cod: "2238",
  notes: "Urgent delivery"
};

const payload = couriers.SteadfastAdapter.formatConsignmentPayload(sampleOrder);
assert.strictEqual(payload.invoice, "19789", "Invoice must strip leading hash");
assert.strictEqual(payload.recipient_name, "Sahadat");
assert.strictEqual(payload.recipient_phone, "01613385883");
assert.strictEqual(payload.recipient_address, "House 12, Chandgaon, Chattogram");
assert.strictEqual(payload.cod_amount, 2238);
assert.strictEqual(payload.note, "Urgent delivery");
console.log("  ✅ SteadfastAdapter payload correctly formatted for Steadfast API v1.");

// 2. Verify handleCreateSteadfastOrder validates input
bg.handleCreateSteadfastOrder(null).then(res => {
  assert.strictEqual(res.success, false);
  assert.ok(res.error.includes("Missing orderData"));
  console.log("  ✅ Missing orderData handled with validation error.");
});

// 3. Mock Chrome Storage & Runtime for Steadfast Dispatch
global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        cb({
          wp_steadfast_api_key: "mock_api_key_123",
          wp_steadfast_secret_key: "mock_secret_key_456"
        });
      }
    }
  },
  runtime: {
    id: "mock_extension_id",
    sendMessage: (msg, cb) => {
      if (msg.action === "create_steadfast_order") {
        cb({
          success: true,
          courier: "steadfast",
          consignmentId: 889900,
          trackingCode: "SF889900",
          data: { status: 200, message: "Consignment created" }
        });
      }
    }
  }
};

// Mock fetch for Steadfast API
const originalFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (url.includes("steadfast.com.bd/api/v1/create_order")) {
    assert.strictEqual(opts.headers["Api-Key"], "mock_api_key_123");
    assert.strictEqual(opts.headers["Secret-Key"], "mock_secret_key_456");
    const body = JSON.parse(opts.body);
    assert.strictEqual(body.invoice, "19789");
    assert.strictEqual(body.cod_amount, 2238);
    return {
      ok: true,
      json: async () => ({
        status: 200,
        message: "Order created successfully",
        consignment: {
          consignment_id: 889900,
          tracking_code: "SF889900"
        }
      })
    };
  }
  return { ok: false, json: async () => ({ status: 500 }) };
};

// 4. Test handleCreateSteadfastOrder with mock API response
bg.handleCreateSteadfastOrder(sampleOrder).then(res => {
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.courier, "steadfast");
  assert.strictEqual(res.consignmentId, 889900);
  assert.strictEqual(res.trackingCode, "SF889900");
  console.log("  ✅ handleCreateSteadfastOrder successfully dispatched parcel and parsed SF tracking code.");

  // 5. Test woocommerce dispatchToSteadfast wrapper
  wc.dispatchToSteadfast(sampleOrder, (wcRes) => {
    assert.strictEqual(wcRes.success, true);
    assert.strictEqual(wcRes.trackingCode, "SF889900");
    console.log("  ✅ woocommerce dispatchToSteadfast successfully executed callback with tracking code.");

    // Restore fetch
    global.fetch = originalFetch;

    console.log("\n🎉 ALL TESTS IN test_steadfast_dispatch.js PASSED 100%!");
  });
});
