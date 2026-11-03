# ⚡ DEEN Delivery Parser — Courier Automation, WordPress SSO & WebMCP AI Agent Engine

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![WebMCP Standard](https://img.shields.io/badge/W3C-WebMCP_Standard-blue.svg)](https://webmachinelearning.github.io/webmcp/)
[![Test Suite](https://img.shields.io/badge/Tests-16%20Suites%20Passed%20(100%25)-success.svg)](run_all_suites.js)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An enterprise Chrome Extension (Manifest V3) purpose-built for **DEEN Commerce**, combining **automated courier dispatch, live customer fraud prevention, smart BD address normalization (64 districts), 2x Retina order receipt rendering, zero-credential WordPress SSO with role & permissions visibility, and W3C WebMCP agentic AI tools**.

---

## 🌟 Key Capabilities

### 1. 🤖 W3C WebMCP (Web Model Context Protocol) AI Agent Tools
- Implements the [W3C Web Machine Learning WebMCP standard](https://webmachinelearning.github.io/webmcp/) via `navigator.modelContext` / `window.modelContext`.
- Exposes **12 structured AI tools** directly to browser-embedded LLMs (Chrome Gemini Nano / Prompt API, Claude in Chrome, or desktop autonomous agents):
  1. `check_customer_courier_rating`: Real-time return risk, delivery %, and cancelled parcel check.
  2. `normalize_bd_address`: Cleans messy checkout addresses without name corruption.
  3. `build_full_address`: Combines cleaned address with resolved District, Zone, and Postcode.
  4. `calculate_delivery_fee`: Verified ৳50 inside Dhaka vs ৳90 outside Dhaka with false-inside correction.
  5. `generate_whatsapp_quick_reply`: Formatted Bengali messages with 1-click `wa.me` deep links.
  6. `get_woocommerce_active_orders`: Extracts orders, line items, variations, unit prices, and COD.
  7. `autofill_pathao_consignment`: Prepares and dispatches order bookings to Pathao.
  8. `evaluate_optimal_courier`: Recommends optimal courier network based on destination coverage and fees.
  9. `calculate_multifactor_risk`: Multi-tier fraud and RTO risk assessment.
  10. `process_ndr_tracking_event`: Automated tracking scan for delivery exceptions to trigger rescue notices.
  11. `query_deen_assistant`: Zero-latency deterministic KPI query engine & customer note analyzer.
  12. `sync_wordpress_admin_credentials`: 1-click auto-sync of courier API keys directly from WordPress.
- Includes an interactive **WebMCP Live Tools Inspector & Runner** directly inside the extension popup.
- *Detailed specification*: See [WEBMCP.md](WEBMCP.md).

### 2. 🌐 WordPress Admin Auto-Connect, Profile Card & Zero-Manual API Key SSO
- **1-Click Active Session Sync**: Automatically probes and retrieves Pathao & courier API keys directly from your active `deencommerce.com/wp-admin` session — zero manual copy-pasting of API secrets required!
- **Direct WordPress Credentials Login**: Authenticates store administrators directly via `wp-login.php` / WordPress REST API (following DEEN Sales-Analysis architecture) and auto-configures courier credentials in 1 click.
- **Authenticated Account Profile Card**:
  - Displays authenticated user display name and username handle (e.g. `Sajid (Store Admin) (@admin)`).
  - Displays verified store domain (`deencommerce.com`).
  - Displays authenticated **Role Badge** (`🛡️ Administrator` vs `🛒 Shop Manager`).
  - Lists verified permissions scope (e.g. *Full Store & Settings Access (manage_options, manage_woocommerce)*).
  - Provides instant `🔄 Re-sync` and `Disconnect` controls.

### 3. 🛡️ Live Courier Intelligence & WooCommerce Pathao Plugin Bridge
- Queries the official **Pathao Hermes API** (`api-hermes.pathao.com`) and **Steadfast Courier Fraud DB** headlessly.
- **WooCommerce Pathao Plugin Bridge**: If direct Pathao credentials are missing in the extension, the background worker automatically bridges to open WooCommerce tabs or probes `/wp-admin/admin.php?page=pathao-courier` using active session cookies, issues a token via Pathao **B2B External Login** (`/aladdin/api/v1/external/login`) with `client_id` + `client_secret`, and returns live customer courier ratings with zero configuration.
- Displays multi-courier composite metrics: **Delivery Success Rate (%)**, **Completed Deliveries**, **Cancelled/Returned Parcels**, and **Rating Grade** (⭐ Top Merchant / Good / Fair / Risky).
- High-efficiency **24-hour multi-tier cache** (page Map + background memory Map + `chrome.storage.local`) with 0ms instant display and zero redundant external API calls.

### 4. 📦 Streamlined, Decluttered 5-Tab Extension Popup
- **`📦 Deliveries`**: Modular delivery processing with seamless sub-navigation:
  - `⚡ Active Page Extractor`: 1-click extract parcels from open Pathao or WooCommerce pages.
  - `📋 Paste Courier Text`: Fuzzy sequential parcel text parser with batch Excel/CSV export.
  - *No Leaking Layout*: Delivery table and empty-state onboarding guide are strictly scoped to the Deliveries tab.
- **`🛡️ Courier Check`**: Dedicated phone lookup for customer delivery ratios, fraud signals, and RTO risk scores.
- **`🌐 Store Connect`**: Dedicated WordPress SSO, active session auto-sync, and courier credentials manager.
- **`💬 WhatsApp`**: Quick replies, bKash advance fee prompts, and canvas receipt generators.
- **`🤖 AI Tools`**: WebMCP agent tool runner & inspector.

### 5. 📍 Smart BD Address Normalizer & Pathao Popup Integration
- Automatically decomposes messy customer checkout addresses into:
  - **Clean Street Address** (strips accidental labels, emails, and phone numbers).
  - **District & Upazila/Zone** resolution (100% coverage of all 64 districts & ~495 upazilas).
  - **ISO 3166-2:BD Code Resolution** (e.g. automatically maps `BD-15` -> `Faridpur`, `BD-18` -> `Gazipur`).
- **Zero-Corruption Guarantee**: Strict label boundaries prevent corrupting valid names (e.g. `Benapole` is never corrupted into `Benaডাকঘর`).
- Injects a **Full Address 1-Click Button & Chips Bar** directly inside the WooCommerce Pathao dispatch modal (`#ptc_wc_shipping_address`).

### 6. 💬 WhatsApp Advance COD & Quick Reply Generator
- Generates authentic Bengali WhatsApp messages tailored for:
  - **Advance Delivery Charge (`advance_fee`)**: Requests ৳90 outside Dhaka or ৳50 inside Dhaka via bKash/Nagad before shipping.
  - **Order Confirmation (`confirm_order`)**: Friendly confirmation with COD total and order reference.
  - **High Return Risk Alert (`high_risk_notice`)**: Strict advance requirement for customers with low completion rates.
  - **Parcel Tracking (`tracking_info`)**: Dispatched tracking notice with rider call instructions.
- Auto-generates instant 1-click **`wa.me` deep links** with prefilled text and standard `880` phone prefix.

### 7. 🎨 2x Retina Order Receipt Canvas Generator
- Generates high-resolution **2x Retina visual receipts** on a pure **White Background (`#ffffff`)** with brand **DEEN Orange (`#ea580c`)** headers.
- Embeds verified byte-for-byte brand logo (`DEEN_LOGO_BASE64`).
- Captures accurate line items, unit prices, product sizes (e.g. `Size: 36`), quantities, subtotal, delivery fee, and COD total.
- **1-Click Actions**:
  - Direct clipboard copy (`Ctrl+V` straight into WhatsApp chat).
  - PNG download fallback.

### 8. 📊 Pathao Merchant Portal Excel & CSV 1-Click Exporter
- Floating widget on `merchant.pathao.com` scans parcel tables dynamically.
- 1-Click **Export to Excel (.xls)** with formatted currency styles.
- 1-Click **Export to CSV** with UTF-8 BOM encoding for Bengali text support.
- 1-Click **Copy as Table (TSV)** for Google Sheets.

### 9. ⚡ Universal Phone Detection & Sidebar Drawer
- Runs across all web pages (WhatsApp Web, Facebook Inbox, CRMs, etc.).
- Highlighting or copying any 11-digit Bangladeshi phone number triggers a non-intrusive **Floating Action Pill**.
- WhatsApp Web Active Chat Header auto-detects recipient phone and injects a real-time rating badge.
- Expandable **Sidebar Drawer** maintains recent lookup history and quick-copy action tabs.

---

## 📂 Project Structure

```text
chrome-extension-delivery-parser/
├── manifest.json                 # Chrome Manifest V3 configuration
├── parser.js                     # Unified parsing engine, address normalizer & generators
├── webmcp-provider.js            # W3C WebMCP tool registry & browser agent interface (12 tools)
├── deen-assistant.js             # Zero-cost deterministic analytical query engine & BYOK client
├── woocommerce.js                # WooCommerce order extraction, canvas & Pathao plugin bridge
├── woocommerce.css               # Styling for WooCommerce action bars & in-popup rating cards
├── phone-check.js                # Universal phone detection script, floating pill & sidebar drawer
├── phone-check.css               # Styling for universal phone pill, sidebar & WhatsApp badges
├── content.js                    # In-page Pathao merchant portal extractor & floating toolbar
├── content.css                   # Scoped styles for Pathao toolbar
├── background.js                 # MV3 Service worker, Hermes OAuth, B2B login, Steadfast & caching
├── popup.html                    # 5-Tab modular UI (Deliveries, Courier, Store, WhatsApp, AI Tools)
├── popup.css                     # Dark modern glassmorphism styling & profile card styles
├── popup.js                      # Popup controller, profile renderer & WebMCP live tool runner
├── env.js                        # Runtime environment credentials (Pathao API OAuth keys)
├── .env.example                  # Environment variables template
├── xlsx.mini.min.js              # Standalone client-side Excel export library
├── icons/                        # Authentic extension and brand icons
│   ├── deen_logo.jpg             # Authentic brand logo embedded in receipt canvas
│   ├── deen_logo.png
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── run_all_suites.js             # Master test runner executing all 16 suites
├── test_parser.js                # Test Suite 1: Sequential & fuzzy parsing, address cases
├── test_autofill_flow.js         # Test Suite 2: Manifest schema, phone rules, Pathao tables
├── test_popup_pathao_check.js    # Test Suite 3: Background messaging & popup sync
├── test_live_pathao_rating_parsing.js # Test Suite 4: Real Hermes API response shapes
├── test_universal_phone_e2e.js   # Test Suite 5: Universal phone highlight & copy e2e
├── test_whatsapp_quick_reply.js  # Test Suite 6: 30-test suite for Order Receipt canvas & pricing
├── test_webmcp_integration.js    # Test Suite 7: WebMCP tools, schemas & execution (12 tools)
├── test_full_fetch_improvements.js # Test Suite 8: Notes, billing/shipping priority, deduplication
├── test_wordpress_login_sync.js  # Test Suite 9: WordPress SSO, Roles, B2B login & Pathao bridge
├── test_icons_verification.js    # Test Suite 10: Icon assets, dimensions & manifest declarations
├── test_deen_assistant.js        # Test Suite 11: Analytical query engine & Bengali note interpreter
├── test_whatsapp_active_chat.js  # Test Suite 12: WhatsApp Web active chat phone & badge injection
├── test_floating_chat.js         # Test Suite 13: Floating AI Assistant Copilot chatbox
├── test_ndr_rescue_listener.js   # Test Suite 14: Non-Delivery Report (NDR) rescue trigger listener
├── test_cache_eviction.js        # Test Suite 15: Background rating & token 24h cache lifecycle
├── test_local_rating_cache_reuse.js # Test Suite 16: Zero-network 0ms rating cache reuse
├── PRD.md                        # Product Requirements Document
├── TRD.md                        # Technical Requirements Document
├── DESIGN.md                     # System Architecture & Detailed Technical Design
├── WORKFLOW.md                   # Operational & Engineering Workflows (WooCommerce, Pathao, WhatsApp)
├── SKILLS.md                     # Agentic Skills Catalog & Subagent Capability Registry
├── TESTING.md                    # Automated Testing Strategy & 16-Suite QA Manual
├── SECURITY.md                   # Security Policy, Manifest V3 CSP & Vulnerability Governance
├── API.md                        # Upstream Courier & Chrome Runtime Messaging Specifications
├── DEPLOYMENT.md                 # Local Setup, Hot-Reload & Chrome Web Store Publishing Guide
├── CHANGELOG.md                  # Semantic Version History & Release Notes
├── TODO.md                       # Engineering Backlog & Completed Milestones
├── BUGS_AND_FIXES.md             # Critical Bug Compendium, Root Cause Analyses & Resolution Log
├── R&D.md                        # Research & Development Case Studies (React 18, Reverse Zone, False-Dhaka)
├── AUDIT.md                      # Code Quality & Invariant Compliance Audit
├── CONTEXT.md                    # Agentic Context Priming & Onboarding Guide
├── WEBMCP.md                     # Complete WebMCP Specification & AI Agent Guide
├── AGENTS.md                     # Operational Manual & Invariant Rules for AI Agents
├── ARCHITECTURE.md               # High-level architecture, component diagrams & data flows
├── OPERATIONS.md                 # FDE Operations Runbook & Edge-Case Playbook
└── README.md                     # Main documentation
```

---

## 🚀 Installation & 1-Click Auto-Updates

### Quick Installation:
1. **Clone or Download ZIP**:
   ```bash
   git clone https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser.git
   ```
2. **Configure Credentials (Zero Node.js required!)**:
   - Simply connect via **🌐 Store Connect** tab in the extension popup using your `deencommerce.com` admin session or login credentials — the extension will auto-sync all Pathao and Steadfast credentials automatically!
   - Alternatively, place a `.env` file in the extension folder or configure in the popup.
3. **Load in Chrome**:
   - Open `chrome://extensions` and enable **Developer mode** (top-right).
   - Click **Load unpacked** and select the extension folder.

---

### 🔄 How Updates Work:
1. **In-App Notification**: An update banner appears at the top of the popup and in WooCommerce admin whenever a new commit is available.
2. **1-Click Update**:
   - **Windows**: Simply double-click `update.bat`.
   - **Mac/Linux**: Run `./update.sh`.
   - **From Popup**: Click **🔄 Reload App** to hot-reload the updated extension in Chrome memory instantly without visiting `chrome://extensions`.

---

## 🧪 Master Automated Test Verification

All **16 comprehensive test suites** run via a single command:

```powershell
node run_all_suites.js
```

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

---

## 📚 Agentic & Technical Documentation

- **[PRD.md](PRD.md)**: Product Requirements Document (features, personas, business goals).
- **[TRD.md](TRD.md)**: Technical Requirements Document (architecture, APIs, security, schemas).
- **[DESIGN.md](DESIGN.md)**: System Design Specification & Sequence Diagrams.
- **[WORKFLOW.md](WORKFLOW.md)**: Operational & Engineering Workflows across WooCommerce, Pathao & WhatsApp Web.
- **[SKILLS.md](SKILLS.md)**: Agentic Skills Catalog & Subagent Capability Registry.
- **[TESTING.md](TESTING.md)**: Automated Testing Strategy & 16-Suite QA Manual.
- **[SECURITY.md](SECURITY.md)**: Security Policy, Manifest V3 CSP & Vulnerability Governance.
- **[API.md](API.md)**: Upstream Courier & Chrome Runtime Messaging Specifications.
- **[DEPLOYMENT.md](DEPLOYMENT.md)**: Local Setup, Hot-Reload & Chrome Web Store Publishing Guide.
- **[CHANGELOG.md](CHANGELOG.md)**: Semantic Version History & Release Notes.
- **[TODO.md](TODO.md)**: Engineering Roadmap, Backlog & Release Milestones.
- **[BUGS_AND_FIXES.md](BUGS_AND_FIXES.md)**: Critical Bug Compendium, Root Cause Analyses & Resolution Log.
- **[R&D.md](R&D.md)**: Research & Development Deep Dives (React 18 `insertBefore` resolution, Reverse Zone Index, False-Dhaka economics).
- **[AUDIT.md](AUDIT.md)**: Full Invariants & Architectural Compliance Audit.
- **[CONTEXT.md](CONTEXT.md)**: Agentic Context Priming & Developer Onboarding Guide.
- **[AGENTS.md](AGENTS.md)**: Operational rules and non-negotiable invariants for AI coding assistants.
- **[ARCHITECTURE.md](ARCHITECTURE.md)**: High-level architecture, sequence diagrams & storage lifecycle.
- **[WEBMCP.md](WEBMCP.md)**: W3C WebMCP specification, 12 tool schemas & agent integration patterns.
- **[OPERATIONS.md](OPERATIONS.md)**: Forward Deployed Engineer (FDE) operational runbook, courier edge cases & incident recovery.

---

## 📄 License
MIT License. Created with ❤️ for DEEN Commerce Operations.
