# 📦 Product Requirements Document (PRD)

## DEEN Delivery Parser — Autonomous Courier Logistics & Dispatch Engine

**Document Version:** 1.2.1  
**Target Platform:** Google Chrome Extension (Manifest V3)  
**Primary Merchant:** DEEN Commerce (`deencommerce.com`)  
**Ecosystem:** Bangladesh E-Commerce (Pathao, Steadfast, RedX, WooCommerce, WhatsApp Web)

---

## 1. Executive Summary & Problem Statement

### 1.1 The Challenge in Bangladeshi E-Commerce
Operating high-velocity Direct-to-Consumer (D2C) fashion and apparel commerce in Bangladesh involves significant operational hurdles:
1. **High Return-to-Origin (RTO) Rate:** Cash-on-Delivery (COD) orders frequently suffer from 20% to 35% return rates due to fraudulent orders, impulse cancellations, and customer unreachability.
2. **False-Dhaka Delivery Fee Exploit:** Customers residing outside Dhaka (Gazipur, Savar, Narayanganj, Cumilla, Chittagong, etc.) frequently select "Inside Dhaka" delivery (paying only ৳50 instead of the standard ৳90 outside-Dhaka courier fee), resulting in massive merchant shipping losses.
3. **Manual Dispatch Latency:** Dispatch teams spend 3 to 5 minutes per order copying customer names, phones, addresses, and product line items from WooCommerce into Pathao Courier or Steadfast forms.
4. **Disjointed WhatsApp Confirmation:** Customer support agents manually copy and paste delivery fees, bKash numbers, and confirmation prompts into WhatsApp Web, risking typos and inconsistent messaging.
5. **Non-Delivery Report (NDR) Friction:** When couriers fail a first delivery attempt ("Customer phone switched off"), the package often returns to merchant without proactive customer rescue.

### 1.2 The Solution
**DEEN Delivery Parser** is a production-grade Chrome Extension (Manifest V3) purpose-built for DEEN Commerce. It integrates seamlessly into **WooCommerce Admin**, **Pathao Merchant Portal**, **WhatsApp Web**, and **Facebook CRM**, providing:
- 1-Click order dispatch to Pathao with intelligent form autofill.
- Real-time customer delivery success ratings aggregated across Pathao Hermes and Steadfast Courier networks.
- 24-hour local caching for zero-latency instant customer score lookups.
- 2x Retina Order Receipt canvas rendering for WhatsApp image confirmations.
- Automatic correction of False-Dhaka courier charges and enforcement of the ৳2,500 Free Shipping policy.
- Automated Non-Delivery Report (NDR) tracking alerts with 1-click WhatsApp customer rescue messages.
- W3C WebMCP AI tool registry exposing 12 autonomous logistics tools to browser agents.

---

## 2. User Personas

| Persona | Role | Key Pain Points | Core Feature Used |
| :--- | :--- | :--- | :--- |
| **Store Dispatch Manager** | Fulfillment & Logistics | Slow manual typing into Pathao; address typos; wrong district selection. | 1-Click Pathao Table Exporter, Order Confirmation Modal, Bulk Queue Auto-Advancement. |
| **Customer Support Agent** | WhatsApp & CRM Order Confirmation | Manually calculating courier fees; sending manual bKash numbers; dealing with hostile fake buyers. | Universal Phone Check, Floating Action Pill, WhatsApp Header Rating Badge, 1-Click Quick Replies. |
| **Operations Director / Store Owner** | Risk Management & Unit Economics | RTO shipping losses; undercharged delivery fees; API key leaks; lack of visibility into delivery health. | ৳2,500 Free Shipping Policy Enforcement, False-Dhaka ৳90 Correction, NDR Rescue Engine, WordPress SSO Sync. |

---

## 3. Core Features & Functional Requirements

### 3.1 1-Click Pathao Table Exporter & Autofill Engine
- **Requirement 3.1.1:** Parse tabular delivery data from `merchant.pathao.com` or WooCommerce table rows into clean, structured records.
- **Requirement 3.1.2:** Support batch export to Excel (`.xlsx`) and CSV (`.csv`) with full consignment metadata, delivery status, COD, and recipient phone.
- **Requirement 3.1.3:** Listen for autofill triggers and populate Pathao's `/courier/orders/create` modal across all standard form fields (Recipient Name, Phone, Address, City/District, Zone, COD, Weight, Item Description).
- **Requirement 3.1.4:** Automatically process Exchange Orders (`D-` prefix) with special exchange delivery instructions and zero extra COD.

### 3.2 2x Retina Order Receipt Canvas Generator
- **Requirement 3.2.1:** Render pixel-perfect, high-DPI (2x Retina scale) order receipts directly onto an HTML5 Canvas.
- **Requirement 3.2.2:** Pure white background (`#ffffff`) with authentic DEEN Orange (`#ea580c`) headers.
- **Requirement 3.2.3:** Byte-for-byte logo preservation using high-resolution embedded base64 assets (`DEEN_LOGO_BASE64`).
- **Requirement 3.2.4:** High-contrast Code 128 barcode simulation rendering the authentic Order ID.
- **Requirement 3.2.5:** 1-Click clipboard copy (`navigator.clipboard.write([ClipboardItem])`) allowing instant `Ctrl + V` pasting into WhatsApp Web.

