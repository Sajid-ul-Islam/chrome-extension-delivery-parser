# 🏛️ Architecture & System Design (ARCHITECTURE.md)

This document details the high-level architecture, module interactions, data flows, security boundaries, and state management of the **DEEN Delivery Parser** Chrome Extension (Manifest V3) for **DEEN Commerce**.

---

## 1. High-Level Architecture Overview

```mermaid
flowchart TD
    subgraph UI Layer
        Popup["Popup Window (popup.html / popup.js)\n5 Tabs: Deliveries, Courier Check, Store Connect, WhatsApp, AI Tools"]
        Sidebar["Universal Sidebar Drawer (phone-check.js)"]
        FloatingPill["Floating Action Pill (phone-check.js)"]
        PathaoPill["Pathao Toolbar (content.js)"]
        WCOrderModal["Order Confirmation Modal (woocommerce.js)"]
        WCRatingCard["In-Popup Rating Card (woocommerce.js)"]
        WPProfile["WordPress Profile & Permissions Card"]
    end

    subgraph Agentic / WebMCP Layer
        WebMCP["WebMCP Provider (webmcp-provider.js)"]
        ModelCtx["navigator.modelContext / window.modelContext"]
        Agent["Autonomous AI Agent (Gemini Nano / Claude / Desktop Agent)"]
    end

    subgraph Business Logic & Parsing Engine
        ParserCore["Unified Parser Core (parser.js)"]
        AddressEngine["Smart BD Address & ISO District Engine (64 Districts)"]
        FeeEngine["Delivery Fee & False-Dhaka Correction Engine"]
        CanvasEngine["2x Retina Order Receipt Canvas Engine"]
        WAEngine["WhatsApp Quick Reply Generator"]
    end

    subgraph Chrome Extension Core (Manifest V3)
        ServiceWorker["Background Service Worker (background.js)"]
        Storage["chrome.storage.local (Persistent State & Caches)"]
        MemCache["In-Memory Map Cache (10-min TTL)"]
        WpSSO["WordPress SSO & Role/Permissions Manager"]
        PathaoBridge["WooCommerce Pathao Plugin Bridge & B2B OAuth"]
    end

    subgraph External Platforms & APIs
        WCDOM["WooCommerce Admin (deencommerce.com/wp-admin)"]
        PathaoDOM["Pathao Portal (merchant.pathao.com)"]
        HermesAPI["Pathao Hermes / Aladdin API (api-hermes.pathao.com)"]
        SteadfastAPI["Steadfast Fraud DB (steadfast.com.bd)"]
        OSMAPI["OpenStreetMap Nominatim Geocoding API"]
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
    Popup --> WPProfile

    %% Logic Connections
    ParserCore --> AddressEngine & FeeEngine & WAEngine
    woocommerce.js --> ParserCore & CanvasEngine
    phone-check.js --> ParserCore
    content.js --> ParserCore

    %% Background & Service Worker Connections
    woocommerce.js <-->|chrome.runtime| ServiceWorker
    phone-check.js <-->|chrome.runtime| ServiceWorker
    Popup <-->|chrome.runtime| ServiceWorker
    WebMCP <-->|chrome.runtime| ServiceWorker
    ServiceWorker <--> Storage & MemCache & WpSSO & PathaoBridge

    %% External Connections
    ServiceWorker <--> HermesAPI & SteadfastAPI & OSMAPI
    WpSSO <--> WCDOM
    PathaoBridge <--> WCDOM & HermesAPI
    WAEngine --> WhatsAppAPI
```

---

## 2. Core Data Flow Pipelines

### A. Customer Delivery Risk & Rating Check Pipeline (with WooCommerce Pathao Bridge)

