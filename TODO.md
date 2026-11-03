# 📝 Project Roadmap & Task Backlog (TODO.md)

## DEEN Delivery Parser — Autonomous Courier Logistics & Dispatch Engine

**Current Version:** 1.2.1  
**Project Health:** 100% Automated Test Suite Passing (16/16 Test Suites)

---

## 1. Completed Milestones (Shipped & Verified)

### Core Engine & Architecture (v1.0.0 - v1.1.0)
- [x] **Sequential Token Address Normalizer:** 100% 64 districts & ~495 upazilas coverage with English/Bengali aliases in `parser.js`.
- [x] **Reverse Zone Inference:** Reverse-lookup thana/upazila (e.g. `Titas` $\rightarrow$ `Cumilla`) without falling back to Dhaka.
- [x] **2x Retina Order Receipt Canvas:** High-DPI canvas rendering with brand logo, line items, barcode, and 1-click clipboard copy.
- [x] **Financial Rules Engine:** ৳50 Inside Dhaka / ৳90 Outside Dhaka, False-Dhaka ৳50 correction, and ৳2,500 Free Shipping threshold enforcement.
- [x] **1-Click Pathao Table Exporter:** In-page floating toolbar on `merchant.pathao.com` with Excel (`.xlsx`) and CSV (`.csv`) export.

### Intelligence & Autonomous Agent Integrations (v1.1.5 - v1.2.0)
- [x] **W3C WebMCP Agent Registry:** 12 structured AI tools exposed via `navigator.modelContext` / `window.modelContext`.
- [x] **DEEN Assistant Copilot:** Zero-cost deterministic analytical query engine + Banglish/Bengali NLP note interpreter + BYOK (Gemini, OpenAI, Groq).
- [x] **Universal Phone Check:** In-page highlight/copy phone detector, floating action pill, and slide-over intelligence drawer.
- [x] **Multi-Courier Composite Scoring:** Composite aggregation across Pathao Hermes and Steadfast Courier fraud networks.
- [x] **Automated NDR Rescue Engine:** Failed delivery attempt auto-detection with high-priority desktop notifications and WhatsApp rescue links.

### Enterprise Security & Performance Hardening (v1.2.1)
- [x] **WordPress SSO Auto-Connect:** Cookie-based session sync without manual API key entry; authenticated account profile card.
- [x] **Pathao B2B External Login:** WooCommerce Pathao Courier plugin bridge via `/aladdin/api/v1/external/login`.
- [x] **React 18 Reconciliation Safeguard:** Shielded `Node.prototype.insertBefore` and `removeChild` on WhatsApp Web to prevent `NotFoundError`.
- [x] **DOM Node Reuse Pattern:** Replaced destructive `.remove()` with in-place attribute/DOM mutations for zero React crashes.
- [x] **24-Hour Unified Local Rating Cache:** Tiered caching across in-page Map, background Map, and `chrome.storage.local` with FIFO 500-entry eviction.
- [x] **16-Suite Verification Harness:** Full verification suite covering all invariants in `run_all_suites.js`.

---

## 2. In-Progress Sprint Tasks (v1.2.2)

- [ ] **Direct RedX Courier API Adapter:** Implement RedX courier tracking and rating adapter alongside Pathao and Steadfast.
- [ ] **Custom Free Shipping Threshold Config:** Allow merchants to customize the ৳2,500 threshold from the extension settings tab.
- [ ] **One-Click Manifest Auto-Updater:** Streamline unpacked extension reload notifications with 1-click background refresh.
- [ ] **Chrome Web Store Submission Preparation:** Prepare Store assets, privacy policy justifications, and clean production ZIP build.

---

## 3. Future Roadmap Backlog (v1.3.0+)

### Automated Dispatch & Multi-Carrier
- [ ] **Steadfast 1-Click Order Creation:** Direct parcel creation API for Steadfast Courier alongside Pathao dispatch.
- [ ] **Paperfly & eCourier Adapters:** Extend composite intelligence to Paperfly Wings and eCourier API networks.
- [ ] **Automated Multi-Carrier Rate Comparison:** Recommend the cheapest/fastest courier based on district and parcel weight.

### WhatsApp Web Automation
- [ ] **Bulk Order Confirmation Queue:** Sequential 1-click confirmation queue across multiple unread WhatsApp conversations.
- [ ] **Interactive Delivery Reschedule Bot:** Webhook listener for customer reschedule replies via WhatsApp.

### Analytics & Reporting
- [ ] **IndexedDB Historical Analytics Dashboard:** In-browser reporting on monthly RTO rates, courier delivery speed, and courier fee leakage.
- [ ] **Discrepancy Reconciliation Auditor:** Cross-reference Pathao merchant invoice CSVs against WooCommerce order numbers to flag billing errors.
