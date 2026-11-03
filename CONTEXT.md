# 🧠 Repository Context & Agent Orientation Manual (CONTEXT.md)

Welcome, AI Agent / Forward Deployed Engineer! This document provides the comprehensive mental model, architectural ground truth, operational rules, and context priming for the **DEEN Delivery Parser** repository.

---

## 1. What is DEEN Delivery Parser?

**DEEN Delivery Parser** is a production Google Chrome Extension (Manifest V3) purpose-built for **DEEN Commerce** (`deencommerce.com`), a premier Direct-to-Consumer (D2C) fashion and apparel brand in Bangladesh.

It unifies three otherwise disconnected platforms:
1. **WooCommerce Store Admin** (`https://deencommerce.com/wp-admin/admin.php?page=wc-orders`): Order processing, HPOS table extraction, 2x Retina digital receipt canvas rendering, Pathao dispatch, False-Dhaka courier fee correction, and ৳2,500 Free Shipping policy enforcement.
2. **Pathao Merchant Portal** (`https://merchant.pathao.com/courier/orders/list`): Live KPI toolbar, 1-click batch Excel/CSV export, React/AntD consignment autofill, and NDR failed delivery tracking.
3. **WhatsApp Web** (`https://web.whatsapp.com`): Active conversation header customer rating badge, 1-click advance delivery fee (৳90) and order confirmation quick reply injection, and NDR customer rescue deep links.

---

## 2. File Map & Architecture Matrix

