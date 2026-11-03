# 🛠️ Technical Requirements Document (TRD)

## DEEN Delivery Parser — Autonomous Courier Logistics & Dispatch Engine

**Document Version:** 1.2.1  
**Architecture Standard:** Google Chrome Extensions Manifest V3  
**Runtime:** Pure Vanilla ECMAScript 2022+ (Zero external npm production dependencies)

---

## 1. System Topology & Execution Contexts

```
+-----------------------------------------------------------------------------------+
|                            Google Chrome Manifest V3                              |
+-----------------------------------------------------------------------------------+
                                          |
        +---------------------------------+---------------------------------+
        |                                 |                                 |
+-------v-------+                 +-------v-------+                 +-------v-------+
| Background    |                 | Content       |                 | Popup & UI    |
| Service Worker|                 | Scripts       |                 | Panes         |
| background.js |                 | (Page DOM)    |                 | popup.html/js |
+---------------+                 +---------------+                 +---------------+
  | Hermes OAuth                    | woocommerce.js (wp-admin)       | 5-Tab Modular
  | Steadfast Check                 | content.js (merchant.pathao)    | Profile Card
  | WordPress SSO                   | phone-check.js (*://*/*)        | Live Tool Run
  | 24h Multi-Cache                 | deen-floating-chat.js           | WhatsApp Hub
  | MV3 Keepalive                   | webmcp-provider.js              | AI Settings
```

### 1.1 Component Execution Boundaries

| Component | Target File | Execution Sandbox | Permissions Required |
| :--- | :--- | :--- | :--- |
| **Service Worker** | `background.js` | ServiceWorkerGlobalScope | `storage`, `cookies`, `notifications`, `contextMenus`, `tabs` |
| **WooCommerce Bridge** | `woocommerce.js` | Isolated Content Script (`*://*/wp-admin/*`) | DOM access, runtime messaging |
| **Pathao Portal Script** | `content.js` | Isolated Content Script (`merchant.pathao.com`) | DOM access, table manipulation |
| **Universal Phone Detector** | `phone-check.js` | Isolated Content Script (`*://*/*`) | Clipboard, selection, MutationObserver |
| **Floating Assistant** | `deen-floating-chat.js` | Content Script (WordPress, Pathao, WA) | In-page draggable container |
| **WebMCP Provider** | `webmcp-provider.js` | Content Script & Injected Page World | `window.modelContext` |
| **Extension Popup** | `popup.js`, `popup.html`| Extension Action Window | Full extension privileges |

---

## 2. API Specifications & Courier Protocol Specifications

### 2.1 Pathao Hermes B2B External Login
Used when credentials originate from the WooCommerce Pathao Courier plugin or developer portal:
- **Endpoint:** `POST https://api-hermes.pathao.com/aladdin/api/v1/external/login`
- **Headers:** `Content-Type: application/json`, `Accept: application/json`
- **Request Payload:**
  ```json
  {
    "client_id": "STRING_CLIENT_ID",
    "client_secret": "STRING_CLIENT_SECRET"
  }
  ```
- **Response Handling:**
  ```json
  {
    "token_type": "Bearer",
    "expires_in": 7776000,
    "access_token": "eyJhbGciOiJSUzI1NiIsIn...",
    "refresh_token": "def50200..."
  }
  ```
- **Fallback Protocol:** If external login returns non-200, system automatically falls back to the password grant endpoint `/aladdin/api/v1/issue-token` with `grant_type: "password"`, `username`, and `password`.

### 2.2 Pathao Customer Rating API
- **Endpoint:** `POST https://api-hermes.pathao.com/aladdin/api/v1/user/success`
- **Secondary Endpoint:** `POST https://merchant.pathao.com/api/v1/user/success`
- **Headers:** `Authorization: Bearer <TOKEN>`, `Content-Type: application/json`
- **Timeout Policy:** 7,000 ms with `AbortController` (resilient against Bangladesh mobile network jitter).
- **Request Payload:** `{ "phone": "01715485035" }`
- **Response Normalization:** Parses `customer_rating` (`excellent_customer`, `good_customer`, `high_risk`) and aggregates delivery totals: `total = total_delivery`, `delivered = successful_delivery`, `cancelled = failed_delivery`.

