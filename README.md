# ⚡ DEEN Delivery Parser — Courier Automation & WebMCP AI Agent Engine

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![WebMCP Standard](https://img.shields.io/badge/W3C-WebMCP_Standard-blue.svg)](https://webmachinelearning.github.io/webmcp/)
[![Test Suite](https://img.shields.io/badge/Tests-7%20Passed%20(100%25)-success.svg)](test_webmcp_integration.js)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A powerful Chrome Extension (Manifest V3) combining **automated courier dispatching, live fraud prevention, smart address normalization, 2x Retina order receipt generation, and W3C WebMCP agentic AI tools** for e-commerce merchants.

---

## 🌟 Key Capabilities

### 1. 🤖 W3C WebMCP (Web Model Context Protocol) AI Agent Tools
- Implements the [W3C Web Machine Learning WebMCP standard](https://webmachinelearning.github.io/webmcp/) via `navigator.modelContext` / `window.modelContext`.
- Exposes **7 structured AI tools** directly to browser-embedded LLMs (Chrome Gemini Nano / Prompt API, Claude in Chrome, or desktop autonomous agents):
  - `check_customer_courier_rating`: Real-time return risk, delivery %, and cancelled parcel check.
  - `normalize_bd_address`: Cleans messy checkout addresses without name corruption.
  - `build_full_address`: Combines cleaned address with resolved District, Zone, and Postcode.
  - `calculate_delivery_fee`: Verified ৳50 inside Dhaka vs ৳90 outside Dhaka with false-inside correction.
  - `generate_whatsapp_quick_reply`: Formatted Bengali messages with 1-click `wa.me` deep links.
  - `get_woocommerce_active_orders`: Extracts orders, line items, variations, unit prices, and COD.
  - `autofill_pathao_consignment`: Prepares and dispatches order bookings to Pathao.
- Includes an interactive **WebMCP Live Tools Inspector & Runner** directly inside the extension popup.
- *Detailed specification*: See [WEBMCP.md](WEBMCP.md).

### 2. 🛡️ Live Courier Intelligence & Rating Check (Pathao + Steadfast)
- Queries the official **Pathao Hermes API** (`api-hermes.pathao.com`) and **Steadfast Courier Fraud DB** headlessly.
- Displays multi-courier composite metrics: **Delivery Success Rate (%)**, **Completed Deliveries**, **Cancelled/Returned Parcels**, and **Rating Grade** (e.g. ⭐ Top Merchant / Good / Fair).
- Highlights high-risk return customers in red (`#ef4444`) so merchants can collect delivery charges in advance before shipping.
- High-efficiency **10-minute multi-tier cache** (memory Map + `chrome.storage.local`) prevents redundant API requests.

### 3. 📍 Smart BD Address Normalizer & Pathao Popup Integration
- Automatically decomposes messy customer checkout addresses into:
  - **Clean Street Address** (strips accidental labels, emails, and phone numbers).
  - **District & Upazila/Zone** resolution (e.g. `Sharsha`, `Benapole`, `Boalmari`, `Sreepur`).
  - **ISO 3166-2:BD Code Resolution** (e.g. automatically maps `BD-15` -> `Faridpur`, `BD-18` -> `Gazipur`).
- **Zero-Corruption Guarantee**: Strict label boundaries prevent corrupting valid names (e.g. `Benapole` is never corrupted into `Benaডাকঘর`).
- Injects a **Full Address 1-Click Button & Chips Bar** directly inside the WooCommerce Pathao dispatch modal (`#ptc_wc_shipping_address`).

### 4. 💬 WhatsApp Advance COD & Quick Reply Generator
- Generates authentic Bengali WhatsApp messages tailored for:
  - **Advance Delivery Charge (`advance_fee`)**: Requests ৳90 outside Dhaka or ৳50 inside Dhaka via bKash/Nagad before shipping.
  - **Order Confirmation (`confirm_order`)**: Friendly confirmation with COD total and order reference.
  - **High Return Risk Alert (`high_risk_notice`)**: Strict advance requirement for customers with low completion rates.
  - **Parcel Tracking (`tracking_info`)**: Dispatched tracking notice with rider call instructions.
- Auto-generates instant 1-click **`wa.me` deep links** with prefilled text and standard `880` phone prefix.

### 5. 🎨 2x Retina Order Receipt Canvas Generator
- Generates high-resolution **2x Retina visual receipts** on a pure **White Background (`#ffffff`)** with brand **DEEN Orange (`#ea580c`)** headers.
- Embeds verified byte-for-byte brand logo (`DEEN_LOGO_BASE64`).
- Captures accurate line items, unit prices, product sizes (e.g. `Size: 36`), quantities, subtotal, delivery fee, and COD total.
- **1-Click Actions**:
  - Direct clipboard copy (`Ctrl+V` straight into WhatsApp chat).
  - PNG download fallback.

### 6. 📊 Pathao Merchant Portal Excel & CSV 1-Click Exporter
- Floating widget on `merchant.pathao.com` scans parcel tables dynamically.
- 1-Click **Export to Excel (.xls)** with formatted currency styles.
- 1-Click **Export to CSV** with UTF-8 BOM encoding for Bengali text support.
- 1-Click **Copy as Table (TSV)** for Google Sheets.

### 7. ⚡ Universal Phone Detection & Sidebar Drawer
- Runs across all web pages (WhatsApp Web, Facebook Inbox, CRMs, etc.).
- Highlighting or copying any 11-digit Bangladeshi phone number triggers a non-intrusive **Floating Action Pill**.
- Expandable **Sidebar Drawer** maintains recent lookup history and quick-copy action tabs (💰 Adv ৳90, 💰 Adv ৳50, ✅ Confirm, ⚠️ Risk).

---

## 📂 Project Structure

```text
chrome-extension-delivery-parser/
├── manifest.json                 # Chrome Manifest V3 configuration
├── parser.js                     # Unified parsing engine, address normalizer & generators
├── webmcp-provider.js            # W3C WebMCP tool registry & browser agent interface
├── woocommerce.js                # WooCommerce order extraction, canvas & Pathao modal normalizer
├── woocommerce.css               # Styling for WooCommerce action bars & in-popup rating cards
├── phone-check.js                # Universal phone detection script, floating pill & sidebar drawer
├── phone-check.css               # Styling for universal phone pill and sidebar
├── content.js                    # In-page Pathao merchant portal extractor & floating toolbar
├── content.css                   # Scoped styles for Pathao toolbar
├── background.js                 # MV3 Service worker, Hermes OAuth, Steadfast API & caching
├── popup.html                    # Extension popup UI (5 tabs: Current Tab, Paste, Sync, WhatsApp, WebMCP)
├── popup.css                     # Dark modern glassmorphism styling
├── popup.js                      # Popup controller & WebMCP live tool runner
├── env.js                        # Runtime environment credentials (Pathao API OAuth keys)
├── .env.example                  # Environment variables template
├── xlsx.mini.min.js              # Standalone client-side Excel export library
├── icons/                        # Authentic extension and brand icons
│   ├── deen_logo.jpg             # Authentic brand logo embedded in receipt canvas
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── test_parser.js                # Test Suite 1: Sequential & fuzzy parsing, address cases
├── test_autofill_flow.js         # Test Suite 2: Manifest schema, phone rules, Pathao tables
├── test_popup_pathao_check.js    # Test Suite 3: Background messaging & popup sync
├── test_live_pathao_rating_parsing.js # Test Suite 4: Real Hermes API response shapes
├── test_universal_phone_e2e.js   # Test Suite 5: Universal phone highlight & copy e2e
├── test_whatsapp_quick_reply.js  # Test Suite 6: 26-test suite for Order Receipt canvas & pricing
├── test_webmcp_integration.js    # Test Suite 7: WebMCP tools, schemas & execution
├── WEBMCP.md                     # Complete WebMCP Specification & AI Agent Guide
├── AGENTS.md                     # Operational Manual & Invariant Rules for AI Agents
├── ARCHITECTURE.md               # High-level architecture, component diagrams & data flows
└── README.md                     # Main documentation
```

---

## 🚀 How to Install & Load in Google Chrome

1. Clone or download this repository:
   ```bash
   git clone https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser.git
   ```
2. Configure credentials:
   - Copy `.env.example` to `.env`.
   - Fill in your Pathao merchant client credentials:
     ```env
     PATHAO_CLIENT_ID=your_client_id
     PATHAO_CLIENT_SECRET=your_client_secret
     PATHAO_USERNAME=your_username
     PATHAO_PASSWORD=your_password
     ```
   - Run `node sync_env.js` to synchronize credentials into `env.js`.
3. Open Google Chrome and navigate to:
   ```text
   chrome://extensions
   ```
4. Enable **Developer mode** (toggle in the top-right corner).
5. Click **Load unpacked** (top-left button).
6. Select the `chrome-extension-delivery-parser` directory.
7. Pin the extension to your Chrome toolbar!

---

## 🧪 Automated Testing & Verification

The repository contains **7 comprehensive test suites** covering all 26+ production scenarios with 100% precision:

```powershell
node test_parser.js; `
node test_autofill_flow.js; `
node test_popup_pathao_check.js; `
node test_live_pathao_rating_parsing.js; `
node test_universal_phone_e2e.js; `
node test_whatsapp_quick_reply.js; `
node test_webmcp_integration.js
```

---

## 📚 Agentic & Technical Documentation

- **[WEBMCP.md](WEBMCP.md)**: Authoritative WebMCP specification guide, JSON schemas, and agent integration patterns.
- **[AGENTS.md](AGENTS.md)**: Operational rules and non-negotiable invariants for AI coding assistants.
- **[ARCHITECTURE.md](ARCHITECTURE.md)**: Full architecture diagrams, sequencing pipelines, and storage lifecycle.

---

## 📄 License
MIT License. Created with ❤️ for DEEN Commerce Operations.
