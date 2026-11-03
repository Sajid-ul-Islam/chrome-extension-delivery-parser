# 🛠️ Forward Deployed Engineering (FDE) Operations Manual & Incident Runbook (OPERATIONS.md)

Welcome, Forward Deployed Engineer (FDE) & Autonomous AI Agent! This document details production operations, e-commerce business rules, courier edge cases, and incident mitigation playbooks for **DEEN Commerce** logistics automation.

---

## 1. Core Business Logic & Financial Integrity Guardrails

### A. Delivery Fee Structure & Geographic Classification
* **Inside Dhaka (Metro)**: Standard delivery charge is **৳50**.
  * Coverage: Dhaka city proper, Mirpur, Uttara, Dhanmondi, Gulshan, Banani, Mohammadpur, Badda, Old Dhaka, Motijheel, etc.
* **Outside Dhaka (National)**: Standard delivery charge is **৳90**.
  * Coverage: All other 63 districts, plus Greater Dhaka sub-districts outside Dhaka Metro (e.g. Savar, Keraniganj, Dhamrai, Ashulia, Gazipur, Narayanganj).

---

### B. The False-Dhaka ৳50 Exploit Mitigation
* **Incident Description**: Customers living in Gazipur, Narayanganj, Savar, or other districts often exploit checkout dropdowns by selecting "Inside Dhaka (৳50)" to reduce their bill.
* **Financial Impact**: Pathao and Steadfast charge DEEN Commerce ৳90–৳130 for delivery to these locations. If the customer only paid ৳50, DEEN Commerce incurs a direct loss of ৳40+ per shipment on logistics alone.
* **Automated Agentic Resolution**:
  1. `parser.js` and `woocommerce.js` inspect the full recipient address string, district, and thana/upazila.
  2. If the address matches an outside-Dhaka zone (e.g. `Gazipur`, `Narayanganj`, `Cumilla`, `Savar`) and the WooCommerce shipping method or charge was ৳50:
     * Sets `isFalseInsideDhaka: true`.
     * Recalculates `COD = Subtotal + ৳90` (e.g., `1500 + 90 = ৳1590`).
     * Alerts the merchant in the confirmation modal: *"Outside Dhaka (Corrected from ৳50 to ৳90)"*.
     * The 2x Retina Order Receipt draws `Delivery: ৳90` and `COD: ৳1590`.

---