### 2.3 Steadfast Courier Fraud Intelligence API
- **Endpoint:** `GET https://steadfast.com.bd/user/frauds/check/:cleanPhone`
- **Headers:** `Accept: application/json, text/plain, */*`
- **Timeout Policy:** 3,500 ms with `AbortController`.
- **Response Parsing:** Extracts `total_delivered` and `total_cancelled` and builds the composite multi-courier risk ratio.

---

## 3. Caching Architecture & Memory Eviction

```
[Query Phone: "01715485035"]
           |
           v
+-----------------------+   Hit (< 24h)
| Page localPageRating- | --------------> [Return 0ms Synchronous]
| Cache (phone-check.js)|
+-----------------------+
           | Miss
           v
+-----------------------+   Hit (< 24h)
| Background Memory Map | --------------> [Return 1ms Cached Response]
| customerRatingMemory- |
| Cache (background.js) |
+-----------------------+
           | Miss
           v
+-----------------------+   Hit (< 24h)
| chrome.storage.local  | --------------> [Promote to Memory & Return]
| customer_rating_cache |
+-----------------------+
           | Miss
           v
+-----------------------+
| Network Fetch: Pathao | --------------> [Save to Storage, Memory & Page]
| Hermes API + Steadfast|
+-----------------------+
```

### 3.1 Cache Eviction Invariants
1. **TTL Duration:** `RATING_CACHE_TTL_MS = 24 * 60 * 60 * 1000` (24 hours).
2. **Online Geocoding Cache:** `ONLINE_ADDRESS_CACHE_TTL_MS = 24 * 60 * 60 * 1000` (24 hours).
3. **Capacity Constraints:** `MAX_RATING_CACHE_ENTRIES = 500`, `MAX_ONLINE_ADDRESS_CACHE_ENTRIES = 500`.
4. **Eviction Algorithm:** FIFO (First-In, First-Out) via `map.keys().next().value` pruning when `size >= 500`.
5. **Periodic Sweeper:** Unreferenced interval (`timer.unref()`) runs `pruneExpiredCaches()` every 15 minutes to delete stale entries without keeping Node.js test workers alive.

---

## 4. React 18 Reconciliation Safeguard on WhatsApp Web

### 4.1 Root Cause of `insertBefore` NotFoundError
WhatsApp Web (`web.whatsapp.com`) uses React 18 with concurrent rendering. When an extension injects or removes DOM elements inside React-managed containers (such as `<header>`):
1. Extension executes `existingBadge.remove()` to replace a badge.
2. React's `commitPlacement` / `insertInContainerBefore` concurrently references `existingBadge` as the `nextSibling`.
3. Calling `header.insertBefore(newNode, detachedNode)` causes the browser DOM engine to throw:
   `NotFoundError: Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.`

### 4.2 Solution Implementation
1. **DOM Node Reuse Pattern:** In `renderWhatsAppHeaderBadge()`, never remove `existingBadge`. Instead, query `#deen-wa-header-rating-badge`, update attributes (`data-phone`), and mutate `innerHTML` in-place.
2. **Defensive Monkey-Patch Shield:**
   ```javascript
   if (typeof window !== "undefined" && typeof Node !== "undefined" && Node.prototype && !window.__deenInsertBeforeProtected) {
     window.__deenInsertBeforeProtected = true;
     const _origInsertBefore = Node.prototype.insertBefore;
     Node.prototype.insertBefore = function (newNode, refNode) {
       if (refNode && refNode.parentNode !== this) {
         return this.appendChild(newNode);
       }
       return _origInsertBefore.apply(this, arguments);
     };
     const _origRemoveChild = Node.prototype.removeChild;
     Node.prototype.removeChild = function (child) {
       if (child && child.parentNode !== this) return child;
       return _origRemoveChild.apply(this, arguments);
     };
   }
   ```

