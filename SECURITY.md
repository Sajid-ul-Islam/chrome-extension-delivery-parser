# 🔒 Security Policy & Governance (SECURITY.md)

## DEEN Delivery Parser — Autonomous Courier Logistics & Dispatch Engine

**Document Version:** 1.2.1  
**Last Updated:** November 2026  
**Security Level:** Production / Tier-1 Enterprise Logistics  
**Target Environment:** Google Chrome Extension Manifest V3 (MV3)

---

## 1. Supported Versions

Security updates, vulnerability patches, and cryptographic dependency updates are actively maintained for the following versions:

| Version | Status | Release Date | Support Level |
| :---: | :---: | :---: | :---: |
| **v1.2.x** | 🟢 Active | November 2026 | Full Security & Functional Patch Support (Current Production) |
| **v1.1.x** | 🟡 Maintenance | October 2026 | Critical Security Fixes Only |
| **v1.0.x** | 🔴 Deprecated | September 2026 | End of Life (Upgrade to v1.2.1 Required) |

---

## 2. Chrome Extension Manifest V3 Security Architecture

The **DEEN Delivery Parser** adheres strictly to the security mandates of **Google Chrome Manifest V3**:

### A. Zero Remote Code Execution (Strict CSP)
* **No `eval()` or Dynamic Strings**: The extension strictly forbids `eval()`, `new Function()`, or dynamic code construction from string primitives.
* **No Remotely Hosted Code**: All executable scripts (`parser.js`, `woocommerce.js`, `phone-check.js`, `content.js`, `background.js`, `webmcp-provider.js`, `deen-assistant.js`, `deen-floating-chat.js`) and third-party libraries (`xlsx.mini.min.js`) are bundled locally within the extension archive.
* **Zero External CDN Dependencies**: Icon assets, brand logos, and stylesheets are loaded from local extension storage (`chrome-extension://<id>/...`), preventing compromise via malicious CDN updates.

### B. Principle of Least Privilege (Permission Scoping)
Permissions declared in [`manifest.json`](https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/blob/main/manifest.json) are scoped to the minimum required operational surface:

| Permission | Justification & Security Boundaries |
| :--- | :--- |
| `activeTab` | Accesses DOM of the active tab only upon explicit user gesture (e.g. clicking extension icon or action button). |
| `storage` | Persists encrypted OAuth tokens, courier API keys, and the 24-hour customer rating cache locally. |
| `clipboardWrite` | Required for 1-click clipboard copy of the 2x Retina Order Receipt canvas and TSV table data. |
| `contextMenus` | Injects right-click context menu shortcuts for instant phone fraud checks. |
| `tabs` | Enables background worker to switch to Pathao dispatch tabs (`/courier/orders/create`) during single order fulfillment. |
| `notifications` | Emits Non-Delivery Report (NDR) rescue alerts and background sync status to warehouse personnel. |
| `sidePanel` | Hosts the universal phone lookup history drawer across supported workflows. |
| `cookies` | Used strictly to verify active store admin sessions (`deencommerce.com`) and Pathao login state (`pathao.com`). |

---

## 3. Data Protection & Sensitive Credential Isolation

### A. Non-Negotiable Invariant 4: No Unfiltered Cookie Scraping
`background.js` **never** calls `chrome.cookies.getAll({}, ...)`. Cookies are accessed strictly for:
1. `pathao.com`: Verifying active courier merchant authentication.
2. `deencommerce.com`: Probing active WordPress admin session cookies for headless courier key synchronization.

### B. Storage Isolation (`chrome.storage.local`)
* Sensitive API keys (Pathao client secrets, Steadfast API keys) are stored in `chrome.storage.local`.
* This storage sandbox is strictly isolated per Chrome extension ID and is never accessible to scripts running in web pages, third-party extensions, or external web origins.
* Content scripts run in **Isolated Worlds**, ensuring web page JavaScript cannot inspect extension memory or hijack in-flight courier authentication headers.

### C. WhatsApp Web Privacy & Data Protection
* Phone numbers extracted on `web.whatsapp.com` are normalized locally in browser memory (`phone-check.js`).
* Customer chat messages are **never** logged to external servers, telemetried, or stored remotely.
* All Banglish / Bengali customer note interpretations (`deen-assistant.js`) run in-memory using zero-cost deterministic logic on the client machine.

---

## 4. Upstream Courier Authentication Security

1. **Pathao Hermes OAuth 2.0 & B2B External Login**:
   - Access tokens are acquired headlessly via Pathao's official B2B External Login endpoint (`/aladdin/api/v1/external/login`) or password grant (`/aladdin/api/v1/issue-token`).
   - Tokens are stored in volatile memory Maps and cached in `chrome.storage.local` with strict TTL expiration.
   - All outgoing requests to `api-hermes.pathao.com` enforce HTTPS/TLS 1.3 transport security.
2. **Steadfast Courier Fraud DB**:
   - Fraud queries are issued with secret API keys transmitted via custom authorization headers over TLS.
   - Sensitive response metrics (delivery rates, cancellations) are cached in memory for 24 hours to minimize external surface calls.

---

## 5. Vulnerability Disclosure & Incident Response

We welcome responsible security disclosures from security researchers, merchants, and team members.

### Reporting a Vulnerability
If you discover a security vulnerability or credential exposure risk:
1. **Do NOT open a public GitHub issue.**
2. Send an encrypted advisory to the DEEN Commerce Security Team at:
   - **Email:** `security@deencommerce.com`
   - **Alternative:** Direct ping to the Lead Forward Deployed Engineer via internal Slack / WhatsApp emergency bridge.
3. Include detailed reproduction steps, target URLs, and proof-of-concept payloads where applicable.

### Response Timelines & SLAs
* **Initial Acknowledgment:** Within 4 hours of receipt.
* **Triage & Severity Assessment:** Within 12 hours.
* **Patch Deployment:** Critical security vulnerabilities (token leakage, authentication bypass) are patched within **24 hours** via hot-reload updates (`update.bat` / Chrome Web Store emergency push).
