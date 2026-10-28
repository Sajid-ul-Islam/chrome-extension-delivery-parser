# 🏛️ Architecture & System Design (ARCHITECTURE.md)

This document details the high-level architecture, module interactions, data flows, and state management of the **DEEN Delivery Parser** Chrome Extension (Manifest V3).

---

## 1. High-Level Architecture Overview

```mermaid
flowchart TD
    subgraph UI Layer
        Popup["Popup Window (popup.html / popup.js)"]
        Sidebar["Universal Sidebar Drawer (phone-check.js)"]
        FloatingPill["Floating Action Pill (phone-check.js)"]
        PathaoPill["Pathao Toolbar (content.js)"]
        WCOrderModal["Order Confirmation Modal (woocommerce.js)"]
        WCRatingCard["In-Popup Rating Card (woocommerce.js)"]
    end

    subgraph Agentic / WebMCP Layer
        WebMCP["WebMCP Provider (webmcp-provider.js)"]
        ModelCtx["navigator.modelContext / window.modelContext"]
        Agent["Autonomous AI Agent (Nano / Claude / Gemini)"]
    end

    subgraph Business Logic & Parsing Engine
        ParserCore["Unified Parser Core (parser.js)"]
        AddressEngine["Smart BD Address & ISO Engine"]
        FeeEngine["Delivery Fee & False-Dhaka Correction"]
        CanvasEngine["2x Retina Order Receipt Canvas"]
        WAEngine["WhatsApp Quick Reply Generator"]
    end

    subgraph Chrome Extension Core
        ServiceWorker["Background Service Worker (background.js)"]
        Storage["chrome.storage.local (Persistent State)"]
        MemCache["In-Memory Map Cache (10-min TTL)"]
    end

    subgraph External Platforms & APIs
        WCDOM["WooCommerce Admin (deencommerce.com/wp-admin)"]
        PathaoDOM["Pathao Portal (merchant.pathao.com)"]
        HermesAPI["Pathao Hermes API (api-hermes.pathao.com)"]
        SteadfastAPI["Steadfast Fraud DB (steadfast.com.bd)"]
        WhatsAppAPI["WhatsApp Web / Deep Link (wa.me)"]
    end

    %% Agent Connections
    Agent <--> ModelCtx
    ModelCtx <--> WebMCP
    WebMCP --> ParserCore

    %% UI Connections
    WCDOM --> WCOrderModal & WCRatingCard
    PathaoDOM --> PathaoPill
    UniversalPages["Any Website (WhatsApp/FB/CRM)"] --> FloatingPill & Sidebar

    %% Logic Connections
    ParserCore --> AddressEngine & FeeEngine & WAEngine
    woocommerce.js --> ParserCore & CanvasEngine
    phone-check.js --> ParserCore
    content.js --> ParserCore

    %% Background Connections
    woocommerce.js <-->|chrome.runtime| ServiceWorker
    phone-check.js <-->|chrome.runtime| ServiceWorker
    Popup <-->|chrome.runtime| ServiceWorker
    WebMCP <-->|chrome.runtime| ServiceWorker
    ServiceWorker <--> Storage & MemCache

    %% External Connections
    ServiceWorker <--> HermesAPI & SteadfastAPI
    WAEngine --> WhatsAppAPI
```

---

## 2. Core Data Flow Pipelines

### A. Customer Delivery Risk & Rating Check Pipeline