### C. Free Shipping Policy & ৳2,500 Threshold Enforcement
* **Company Policy**: Free Shipping is granted **STRICTLY when product subtotal is ≥ ৳2,500**.
* **Order Qualification Rules**:
  * **Orders ≥ ৳2,500**:
    * If WooCommerce applied 0 shipping, a free shipping coupon, or shipping method is `Free shipping`:
    * Delivery fee remains **৳0**.
    * `COD = Subtotal`.
    * Receipt canvas displays: `Delivery: Free (৳0)`.
    * WhatsApp quick reply template omits advance delivery fee requests.
  * **Orders < ৳2,500**:
    * **Disqualified from automatic free delivery**, even if WooCommerce recorded 0 shipping or the customer claimed free delivery in the customer note.
    * Standard delivery fee is automatically added to COD:
      * Inside Dhaka: `Subtotal + ৳50` (e.g. Subtotal ৳1494 $\rightarrow$ `COD = ৳1544` as in Order #19046).
      * Outside Dhaka: `Subtotal + ৳90` (e.g. Subtotal ৳1500 $\rightarrow$ `COD = ৳1590`).
  * **Merchant Manual Override**:
    * If the store merchant explicitly clicks the `🎁 Free Delivery` toggle (`forceFreeShipping: true`) in the Order Confirmation Modal, the system honors the override unconditionally regardless of order subtotal.

---

### D. Zero-Shipping (`codNum === subNum`) Auto-Correction
* When WooCommerce imports an order where shipping was uncalculated or defaulted to 0, `COD` equals `Subtotal` (e.g., `Subtotal = ৳1494, Total = ৳1494`):
  * Inside Dhaka: Automatically corrects COD to `1494 + 50 = ৳1544`.
  * Outside Dhaka: Automatically corrects COD to `1500 + 90 = ৳1590`.
* The merchant is protected from dispatching orders where the courier delivery fee was omitted.

---

## 2. Courier Intelligence & Customer Risk Scoring

DEEN Commerce aggregates live delivery data across **Pathao Hermes/Aladdin** and **Steadfast Courier Fraud DB** to compute a unified composite customer risk score:

| Risk Tier | Delivery Success % | Return Rate | Recommended Action Item | WhatsApp Protocol |
| :--- | :--- | :--- | :--- | :--- |
| **LOW (Safe)** | $\ge 85\%$ | $< 15\%$ | Fast-track dispatch directly via Pathao. | Friendly order confirmation with COD total (`confirm_order`). |
| **MEDIUM (Moderate)** | $60\% - 84\%$ | $16\% - 40\%$ | Phone call verification before packaging. | Reconfirm address & delivery date (`confirm_order`). |
| **HIGH (Risky)** | $< 60\%$ or $\ge 3$ Returns | $> 40\%$ | **Mandatory Advance Delivery Charge Collection**. | Send strict High-Risk alert (`high_risk_notice`), collect ৳90 via bKash/Nagad before dispatch. |
| **NEW (Clean)** | No prior records | 0 Returns | Standard order verification. | Standard confirmation (`confirm_order`). |

---

## 3. Pathao OAuth & WooCommerce Plugin Bridge Architecture

### A. Authentication Hierarchy
When querying customer rating or booking a consignment, the extension resolves authentication in the following order:
1. **Active Pathao Portal Tab**: If `merchant.pathao.com` is open in any Chrome tab, queries the active session headlessly via content script messaging (`query_pathao_rating`).
2. **Local Token Cache**: Checks `chrome.storage.local` for `pathao_merchant_token` with valid `pathao_token_expiry`.
3. **Environment Credentials**: Inspects `.env` / `env.js` / storage keys (`PATHAO_CLIENT_ID`, `PATHAO_CLIENT_SECRET`, `PATHAO_USERNAME`, `PATHAO_PASSWORD`).
4. **WooCommerce Pathao Plugin Bridge (Zero Manual Entry)**:
   * If credentials are missing in the extension, the background worker sends message `{ action: "get_wc_pathao_credentials" }` to any active WooCommerce tab (`*://*/wp-admin/*`).
   * Content script `woocommerce.js` checks inlined script variables (`ptc_params`) or probes `/wp-admin/admin.php?page=pathao-courier` using active WordPress cookies.
   * Background worker calls Pathao's **B2B External Login API** (`https://api-hermes.pathao.com/aladdin/api/v1/external/login`) with `{ client_id, client_secret }`.
   * An OAuth access token is issued, cached, and immediately used to query the customer rating.

---

## 4. Incident Response & Troubleshooting Playbook

### Incident 1: Customer Rating Shows "Not Connected / Token Missing"
* **Symptom**: Popup or in-page rating card displays `⚪ Not Connected` or `Token Missing`.
* **Root Cause**:
  * No Pathao portal tab is open.
  * Direct `.env` credentials are not configured.
  * User is not logged into WooCommerce on `deencommerce.com/wp-admin`.
* **Resolution**:
  1. Open a tab to `https://deencommerce.com/wp-admin`.
  2. Open the extension popup, go to **🌐 Store Connect**, and click **⚡ 1-Click Active Session**.
  3. Ensure the Authenticated Profile Card appears showing `🛡️ Administrator` or `🛒 Shop Manager`.
  4. Pathao credentials and B2B tokens are automatically extracted and verified.

---

### Incident 2: Address Shows Village or Bazar Not Found in Dropdown
* **Symptom**: Customer gives a remote address like *"Chakla Bazar, Titas"* and district dropdown does not auto-select.
* **Root Cause**: Incomplete address without explicit district name.
* **Resolution**:
  1. Click **🌐 Smart Guess** in the DEEN Smart Address helper bar inside the Pathao modal.
  2. The background worker queries OpenStreetMap Nominatim reverse geocoding via `guess_address_online`.
  3. Reverse zone index automatically maps `Titas` $\rightarrow$ `Cumilla` (District) and selects the dropdowns.
  4. Click **📝 Full Address** to build the complete normalized address with district and upazila.

---

### Incident 3: Non-Delivery Report (NDR) Tracking Event
* **Symptom**: Customer parcel is marked *"Customer Unreachable"*, *"Rider Could Not Contact"*, or *"Customer Rescheduled"* by Pathao/Steadfast rider.
* **Risk**: Parcels not re-contacted within 24 hours are automatically returned to DEEN Commerce central warehouse, incurring return delivery fees.
* **Resolution**:
  1. WebMCP tool `process_ndr_tracking_event` flags the consignment as active NDR.
  2. Operator or AI agent opens WhatsApp Web to customer phone.
  3. Injects urgent NDR Rescue template:
     > *"আসসালামু আলাইকুম [Customer Name], DEEN Commerce থেকে আপনার অর্ডার #[ID] ডেলিভারির জন্য পাঠাও রাইডার যোগাযোগ করার চেষ্টা করছেন। অনুগ্রহ করে রাইডারের কল রিসিভ করুন অথবা আমাদের এই নাম্বারে জানান। ধন্যবাদ!"*

---

## 5. Deployment & Release Runbook

### Hotfix Deployment Procedure:
1. Make code modifications adhering strictly to `AGENTS.md` non-negotiable invariants.
2. Run the master test suite:
   ```powershell
   node run_all_suites.js
   ```
   **Do not proceed if any suite fails.**
3. Verify manifest declarations and version bump:
   * Increment `"version"` in `manifest.json` and `package.json` (e.g. `2.4.2` $\rightarrow$ `2.4.3`).
4. Commit and push changes to GitHub `main` branch.
5. In client machines, execute `update.bat` (Windows) or `./update.sh` (Mac/Linux), or click **🔄 Reload App** in the popup header.

