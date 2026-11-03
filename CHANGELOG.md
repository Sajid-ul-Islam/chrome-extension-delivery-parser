# 📜 Changelog & Release Notes (CHANGELOG.md)

All notable changes to the **DEEN Delivery Parser** Chrome Extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.1] - 2026-11-02

### Added
- **24-Hour 3-Tier Local Cache Architecture**: Added in-page memory Map (`localPageRatingCache`), background memory Map (`customerRatingMemoryCache`), and `chrome.storage.local` (`customer_rating_cache`) for 0ms instant display and zero redundant courier API queries.
- **In-Memory Cache Eviction Sweeper**: Capped cache at 500 entries with FIFO pruning and periodic unreferenced timer (`pruneTimer.unref()`) preventing test runner hangs.
- **Dynamic `env.js` Text Fallback**: Added dynamic script content extraction fallback via `fetch(chrome.runtime.getURL("env.js"))` in `background.js`.
- **Comprehensive Documentation Suite**: Authored `PRD.md`, `TRD.md`, `DESIGN.md`, `TODO.md`, `R&D.md`, `AUDIT.md`, `CONTEXT.md`, `WORKFLOW.md`, `SECURITY.md`, `CHANGELOG.md`, `TESTING.md`, `API.md`, and `DEPLOYMENT.md`.
- **New Automated Test Suites**: Added `test_cache_eviction.js` and `test_local_rating_cache_reuse.js` bringing master automated test harness to 16 suites (100% pass rate).

### Fixed
- **WhatsApp Web React 18 `insertBefore` NotFoundError**: Diagnosed and resolved DOM element detachment crash (`phone-check.js:1511`) on `web.whatsapp.com` using the DOM Node Reuse Pattern and defensive wrappers on `Node.prototype.insertBefore` and `Node.prototype.removeChild`.
- **Pathao Customer Rating Credential Override**: Fixed bug in `loadRuntimeEnv()` where stored empty string (`pathao_client_secret: ""`) wiped valid credentials loaded from `env.js`.
- **Pathao API Timeout Resilience**: Extended Hermes fetch timeout from 4,000ms to 7,000ms with graceful fallback to Steadfast Courier.
- **Empty Phone Input Guard**: Added early input validation guard in `handleCustomerRatingRequest` to prevent invalid normalization.

---

## [1.2.0] - 2026-10-25

### Added
- **DEEN Floating AI Copilot Chatbox (`deen-floating-chat.js`, `deen-floating-chat.css`)**: In-page collapsible floating Copilot window with draggable circular brand launcher, coordinate persistence, contextual telemetry banner, and 1-click WhatsApp message injector.
- **Context-Aware Dynamic Prompt Chips**: Platform-tailored prompt suggestions across WooCommerce (`📊 Audit Orders`, `💰 COD Breakdown`), Pathao (`💰 Uncollected COD`, `📦 Unpaid Parcels`), and WhatsApp Web (`🛡️ Check Rating`, `💰 ৳90 Advance Fee`).
- **Zero-Cost Deterministic Query Engine (`deen-assistant.js`)**: Sub-5ms analytical calculations for total COD, net revenue, parcel counts, and Banglish customer note interpretations (e.g. *"shukrobar pathaben"*, *"dekhe nibo"*).
- **Non-Delivery Report (NDR) Rescue Detector (`courier-adapters.js`)**: Real-time scanner for failed delivery attempts with 1-click WhatsApp customer rescue links.
- **Automated Test Suites**: Added `test_floating_chat.js`, `test_ndr_rescue_listener.js`, and `test_deen_assistant.js`.

---

## [1.1.0] - 2026-10-12

### Added
- **WordPress SSO & Admin Profile Card**: 1-click active session probe and direct `wp-login.php` authentication. Displays user avatar, display name, handle, role badge (`🛡️ Administrator` vs `🛒 Shop Manager`), and specific permission scope (`manage_options, manage_woocommerce`).
- **WooCommerce Pathao Plugin Bridge**: Headless session bridge probing `/wp-admin/admin.php?page=pathao-courier` to issue access tokens via Pathao B2B External Login (`/aladdin/api/v1/external/login`) with `client_id` + `client_secret`.
- **Steadfast API Key Auto-Sync**: Passively extracts Steadfast courier credentials from WordPress settings forms.
- **Automated Test Suites**: Added `test_wordpress_login_sync.js` and `test_icons_verification.js`.

### Fixed
- **Role Isolation**: Strict boundary between Store Administrator and Shop Manager permissions to enforce least privilege.

---

## [1.0.0] - 2026-09-15

### Added
- **Central Parsing Engine (`parser.js`)**: Fuzzy sequential token parser, BD phone normalizer, and 64-district resolution engine with ~495 upazilas coverage.
- **Reverse Zone Inference**: Intelligent upazila-to-district reverse mapping (e.g. `Titas` -> `Cumilla`) without defaulting to Dhaka.
- **Financial Invariant Rules**: ৳50 inside Dhaka vs ৳90 outside Dhaka; False-Dhaka ৳50 fee auto-corrected to ৳90; Free Shipping enforced **only** when subtotal $\ge ৳2500$.
- **2x Retina Visual Canvas Receipt Generator (`woocommerce.js`)**: 640px wide 2x Retina canvas on pure white background (`#ffffff`) with brand DEEN Orange (`#ea580c`), authentic logo bytes, and direct clipboard copy (`ClipboardItem`).
- **W3C WebMCP Standard Registry (`webmcp-provider.js`)**: Exposes 12 structured AI tools to browser agents via `navigator.modelContext` / `window.modelContext`.
- **Pathao Merchant Portal Automation (`content.js`)**: In-page floating KPI toolbar, 1-click Excel (`.xlsx`) export via embedded SheetJS, CSV export with UTF-8 BOM, and React/Ant Design consignment autofill engine.
- **Universal Phone Detection (`phone-check.js`)**: Selection/copy phone detector, floating action pill, slide-out sidebar drawer, and WhatsApp Web header rating badge.
- **Modular 5-Tab Extension Popup (`popup.html`, `popup.js`, `popup.css`)**: Deliveries, Courier Check, Store Connect, WhatsApp, and AI Tools tabs with dark modern glassmorphism design.
- **Automated Test Suites**: Initial test harness covering parser, autofill, popup check, live Hermes parsing, universal phone, WhatsApp quick replies, WebMCP, and full fetch improvements (Suites 1–8).
