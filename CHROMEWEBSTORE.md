# Chrome Web Store Listing — DEEN Delivery Parser - Courier & Pathao Exporter

> Last Updated: 2026-11-14

## Store Listing

**Extension Name** [REQUIRED]
DEEN Delivery Parser - Courier & Pathao Exporter

**Short Description** [REQUIRED]
Extract, parse, and export courier deliveries directly to Excel and CSV with 1-click and live delivery success metrics.

**Detailed Description** [REQUIRED]
DEEN Delivery Parser streamlines e-commerce fulfillment by automatically organizing courier deliveries, evaluating delivery success rates, and generating clean spreadsheet exports in one click.

Key Features:
- 1-Click Spreadsheet Exports: Convert active delivery lists on courier portals into structured Excel (.xlsx) and CSV files instantly.
- Delivery Success Insights: Check customer fulfillment reliability ratings across supported couriers before dispatching parcels to reduce return rates.
- Order Dispatch Helper: Fast-track consignment creation by auto-populating recipient details, contact numbers, and delivery zones.
- Digital Receipt Canvas: Generate sharp, branded customer receipts with itemized order summaries ready to copy and send.
- Omnichannel Support: Works seamlessly across courier merchant portals, order management dashboards, and communication tabs.
- Side Panel & Quick View: Access search history and delivery verification directly from Chrome's side panel without switching tabs.

How To Use:
1. Click the DEEN Delivery Parser icon in your browser toolbar or right-click to open the side panel.
2. On your courier merchant portal or order admin dashboard, click "Export to Excel" or "Parse Orders" to extract delivery records.
3. Highlight any customer phone number and right-click to instantly check their historical delivery success ratio.
4. Download cleanly formatted Excel/CSV files or dispatch directly to your courier queue.

Privacy & Security:
DEEN Delivery Parser values your business privacy. All parsing, data sanitization, and spreadsheet generation occur locally inside your browser sandbox. Your customer records and order data are never sold, rented, or sent to unauthorized third-party servers.

Support & Inquiries:
For questions, feature requests, or enterprise support, reach out to support@deencommerce.com or submit feedback through the extension settings.

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
Extracts courier delivery orders and checks customer delivery success ratios across courier portals and order management dashboards.

**Primary Language** [REQUIRED]
English

---

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|---|---|---|---|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `icons/icon128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 | 🟡 Needs update | `store-assets/screenshot1-delivery-export.png` |
| Screenshot 2 [RECOMMENDED] | 1280×800 | 🟡 Needs update | `store-assets/screenshot2-customer-rating.png` |
| Screenshot 3 [RECOMMENDED] | 1280×800 | 🟡 Needs update | `store-assets/screenshot3-order-dispatch.png` |
| Screenshot 4 | 1280×800 | 🟡 Needs update | `store-assets/screenshot4-receipt-canvas.png` |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | `store-assets/promo-440x280.png` |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | `store-assets/marquee-1400x560.png` |

### Screenshot Notes
- Screenshot 1: In-page floating toolbar on Pathao merchant portal showing live KPI metrics (Total Parcels, Paid vs Unpaid, Net Revenue) and the "Export to Excel" button.
- Screenshot 2: WooCommerce order table with the customer delivery success rating column (green/amber risk badges).
- Screenshot 3: Popup dashboard and side panel performing universal phone number fraud and delivery ratio lookup.
- Screenshot 4: 2x Retina digital order receipt canvas ready for 1-click clipboard copy.

---

## Permissions Justification

| Permission | Type | Justification |
|---|---|---|
| `activeTab` | permissions | Used to extract order delivery tables and read user selections when explicitly clicked by the user. |
| `scripting` | permissions | Injects the local spreadsheet generator (`xlsx.mini.min.js`) on courier pages upon user export request. |
| `storage` | permissions | Caches courier delivery success ratios locally for 24 hours to prevent repeated network queries and stores user preferences. |
| `clipboardWrite` | permissions | Allows 1-click copy of the generated 2x Retina order receipt canvas image and TSV table data to the system clipboard. |
| `contextMenus` | permissions | Adds right-click shortcuts allowing merchants to highlight customer phone numbers and instantly check delivery history. |
| `tabs` | permissions | Required to switch to active courier fulfillment tabs during 1-click parcel dispatch from order tables. |
| `notifications` | permissions | Alerts warehouse personnel when long-running parcel exports complete or when a Non-Delivery Report (NDR) requires urgent attention. |
| `sidePanel` | permissions | Displays customer delivery risk ratings, search history, and parser tools in Chrome's side panel alongside active workflows. |
| `cookies` | permissions | Verifies active authentication session status on authorized merchant portals (Pathao and store admin) so users don't have to re-login. |
| `https://*.pathao.com/*` | host_permissions | Required to fetch courier delivery statuses, parse parcel tables, and check delivery success ratios on Pathao merchant portal. |
| `https://steadfast.com.bd/*` | host_permissions | Used to query courier fraud and delivery ratio verification on Steadfast courier API. |
| `*://deencommerce.com/*` | host_permissions | Connects to merchant's WooCommerce admin order tables to extract shipping addresses, phone numbers, and line items. |
| `https://api.redx.com.bd/*` | host_permissions | Checks parcel delivery status on RedX logistics network. |
| `https://nominatim.openstreetmap.org/*` | host_permissions | Provides address autocomplete and district/thana zone suggestions for courier consignment creation. |
| `https://api.github.com/*` | host_permissions | Checks for official extension version updates and security releases. |
| `https://agent.tinyfish.ai/*` | host_permissions | Provides optional AI assistant integration for parcel note interpretation when configured by user. |