---

## 5. Non-Negotiable Coding Invariants & Module Exports

All automated test suites import functions directly via CommonJS `require()`. You **MUST NEVER REMOVE** these symbols from `module.exports`:

### `woocommerce.js`
- `extractRowOrderDetails`, `extractOrderDetailsFromModal`, `renderOrderReceiptCanvas`, `copyCanvasScreenshotToClipboard`, `downloadCanvasScreenshot`, `showOrderConfirmModal`, `injectOrderPreviewModalActions`, `getSelectedOrderRows`, `syncToPathao`, `initBulkDispatchBar`, `updateBulkDispatchBar`, `normalizeBDPhone`, `injectTableActionButtons`, `injectSingleOrderPageButton`, `injectWhatsAppMessage`, `getQuickReplyConfig`, `DEFAULT_QUICK_REPLY_CONFIG`, `normalizeCustomerAndOrderData`, `parseWooCommerceAddressBlock`, `isInvalidCustomerName`, `extractItemNameWithSize`, `bengaliToAsciiDigits`, `parseOrderEditPageHTML`, `fetchOrderDetailsViaEditPage`, `orderDetailsCache`, `inFlightOrderRequests`, `fetchWithTimeout`, `DEEN_LOGO_BASE64`, `getWooCommerceAjaxConfig`, `parseWooCommerceAjaxOrderDetails`, `normalizeAddressForPathao`, `buildFullAddress`, `normalizeDisplayAddress`, `initPathaoPluginAddressNormalizer`, `fetchCustomerRatingBackground`, `renderRatingState`, `injectCustomerRatingColumn`, `getLocalRatingCache`, `setLocalRatingCache`, `clearLocalRatingCache`, `renderRatingCellUI`, `renderOrderRatingCell`, `triggerOrderConfirmModalForRow`, `RATING_CACHE_KEY`, `RATING_CACHE_TTL`, `ORDER_PHONE_CACHE_KEY`, `getOrderPhoneCache`, `setOrderPhoneCache`, `clearOrderPhoneCache`, `renderRatingCellForPhone`, `enqueueRatingTask`, `BD_ISO_DISTRICTS`, `detectDistrictFromISOCode`, `getISOCodeFromDistrict`.

### `phone-check.js`
- `normalizeBDPhone`, `escapeHTML`, `DEFAULT_QUICK_REPLY_CONFIG`, `calculateDeliveryFee`, `buildWhatsAppDeepLink`, `generateQuickReply`, `getQuickReplyConfig`, `injectWhatsAppMessage`, `extractWhatsAppActivePhone`, `renderWhatsAppHeaderBadge`, `initWhatsAppActiveChatDetector`, `getLocalCachedRating`, `setLocalCachedRating`, `localPageRatingCache`.

### `background.js`
- `handleCustomerRatingRequest`, `handleOnlineAddressGuess`, `parseNominatimAddressResult`, `onlineAddressCache`, `customerRatingMemoryCache`, `pruneExpiredCaches`, `RATING_CACHE_TTL_MS`, `ONLINE_ADDRESS_CACHE_TTL_MS`, `MAX_RATING_CACHE_ENTRIES`, `MAX_ONLINE_ADDRESS_CACHE_ENTRIES`, `extractCredentialsFromWordPressHTML`, `authenticateWordPressUser`, `syncFromWordPressAdmin`, `getWordPressConnectionStatus`, `disconnectWordPressSession`, `saveWordPressExtractedCredentials`, `issuePathaoTokenFromCredentials`, `loadRuntimeEnv`, `getPathaoToken`, `fetchPathaoTokenFromWooCommercePlugin`.
