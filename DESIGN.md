# 📐 System Design & Architecture Document (DESIGN.md)

## DEEN Delivery Parser — Autonomous Courier Logistics & Dispatch Engine

**Document Version:** 1.2.1  
**Architecture:** Event-Driven Chrome Extension Architecture (Manifest V3)

---

## 1. System Architecture Overview

```
+---------------------------------------------------------------------------------------+
|                                    Chrome Browser                                     |
|                                                                                       |
|   +-----------------------+   +------------------------+   +----------------------+   |
|   |  *://*/wp-admin/*     |   |  web.whatsapp.com      |   | merchant.pathao.com  |   |
|   |  (woocommerce.js)     |   |  (phone-check.js)      |   | (content.js)         |   |
|   |                       |   |                        |   |                      |   |
|   | - Table Order Details |   | - Active Chat Detection|   | - Floating Toolbar   |   |
|   | - 2x Retina Receipt   |   | - Header Rating Badge  |   | - Autofill Listener  |   |
|   | - Pathao Plugin Bridge|   | - Quick Reply Injector |   | - CSV/Excel Exporter |   |
|   | - NDR Row Decorator   |   | - Sidebar Customer Intel|  | - NDR Alert Scanner  |   |
|   +-----------+-----------+   +-----------+------------+   +----------+-----------+   |
|               |                           |                           |               |
|               +-------------------+       |       +-------------------+               |
|                                   |       |       |                                   |
|                                   v       v       v                                   |
|                       +---------------------------------------+                       |
|                       |  chrome.runtime.sendMessage / onMessage |                      |
|                       +-------------------+-------------------+                       |
|                                           |                                           |
|                                           v                                           |
|                       +---------------------------------------+                       |
|                       |   Background Service Worker           |                       |
|                       |   (background.js)                     |                       |
|                       |                                       |                       |
|                       | - Hermes B2B External Login           |                       |
|                       | - 24-Hour Tiered Local Cache          |                       |
|                       | - Steadfast Fraud Intelligence        |                       |
|                       | - WordPress SSO & Session Sync        |                       |
|                       | - Nominatim ISO3166 Geocoder          |                       |
|                       +-------------------+-------------------+                       |
|                                           |                                           |
+-------------------------------------------|-------------------------------------------+
                                            | HTTPS Fetch
        +-----------------------------------+-----------------------------------+
        |                                   |                                   |
+-------v-------+                   +-------v-------+                   +-------v-------+
| Pathao Hermes |                   | Steadfast BD  |                   | WordPress API |
| Aladdin APIs  |                   | Fraud Portal  |                   | & Woo Session |
+---------------+                   +---------------+                   +---------------+
```

---

## 2. Sequence Diagrams

### 2.1 Multi-Courier Customer Intelligence & 24h Local Cache Reuse

```mermaid
sequenceDiagram
    autonumber
    participant UI as WhatsApp Web / Woo Table
    participant PC as Content Script (phone-check.js)
    participant SW as Service Worker (background.js)
    participant DB as chrome.storage.local
    participant API as Pathao Hermes API

    UI->>PC: User opens chat / loads order row (Phone: 01715485035)
    PC->>PC: Check localPageRatingCache (In-Memory Map)
    alt Found in Page Cache (< 24h)
        PC-->>UI: ⚡ Return 0ms Instant Rating (No network, zero latency)
    else Page Cache Miss
        PC->>DB: Query customer_rating_cache
        alt Found in Persistent Storage (< 24h)
            DB-->>PC: Return Cached Customer Record
            PC->>PC: Save to localPageRatingCache
            PC-->>UI: ⚡ Return 1ms Cached Rating (Badge updated)
        else Storage Cache Miss
            PC->>SW: sendMessage({ action: "fetch_customer_rating", phone })
            SW->>SW: Check customerRatingMemoryCache
            alt Found in Background Memory (< 24h)
                SW-->>PC: Return cached response ({ cached: true })
            else Background Cache Miss
                SW->>API: POST /aladdin/api/v1/user/success (Bearer Token)
                API-->>SW: Return 200 OK (351 delivered, 4 cancelled, 99%)
                SW->>DB: Persist in customer_rating_cache (with timestamp)
                SW->>SW: Promote to customerRatingMemoryCache
                SW-->>PC: Return fresh rating payload
            end
            PC->>PC: Save to localPageRatingCache
            PC-->>UI: Render Rating Badge & Risk Level
        end
    end
```