```mermaid
sequenceDiagram
    autonumber
    actor Merchant as Merchant / AI Agent
    participant UI as WooCommerce / Universal Pill / WebMCP
    participant SW as Service Worker (background.js)
    participant Cache as Memory Map & LocalStorage
    participant Hermes as Pathao Hermes API
    participant SF as Steadfast API

    Merchant->>UI: Selects Phone Number / Order
    UI->>SW: sendMessage("fetch_customer_rating", phone)
    SW->>Cache: Check 10-minute TTL Cache
    alt Cache Hit (Valid < 10 mins)
        Cache-->>SW: Return Cached Courier Rating
    else Cache Miss / Force Refresh
        par Query Pathao Hermes API
            SW->>Hermes: POST /aladdin/api/v1/user/success (Bearer Token)
            Hermes-->>SW: { total, delivered, cancelled, customer_rating }
        and Query Steadfast Network
            SW->>SF: GET /user/frauds/check/{phone}
            SF-->>SW: { total_delivered, total_cancelled }
        end
        SW->>SW: Aggregate Composite Risk (Delivery % & Returns)
        SW->>Cache: Save Entry with Date.now()
    end
    SW-->>UI: Return Normalized Rating & Risk Label
    UI-->>Merchant: Render Color-coded Rating Pill & Stats
```

---

### B. Order Details, Pricing & Address Correction Pipeline

```mermaid
flowchart LR
    RawOrder["Raw Order Details\n(Modal / Edit Page / Row)"] --> CleanLabels["Clean HTML Entities\n& Filter Action Buttons"]
    CleanLabels --> StripDangling["Strip Dangling (Size:)\n& Variation Tables"]
    StripDangling --> ExtractPrices["Capture Unit Price,\nQty & Subtotal"]
    ExtractPrices --> AddressDecompose["Smart BD Address Parser\n(District, Zone, Postcode)"]
    AddressDecompose --> CheckLocation{"Customer Outside\nDhaka?"}
    
    CheckLocation -- Yes --> CheckFee{"Charged ৳50\nFalse-Dhaka?"}
    CheckLocation -- No --> KeepFee["Keep ৳50 Fee"]
    
    CheckFee -- Yes (Charged ৳50) --> CorrectFee["Correct COD = Subtotal + ৳90\n(e.g. 1500 + 90 = ৳1590)"]
    CheckFee -- No --> StandardOutside["Standard ৳90 Fee"]

    CorrectFee & StandardOutside & KeepFee --> CanvasReceipt["2x Retina White Canvas Receipt\n& WhatsApp Message Generator"]
```

---

## 3. Storage Architecture & Keys

| Storage Key | Storage Engine | TTL | Description |
| :--- | :--- | :--- | :--- |
| `customer_rating_cache` | `chrome.storage.local` + `Map` | 10 Minutes | Cached courier ratings indexed by 11-digit phone number. Prevents redundant API calls. |
| `pathao_merchant_token` | `chrome.storage.local` | 30 Days | Active Pathao OAuth access token. |
| `pathao_autofill_data` | `chrome.storage.local` | 5 Minutes | Transient payload for Pathao order creation form autofill. Cleaned on startup. |
| `pathao_batch_queue` | `chrome.storage.local` | Session | Queue state for bulk order dispatch progression. |
| `deen_quick_reply_config` | `chrome.storage.sync` / `local` | Permanent | Merchant bKash/Nagad accounts, store name, and shipping fee settings. |
| `phone_check_history` | `chrome.storage.local` | Permanent | Recent 30 customer phone searches in universal sidebar drawer. |

---

## 4. Multi-Context Scripting & Isolation

Chrome extensions enforce strict security boundaries:
1. **Isolated World (Default Content Scripts)**:
   - Scripts: `woocommerce.js`, `phone-check.js`, `content.js`.
   - Access to full DOM, but cannot modify page-level window properties directly.
   - Communicates with Service Worker via `chrome.runtime.sendMessage`.
2. **Main World (`world: "MAIN"`)**:
   - Scripts: `webmcp-provider.js` (and window injection bridge).
   - Exposes `navigator.modelContext` and `window.modelContext` so in-page AI models and external scripts can discover tools.
   - Bridges to extension context via `window.postMessage` listeners.
3. **Background Worker (MV3 Service Worker)**:
   - Script: `background.js`.
   - Lifecycled, non-persistent, reactive execution.
   - Holds the primary OAuth token management and cross-origin fetch permissions.
