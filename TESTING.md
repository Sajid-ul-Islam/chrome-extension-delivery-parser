# 🧪 Quality Assurance & Automated Testing Manual (TESTING.md)

## DEEN Delivery Parser — Autonomous Courier Logistics & Dispatch Engine

**Document Version:** 1.2.1  
**Master Test Suite Status:** 🟢 16/16 Passed (100%)  
**Target Runner:** Node.js v16+ (CommonJS) / Google Chrome Developer Mode

---

## 1. Testing Philosophy & Invariant Standards

Automated testing in the **DEEN Delivery Parser** codebase enforces the **11 Non-Negotiable Invariants** outlined in [`AGENTS.md`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/AGENTS.md):
1. **Preserve All Module Exports (Invariant 1)**: Core scripts (`woocommerce.js`, `phone-check.js`, `background.js`, `parser.js`) must always export designated functions for direct Node.js testing.
2. **Debounced Observers (Invariant 2)**: MutationObservers are verified for minimum 200ms debounce.
3. **Financial Invariants (Invariant 7)**: Strict verification of ৳50 inside Dhaka, ৳90 outside Dhaka, False-Dhaka correction, and ৳2,500 Free Shipping threshold.
4. **Zero Bengali Corruption (Invariant 5)**: Real-world Bengali addresses (e.g. `বেনাপোল`) must never be corrupted.
5. **Windows PowerShell Execution Safety (Invariant 11)**: Test runs must execute discrete `.js` script files via `node script.js`. Inline multi-line `node -e` commands are strictly forbidden on Windows.

---

## 2. Test Suite Directory (16 Suites)

The complete automated test harness consists of 16 specialized test suites:

| Suite # | Test File | Primary Scope & Verification Targets | Expected Runtime |
| :---: | :--- | :--- | :---: |
| **1** | `test_parser.js` | Fuzzy sequential token parsing, KPI computation, 20 address edge cases, 100% 64 districts coverage. | ~150ms |
| **2** | `test_autofill_flow.js` | Manifest schema, BD phone normalization, Pathao table extraction, exchange orders (`D-`), bulk queue advancement. | ~180ms |
| **3** | `test_popup_pathao_check.js` | Background runtime messaging, timeout fallbacks, popup UI sync and state transitions. | ~120ms |
| **4** | `test_live_pathao_rating_parsing.js` | Real Pathao Hermes API response shapes, multi-courier composite aggregation, token handling. | ~140ms |
| **5** | `test_universal_phone_e2e.js` | Universal phone highlight & copy triggers, DOM floating pill, sidebar drawer state. | ~160ms |
| **6** | `test_whatsapp_quick_reply.js` | 30 tests: 2x Canvas, line items, orders #17819, #18264, #18276, #18304, #19046, ৳2500 policy. | ~350ms |
| **7** | `test_webmcp_integration.js` | WebMCP registry conformance, tool discovery, execution of all 12 tools, semantic hints & schemas. | ~220ms |
| **8** | `test_full_fetch_improvements.js` | Shipping priority over billing, address 2 preservation, customer notes, concurrent fetch deduplication. | ~190ms |
| **9** | `test_wordpress_login_sync.js` | WordPress Admin auto-connect, session sync, wp-login authentication, B2B external login, WooCommerce plugin bridge. | ~240ms |
| **10** | `test_icons_verification.js` | Manifest icon declarations, presence and integrity of PNG/JPEG/SVG assets (16px, 32px, 48px, 128px). | ~90ms |
| **11** | `test_deen_assistant.js` | Zero-cost deterministic analytical queries, Banglish customer note interpreter, BYOK gateway interfaces. | ~130ms |
| **12** | `test_whatsapp_active_chat.js` | WhatsApp Web conversation header phone extraction, header rating badge, React 18 DOM reuse safeguard. | ~170ms |
| **13** | `test_floating_chat.js` | In-page floating AI Copilot chatbox validation across WordPress, Pathao, and WhatsApp Web. | ~210ms |
| **14** | `test_ndr_rescue_listener.js` | Non-Delivery Report (NDR) failed delivery attempt detector, Bengali retry/return keyword filters, 1-click rescue. | ~160ms |
| **15** | `test_cache_eviction.js` | 24-hour cache TTL eviction, capacity limit (500 items), FIFO pruning, `pruneExpiredCaches()` unref timer. | ~180ms |
| **16** | `test_local_rating_cache_reuse.js` | Zero-network cache hit verification, page memory cache, storage cache, forceRefresh bypass. | ~140ms |

---

## 3. How to Execute Tests

### A. Run Complete 16-Suite Test Harness
To run all 16 test suites in sequential order with automated pass/fail reporting:

```powershell
node run_all_suites.js
```