| File | Context / Environment | Key Responsibilities |
| :--- | :--- | :--- |
| [`manifest.json`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/manifest.json) | Chrome Manifest V3 | Declares background service worker, permissions, host permissions, content scripts, and web accessible assets. |
| [`parser.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/parser.js) | Global / Shared | Core parsing engine, BD phone normalizer, 64 districts & ~495 upazilas dictionary, reverse zone inference, fee calculator, WhatsApp message generator. |
| [`background.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/background.js) | Service Worker (MV3) | Pathao Hermes OAuth & B2B external login, Steadfast courier check, 24-hour multi-tier local cache, WordPress SSO session probe, Nominatim geocoder. |
| [`woocommerce.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/woocommerce.js) | Content Script (`*://*/wp-admin/*`) | Order row extraction, lazy-loaded customer rating column, 2x Retina canvas receipt, Pathao popup address normalizer, same-origin plugin settings bridge. |
| [`phone-check.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/phone-check.js) | Content Script (`*://*/*`) | Highlight/copy phone detector, WhatsApp Web conversation header badge with React 18 reconciliation safeguard, slide-over drawer, floating action pill. |
| [`content.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/content.js) | Content Script (`merchant.pathao.com`) | In-page floating toolbar, parcel table extractor, 1-click Excel/CSV exporter, form autofill listener, NDR failed attempt decorator. |
| [`courier-adapters.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/courier-adapters.js) | Global / Shared | Multi-carrier unified adapter (Pathao, Steadfast, RedX), composite risk score, NDR tracking event processor, courier fee comparator. |
| [`storage-engine.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/storage-engine.js) | Global / Shared | Storage wrapper for `chrome.storage.local` with fallback to `localStorage` or memory Map. Handles NDR alerts, customer history, and cached records. |
| [`deen-assistant.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/deen-assistant.js) | Global / Content / Popup | Zero-cost deterministic analytical query engine, Banglish/Bengali customer note interpreter, BYOK (Gemini, OpenAI, Groq) gateway. |
| [`deen-floating-chat.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/deen-floating-chat.js) | Content Script | In-page collapsible floating Copilot window across WordPress, Pathao, and WhatsApp Web with prompt chips and 1-click message injection. |
| [`webmcp-provider.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/webmcp-provider.js) | Content Script / Page | W3C WebMCP tool registry (`navigator.modelContext` / `window.modelContext`). Exposes 12 structured AI tools to browser agents. |
| [`popup.html`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/popup.html), [`popup.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/popup.js) | Extension Popup Window | 5-tab modular UI (`📦 Deliveries`, `🛡️ Courier Check`, `🌐 Store Connect`, `💬 WhatsApp`, `🤖 AI Tools`), WordPress profile card, Pathao sync runner. |
| [`env.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/env.js) | Global / Extension Root | Environment credentials fallback configuration (`PATHAO_CLIENT_ID`, `PATHAO_CLIENT_SECRET`, etc.). |
| [`run_all_suites.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/run_all_suites.js) | Node.js Test Harness | Master test runner executing all 16 automated test suites. |

---

## 3. The 11 Non-Negotiable Coding Invariants

When developing or refactoring in this repository, you **MUST NEVER VIOLATE** these invariants:

1. **Preserve All Module Exports (Invariant 1):** Never delete or rename symbols exported in `module.exports` across `woocommerce.js`, `phone-check.js`, `background.js`, and `parser.js`.
2. **Debounced MutationObservers (Invariant 2):** Minimum 200ms debounce on all MutationObservers (`debounceTimer`) to prevent UI thrashing.
3. **Single Order Dispatch Flag (Invariant 3):** Single order dispatches must pass `{ autoSwitch: true, userTriggered: true }`.
4. **Zero Unfiltered Cookie Scraping (Invariant 4):** Cookies are accessed strictly for `pathao.com` and the verified store domain (`deencommerce.com`).
5. **Zero Bengali Text Corruption (Invariant 5):** Never tamper with Bengali customer names (e.g. Benapole `বেনাপোল` must never become `Benaডাকঘর`). Numeral conversion is strictly for prices, order IDs, and quantities.
6. **Order Receipt Canvas Visual Rules (Invariant 6):** Pure `#ffffff` background, DEEN Orange `#ea580c` headers, authentic logo from `DEEN_LOGO_BASE64`, and zero `-` or `0` placeholders.
7. **Delivery Fee, Free Shipping & False-Dhaka Rules (Invariant 7):**
   - Inside Dhaka: ৳50. Outside Dhaka: ৳90.
   - **Free Shipping applies ONLY when Subtotal $\ge$ ৳2,500** (`subtotal >= 2500`).
   - Orders $<$ ৳2,500 automatically have courier fees added (+৳50 inside, +৳90 outside) even if WooCommerce had 0 shipping.
   - False-Dhaka 50 TK Correction: Orders outside Dhaka that selected inside Dhaka are automatically corrected to ৳90.
8. **100% 64 Districts Coverage & Reverse Zone Inference (Invariant 8):** Incomplete addresses mentioning only an upazila (e.g. `Titas`) must resolve to their parent district (`Cumilla`) without falling back to Dhaka. Obscure locations fall back to OpenStreetMap Nominatim (`ISO3166-2-lvl5`).
9. **WordPress SSO & Role Isolation (Invariant 9):** Cookie-based connection stores display name, username, role, and permissions in `chrome.storage.local`. Categories: `Administrator` and `Shop Manager`.
10. **WooCommerce Pathao Plugin Bridge & B2B External Login (Invariant 10):** Automatically probe open WooCommerce tabs (`get_wc_pathao_credentials`) to extract credentials and issue tokens via `/aladdin/api/v1/external/login`.
11. **PowerShell CLI Execution Safety for AI Agents (Invariant 11):** Never run complex inline Node scripts via `node -e "..."` in PowerShell. Always create a temporary `.js` helper file and run `node script.js`.

---

## 4. Key Engineering Systems

### 4.1 24-Hour Tiered Local Rating Cache
To avoid redundant network requests to Pathao Hermes API and ensure 0ms instantaneous display:
1. **Tier 1 (Page Map):** `localPageRatingCache` in `phone-check.js` checks in-memory Map first (0ms).
2. **Tier 2 (Storage):** `customer_rating_cache` in `chrome.storage.local` holds up to 500 entries for 24 hours.
3. **Tier 3 (Service Worker Map):** `customerRatingMemoryCache` in `background.js` caches up to 500 entries for 24 hours with FIFO eviction.
4. **Bypass:** `forceRefresh: true` explicitly bypasses local cache and forces a fresh query to Pathao.

### 4.2 React 18 Reconciliation Safeguard on WhatsApp Web
WhatsApp Web's React engine throws `NotFoundError: Failed to execute 'insertBefore' on 'Node'` when extension content scripts delete and re-insert elements in the conversation header.
- **Rule 1:** Never call `existingBadge.remove()`. Always reuse the existing DOM node (`badge.setAttribute('data-phone', phone)` and replace `innerHTML`).
- **Rule 2:** `phone-check.js` installs a defensive wrapper on `Node.prototype.insertBefore` and `Node.prototype.removeChild` to safely catch foreign sibling nodes and fall back to `appendChild`.

### 4.3 Automated Non-Delivery Report (NDR) Rescue
1. Listens for failed delivery statuses (`Delivery Attempt Failed`, `ব্যর্থ`, `যোগাযোগ করা সম্ভব হয়নি`).
2. Triggers desktop notifications via `chrome.notifications`.
3. Injects 1-click rescue buttons on portal rows and generates personalized WhatsApp deep links pre-filled with the order's tracking ID and customer name.

---

## 5. Verification & Testing

Before declaring any task or sprint complete, run the complete automated test harness:

```powershell
node run_all_suites.js
```

### The 16 Test Suites:
1. `test_parser.js` — Sequential token parsing, KPIs, 20 edge cases, 64 districts.
2. `test_autofill_flow.js` — Manifest schema, phone normalization, Pathao tables, exchange orders (`D-`).
3. `test_popup_pathao_check.js` — Background messaging, timeout fallbacks, popup UI sync.
4. `test_live_pathao_rating_parsing.js` — Real Hermes API responses, composite aggregation.
5. `test_universal_phone_e2e.js` — Universal phone detection, copy/highlight triggers, sidebar drawer.
6. `test_whatsapp_quick_reply.js` — 30 tests: 2x Canvas, line items, orders #17819, #18264, #18276, #18304, #19046, ৳2500 policy.
7. `test_webmcp_integration.js` — WebMCP registry conformance, tool discovery, execution of all 12 tools.
8. `test_full_fetch_improvements.js` — Shipping priority, address 2 preservation, customer notes, deduplication.
9. `test_wordpress_login_sync.js` — WordPress Admin auto-connect, session sync, B2B external login.
10. `test_icons_verification.js` — Manifest icon declarations, presence and integrity of PNG/JPEG/SVG assets.
11. `test_deen_assistant.js` — Zero-cost deterministic analytical queries, Banglish customer note interpreter.
12. `test_whatsapp_active_chat.js` — WhatsApp Web header phone extraction, rating badge, Node reuse safeguard.
13. `test_floating_chat.js` — In-page floating AI Copilot chatbox validation across WordPress, Pathao, and WhatsApp.
14. `test_ndr_rescue_listener.js` — NDR failed attempt auto-detection, WhatsApp rescue links, desktop alerts.
15. `test_cache_eviction.js` — 24-hour cache TTL eviction, capacity limit (500 items), FIFO pruning.
16. `test_local_rating_cache_reuse.js` — Zero-network cache hit verification, page memory cache, storage cache.
