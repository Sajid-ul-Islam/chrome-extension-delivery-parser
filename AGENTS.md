# 🤖 Agentic Development Manual & Codebase Invariants (AGENTS.md)

Welcome, AI Agent / Forward Deployed Engineer! This document provides the authoritative operational manual, system architecture, and non-negotiable coding invariants for developing, testing, deploying, and maintaining the **DEEN Delivery Parser** Chrome Extension (Manifest V3) for **DEEN Commerce**.

---

## 1. System Architecture & Component Roles

The codebase adheres strictly to **Google Chrome Manifest V3**:

| Component | File | Execution Context | Key Responsibilities |
| :--- | :--- | :--- | :--- |
| **Parser Core** | [`parser.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/parser.js) | Global / Shared | Centralized parsing engine, regex anchors, BD address normalizer, ISO district detection, delivery fee calculations, WhatsApp message generator. |
| **WebMCP Provider** | [`webmcp-provider.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/webmcp-provider.js) | Content Script / Page | W3C WebMCP tool registry (`navigator.modelContext` / `window.modelContext`). Exposes 12 structured AI tools to browser agents. |
| **DEEN Assistant Core** | [`deen-assistant.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/deen-assistant.js) | Global / Shared / Extension UI | Zero-cost deterministic query engine, Banglish/Bengali customer note & message analyzer, BYOK (Gemini, OpenAI, Groq) client, and conversation store. |
| **Floating Assistant Chatbox** | [`deen-floating-chat.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/deen-floating-chat.js) | Content Script (WordPress, Pathao, WhatsApp Web) | In-page collapsible floating Copilot window with draggable circular brand launcher, coordinate persistence, contextual telemetry banner, dynamic prompt chips, 1-click WhatsApp message injector, zero-cost + BYOK completions. |
| **WooCommerce Integration** | [`woocommerce.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/woocommerce.js) | Content Script (`*://*/wp-admin/*`) | WooCommerce table parsing, order details extraction, 2x Retina Order Receipt canvas rendering, Pathao popup address auto-normalizer, same-origin Pathao settings probe (`get_wc_pathao_credentials`). |
| **Universal Phone Check** | [`phone-check.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/phone-check.js) | Content Script (`*://*/*`) | Highlight & copy phone detector across WhatsApp Web, Facebook, CRMs; WhatsApp Web active chat header auto-detection & inline rating badge; interactive floating action pill & sidebar drawer. |
| **Pathao Content Script & NDR Rescue** | [`content.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/content.js), [`courier-adapters.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/courier-adapters.js) | Content Script (`merchant.pathao.com`) | In-page floating toolbar, parcel table extractor, 1-click Excel/CSV exporter, form autofill listener, and automated Non-Delivery Report (NDR) rescue detector with WhatsApp quick rescue triggers. |
| **Background Worker** | [`background.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/background.js) | Service Worker (MV3) | Pathao Hermes OAuth & B2B login, WooCommerce Pathao plugin bridge, Steadfast courier check, 10-minute multi-tier cache, tab synchronization, WordPress SSO session sync. |
| **Extension Popup** | [`popup.html`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/popup.html), [`popup.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/popup.js) | Extension Window | 5-tab modular UI (`📦 Deliveries`, `🛡️ Courier Check`, `🌐 Store Connect`, `💬 WhatsApp`, `🤖 AI Tools`), WordPress profile card, Pathao sync, and WebMCP Live Tool Runner. |

---

## 2. Non-Negotiable Coding Invariants (CRITICAL)

When refactoring or adding features, you **MUST NEVER VIOLATE** these invariants:

### Invariant 1: Preserve All Module Exports
Automated test suites (`test_whatsapp_quick_reply.js`, `test_autofill_flow.js`, etc.) import functions directly from `woocommerce.js`, `phone-check.js`, `parser.js`, and `background.js`.
- Always preserve `module.exports` in `woocommerce.js`:
  - `extractRowOrderDetails`, `extractOrderDetailsFromModal`, `renderOrderReceiptCanvas`, `copyCanvasScreenshotToClipboard`, `downloadCanvasScreenshot`, `showOrderConfirmModal`, `injectOrderPreviewModalActions`, `getSelectedOrderRows`, `syncToPathao`, `initBulkDispatchBar`, `updateBulkDispatchBar`, `normalizeBDPhone`, `injectTableActionButtons`, `injectSingleOrderPageButton`, `injectWhatsAppMessage`, `getQuickReplyConfig`, `DEFAULT_QUICK_REPLY_CONFIG`, `normalizeCustomerAndOrderData`, `parseWooCommerceAddressBlock`, `isInvalidCustomerName`, `extractItemNameWithSize`, `bengaliToAsciiDigits`, `parseOrderEditPageHTML`, `fetchOrderDetailsViaEditPage`, `orderDetailsCache`, `inFlightOrderRequests`, `fetchWithTimeout`, `DEEN_LOGO_BASE64`, `getWooCommerceAjaxConfig`, `parseWooCommerceAjaxOrderDetails`, `normalizeAddressForPathao`, `buildFullAddress`, `normalizeDisplayAddress`, `initPathaoPluginAddressNormalizer`, `fetchCustomerRatingBackground`, `renderRatingState`, `BD_ISO_DISTRICTS`, `detectDistrictFromISOCode`, `getISOCodeFromDistrict`, `extractCredentialsFromDOM`.
- Always preserve `module.exports` in `phone-check.js`:
  - `normalizeBDPhone`, `escapeHTML`, `DEFAULT_QUICK_REPLY_CONFIG`, `calculateDeliveryFee`, `buildWhatsAppDeepLink`, `generateQuickReply`, `getQuickReplyConfig`, `injectWhatsAppMessage`, `extractWhatsAppActivePhone`, `renderWhatsAppHeaderBadge`, `initWhatsAppActiveChatDetector`.
- Always preserve `module.exports` in `background.js`:
  - `handleCustomerRatingRequest`, `handleOnlineAddressGuess`, `parseNominatimAddressResult`, `onlineAddressCache`, `extractCredentialsFromWordPressHTML`, `authenticateWordPressUser`, `syncFromWordPressAdmin`, `getWordPressConnectionStatus`, `disconnectWordPressSession`, `saveWordPressExtractedCredentials`, `issuePathaoTokenFromCredentials`, `loadRuntimeEnv`, `getPathaoToken`, `fetchPathaoTokenFromWooCommercePlugin`.

### Invariant 2: Debounced MutationObservers
All MutationObservers in `woocommerce.js` and `phone-check.js` **must be debounced (minimum 200ms)** using a `debounceTimer` to prevent UI thrashing and high CPU usage during dynamic WordPress AJAX updates.

### Invariant 3: Single Order Dispatch Flag
In `woocommerce.js`, single-order dispatch calls to `syncToPathao` must always include `{ autoSwitch: true, userTriggered: true }` so that the service worker navigates directly to `/courier/orders/create` and switches tabs.

### Invariant 4: No Unfiltered Cookie Scraping
`background.js` must **never** call `chrome.cookies.getAll({}, ...)` across all domains. Cookies are accessed strictly for `pathao.com` and the verified store domain (e.g. `deencommerce.com`) for active session authentication.

### Invariant 5: Zero Bengali Text Corruption
- Never corrupt Bengali names like Benapole (`বেনাপোল`) into `Benaডাকঘর`. Word-boundary replacements must be strictly label-aware.
- Bengali numeral conversion (`০-৯` to `0-9`) must be used for prices, order IDs, and quantities, but must never modify Bengali customer names.

### Invariant 6: Order Receipt Canvas Visual Rules
The 2x Retina Order Receipt canvas rendered by `renderOrderReceiptCanvas`:
- Must use a pure **White Background (`#ffffff`)** with brand **DEEN Orange (`#ea580c`)** headers.
- Must render the authentic brand logo byte-for-byte from [`icons/deen_logo.jpg`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/icons/deen_logo.jpg) via `DEEN_LOGO_BASE64`.
- Must never display `-` or `0` for valid products, quantities, unit prices, or delivery charges.
- Must preserve product titles with sizes (e.g. `Tom Tailor Jeans - Regular Fit - 36 (Size: 36)`).

### Invariant 7: Delivery Fee, Free Shipping Threshold & Outside Dhaka Detection
- Inside Dhaka standard delivery: **৳50**
- Outside Dhaka standard delivery: **৳90**
- **Free Shipping Threshold Policy**: Free Shipping applies **ONLY when product cost / subtotal is more than ৳2,500** (`subtotal >= 2500` or `subtotal > 2500`).
  - **Orders ≥ ৳2500**: Legitimate Free Shipping orders (e.g. 0 shipping in WooCommerce, shipping method `Free shipping`, coupon `free_shipping`, or notes `ফ্রি ডেলিভারি`) preserve **৳0 delivery fee** (`COD = Subtotal`, canvas draws `Delivery: Free (৳0)`).
  - **Orders < ৳2500**: Disqualified from automatic free shipping even if WooCommerce had 0 shipping or selected free delivery. Standard delivery fee is automatically added to COD (**+৳50 inside Dhaka**, **+৳90 outside Dhaka**) so the merchant is never underpaid.
  - **Manual Merchant Override**: The 1-click `🎁 Free Delivery` toggle in the order confirmation modal (`forceFreeShipping: true`) is always honored regardless of subtotal.
- **0 Shipping / COD Equal to Subtotal Addition**: When an order arrives where WooCommerce added 0 shipping (`codNum === subNum`, e.g. Subtotal ৳1494 and COD ৳1494), the system automatically adds the delivery fee:
  - Inside Dhaka: `Subtotal + ৳50` (e.g. `1494 + 50 = ৳1544` as in Order #19046).
  - Outside Dhaka: `Subtotal + ৳90` (e.g. `1500 + 90 = ৳1590`).
- **False-Dhaka 50 TK Correction**: When a customer outside Dhaka falsely selected inside-Dhaka delivery (paying only ৳50), the system corrects COD to `Subtotal + ৳90` (e.g. `1500 + 90 = 1590`) so the merchant is never underpaid.

### Invariant 8: 100% 64 Districts Coverage, Reverse Zone Inference & Online Geocoding Fallback
- `OTHER_CITY_ZONES` in [`parser.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/parser.js) must cover 100% of all 64 Bangladesh districts and their ~495 upazilas with English and Bengali aliases.
- When an incomplete address mentions a thana/upazila without the district name (e.g. `Titas`), the parser must infer the parent district (`Cumilla`) via reverse zone index and never fall back to Dhaka.
- Intelligent Online Geocoding via `guess_address_online` in [`background.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/background.js) queries OpenStreetMap Nominatim with `ISO3166-2-lvl5` code mapping as a fast, free fallback for obscure bazars or villages.

### Invariant 9: WordPress SSO & Role/Permissions Isolation
- When authenticated with WordPress (via Active Session Cookie or `wp-login.php`):
  - Store Display Name (`wp_connected_user`), Login Username (`wp_connected_login`), Role (`wp_user_role`), and Permission string (`wp_user_permissions`) in `chrome.storage.local`.
  - Roles must be reliably categorized into `Administrator` (with capabilities `manage_options, manage_woocommerce`) and `Shop Manager` (with `manage_woocommerce`).
  - The popup UI must display an **Authenticated Account Profile Card** with avatar, role badge, site domain, permission description, and quick `🔄 Re-sync` and `Disconnect` buttons.

### Invariant 10: WooCommerce Pathao Plugin Bridge & B2B External Login
- When checking customer delivery ratings from Pathao:
  - If direct Pathao credentials (`.env`, `env.js`, or storage) are **missing**, the extension must automatically bridge to the **Pathao Courier WooCommerce Plugin**:
    1. Query open WooCommerce tabs (`*://*/wp-admin/*`) via message `{ action: "get_wc_pathao_credentials" }`.
    2. Fallback to headless session probe via `syncFromWordPressAdmin()`.
    3. Issue access tokens using Pathao's **B2B External Login** (`/aladdin/api/v1/external/login`) with `client_id` + `client_secret` (standard for WooCommerce Pathao plugins).
    4. Query customer rating and return data with `source: "PATHAO"`.

### Invariant 11: PowerShell Execution Safety for AI Agents
- On Windows systems, **never execute complex inline Node.js scripts via `node -e "..."` in PowerShell**. PowerShell strips quotation marks and intercepts characters like `$`, `[`, `]`, and backticks.
- Always create a temporary `.js` helper file, execute it using `node script.js`, and clean it up immediately afterwards.

---

## 3. Automated Verification & Test Suites

Before committing or pushing any change, **all 16 test suites must pass 100%**:

```powershell
# Run complete test suite:
node run_all_suites.js

# Or run individual suites:
node test_parser.js; `
node test_autofill_flow.js; `
node test_popup_pathao_check.js; `
node test_live_pathao_rating_parsing.js; `
node test_universal_phone_e2e.js; `
node test_whatsapp_quick_reply.js; `
node test_webmcp_integration.js; `
node test_full_fetch_improvements.js; `
node test_wordpress_login_sync.js; `
node test_icons_verification.js; `
node test_deen_assistant.js; `
node test_whatsapp_active_chat.js; `
node test_floating_chat.js; `
node test_ndr_rescue_listener.js; `
node test_cache_eviction.js; `
node test_local_rating_cache_reuse.js
```

### Test Suite Directory:
1. [`test_parser.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/test_parser.js) — Standard & fuzzy sequential token parsing, KPI computation, 20 address edge cases, 100% 64 districts coverage, and batch CSV export.
2. [`test_autofill_flow.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/test_autofill_flow.js) — Manifest schema, phone normalization, script loading, Pathao tables, exchange orders (`D-`), WooCommerce row extraction, and bulk queue advancement.
3. [`test_popup_pathao_check.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/test_popup_pathao_check.js) — Background messaging, timeout fallbacks, popup UI sync.
4. [`test_live_pathao_rating_parsing.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/test_live_pathao_rating_parsing.js) — Real Hermes API responses, multi-courier composite aggregation, token handling.
5. [`test_universal_phone_e2e.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/test_universal_phone_e2e.js) — Universal phone detection, DOM highlight/copy triggers, sidebar drawer, floating pill.
6. [`test_whatsapp_quick_reply.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/test_whatsapp_quick_reply.js) — Comprehensive 30-test suite for Order Receipt canvas, line items, AJAX fallbacks, real orders #17819, #18264, #18276, #18304, address deduplication & normalization (#19029), Pathao address normalizer, Smart Guess online geocoding, ISO district detection, and 10-minute caching.
7. [`test_webmcp_integration.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/test_webmcp_integration.js) — WebMCP registry conformance, tool discovery, execution of all 12 tools, semantic hints (`readOnlyHint`, `consequentialHint`), and argument schema validation.
8. [`test_full_fetch_improvements.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/test_full_fetch_improvements.js) — Shipping priority over billing, address 2 preservation, customer notes extraction across AJAX, edit page, modal, and table row, concurrent fetch deduplication (`inFlightOrderRequests`), timeout protection, and free shipping advance charge omission.
9. [`test_wordpress_login_sync.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/test_wordpress_login_sync.js) — WordPress Admin auto-connect, active session sync, wp-login credentials authentication, PTC & Pathao plugin settings HTML extraction, Steadfast keys, inlined JSON configs, role & permissions verification, B2B external login, and WooCommerce Pathao plugin bridge fallback.
10. [`test_icons_verification.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/test_icons_verification.js) — Validates manifest icon declarations, presence and integrity of PNG/JPEG/SVG icon assets across 16px, 32px, 48px, and 128px resolutions.
11. [`test_deen_assistant.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/test_deen_assistant.js) — In-memory deterministic analytical queries (parcels count, COD, revenue, delivery fee totals, district breakdowns, Bengali greetings), Banglish/Bengali customer note & message interpreter, and BYOK client interfaces.
12. [`test_whatsapp_active_chat.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/test_whatsapp_active_chat.js) — WhatsApp Web conversation header phone extraction from title and custom status, header rating badge injection, colored risk pills (High/Medium/Low/New), 1-click quick replies, and debounced MutationObserver listeners.
13. [`test_floating_chat.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/test_floating_chat.js) — In-page floating AI Assistant Copilot chatbox validation across WordPress Admin, Pathao Merchant Portal, and WhatsApp Web (platform detection, context extractors, markdown rendering, clean WhatsApp message injection, and public visibility toggle API).
14. [`test_ndr_rescue_listener.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/test_ndr_rescue_listener.js) — Pathao NDR failed delivery attempt detector, Bengali retry/return keyword filters, delivered parcel exclusion, alert storage, table row decoration, and 1-click WhatsApp rescue modal.
15. [`test_cache_eviction.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/test_cache_eviction.js) — Cache capacity limit (500 entries) FIFO eviction, 10-minute rating TTL, 24-hour address TTL, and periodic sweeper (`pruneExpiredCaches`).
16. [`test_local_rating_cache_reuse.js`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/test_local_rating_cache_reuse.js) — Unified local rating cache, zero-network instant reuse across background and in-page contexts, and force-refresh cache bypass.

---

## 4. WebMCP Agent Development Quickstart

To interact with WebMCP tools programmatically from an agent:

```javascript
// 1. Get registry reference
const registry = navigator.modelContext || window.modelContext;

// 2. Discover available tools
const tools = await registry.getTools();

// 3. Call courier check
const rating = await registry.executeTool("check_customer_courier_rating", {
  phone: "01715485035"
});

// 4. Call address normalizer
const address = await registry.executeTool("normalize_bd_address", {
  rawAddress: "Home Benapole city,thana sharsha,jela jashore"
});
```

See [`WEBMCP.md`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/WEBMCP.md) for full JSON Schemas and API documentation.
