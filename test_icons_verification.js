/**
 * Automated Verification Test Suite for DEEN Commerce Official Icons
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log("==================================================");
console.log("🎨 Verifying DEEN Commerce Official Icons & Manifest Config");
console.log("==================================================");

// 1. Verify icons exist on disk
console.log("\n▶ Test 1: Verifying icon file existence...");
const requiredIcons = [
  { file: 'icons/icon16.png', w: 16, h: 16, type: 'png' },
  { file: 'icons/icon32.png', w: 32, h: 32, type: 'png' },
  { file: 'icons/icon48.png', w: 48, h: 48, type: 'png' },
  { file: 'icons/icon128.png', w: 128, h: 128, type: 'png' },
  { file: 'icons/deen_logo.png', w: 200, h: 200, type: 'png' },
  { file: 'icons/deen_logo.jpg', w: 200, h: 200, type: 'jpg', expectedSize: 4299 }
];

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const JPG_MAGIC = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);

for (const icon of requiredIcons) {
  const iconPath = path.join(__dirname, icon.file);
  assert(fs.existsSync(iconPath), `Icon file ${icon.file} must exist`);
  const buf = fs.readFileSync(iconPath);
  assert(buf.length > 0, `Icon file ${icon.file} must not be empty`);

  if (icon.type === 'png') {
    assert(buf.slice(0, 8).equals(PNG_MAGIC), `${icon.file} must have valid PNG magic bytes (not JPEG)`);
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    assert.strictEqual(width, icon.w, `${icon.file} width must be ${icon.w}`);
    assert.strictEqual(height, icon.h, `${icon.file} height must be ${icon.h}`);
  } else if (icon.type === 'jpg') {
    assert(buf.slice(0, 4).equals(JPG_MAGIC), `${icon.file} must have valid JPEG magic bytes`);
    assert.strictEqual(buf.length, icon.expectedSize, `${icon.file} size must match authentic byte-for-byte (Invariant 6)`);
  }
  console.log(`  ✅ ${icon.file} (${icon.w}x${icon.h}, ${icon.type.toUpperCase()}) verified.`);
}

// 2. Validate manifest.json icon configuration
console.log("\n▶ Test 2: Validating manifest.json icon declarations...");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));

assert(manifest.icons, "manifest.json must have 'icons' field");
assert.strictEqual(manifest.icons["16"], "icons/icon16.png", "manifest icons 16 must map to icons/icon16.png");
assert.strictEqual(manifest.icons["32"], "icons/icon32.png", "manifest icons 32 must map to icons/icon32.png");
assert.strictEqual(manifest.icons["48"], "icons/icon48.png", "manifest icons 48 must map to icons/icon48.png");
assert.strictEqual(manifest.icons["128"], "icons/icon128.png", "manifest icons 128 must map to icons/icon128.png");

assert(manifest.action && manifest.action.default_icon, "manifest.json must have action.default_icon");
assert.strictEqual(manifest.action.default_icon["16"], "icons/icon16.png", "action default_icon 16 must map to icons/icon16.png");
assert.strictEqual(manifest.action.default_icon["32"], "icons/icon32.png", "action default_icon 32 must map to icons/icon32.png");
assert.strictEqual(manifest.action.default_icon["48"], "icons/icon48.png", "action default_icon 48 must map to icons/icon48.png");
assert.strictEqual(manifest.action.default_icon["128"], "icons/icon128.png", "action default_icon 128 must map to icons/icon128.png");

const hasIconsWebAccessible = manifest.web_accessible_resources.some(war =>
  war.resources && war.resources.includes("icons/*")
);
assert(hasIconsWebAccessible, "manifest web_accessible_resources must include icons/*");
console.log("  ✅ manifest.json icons & action.default_icon & web_accessible_resources verified.");

// 3. Validate background.js notification icon
console.log("\n▶ Test 3: Validating background.js notification icon...");
const bgContent = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
assert(!bgContent.includes('iconUrl: "icons/deen_logo.jpg"'), "background.js must never use JPG for Chrome notification");
assert(bgContent.includes('iconUrl: "icons/icon48.png"'), "background.js must use valid PNG icons/icon48.png for desktop notifications");
console.log("  ✅ background.js notification icon verified.");

// 4. Validate popup.html branding & favicons
console.log("\n▶ Test 4: Validating popup.html branding & favicons...");
const popupHtml = fs.readFileSync(path.join(__dirname, 'popup.html'), 'utf8');
assert(popupHtml.includes('rel="icon"'), "popup.html must specify favicon links");
assert(popupHtml.includes('icons/icon32.png') || popupHtml.includes('icons/icon16.png'), "popup.html favicon must reference DEEN official icons");
assert(popupHtml.includes('src="icons/icon48.png"'), "popup.html header must render official DEEN brand logo");
console.log("  ✅ popup.html branding & favicons verified.");

// 5. Validate popup.css brand logo styles
console.log("\n▶ Test 5: Validating popup.css brand logo styling...");
const popupCss = fs.readFileSync(path.join(__dirname, 'popup.css'), 'utf8');
assert(popupCss.includes('.brand-logo-img'), "popup.css must contain .brand-logo-img styling");
console.log("  ✅ popup.css brand logo styling verified.");

console.log("\n>>> ALL OFFICIAL DEEN COMMERCE ICON VERIFICATION TESTS PASSED SUCCESSFULLY! <<<\n");