```mermaid
sequenceDiagram
    autonumber
    actor Merchant as Merchant / AI Agent
    participant UI as WooCommerce / WhatsApp / Popup / WebMCP
    participant SW as Service Worker (background.js)
    participant Cache as Memory Map & chrome.storage
    participant WC as WooCommerce Tab (woocommerce.js)
    participant Hermes as Pathao Hermes / Aladdin API
    participant SF as Steadfast Fraud Network

    Merchant->>UI: Selects Phone Number / Opens Order
    UI->>SW: sendMessage("fetch_customer_rating", phone)
    SW->>Cache: Check 10-Minute TTL Cache
    alt Cache Hit (Valid < 10 mins)
        Cache-->>SW: Return Cached Courier Rating
    else Cache Miss / Force Refresh
        alt Active Pathao Tab Open
            SW->>Hermes: Query Active Session Headlessly
        else Direct Credentials in .env / Storage
            SW->>Hermes: POST /aladdin/api/v1/user/success (Bearer Token)
        else Direct Credentials Missing (WooCommerce Plugin Bridge)
            SW->>WC: sendMessage("get_wc_pathao_credentials")
            alt Tab has DOM / Settings Credentials
                WC-->>SW: { clientId, clientSecret, ... }
            else Fallback Headless Probe
                SW->>WC: Probe /wp-admin/admin.php?page=pathao-courier
                WC-->>SW: Extracted Pathao Plugin Credentials
            end
            SW->>Hermes: POST /aladdin/api/v1/external/login (client_id, client_secret)
            Hermes-->>SW: { access_token }
            SW->>Hermes: POST /aladdin/api/v1/user/success (Bearer Token)
        end
        Hermes-->>SW: { total, delivered, cancelled, customer_rating }
        
        par Query Steadfast Network
            SW->>SF: GET /user/frauds/check/{phone}
            SF-->>SW: { total_delivered, total_cancelled }
        end
        
        SW->>SW: Compute Multi-Courier Composite Risk & Success %
        SW->>Cache: Save Entry with Date.now()
    end
    SW-->>UI: Return Normalized Rating, Risk Level & Stats
    UI-->>Merchant: Render Color-Coded Rating Badge (Safe/Medium/Risky/New)
```

---

### B. WordPress Admin SSO, Role & Permissions Discovery Pipeline

```mermaid
sequenceDiagram
    autonumber
    actor Merchant as Store Merchant / Admin
    participant Popup as Store Connect (popup.html / popup.js)
    participant SW as Service Worker (background.js)
    participant Store as WordPress Admin (deencommerce.com/wp-admin)
    participant Storage as chrome.storage.local

    Merchant->>Popup: Clicks "⚡ 1-Click Active Session" or Enters Credentials
    Popup->>SW: sendMessage("sync_from_wordpress", { siteUrl })
    SW->>Store: Check wordpress_logged_in_* Session Cookies
    SW->>Store: Probe Candidate Settings Endpoints (/wp-admin/, /ptc-settings, /pathao-courier)
    Store-->>SW: HTML Response with Admin Bar, Roles & Form Fields
    
    SW->>SW: extractCredentialsFromWordPressHTML()
    Note over SW: Extracts User Display Name, Login Username,<br/>Role (Admin vs Shop Manager), Capabilities & Keys
    
    SW->>Storage: Save wp_connected_user, wp_user_role, wp_user_permissions, credentials
    SW-->>Popup: { success: true, adminUser, userRole, userPermissions, credentialsFound }
    Popup->>Popup: renderAuthenticatedProfile()
    Popup-->>Merchant: Displays Authenticated Profile Card with Role Badge & Permissions Scope
```

---

### C. Order Details, Pricing & Address Correction Pipeline

```mermaid
flowchart LR
    RawOrder["Raw Order Details\n(Modal / Edit Page / Table Row)"] --> CleanLabels["Clean HTML Entities\n& Filter Action Buttons"]
    CleanLabels --> StripDangling["Strip Dangling (Size:)\n& Variation Line Items"]
    StripDangling --> ExtractPrices["Capture Unit Price,\nQty & Subtotal"]
    ExtractPrices --> AddressDecompose["Smart BD Address Parser\n(64 Districts, Thana, Upazila)"]
    
    AddressDecompose --> CheckFree{"Subtotal ≥ ৳2500\n& Free Delivery?"}
    CheckFree -- Yes (≥ ৳2500) --> FreeShip["Keep ৳0 Delivery\nCOD = Subtotal"]
    
    CheckFree -- No (< ৳2500) --> CheckLocation{"Customer Outside\nDhaka?"}
    
    CheckLocation -- Outside Dhaka --> CheckFee{"Charged ৳50\nFalse-Dhaka?"}
    CheckLocation -- Inside Dhaka --> AddDhaka["Add Inside Dhaka ৳50\n(e.g. 1494 + 50 = ৳1544)"]
    
    CheckFee -- Yes (Charged ৳50) --> CorrectFee["Correct COD = Subtotal + ৳90\n(e.g. 1500 + 90 = ৳1590)"]
    CheckFee -- No (Already ৳90) --> StandardOutside["Standard Outside Dhaka ৳90"]

    FreeShip & AddDhaka & CorrectFee & StandardOutside --> CanvasReceipt["2x Retina White Canvas Receipt\n& WhatsApp Message Generator"]
```

