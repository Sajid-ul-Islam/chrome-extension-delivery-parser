# ⚡ DEEN Delivery Parser — Chrome Extension

A standalone Chrome Extension (Manifest V3) that extracts, parses, and exports Pathao and courier deliveries directly to **Excel (.xls)**, **CSV**, and **Clipboard** with zero manual copy-pasting.

---

## 🌟 Key Features

1. **⚡ In-Page Floating Toolbar (on `merchant.pathao.com`)**:
   - Injects a discrete, stylish floating pill in the bottom-right corner of the Pathao merchant portal.
   - Automatically detects parcels on screen.
   - 1-Click buttons for:
     - **📥 Export to Excel (.xls)** with formatted currency and header styles
     - **📄 Export to CSV** with UTF-8 BOM encoding for proper Bengali text support
     - **📋 Copy as Table (TSV)** to paste cleanly into Google Sheets or DEEN-OPS
     - **🔄 Live Rescan**

2. **🌐 Universal Extension Popup (Works on Any Page)**:
   - **Current Tab Extractor**: Automatically scans active tab text and extracts parcels.
   - **Paste & Parse**: Paste raw courier blocks or unstructured notes with optional **Force Aggressive Fuzzy Mode**.
   - **Live KPI Dashboard**:
     - *Total Parcels*
     - *Paid vs. Unpaid*
     - *Total COD Amount (৳)*
     - *Net Revenue (৳)*
   - **Interactive Table**: Search by consignment, order ID, phone, customer name, or status.

3. **🧠 Dual-Engine Delivery Parser**:
   - Ported from `src/processing/delivery_parser.py`.
   - Sequential state machine for standard Pathao table outputs.
   - Intelligent regex & fuzzy extractor for fragmented or unstructured notes.

4. **🖱️ Right-Click Context Menu**:
   - Highlight any delivery text anywhere on the web, right-click, and choose **"🧩 Parse Courier Records with DEEN Parser"**.

---

## 🚀 How to Install in Google Chrome

1. Open Google Chrome.
2. Navigate to:
   ```text
   chrome://extensions
   ```
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click the **Load unpacked** button in the top-left corner.
5. Select this folder:
   ```text
   h:\Repo\Order Process Automation\chrome-extension-delivery-parser
   ```
6. The extension is now installed! Pin it to your Chrome toolbar for quick access.

---

## 📦 How to Move & Push to a New Git Repository

Because this folder is completely self-contained, you can move it to any directory and initialize it as its own Git repository:

```bash
# 1. Copy or move this folder to your desired location (e.g. your projects folder)
cp -r chrome-extension-delivery-parser /path/to/my-new-repo
cd /path/to/my-new-repo

# 2. Initialize a fresh Git repository
git init
git branch -M main

# 3. Add files and make initial commit
git add .
git commit -m "Initial commit: DEEN Delivery Parser Chrome Extension (Manifest V3)"

# 4. Connect to your GitHub repository and push
git remote add origin https://github.com/<YOUR_USERNAME>/<YOUR_REPOSITORY_NAME>.git
git push -u origin main
```

---

## 📂 Project Structure

```text
chrome-extension-delivery-parser/
├── manifest.json         # Chrome Manifest V3 configuration
├── parser.js             # Core extraction & parsing engine (ported from Python)
├── background.js         # Service worker & context menu handler
├── content.js            # In-page extractor & floating widget script
├── content.css           # Scoped styles for in-page floating toolbar
├── popup.html            # Extension popup user interface
├── popup.css             # Extension popup styling (dark modern theme)
├── popup.js              # Popup controller, search, KPIs & export actions
├── icons/
│   ├── icon16.png        # 16x16 icon
│   ├── icon48.png        # 48x48 icon
│   └── icon128.png       # 128x128 icon
├── create_icons.py       # Python PIL script to regenerate icons
├── .gitignore            # Git ignore rules
└── README.md             # Documentation
```

---

## 📄 License
MIT License. Created for DEEN Operations.
