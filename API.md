# 🔌 API & Integration Specifications (API.md)

## DEEN Delivery Parser — Autonomous Courier Logistics & Dispatch Engine

**Document Version:** 1.2.1  
**Protocols:** REST / HTTPS / JSON / Chrome Extension MV3 Messaging / W3C WebMCP  
**Target Upstreams:** Pathao Hermes API, Steadfast Courier, OpenStreetMap Nominatim, WooCommerce Admin AJAX

---

## 1. Upstream Courier API Specifications

### A. Pathao Hermes API (`https://api-hermes.pathao.com`)

The extension communicates with Pathao Hermes API for OAuth token issuance, B2B external authentication, and customer courier rating queries.

#### 1. OAuth Password Grant (Direct Credentials)
* **Endpoint:** `POST https://api-hermes.pathao.com/aladdin/api/v1/issue-token`
* **Headers:**
  ```http
  Content-Type: application/json
  Accept: application/json
  ```
* **Payload:**
  ```json
  {
    "client_id": "CLIENT_ID",
    "client_secret": "CLIENT_SECRET",
    "username": "MERCHANT_EMAIL",
    "password": "MERCHANT_PASSWORD",
    "grant_type": "password"
  }
  ```
* **Response (200 OK):**
  ```json
  {
    "token_type": "Bearer",
    "expires_in": 2592000,
    "access_token": "JWT_ACCESS_TOKEN",
    "refresh_token": "JWT_REFRESH_TOKEN"
  }
  ```

#### 2. Pathao B2B External Login (WooCommerce Plugin Bridge)
* **Endpoint:** `POST https://api-hermes.pathao.com/aladdin/api/v1/external/login`
* **Headers:**
  ```http
  Content-Type: application/json
  Accept: application/json
  ```
* **Payload:**
  ```json
  {
    "client_id": "WC_PLUGIN_CLIENT_ID",
    "client_secret": "WC_PLUGIN_CLIENT_SECRET"
  }
  ```
* **Response (200 OK):**
  ```json
  {
    "token_type": "Bearer",
    "access_token": "JWT_ACCESS_TOKEN",
    "expires_in": 2592000
  }
  ```

#### 3. Customer Courier Rating Query
* **Endpoint:** `GET https://api-hermes.pathao.com/aladdin/api/v2/user/rating?phone={11_DIGIT_PHONE}`
* **Headers:**
  ```http
  Authorization: Bearer {ACCESS_TOKEN}
  Accept: application/json
  ```
* **Response (200 OK):**
  ```json
  {
    "data": {
      "user_phone": "017XXXXXXXX",
      "total_delivered": 18,
      "total_returned": 2,
      "delivery_ratio": 90,
      "rating_score": 4.5,
      "grade": "Top Merchant"
    }
  }
  ```

---

### B. Steadfast Courier Fraud DB API (`https://steadfast.com.bd`)

* **Endpoint:** `POST https://steadfast.com.bd/api/v1/fraud-check`
* **Headers:**
  ```http
  Api-Key: {STEADFAST_API_KEY}
  Secret-Key: {STEADFAST_SECRET_KEY}
  Content-Type: application/json
  ```
* **Payload:**
  ```json
  {
    "phone": "017XXXXXXXX"
  }
  ```
* **Response (200 OK):**
  ```json
  {
    "status": 200,
    "data": {
      "phone": "017XXXXXXXX",
      "total_parcels": 12,
      "success_delivery": 11,
      "return_delivery": 1,
      "success_ratio": "91.6%"
    }
  }
  ```

---

### C. OpenStreetMap Nominatim Geocoding API (`https://nominatim.openstreetmap.org`)

* **Endpoint:** `GET https://nominatim.openstreetmap.org/search`
* **Query Parameters:**
  - `q`: Raw address or bazar/upazila name
  - `countrycodes`: `bd`
  - `format`: `json`
  - `addressdetails`: `1`
  - `limit`: `1`
* **Response Shape:**
  ```json
  [
    {
      "place_id": 1234567,
      "address": {
        "town": "Sharsha",
        "state_district": "Jashore",
        "ISO3166-2-lvl5": "BD-22",
        "postcode": "7432"
      }
    }
  ]
  ```

---

## 2. Internal Chrome Runtime Messaging Contracts

Content scripts (`woocommerce.js`, `phone-check.js`, `content.js`, `popup.js`) communicate with the background service worker (`background.js`) via `chrome.runtime.sendMessage`:

### 1. `check_customer_rating`
* **Direction:** Content Script / Popup -> Service Worker
* **Payload:**
  ```json
  {
    "action": "check_customer_rating",
    "phone": "01715485035",
    "forceRefresh": false
  }
  ```
* **Response:**
  ```json
  {
    "success": true,
    "source": "PATHAO",
    "cached": true,
    "cacheSource": "memory",
    "data": {
      "phone": "01715485035",
      "successRate": 95,
      "totalDelivered": 19,
      "totalReturned": 1,
      "grade": "Top Merchant"
    }
  }
  ```

### 2. `sync_wordpress_admin`
* **Direction:** Popup -> Service Worker
* **Payload:**
  ```json
  {
    "action": "sync_wordpress_admin"
  }
  ```
* **Response:**
  ```json
  {
    "success": true,
    "user": "Sajid (Store Admin)",
    "login": "admin",
    "role": "Administrator",
    "permissions": "manage_options, manage_woocommerce",
    "siteUrl": "https://deencommerce.com"
  }
  ```

### 3. `get_wc_pathao_credentials`
* **Direction:** Service Worker -> WooCommerce Tab Content Script
* **Payload:**
  ```json
  {
    "action": "get_wc_pathao_credentials"
  }
  ```
* **Response:**
  ```json
  {
    "success": true,
    "credentials": {
      "pathao_client_id": "CLIENT_ID",
      "pathao_client_secret": "CLIENT_SECRET"
    }
  }
  ```

### 4. `guess_address_online`
* **Direction:** Content Script -> Service Worker
* **Payload:**
  ```json
  {
    "action": "guess_address_online",
    "addressText": "Sharsha Bazar"
  }
  ```
* **Response:**
  ```json
  {
    "success": true,
    "district": "Jashore",
    "zone": "Sharsha",
    "postcode": "7432",
    "source": "Nominatim"
  }
  ```