### 2.2 WordPress SSO & WooCommerce Pathao Plugin Bridge

```mermaid
sequenceDiagram
    autonumber
    participant Pop as Extension Popup UI
    participant SW as Background Service Worker
    participant Tab as Open WooCommerce Tab
    participant Pk as Pathao Hermes OAuth

    Pop->>SW: sendMessage({ action: "sync_from_wordpress", siteUrl })
    SW->>Tab: Query tabs for "*://*/wp-admin/*"
    alt WooCommerce Tab Open
        SW->>Tab: sendMessage({ action: "get_wc_pathao_credentials" })
        Tab->>Tab: Probe /wp-admin/admin.php?page=pathao-courier
        Tab-->>SW: Return { clientId, clientSecret, storeId }
    else Headless Session Probe
        SW->>SW: Probe WordPress admin cookies (wordpress_logged_in_*)
        SW->>SW: Fetch /wp-admin/admin.php?page=pathao-courier
        SW->>SW: Extract credentials from HTML DOM
    end
    SW->>Pk: POST /aladdin/api/v1/external/login (client_id, client_secret)
    Pk-->>SW: Return 200 OK with Bearer access_token (expires in 90 days)
    SW->>SW: Save credentials & token in chrome.storage.local
    SW-->>Pop: Return Authenticated Profile Card (User, Role, Permissions)
```

---

## 3. Data Models & Schemas

### 3.1 Composite Customer Rating Object
```json
{
  "success": true,
  "phone": "01715485035",
  "ratingGrade": "Excellent Customer",
  "successRate": 99,
  "totalParcels": 355,
  "deliveredCount": 351,
  "cancelledCount": 4,
  "riskLevel": "low",
  "riskLabel": "Excellent Customer (99%)",
  "riskColor": "#10b981",
  "isNewCustomer": false,
  "cached": true,
  "cacheSource": "memory",
  "cachedAt": 1730591234567,
  "pathaoStats": {
    "total": 355,
    "delivered": 351,
    "cancelled": 4,
    "ratingGrade": "Excellent Customer"
  },
  "steadfastStats": {
    "total": 0,
    "delivered": 0,
    "cancelled": 0
  },
  "sources": {
    "pathao": { "checked": true, "ratingGrade": "Excellent Customer" },
    "steadfastNetwork": { "checked": false }
  }
}
```

### 3.2 Normalized Bangladesh Address Object
```json
{
  "original": "House 12, Road 4, Noyakandi Bazar, Titas,",
  "street": "House 12, Road 4, Noyakandi Bazar",
  "thana": "Titas",
  "zone": "Titas",
  "district": "Cumilla",
  "postcode": "",
  "isOutsideDhaka": true,
  "deliveryFee": 90,
  "fullAddress": "House 12, Road 4, Noyakandi Bazar, Titas, Cumilla"
}
```

---

## 4. Canvas 2D Rendering Engine Architecture

The 2x Retina Order Receipt canvas rendered by `renderOrderReceiptCanvas()`:
1. **High-DPI Coordinate Scaling:**
   - Canvas element CSS dimensions: $460\text{px} \times H\text{px}$.
   - Canvas bitmap dimensions: $(460 \times 2)\text{px} \times (H \times 2)\text{px}$.
   - Context scaling: `ctx.scale(2, 2)`.
2. **Visual Hierarchy:**
   - Background: Pure solid `#ffffff`.
   - Header Accent: Authentic DEEN Orange `#ea580c`.
   - Brand Logo: Rendered byte-for-byte from `DEEN_LOGO_BASE64` with aspect-ratio preservation.
   - Typography: Clean system fallback sans-serif stack (`system-ui, -apple-system, 'Segoe UI', Roboto`).
   - Line Items Table: Quantity, Title with Size, Unit Price, Line Total.
   - Barcode Simulation: Code 128 high-contrast vertical bars drawn directly via canvas rectangles based on Order ID characters.
3. **Clipboard Interoperability:**
   - Converted to PNG blob via `canvas.toBlob((blob) => ..., 'image/png')`.
   - Injected directly into the operating system clipboard using `navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])`.
