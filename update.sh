#!/usr/bin/env bash
set -e

echo "==================================================================="
echo "  DEEN Delivery Parser - 1-Click Extension Updater"
echo "  Repository: Sajid-ul-Islam/chrome-extension-delivery-parser"
echo "==================================================================="
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -d ".git" ] && command -v git >/dev/null 2>&1; then
    echo "[*] Git repository detected. Pulling latest updates from GitHub..."
    git fetch origin main
    git reset --hard origin/main
    echo ""
    echo "[SUCCESS] Extension updated successfully via Git!"
else
    echo "[*] Downloading latest ZIP from GitHub..."
    TMP_DIR=$(mktemp -d)
    ZIP_PATH="$TMP_DIR/update.zip"
    curl -fsSL "https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/archive/refs/heads/main.zip" -o "$ZIP_PATH"
    unzip -q "$ZIP_PATH" -d "$TMP_DIR"
    cp -R "$TMP_DIR/chrome-extension-delivery-parser-main/"* "$SCRIPT_DIR/"
    rm -rf "$TMP_DIR"
    echo ""
    echo "[SUCCESS] Extension files updated to latest version!"
fi

echo ""
echo "==================================================================="
echo "  NEXT STEP:"
echo "  In Chrome, click 'Reload App' in the extension popup"
echo "  or reload unpacked extension at chrome://extensions"
echo "==================================================================="
echo ""