### 3.3 Multi-Courier Customer Intelligence & Fraud Defense
- **Requirement 3.3.1:** Query Pathao Hermes API (`/aladdin/api/v1/user/success`) headlessly using active session tokens or B2B OAuth credentials.
- **Requirement 3.3.2:** Query Steadfast Courier fraud network (`/user/frauds/check/:phone`) headlessly using active session or API key.
- **Requirement 3.3.3:** Aggregate composite delivery metrics: Total Parcels, Delivered Count, Cancelled Count, Return Ratio, and Risk Rating Grade (`Excellent Customer`, `Good Customer`, `High Return Risk`).
- **Requirement 3.3.4:** Display color-coded risk pills across all interfaces:
  - 🟢 **Safe Buyer (Low Risk):** Success Rate $\ge 80\%$.
  - 🟡 **Moderate Caution (Medium Risk):** Success Rate $60\% - 79\%$.
  - 🔴 **High Return Risk:** Success Rate $< 60\%$.
  - 🔵 **New Customer:** 0 prior delivery records detected.

### 3.4 24-Hour Unified Local Rating Cache System
- **Requirement 3.4.1:** Store customer ratings in `chrome.storage.local` and in-memory Map with a **24-hour Time-to-Live (TTL)** (`86,400,000 ms`).
- **Requirement 3.4.2:** Prioritize local cache lookup: if a customer rating was checked within the last 24 hours, serve it in 0ms without sending background messages or querying external courier APIs.
- **Requirement 3.4.3:** Enforce a maximum capacity limit of **500 entries** using FIFO (First-In, First-Out) eviction to prevent storage quota bloat.
- **Requirement 3.4.4:** Provide a manual `🔄 Refresh` button across all modals, table cells, and badges allowing agents to force an immediate live re-query (`forceRefresh: true`).

### 3.5 Automated Non-Delivery Report (NDR) Rescue Listener
- **Requirement 3.5.1:** Detect failed delivery attempts in Pathao and Steadfast portals ("Customer phone switched off", "Customer unreachable", "Address incomplete", "Customer requested reschedule").
- **Requirement 3.5.2:** Persist active NDR alerts in extension storage and trigger high-priority desktop notifications.
- **Requirement 3.5.3:** Decorate table rows with an interactive `🚨 Rescue Order` action badge.
- **Requirement 3.5.4:** Generate personalized WhatsApp rescue deep links pre-populated with customer name, tracking ID, parcel status, and urgent re-delivery confirmation options.

### 3.6 WordPress SSO & WooCommerce Pathao Plugin Bridge
- **Requirement 3.6.1:** Authenticate with WordPress Admin via active session cookie without requiring manual API key input.
- **Requirement 3.6.2:** Proactively probe WooCommerce tabs (`get_wc_pathao_credentials`) to automatically extract Pathao Courier plugin settings (`client_id`, `client_secret`, `store_id`).
- **Requirement 3.6.3:** Support Pathao B2B External Login (`/aladdin/api/v1/external/login`) using credentials synchronized from the WooCommerce plugin.
- **Requirement 3.6.4:** Categorize WordPress user roles into `Administrator` and `Shop Manager` and display an Authenticated Account Profile Card in the extension popup.

### 3.7 W3C WebMCP Provider & Autonomous Browser Agents
- **Requirement 3.7.1:** Register with the W3C WebMCP tool registry (`navigator.modelContext` / `window.modelContext`).
- **Requirement 3.7.2:** Expose 12 fully typed AI tools covering phone parsing, address normalization, courier rating checks, order dispatch, canvas rendering, and NDR processing.
- **Requirement 3.7.3:** Support agentic query execution from AI Copilots with strict input schema validation and semantic safety hints (`readOnlyHint`, `consequentialHint`).

---

## 4. Financial Invariants & Business Logic Policies

### 4.1 Standard Delivery Fees
- **Inside Dhaka:** ৳50
- **Outside Dhaka:** ৳90
- **Sub-Dhaka (Gazipur, Savar, Keraniganj, Narayanganj):** ৳90

### 4.2 Free Shipping Threshold Policy (৳2,500 Rule)
- **Policy:** Automatic Free Shipping applies **ONLY when the product cost / subtotal is greater than or equal to ৳2,500** (`subtotal >= 2500`).
- **Subtotal $\ge$ ৳2,500:** Delivery fee is ৳0 (`COD = Subtotal`).
- **Subtotal $<$ ৳2,500:** Disqualified from automatic free shipping. Standard delivery fee is automatically added to COD (+৳50 inside Dhaka, +৳90 outside Dhaka).
- **Merchant Manual Override:** The 1-click `🎁 Free Delivery` toggle in the order confirmation modal (`forceFreeShipping: true`) is always honored regardless of subtotal.

### 4.3 False-Dhaka ৳50 Exploit Mitigation
- When an order destined for an Outside-Dhaka district (e.g. Cumilla, Bagerhat, Chittagong, Sylhet) arrives with Inside-Dhaka ৳50 shipping, the system automatically corrects the delivery fee to ৳90 and updates COD to `Subtotal + ৳90`.

---

## 5. Non-Functional Requirements

- **Performance:** Local cache lookup $\le 1\text{ ms}$; canvas screenshot rendering $\le 50\text{ ms}$; initial DOM badge injection $\le 250\text{ ms}$.
- **Reliability:** 100% pass rate across all 16 automated test suites.
- **Privacy & Security:** Strict isolation; zero unfiltered cookie scraping; credentials stored encrypted in Chrome protected local storage; no third-party tracking.
- **Compatibility:** Manifest V3 compliant; tested on Google Chrome 109.0+ and Microsoft Edge 109.0+.