---

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Yes (processed strictly on-device)

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|---|---|---|---|---|
| Personally identifiable info (Name, Phone, Address) | Yes | Yes (to user's chosen courier APIs) | Core Functionality: Required to fill courier consignment forms and check delivery ratios with Pathao/Steadfast. | No. Only sent directly to the courier selected by the user. |
| Health info | No | No | N/A | No |
| Financial info (COD amount, Delivery fees) | Yes | Yes (to user's courier APIs) | Core Functionality: Required to declare Cash on Delivery amounts for parcel dispatch. | No |
| Authentication info (Session cookies, API tokens) | Yes | Yes (to authorized store/courier APIs) | Core Functionality: Authenticates API requests to merchant's own store and courier accounts. | No |
| Personal communications | No | No | N/A | No |
| Location | No | No | N/A | No |
| Web history | No | No | N/A | No |
| User activity | No | No | N/A | No |
| Website content (Order rows) | Yes | No | Core Functionality: Extracts order table rows to generate Excel/CSV files on user command. | No. Export files are generated in-memory on the client machine. |

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

---

## Privacy Policy

**Privacy Policy URL** [REQUIRED]
https://deencommerce.com/privacy-policy-extension

---

## Distribution

**Visibility**: Unlisted (for internal team / merchant operations) or Public  
**Regions**: Bangladesh, Worldwide

---

## Developer Info

**Publisher Name** [REQUIRED]
DEEN Commerce

**Contact Email** [REQUIRED]
security@deencommerce.com

**Support URL / Email** [RECOMMENDED]
support@deencommerce.com

**Homepage URL** [RECOMMENDED]
https://deencommerce.com

---

## Version History

| Version | Date | Changes | Status |
|---|---|---|---|
| 1.2.1 | 2026-11-14 | Enterprise logistics copilot, 24h rating cache, WebMCP provider integration, 19 test suites, CSP compliance fix. | Draft |
| 1.2.0 | 2026-11-01 | React 18 / Ant Design auto-fill engine, retina canvas receipt generator, WhatsApp Web header detector. | Published |
| 1.1.0 | 2026-10-15 | Lazy-loaded customer risk rating column, Steadfast multi-courier API bridge. | Published |
| 1.0.0 | 2026-09-15 | Initial release: Pathao order table extraction and SheetJS Excel export. | Published |

---

## Review Notes

### Known Issues / Limitations
1. `.env` and `env.js` containing development API credentials must be excluded from the Chrome Web Store production package ZIP.
2. The `*://*/*` content script match in `manifest.json` for `phone-check.js` should be scoped to specific target domains (or converted to `activeTab` / optional permissions) to avoid Chrome Web Store review scrutiny.
3. Plaintext HTTP matches (`http://*.pathao.com/*`) in `host_permissions` should be upgraded strictly to `https://`.
