# 📝 Project Roadmap & Task Backlog (TODO.md)

## DEEN Delivery Parser — Autonomous Courier Logistics & Dispatch Engine

**Current Version:** 1.2.2  
**Project Health:** 100% Automated Test Suite Passing (24/24 Test Suites)

---

## 1. Completed Milestones (Shipped & Verified)

### Core Engine & Architecture (v1.0.0 - v1.1.0)
- [x] **Sequential Token Address Normalizer:** 100% 64 districts & ~495 upazilas coverage with English/Bengali aliases in `parser.js`.
- [x] **Reverse Zone Inference:** Reverse-lookup thana/upazila (e.g. `Titas` $\rightarrow$ `Cumilla`) without falling back to Dhaka.
- [x] **2x Retina Order Receipt Canvas:** High-DPI canvas rendering with brand logo, line items, barcode, and 1-click clipboard copy.
- [x] **Financial Rules Engine:** ৳50 Inside Dhaka / ৳90 Outside Dhaka, False-Dhaka ৳50 correction, and ৳2,500 Free Shipping threshold enforcement.
- [x] **1-Click Pathao Table Exporter:** In-page floating toolbar on `merchant.pathao.com` with Excel (`.xlsx`) and CSV (`.csv`) export.

### Intelligence & Autonomous Agent Integrations (v1.1.5 - v1.2.0)
- [x] **W3C WebMCP Agent Registry:** 19 structured AI tools exposed via `navigator.modelContext` / `window.modelContext`.
- [x] **DEEN Assistant Copilot:** Zero-cost deterministic analytical query engine + Banglish/Bengali NLP note interpreter + BYOK (Gemini, OpenAI, Groq).
- [x] **Universal Phone Check:** In-page highlight/copy phone detector, floating action pill, and slide-over intelligence drawer.
- [x] **Multi-Courier Composite Scoring:** Composite aggregation across Pathao Hermes and Steadfast Courier fraud networks.
- [x] **Automated NDR Rescue Engine:** Failed delivery attempt auto-detection with high-priority desktop notifications and WhatsApp rescue links.

### Enterprise Logistics & Operational Automation (v1.2.2)
- [x] **Real-Time Pathao Coverage Engine (Pillar 1):** Compiled 5.9MB `pathao_coverage.json` into 321KB `pathao_zone_index.json`, providing <1ms offline zone/city matching and direct ID selection in WooCommerce Pathao modal & Pathao merchant portal (tested in `test_pathao_coverage_index.js`).
- [x] **Multi-Carrier Steadfast Dispatch (Pillar 2):** 1-Click Steadfast API order booking (`/api/v1/create_order`) in WooCommerce confirmation modal & background worker with tracking code generation (tested in `test_steadfast_dispatch.js`).
- [x] **Custom Free Shipping & Pricing Config (Pillar 3):** Merchant-configurable Free Shipping threshold & delivery fees in Extension Settings and dynamic rules engine (tested in `test_pricing_rules_config.js`).
- [x] **WhatsApp Web Confirmation Queue & NDR Rescue (Pillar 4):** Sequential 1-click confirmation queue widget in WhatsApp Web and high-converting Bengali NDR rescue template (tested in `test_whatsapp_queue_and_ndr.js`).
- [x] **Courier Invoice Reconciliation Auditor (Pillar 5):** Discrepancy detector for COD shortages and fee overcharges in `deen-assistant.js` and WebMCP tool `reconcile_courier_invoice` (tested in `test_invoice_reconciliation.js`).
- [x] **Chrome Web Store Packaging Optimization (Pillar 6):** Lean production ZIP bundle generation (0.39 MB) via `package-cws.ps1`.
- [x] **WordPress SSO Auto-Connect:** Cookie-based session sync without manual API key entry; authenticated account profile card.
- [x] **Pathao B2B External Login:** WooCommerce Pathao Courier plugin bridge via `/aladdin/api/v1/external/login`.
- [x] **24-Hour Unified Local Rating Cache:** Tiered caching across in-page Map, background Map, and `chrome.storage.local` with FIFO 500-entry eviction.
- [x] **24-Suite Verification Harness:** Full verification suite covering all invariants in `run_all_suites.js`.

---

## 2. In-Progress Sprint Tasks (v1.2.3)

- [ ] **Direct RedX Courier API Booking:** Implement parcel dispatch for RedX logistics network.
- [ ] **Automated Multi-Carrier Rate Arbitrage:** Automatically recommend Steadfast vs Pathao based on live delivery fee comparison.
- [ ] **Paperfly Wings Adapter:** Extend composite courier check to Paperfly API.

---

## 3. Future Roadmap Backlog (v1.3.0+)

### Automated Dispatch & Multi-Carrier
- [ ] **Paperfly & eCourier Adapters:** Extend composite intelligence to Paperfly Wings and eCourier API networks.
- [ ] **Automated Multi-Carrier Rate Comparison:** Recommend the cheapest/fastest courier based on district and parcel weight.

### WhatsApp Web Automation
- [ ] **Interactive Delivery Reschedule Bot:** Webhook listener for customer reschedule replies via WhatsApp.

### Analytics & Reporting
- [ ] **IndexedDB Historical Analytics Dashboard:** In-browser reporting on monthly RTO rates, courier delivery speed, and courier fee leakage.