**Expected Success Output:**
```text
🚀 Running Complete Automated Test Suite...

Testing test_parser.js...                  ✅ PASSED
Testing test_autofill_flow.js...            ✅ PASSED
Testing test_popup_pathao_check.js...       ✅ PASSED
Testing test_live_pathao_rating_parsing.js. ✅ PASSED
Testing test_universal_phone_e2e.js...      ✅ PASSED
Testing test_whatsapp_quick_reply.js...     ✅ PASSED
Testing test_webmcp_integration.js...       ✅ PASSED
Testing test_full_fetch_improvements.js...  ✅ PASSED
Testing test_wordpress_login_sync.js...     ✅ PASSED
Testing test_icons_verification.js...       ✅ PASSED
Testing test_deen_assistant.js...           ✅ PASSED
Testing test_whatsapp_active_chat.js...      ✅ PASSED
Testing test_floating_chat.js...            ✅ PASSED
Testing test_ndr_rescue_listener.js...      ✅ PASSED
Testing test_cache_eviction.js...           ✅ PASSED
Testing test_local_rating_cache_reuse.js... ✅ PASSED

==================================================
🎉 ALL 16 TEST SUITES PASSED 100%!
```

### B. Run Individual Subsystem Tests
To test specific components during localized feature development:

```powershell
# Pricing, 2x Retina Canvas & WhatsApp formatting:
node test_whatsapp_quick_reply.js

# 24h 3-Tier Local Cache & Zero-Network reuse:
node test_local_rating_cache_reuse.js

# Cache capacity & TTL eviction:
node test_cache_eviction.js

# WhatsApp Web active chat & React 18 DOM reuse:
node test_whatsapp_active_chat.js

# WordPress SSO & B2B External Login bridge:
node test_wordpress_login_sync.js

# 12 W3C WebMCP tools:
node test_webmcp_integration.js
```

---

## 4. Mocking & Environment Isolation Architecture

Because the extension runs in browser DOM and Chrome Extension MV3 contexts, our Node.js test suites utilize lightweight, high-performance mocks:

### A. Chrome Extension APIs Mock (`global.chrome`)
```javascript
global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => cb({ ...mockStorageData }),
      set: (items, cb) => { Object.assign(mockStorageData, items); if (cb) cb(); },
      remove: (keys, cb) => { /* delete keys */ if (cb) cb(); }
    }
  },
  runtime: {
    sendMessage: (msg, cb) => { /* mock response */ },
    onMessage: { addListener: (fn) => { /* register listener */ } },
    getURL: (path) => `chrome-extension://mock-id/${path}`
  },
  tabs: {
    query: (query, cb) => cb([{ id: 101, url: "https://deencommerce.com/wp-admin/" }]),
    sendMessage: (tabId, msg, cb) => cb({ success: true })
  }
};
```

### B. DOM & HTML5 Canvas Mocks (`global.document`, `global.window`)
- Mock DOM elements (`HTMLDivElement`, `HTMLTableElement`, `HTMLInputElement`) with realistic `classList`, `getAttribute`, `setAttribute`, `querySelector`, and `addEventListener` methods.
- Mock HTML5 Canvas 2D context (`CanvasRenderingContext2D`) capturing `drawImage`, `fillText`, `measureText`, and `toDataURL` calls to verify byte-accurate receipt rendering without requiring a headless browser.

---

## 5. Financial & Business Invariant Test Matrix

The following real orders from DEEN Commerce are codified as immutable unit test assertions:

| Order | Destination | Subtotal | Shipping | Expected COD | Key Assertion Validated |
| :---: | :---: | :---: | :---: | :---: | :--- |
| **#17819** | Chattogram (Outside) | ৳2,750 | ৳0 | **৳2,750** | $\ge ৳2500$ threshold: Free shipping honored, zero advance required. |
| **#18264** | Mirpur, Dhaka (Inside) | ৳1,450 | ৳0 | **৳1,500** | $< ৳2500$ threshold: ৳50 delivery fee automatically added to COD. |
| **#18276** | Bogura (Outside) | ৳1,200 | ৳50 | **৳1,290** | False-Dhaka: Customer falsely picked ৳50 inside; corrected to ৳90 outside. |
| **#18304** | Sylhet (Outside) | ৳1,890 | ৳90 | **৳1,980** | Outside Dhaka standard fee (৳90) preserved accurately. |
| **#19029** | Benapole, Jashore | ৳3,200 | ৳0 | **৳3,200** | Zero Bengali text corruption: `বেনাপোল` is never corrupted into `Benaডাকঘর`. |
| **#19046** | Uttara, Dhaka (Inside) | ৳1,494 | ৳0 | **৳1,544** | COD equals Subtotal ($codNum === subNum$): +৳50 delivery fee added. |

---

## 6. Guidelines for Authoring New Tests

When adding features or refactoring:
1. Always create a new test file named `test_<feature_name>.js`.
2. Ensure the test file exits with code `0` on success and code `1` on assertion failure.
3. Add the test file to `suites` array in [`run_all_suites.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/run_all_suites.js).
4. Run `node run_all_suites.js` to ensure 100% pass across all 16+ suites.
5. **Never break Invariant 1**: Always preserve existing `module.exports` definitions.
