# 🤖 Agentic Development Manual & Codebase Invariants (AGENTS.md)

Welcome, AI Agent! This document provides the authoritative operational manual, system architecture, and non-negotiable coding invariants for developing, testing, and maintaining the **DEEN Delivery Parser** Chrome Extension.

---

## 1. System Architecture & Component Roles

The codebase adheres strictly to **Google Chrome Manifest V3**:

| Component | File | Execution Context | Key Responsibilities |
| :--- | :--- | :--- | :--- |
| **Parser Core** | [`parser.js`](file:///d:/Repo/chrome-extension-delivery-parser/parser.js) | Global / Shared | Centralized parsing engine, regex anchors, BD address normalizer, ISO district detection, delivery fee calculations, WhatsApp message generator. |
| **WebMCP Provider** | [`webmcp-provider.js`](file:///d:/Repo/chrome-extension-delivery-parser/webmcp-provider.js) | Content Script / Page | W3C WebMCP tool registry (`navigator.modelContext` / `window.modelContext`). Exposes 7 structured AI tools to browser agents. |
| **WooCommerce Integration** | [`woocommerce.js`](file:///d:/Repo/chrome-extension-delivery-parser/woocommerce.js) | Content Script (`*://*/wp-admin/*`) | WooCommerce table parsing, order details extraction, 2x Retina Order Receipt canvas rendering, Pathao popup address auto-normalizer. |
| **Universal Phone Check** | [`phone-check.js`](file:///d:/Repo/chrome-extension-delivery-parser/phone-check.js) | Content Script (`*://*/*`) | Highlight & copy phone detector across WhatsApp Web, Facebook, CRMs; interactive floating action pill & sidebar drawer. |
| **Pathao Content Script** | [`content.js`](file:///d:/Repo/chrome-extension-delivery-parser/content.js) | Content Script (`merchant.pathao.com`) | In-page floating toolbar, parcel table extractor, 1-click Excel/CSV exporter, form autofill listener. |
| **Background Worker** | [`background.js`](file:///d:/Repo/chrome-extension-delivery-parser/background.js) | Service Worker (MV3) | Pathao Hermes OAuth & API queries, Steadfast courier check, 10-minute multi-tier cache, tab synchronization, context menus. |
| **Extension Popup** | [`popup.html`](file:///d:/Repo/chrome-extension-delivery-parser/popup.html), [`popup.js`](file:///d:/Repo/chrome-extension-delivery-parser/popup.js) | Extension Window | Tab extractor, paste & parse, Pathao quick phone check, WhatsApp settings & preview, WebMCP Live Tool Runner. |

---

## 2. Non-Negotiable Coding Invariants (CRITICAL)

When refactoring or adding features, you **MUST NEVER VIOLATE** these invariants:

### Invariant 1: Preserve All Module Exports
Automated test suites (`test_whatsapp_quick_reply.js`, `test_autofill_flow.js`, etc.) import functions directly from `woocommerce.js`, `phone-check.js`, and `parser.js`.
- Always preserve `module.exports` in `woocommerce.js`:
  - `extractRowOrderDetails`, `extractOrderDetailsFromModal`, `renderOrderReceiptCanvas`, `copyCanvasScreenshotToClipboard`, `downloadCanvasScreenshot`, `showOrderConfirmModal`, `injectOrderPreviewModalActions`, `getSelectedOrderRows`, `syncToPathao`, `initBulkDispatchBar`, `updateBulkDispatchBar`, `normalizeBDPhone`, `injectTableActionButtons`, `injectSingleOrderPageButton`, `injectWhatsAppMessage`, `getQuickReplyConfig`, `DEFAULT_QUICK_REPLY_CONFIG`, `normalizeCustomerAndOrderData`, `parseWooCommerceAddressBlock`, `isInvalidCustomerName`, `extractItemNameWithSize`, `bengaliToAsciiDigits`, `parseOrderEditPageHTML`, `fetchOrderDetailsViaEditPage`, `orderDetailsCache`, `DEEN_LOGO_BASE64`, `getWooCommerceAjaxConfig`, `parseWooCommerceAjaxOrderDetails`, `normalizeAddressForPathao`, `buildFullAddress`, `normalizeDisplayAddress`, `initPathaoPluginAddressNormalizer`, `fetchCustomerRatingBackground`, `renderRatingState`, `BD_ISO_DISTRICTS`, `detectDistrictFromISOCode`, `getISOCodeFromDistrict`.
- Always preserve `module.exports` in `phone-check.js`:
  - `normalizeBDPhone`, `escapeHTML`, `DEFAULT_QUICK_REPLY_CONFIG`, `calculateDeliveryFee`, `buildWhatsAppDeepLink`, `generateQuickReply`, `getQuickReplyConfig`, `injectWhatsAppMessage`.

### Invariant 2: Debounced MutationObservers
All MutationObservers in `woocommerce.js` and `phone-check.js` **must be debounced (minimum 200ms)** using a `debounceTimer` to prevent UI thrashing and high CPU usage during dynamic WordPress AJAX updates.

### Invariant 3: Single Order Dispatch Flag
In `woocommerce.js`, single-order dispatch calls to `syncToPathao` must always include `{ autoSwitch: true, userTriggered: true }` so that the service worker navigates directly to `/courier/orders/create` and switches tabs.

### Invariant 4: No Unfiltered Cookie Scraping
`background.js` must **never** call `chrome.cookies.getAll({}, ...)` across all domains. Cookies are accessed strictly for `pathao.com` authentication tokens.

### Invariant 5: Zero Bengali Text Corruption
- Never corrupt Bengali names like Benapole (`বেনাপোল`) into `Benaডাকঘর`. Word-boundary replacements must be strictly label-aware.
- Bengali numeral conversion (`০-৯` to `0-9`) must be used for prices, order IDs, and quantities, but must never modify Bengali customer names.

### Invariant 6: Order Receipt Canvas Visual Rules
The 2x Retina Order Receipt canvas rendered by `renderOrderReceiptCanvas`:
- Must use a pure **White Background (`#ffffff`)** with brand **DEEN Orange (`#ea580c`)** headers.
- Must render the authentic brand logo byte-for-byte from [`icons/deen_logo.jpg`](file:///d:/Repo/chrome-extension-delivery-parser/icons/deen_logo.jpg) via `DEEN_LOGO_BASE64`.
- Must never display `-` or `0` for valid products, quantities, unit prices, or delivery charges.
- Must preserve product titles with sizes (e.g. `Tom Tailor Jeans - Regular Fit - 36 (Size: 36)`).

### Invariant 7: Delivery Fee & Outside Dhaka Detection
- Inside Dhaka standard delivery: **৳50**
- Outside Dhaka standard delivery: **৳90**
- **False-Dhaka 50 TK Correction**: When a customer outside Dhaka falsely selected inside-Dhaka delivery (paying only ৳50), the system corrects COD to `Subtotal + ৳90` (e.g. `1500 + 90 = 1590`) so the merchant is never underpaid.

### Invariant 8: 100% 64 Districts Coverage, Reverse Zone Inference & Online Geocoding Fallback
- `OTHER_CITY_ZONES` in [`parser.js`](file:///d:/Repo/chrome-extension-delivery-parser/parser.js) must cover 100% of all 64 Bangladesh districts and their ~495 upazilas with English and Bengali aliases.
- When an incomplete address mentions a thana/upazila without the district name (e.g. `Titas`), the parser must infer the parent district (`Cumilla`) via reverse zone index and never fall back to Dhaka.
- Intelligent Online Geocoding via `guess_address_online` in [`background.js`](file:///d:/Repo/chrome-extension-delivery-parser/background.js) queries OpenStreetMap Nominatim with `ISO3166-2-lvl5` code mapping as a fast, free fallback for obscure bazars or villages.

---

## 3. Automated Verification & Test Suites

Before committing or pushing any change, **all 7 test suites must pass 100%**:

```powershell
# Run all test suites
node test_parser.js; `
node test_autofill_flow.js; `
node test_popup_pathao_check.js; `
node test_live_pathao_rating_parsing.js; `
node test_universal_phone_e2e.js; `
node test_whatsapp_quick_reply.js; `
node test_webmcp_integration.js
```

### Test Suite Directory:
1. [`test_parser.js`](file:///d:/Repo/chrome-extension-delivery-parser/test_parser.js) — Standard & fuzzy sequential token parsing, KPI computation, 20 address edge cases, 100% 64 districts coverage, and batch CSV export.
2. [`test_autofill_flow.js`](file:///d:/Repo/chrome-extension-delivery-parser/test_autofill_flow.js) — Manifest schema, phone normalization, script loading, Pathao tables, exchange orders (`D-`), WooCommerce row extraction, and bulk queue advancement.
3. [`test_popup_pathao_check.js`](file:///d:/Repo/chrome-extension-delivery-parser/test_popup_pathao_check.js) — Background messaging, timeout fallbacks, popup UI sync.
4. [`test_live_pathao_rating_parsing.js`](file:///d:/Repo/chrome-extension-delivery-parser/test_live_pathao_rating_parsing.js) — Real Hermes API responses, multi-courier composite aggregation, token handling.
5. [`test_universal_phone_e2e.js`](file:///d:/Repo/chrome-extension-delivery-parser/test_universal_phone_e2e.js) — Universal phone detection, DOM highlight/copy triggers, sidebar drawer, floating pill.
6. [`test_whatsapp_quick_reply.js`](file:///d:/Repo/chrome-extension-delivery-parser/test_whatsapp_quick_reply.js) — Comprehensive 28-test suite for Order Receipt canvas, line items, AJAX fallbacks, real orders #17819, #18264, #18276, #18304, address deduplication & normalization (#19029), Pathao address normalizer, Smart Guess online geocoding, ISO district detection, and 10-minute caching.
7. [`test_webmcp_integration.js`](file:///d:/Repo/chrome-extension-delivery-parser/test_webmcp_integration.js) — WebMCP registry conformance, tool discovery, execution of all 7 tools, semantic hints (`readOnlyHint`, `consequentialHint`), and argument schema validation.

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

See [`WEBMCP.md`](file:///d:/Repo/chrome-extension-delivery-parser/WEBMCP.md) for full JSON Schemas and API documentation.
