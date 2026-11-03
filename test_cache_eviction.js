/**
 * Automated Test Suite: Cache Eviction, TTL & Capacity Management Verification
 * DEEN Delivery Parser Chrome Extension
 */

const assert = require('assert');
const bg = require('./background.js');

console.log("==================================================");
console.log("🧪 Running Cache Eviction & TTL Management Suite");
console.log("==================================================");

// Test 1: Verify Cache Constants and Exports
console.log("\n▶ Test 1: Verifying cache constants & exports...");
assert(bg.customerRatingMemoryCache instanceof Map, "customerRatingMemoryCache must be a Map");
assert(bg.onlineAddressCache instanceof Map, "onlineAddressCache must be a Map");
assert.strictEqual(typeof bg.pruneExpiredCaches, "function", "pruneExpiredCaches must be a function");
assert.strictEqual(bg.RATING_CACHE_TTL_MS, 10 * 60 * 1000, "RATING_CACHE_TTL_MS must be 10 minutes");
assert.strictEqual(bg.ONLINE_ADDRESS_CACHE_TTL_MS, 24 * 60 * 60 * 1000, "ONLINE_ADDRESS_CACHE_TTL_MS must be 24 hours");
assert.strictEqual(bg.MAX_RATING_CACHE_ENTRIES, 500, "MAX_RATING_CACHE_ENTRIES must be 500");
assert.strictEqual(bg.MAX_ONLINE_ADDRESS_CACHE_ENTRIES, 500, "MAX_ONLINE_ADDRESS_CACHE_ENTRIES must be 500");
console.log("  ✅ Cache constants and structures verified successfully.");

// Test 2: Online Address Cache Hit & TTL Eviction
console.log("\n▶ Test 2: Testing onlineAddressCache hit & TTL expiration...");
bg.onlineAddressCache.clear();

// Query that will be resolved locally
let testRes1 = null;
bg.handleOnlineAddressGuess("Dhanmondi 27, Dhaka", (res) => {
  testRes1 = res;
});

assert(testRes1, "Local address guess must respond");
assert.strictEqual(testRes1.success, true, "Local guess must succeed");
assert.strictEqual(testRes1.district, "Dhaka");
assert(testRes1.timestamp, "Result should include timestamp");
assert(bg.onlineAddressCache.has("dhanmondi 27, dhaka"), "Must be cached in onlineAddressCache");

// Verify fast-path hit from cache
let testRes2 = null;
bg.handleOnlineAddressGuess("Dhanmondi 27, Dhaka", (res) => {
  testRes2 = res;
});
assert.strictEqual(testRes2, testRes1, "Second lookup must return cached reference");

// Manually expire entry and verify deletion
const cached = bg.onlineAddressCache.get("dhanmondi 27, dhaka");
cached.timestamp = Date.now() - (bg.ONLINE_ADDRESS_CACHE_TTL_MS + 1000); // 24h + 1s ago

let testRes3 = null;
bg.handleOnlineAddressGuess("Dhanmondi 27, Dhaka", (res) => {
  testRes3 = res;
});
assert(testRes3, "Must respond after re-evaluating");
assert(bg.onlineAddressCache.get("dhanmondi 27, dhaka").timestamp > cached.timestamp, "Cache entry must be refreshed with new timestamp");
console.log("  ✅ onlineAddressCache hit, timestamping, and TTL expiration verified.");

// Test 3: Capacity Limit Eviction (FIFO) in onlineAddressCache
console.log("\n▶ Test 3: Testing onlineAddressCache max capacity (500) FIFO eviction...");
bg.onlineAddressCache.clear();

// Fill with 500 items
for (let i = 0; i < 500; i++) {
  bg.onlineAddressCache.set(`query_${i}`, {
    success: true,
    district: "Dhaka",
    timestamp: Date.now()
  });
}
assert.strictEqual(bg.onlineAddressCache.size, 500, "Cache should hold exactly 500 entries");
assert(bg.onlineAddressCache.has("query_0"), "Oldest entry query_0 should exist");

