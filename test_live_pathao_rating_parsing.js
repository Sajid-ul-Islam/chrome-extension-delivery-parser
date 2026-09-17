const assert = require('assert');

console.log("🧪 Testing Real Pathao & Multi-Courier Rating Parsing Engine...");

// Simulate background.js parsing logic
function parseCourierStats(pathaoData, steadfastData, storeHistory) {
  let pathaoStats = null;
  let pathaoStatus = "not_connected";

  if (pathaoData && !pathaoData.error) {
    const c = (pathaoData.data && pathaoData.data.customer)
      || pathaoData.customer
      || (pathaoData.data && typeof pathaoData.data === "object" && !Array.isArray(pathaoData.data) ? pathaoData.data : null)
      || pathaoData;

    if (c && typeof c === "object") {
      const t = Number(c.total_delivery || c.total || c.total_orders || c.total_order || 0);
      const d = Number(c.successful_delivery || c.delivered || c.success || 0);
      const f = Number(c.failed_delivery || c.cancelled || c.cancel || Math.max(0, t - d));
      pathaoStats = {
        total: t,
        delivered: d,
        cancelled: f,
        name: c.name || ""
      };
      pathaoStatus = t > 0 ? "live" : "clean_record";
    }
  } else if (pathaoData && (pathaoData.status === "token_missing" || pathaoData.status === 401 || pathaoData.status === 400)) {
    pathaoStatus = "token_missing";
  }

  let steadfastStats = null;
  let steadfastStatus = "not_connected";
  if (steadfastData && (typeof steadfastData.total_delivered !== "undefined" || typeof steadfastData.total_cancelled !== "undefined")) {
    const d = Number(steadfastData.total_delivered || 0);
    const c = Number(steadfastData.total_cancelled || 0);
    const t = d + c;
    steadfastStats = { total: t, delivered: d, cancelled: c };
    steadfastStatus = "live";
  }

  const total = (pathaoStats ? pathaoStats.total : 0) + (steadfastStats ? steadfastStats.total : 0) + (storeHistory ? storeHistory.total : 0);
  const delivered = (pathaoStats ? pathaoStats.delivered : 0) + (steadfastStats ? steadfastStats.delivered : 0) + (storeHistory ? storeHistory.delivered : 0);
  const cancelled = (pathaoStats ? pathaoStats.cancelled : 0) + (steadfastStats ? steadfastStats.cancelled : 0) + (storeHistory ? storeHistory.cancelled : 0);

  const isNewCustomer = total === 0;
  let successRate = total > 0 ? Math.round((delivered / total) * 100) : 100;
  let riskLevel = successRate >= 80 ? "low" : (successRate >= 60 ? "medium" : "high");

  return {
    success: true,
    totalParcels: total,
    deliveredCount: delivered,
    cancelledCount: cancelled,
    successRate: successRate,
    riskLevel: riskLevel,
    pathaoStatus: pathaoStatus,
    pathaoStats: pathaoStats,
    steadfastStatus: steadfastStatus,
    steadfastStats: steadfastStats
  };
}

// Case 1: Real Pathao API response format (nested under data.customer)
const realPathaoResponse = {
  type: "success",
  message: "User success rate fetched successfully",
  data: {
    customer: {
      name: "Tanvir Rahman",
      phone: "01712345678",
      total_delivery: 18,
      successful_delivery: 16
    }
  }
};

const res1 = parseCourierStats(realPathaoResponse, null, null);
assert.strictEqual(res1.pathaoStatus, "live", "Pathao status must be live");
assert.strictEqual(res1.totalParcels, 18, "Total parcels must be 18");
assert.strictEqual(res1.deliveredCount, 16, "Delivered count must be 16");
assert.strictEqual(res1.cancelledCount, 2, "Cancelled count must be 2");
assert.strictEqual(res1.successRate, 89, "Success rate must be 89%");
assert.strictEqual(res1.pathaoStats.name, "Tanvir Rahman", "Customer name should be extracted");
console.log("  ✅ Case 1: Real Pathao API nested response parsed with 100% precision!");

// Case 2: Multi-Courier aggregation with Steadfast
const steadfastResponse = {
  total_delivered: 10,
  total_cancelled: 2
};
const res2 = parseCourierStats(realPathaoResponse, steadfastResponse, null);
assert.strictEqual(res2.totalParcels, 30, "Total parcels aggregated across Pathao + Steadfast must be 30");
assert.strictEqual(res2.deliveredCount, 26, "Delivered count aggregated must be 26");
assert.strictEqual(res2.cancelledCount, 4, "Cancelled count aggregated must be 4");
assert.strictEqual(res2.successRate, 87, "Aggregated success rate must be 87%");
console.log("  ✅ Case 2: Multi-Courier composite aggregation across Pathao & Steadfast verified!");

// Case 3: Token missing
const tokenMissingResponse = { error: true, status: 401 };
const res3 = parseCourierStats(tokenMissingResponse, null, null);
assert.strictEqual(res3.pathaoStatus, "token_missing", "Must flag token_missing when 401 occurs");
assert.strictEqual(res3.totalParcels, 0, "Parcels should be 0 when unauthenticated");
console.log("  ✅ Case 3: Token missing accurately caught and flagged for 1-click login prompt!");

console.log("\n🎉 ALL REAL COURIER DATA PARSING TESTS PASSED SUCCESSFULLY!");
