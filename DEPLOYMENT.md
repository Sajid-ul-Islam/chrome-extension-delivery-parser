# 🚀 Deployment, Packaging & Distribution Guide (DEPLOYMENT.md)

## DEEN Delivery Parser — Autonomous Courier Logistics & Dispatch Engine

**Document Version:** 1.2.1  
**Target Architecture:** Google Chrome Extension Manifest V3 (MV3)  
**Distribution Channels:** Developer Unpacked / 1-Click Git Auto-Update / Chrome Web Store Private Distribution

---

## 1. Local Developer Mode Installation

For active development, warehouse terminals, and customer service workstations:

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser.git
   cd chrome-extension-delivery-parser
   ```
2. **Configure Runtime Credentials (Zero Node.js Required!)**:
   - The extension auto-syncs credentials directly from an active `deencommerce.com/wp-admin` session via the **🌐 Store Connect** tab in the extension popup.
   - Alternatively, copy `.env.example` to `env.js`:
     ```javascript
     window.__RUNTIME_CONFIG__ = {
       PATHAO_CLIENT_ID: "your_client_id",
       PATHAO_CLIENT_SECRET: "your_client_secret",
       PATHAO_USERNAME: "your_merchant_email",
       PATHAO_PASSWORD: "your_merchant_password",
       STEADFAST_API_KEY: "your_steadfast_key",
       STEADFAST_SECRET_KEY: "your_steadfast_secret"
     };
     ```
3. **Load Unpacked in Chrome**:
   - Navigate to `chrome://extensions/`.
   - Enable **Developer mode** toggle in the top-right corner.
   - Click **Load unpacked** (top-left).
   - Select the `chrome-extension-delivery-parser` directory.
   - Pin the **DEEN Delivery Parser** icon to your Chrome toolbar.

---

## 2. In-App Hot-Reload & 1-Click Auto-Updates

The extension includes built-in update triggers for warehouse staff:

### A. Windows 1-Click Update Script
Double-click `update.bat` in the extension root:
```bat
@echo off
git pull origin main
echo Extension updated successfully! Open Chrome popup and click "Reload App".
pause
```

### B. macOS / Linux 1-Click Update Script
Run `update.sh` in terminal:
```bash
chmod +x update.sh
./update.sh
```

### C. Extension Popup Hot-Reload
1. Open the DEEN Delivery Parser popup.
2. If an update is detected on GitHub, an **Update Banner** appears.
3. Click **`🔄 Reload App`** to hot-reload the extension in Chrome memory immediately without needing to open `chrome://extensions`.

---

## 3. Production Zip Packaging Checklist

When creating a release zip bundle for Chrome Web Store submission or internal distribution:

### Production Package Inclusions
```text
chrome-extension-delivery-parser/
├── manifest.json
├── background.js
├── parser.js
├── woocommerce.js
├── woocommerce.css
├── phone-check.js
├── phone-check.css
├── content.js
├── content.css
├── courier-adapters.js
├── webmcp-provider.js
├── deen-assistant.js
├── deen-floating-chat.js
├── deen-floating-chat.css
├── popup.html
├── popup.js
├── popup.css
├── xlsx.mini.min.js
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   ├── icon128.png
│   ├── deen_logo.png
│   └── deen_logo.jpg
└── README.md
```

### Strict Exclusions from Production Archive
* `.git/`, `.gitignore`
* All test files (`test_*.js`, `run_all_suites.js`)
* Temporary helper scripts (`temp_*.js`, `patch_*.js`, `fix_*.js`)
* Local secret configurations (`.env`, `env.js` containing real credentials)

---

## 4. Chrome Web Store Submission & Justifications

### Permission Justifications for Review
When submitting to the Chrome Web Store Developer Dashboard:

1. **`activeTab`**: Required to extract order table data and consignment details from the current page upon user action.
2. **`storage`**: Required to persist user UI preferences and the 24-hour customer courier rating cache locally.
3. **`clipboardWrite`**: Required to copy the 2x Retina Order Receipt canvas and TSV tables to the clipboard for instant paste into WhatsApp Web and Google Sheets.
4. **`contextMenus`**: Required to allow right-click phone fraud lookups from selected text.
5. **`cookies`**: Required to detect active session authentication on the merchant's verified store domain (`deencommerce.com`) and courier portal (`pathao.com`) for zero-manual-entry API key synchronization.
6. **`host_permissions`**:
   - `https://api-hermes.pathao.com/*`: Official Pathao courier rating and consignment tracking API.
   - `https://merchant.pathao.com/*`: Merchant portal interface automation.
   - `https://*.deencommerce.com/*`: Store admin session synchronization.
   - `https://nominatim.openstreetmap.org/*`: BD upazila geocoding fallback for obscure delivery addresses.