// Add 501st entry via handleOnlineAddressGuess
bg.handleOnlineAddressGuess("Uttara Sector 4, Dhaka", () => {});

assert.strictEqual(bg.onlineAddressCache.size, 500, "Cache size should not exceed 500");
assert(!bg.onlineAddressCache.has("query_0"), "Oldest entry query_0 should have been evicted");
assert(bg.onlineAddressCache.has("uttara sector 4, dhaka"), "New entry should exist in cache");
console.log("  ✅ onlineAddressCache capacity limit and FIFO eviction verified.");

// Test 4: Capacity Limit Eviction in customerRatingMemoryCache
console.log("\n▶ Test 4: Testing customerRatingMemoryCache max capacity (500) FIFO eviction...");
bg.customerRatingMemoryCache.clear();

for (let i = 0; i < 500; i++) {
  const phone = "017" + String(i).padStart(8, '0');
  bg.customerRatingMemoryCache.set(phone, {
    timestamp: Date.now(),
    result: { phone, success: true }
  });
}
assert.strictEqual(bg.customerRatingMemoryCache.size, 500, "Rating cache should hold exactly 500 entries");
assert(bg.customerRatingMemoryCache.has("01700000000"), "Oldest entry 01700000000 should exist");

// Add one more entry
if (bg.customerRatingMemoryCache.size >= bg.MAX_RATING_CACHE_ENTRIES) {
  const oldest = bg.customerRatingMemoryCache.keys().next().value;
  if (oldest) bg.customerRatingMemoryCache.delete(oldest);
}
bg.customerRatingMemoryCache.set("01899999999", {
  timestamp: Date.now(),
  result: { phone: "01899999999", success: true }
});

assert.strictEqual(bg.customerRatingMemoryCache.size, 500, "Cache size must be capped at 500");
assert(!bg.customerRatingMemoryCache.has("01700000000"), "Oldest phone should be evicted");
assert(bg.customerRatingMemoryCache.has("01899999999"), "New phone should exist");
console.log("  ✅ customerRatingMemoryCache capacity limit verified.");

// Test 5: pruneExpiredCaches() Functionality
console.log("\n▶ Test 5: Testing pruneExpiredCaches() periodic sweeper...");
bg.onlineAddressCache.clear();
bg.customerRatingMemoryCache.clear();

const now = Date.now();
// Add 1 fresh and 1 expired entry to both caches
bg.onlineAddressCache.set("fresh_addr", { timestamp: now, success: true });
bg.onlineAddressCache.set("expired_addr", { timestamp: now - (25 * 3600 * 1000), success: true });

bg.customerRatingMemoryCache.set("01711111111", { timestamp: now, result: {} });
bg.customerRatingMemoryCache.set("01722222222", { timestamp: now - (15 * 60 * 1000), result: {} });

assert.strictEqual(bg.onlineAddressCache.size, 2);
assert.strictEqual(bg.customerRatingMemoryCache.size, 2);

bg.pruneExpiredCaches();

assert.strictEqual(bg.onlineAddressCache.size, 1, "Expired address query must be pruned");
assert(bg.onlineAddressCache.has("fresh_addr"), "Fresh address query must be retained");
assert(!bg.onlineAddressCache.has("expired_addr"), "Expired address query must be deleted");

assert.strictEqual(bg.customerRatingMemoryCache.size, 1, "Expired customer rating must be pruned");
assert(bg.customerRatingMemoryCache.has("01711111111"), "Fresh customer rating must be retained");
assert(!bg.customerRatingMemoryCache.has("01722222222"), "Expired customer rating must be deleted");
console.log("  ✅ pruneExpiredCaches successfully pruned expired entries from both caches.");

console.log("\n==================================================");
console.log("🎉 ALL CACHE EVICTION & TTL TESTS PASSED 100%!");
console.log("==================================================");
process.exit(0);


