# 🐛 Bugs & Fixes Compendium (bugs&fixes.md)

> **Note:** This file is aliased to [BUGS_AND_FIXES.md](BUGS_AND_FIXES.md). See [BUGS_AND_FIXES.md](BUGS_AND_FIXES.md) for the full root cause analyses and architectural fix logs.

## DEEN Delivery Parser — Critical Bug Post-Mortem & Fix Log

**Document Version:** 1.2.1  
**Status:** All 12 Documented Critical Bugs Resolved & Verified (16/16 Test Suites Passing)

---

## Master Bug Index

| Bug ID | Severity | Component | Issue Summary | Resolution Status |
| :---: | :---: | :--- | :--- | :---: |
| **BUG-01** | 🔴 Critical | `phone-check.js` | WhatsApp Web React 18 `insertBefore` NotFoundError crash. | 🟢 Resolved |
| **BUG-02** | 🔴 Critical | `background.js` | Pathao rating fetch failure due to empty secret overwrite in storage. | 🟢 Resolved |
| **BUG-03** | 🟡 High | `background.js` | Pathao Hermes API fetch timeout aborting during network latency spikes. | 🟢 Resolved |
| **BUG-04** | 🟡 High | `background.js` | Node.js automated test runner hanging on un-refed cache eviction interval. | 🟢 Resolved |
| **BUG-05** | 🟡 High | `phone-check.js` | Temporal Dead Zone (TDZ) `ReferenceError` during CommonJS test require. | 🟢 Resolved |
| **BUG-06** | 🔴 Critical | `parser.js` | Bengali town name corruption (`বেনাপোল` -> `Benaডাকঘর`). | 🟢 Resolved |
| **BUG-07** | 🔴 Financial | `woocommerce.js` | False-Dhaka undercharging: Outside Dhaka customers paying only ৳50. | 🟢 Resolved |
| **BUG-08** | 🔴 Financial | `woocommerce.js` | Free Shipping threshold miscalculation for orders under ৳2,500. | 🟢 Resolved |
| **BUG-09** | 🟡 High | `woocommerce.js` | Concurrent AJAX fetch race conditions during rapid table order scrolling. | 🟢 Resolved |
| **BUG-10** | 🟡 High | `parser.js` | Incomplete BD addresses (upazila without district) falling back to Dhaka. | 🟢 Resolved |
| **BUG-11** | 🟢 Low | `phone-check.js` | Missing `classList.contains` method in test mocks throwing TypeError. | 🟢 Resolved |
| **BUG-12** | 🟢 Low | `background.js` | Empty phone string normalizing to `"0"` and triggering invalid queries. | 🟢 Resolved |

---

### Key Resolution Summary

1. **WhatsApp React 18 Fix**: Implemented in-place DOM Node Reuse Pattern in `renderWhatsAppHeaderBadge` and installed defensive wrappers on `Node.prototype.insertBefore` and `removeChild`.
2. **Pathao 401 Credential Fix**: Guarded `stored.pathao_client_secret` against empty string overwrites in `loadRuntimeEnv()` and added dynamic `chrome.runtime.getURL("env.js")` text parsing fallback.
3. **Hermes Timeout Extension**: Extended fetch timeout to 7,000ms with automatic failover to Steadfast Courier Fraud DB.
4. **Node.js Process Exit Fix**: Added `pruneTimer.unref()` to the 15-minute cache sweeper in `background.js`.
5. **CommonJS Export Fix**: Moved `localPageRatingCache` declaration above `module.exports` in `phone-check.js`.
6. **Bengali Word Boundary Protection**: Added Unicode word boundaries (`[\s,।-]`) to prevent corrupting valid names like `বেনাপোল`.
7. **False-Dhaka ৳90 Correction**: Auto-corrects ৳50 inside Dhaka fee to ৳90 when destination district is outside Dhaka.
8. **৳2,500 Free Shipping Rule**: Enforces Free Delivery only when subtotal $\ge ৳2,500$.
9. **AJAX Deduplication**: Uses `inFlightOrderRequests` Map to prevent duplicate concurrent network queries.
10. **Reverse Zone Inference**: Maps all ~495 upazilas to their parent district without falling back to Dhaka.

---

### Automated Verification
All fixes are regression-tested via:
```powershell
node run_all_suites.js
```
🎉 **All 16 Test Suites Passed 100%!**