---

## 3. Storage Architecture & State Management

| Storage Key | Engine | TTL | Description |
| :--- | :--- | :--- | :--- |
| `customer_rating_cache` | `chrome.storage.local` + `Map` | 10 Minutes | Cached courier ratings indexed by 11-digit phone number. Prevents redundant API calls. |
| `pathao_merchant_token` | `chrome.storage.local` | 30 Days | Active Pathao OAuth access token. |
| `pathao_token_expiry` | `chrome.storage.local` | 30 Days | Expiration epoch timestamp for Pathao access token. |
| `pathao_autofill_data` | `chrome.storage.local` | 5 Minutes | Transient payload for Pathao order creation form autofill. Cleaned on startup. |
| `pathao_batch_queue` | `chrome.storage.local` | Session | Queue state for bulk order dispatch progression. |
| `wp_connected_site` | `chrome.storage.local` | Permanent | Store URL currently synced (e.g. `https://deencommerce.com`). |
| `wp_connected_user` | `chrome.storage.local` | Permanent | Authenticated WordPress display name (e.g. `Sajid (Store Admin)`). |
| `wp_connected_login` | `chrome.storage.local` | Permanent | WordPress login username handle (e.g. `admin`). |
| `wp_user_role` | `chrome.storage.local` | Permanent | Authenticated role (`Administrator` or `Shop Manager`). |
| `wp_user_permissions` | `chrome.storage.local` | Permanent | Human-readable permission string (e.g. `Full Store & Settings Access (manage_options, manage_woocommerce)`). |
| `wp_auth_status` | `chrome.storage.local` | Permanent | Connection status (`connected`, `connected_no_creds`, `disconnected`). |
| `deen_quick_reply_config` | `chrome.storage.sync` / `local` | Permanent | Merchant bKash/Nagad accounts, store name, and shipping fee settings. |
| `phone_check_history` | `chrome.storage.local` | Permanent | Recent 30 customer phone searches in universal sidebar drawer. |

---

## 4. Multi-Context Scripting & Security Isolation

Google Chrome Manifest V3 enforces strict security boundaries:

```mermaid
graph TB
    subgraph Main World ["Main World (Page Context)"]
        WebMCPProvider["webmcp-provider.js\nExposes navigator.modelContext & window.modelContext"]
        InPageScripts["Page DOM & JavaScript Environment"]
    end

    subgraph Isolated World ["Isolated World (Extension Content Scripts)"]
        WC["woocommerce.js\nRuns on *://*/wp-admin/*"]
        UniversalPhone["phone-check.js\nRuns on *://*/*"]
        PathaoContent["content.js\nRuns on merchant.pathao.com"]
    end

    subgraph Extension Context ["Extension Context (Isolated Background)"]
        ServiceWorker["background.js (MV3 Service Worker)\nCross-origin fetch, OAuth tokens, Chrome storage"]
        Popup["popup.js / popup.html\nUser interface & WebMCP tool runner"]
    end

    InPageScripts <-->|DOM Events / postMessage| WebMCPProvider
    WebMCPProvider <-->|postMessage Bridge| WC
    WC <-->|chrome.runtime.sendMessage| ServiceWorker
    UniversalPhone <-->|chrome.runtime.sendMessage| ServiceWorker
    PathaoContent <-->|chrome.runtime.sendMessage| ServiceWorker
    Popup <-->|chrome.runtime.sendMessage| ServiceWorker
```

1. **Isolated World (Default Content Scripts)**:
   - Scripts: `woocommerce.js`, `phone-check.js`, `content.js`.
   - Access to full DOM, but isolated from page JavaScript variables.
   - Communicates with Service Worker via `chrome.runtime.sendMessage`.
2. **Main World (`world: "MAIN"`)**:
   - Scripts: `webmcp-provider.js`.
   - Injected into page context so in-browser LLMs (Chrome Prompt API / Gemini Nano) can access `navigator.modelContext`.
   - Bridges tool invocations across window boundaries via secure `window.postMessage` listeners.
3. **Background Worker (MV3 Service Worker)**:
   - Script: `background.js`.
   - Lifecycled, non-persistent, reactive execution.
   - Holds the primary OAuth token management, cookie reads, and cross-origin fetch permissions for Pathao, Steadfast, and OpenStreetMap.
