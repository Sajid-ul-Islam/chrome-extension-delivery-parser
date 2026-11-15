const assert = require('assert');
const { normalizeCustomerName } = require('./parser.js');

// Verification Tests
const testCases = [
  { input: "  MD. RAFIQUL ISLAM  ", expected: "Md. Rafiqul Islam" },
  { input: "sajid ul islam", expected: "Sajid Ul Islam" },
  { input: "md saiful islam", expected: "Md. Saiful Islam" },
  { input: "mst. shirin akter", expected: "Mst. Shirin Akter" },
  { input: "mst shirin akter", expected: "Mst. Shirin Akter" },
  { input: "Customer: Md. Tanvir (01715485035)", expected: "Md. Tanvir" },
  { input: "01812345678 Kazi Morshed", expected: "Kazi Morshed" },
  { input: "Tanvir Hossain - Mirpur, Dhaka", expected: "Tanvir Hossain" },
  { input: "Farhana Akter [Order #19046]", expected: "Farhana Akter" },
  { input: " মোঃ রফিকুল ইসলাম ", expected: "মোঃ রফিকুল ইসলাম" },
  { input: "মোসাঃ শিরিন আক্তার", expected: "মোসাঃ শিরিন আক্তার" },
  { input: "মোঃসাজিদ", expected: "মোঃ সাজিদ" },
  { input: "Dr. Mahbubur Rahman", expected: "Dr. Mahbubur Rahman" },
  { input: "engr. nazmul hasan", expected: "Engr. Nazmul Hasan" },
  { input: "user@example.com", expected: "" },
  { input: "01715485035", expected: "" },
  { input: "Customer", expected: "" },
  { input: "N/A", expected: "" },
  { input: "Tanvir ❤️", expected: "Tanvir" },
  { input: "\"Sajid\"", expected: "Sajid" },
  { input: "Tanvir (01715485035", expected: "Tanvir" },
  { input: "[Tanvir Hossain]", expected: "Tanvir Hossain" },
  { input: "Mr. Sakib Al Hasan", expected: "Mr. Sakib Al Hasan" },
  { input: "mrs. farhana akter", expected: "Mrs. Farhana Akter" },
  { input: "Alhaj Md. Rafiqul Islam", expected: "Al-Haj Md. Rafiqul Islam" },
  { input: "Haji Mohammad Ali", expected: "Haji Mohammad Ali" },
  { input: "advocate aminul islam", expected: "Adv. Aminul Islam" },
  { input: "professor abdul karim", expected: "Prof. Abdul Karim" },
  { input: "Tanvir (call before delivery)", expected: "Tanvir" },
  { input: "আলহাজ্ব মোঃ রফিকুল ইসলাম", expected: "আলহাজ্ব মোঃ রফিকুল ইসলাম" },
  { input: "ডাঃ মাহবূবুর রহমান", expected: "ডাঃ মাহবূবুর রহমান" },
  { input: "ইঞ্জিঃ নাজমুল হাসান", expected: "ইঞ্জিঃ নাজমুল হাসান" },

  // Redundant Name Normalization (Same-Script & Cross-Language Bangla/English)
  { input: "Sajid Sajid", expected: "Sajid" },
  { input: "সাজিদ সাজিদ", expected: "সাজিদ" },
  { input: "Md. Tanvir Md. Tanvir", expected: "Md. Tanvir" },
  { input: "মোঃ তানভীর মোঃ তানভীর", expected: "মোঃ তানভীর" },
  { input: "Tanvir Hossain Tanvir Hossain", expected: "Tanvir Hossain" },
  { input: "তানভীর হোসেন তানভীর হোসেন", expected: "তানভীর হোসেন" },
  { input: "Tanvir Tanvir Hossain", expected: "Tanvir Hossain" },
  { input: "Tanvir Hossain Tanvir", expected: "Tanvir Hossain" },
  { input: "Md. Tanvir Tanvir", expected: "Md. Tanvir" },
  { input: "Md. Md. Tanvir", expected: "Md. Tanvir" },
  { input: "মোঃ মোঃ তানভীর", expected: "মোঃ তানভীর" },
  { input: "তানভীর তানভীর", expected: "তানভীর" },
  { input: "Sajid সাজিদ", expected: "Sajid" },
  { input: "সাজিদ Sajid", expected: "Sajid" },
  { input: "Md. Tanvir মোঃ তানভীর", expected: "Md. Tanvir" },
  { input: "মোঃ তানভীর Md. Tanvir", expected: "Md. Tanvir" },
  { input: "Tanvir (তানভীর)", expected: "Tanvir" },
  { input: "তানভীর (Tanvir)", expected: "Tanvir" },
  { input: "Farhana Akter ফারহানা আক্তার", expected: "Farhana Akter" },
  { input: "ফারহানা আক্তার Farhana Akter", expected: "Farhana Akter" },
  { input: "Sakib Al Hasan সাকিব আল হাসান", expected: "Sakib Al Hasan" },
  { input: "Tanvir (Tanvir)", expected: "Tanvir" },
  { input: "Tanvir / তানভীর", expected: "Tanvir" },
  { input: "Tanvir - তানভীর", expected: "Tanvir" },
  { input: "Md. Rafiqul Islam - মোঃ রফিকুল ইসলাম", expected: "Md. Rafiqul Islam" },
  { input: "Boro dealer Sahadat বড় ডিলার শাহাদাত", expected: "Boro Dealer Sahadat" }
];

testCases.forEach((tc, i) => {
  const actual = normalizeCustomerName(tc.input);
  assert.strictEqual(actual, tc.expected, `Case ${i + 1} mismatch: for '${tc.input}', expected '${tc.expected}', got '${actual}'`);
  console.log(`✅ Case ${i + 1}: '${tc.input}' -> '${actual}'`);
});

console.log(`\n🎉 ALL ${testCases.length} NAME NORMALIZATION UNIT TESTS PASSED 100%!`);

// =============================================================================
// Interactive DOM Tests for Pathao Popup Customer Name Normalize Option
// =============================================================================
console.log("\n▶ Testing Pathao Plugin Modal & Bulk Modal Name Normalizer Option...");

function makeMockEl(tag, id = "") {
  const el = {
    tagName: String(tag || "DIV").toUpperCase(),
    id,
    className: "",
    value: "",
    innerText: "",
    textContent: "",
    checked: true,
    dataset: {},
    style: {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    children: [],
    listeners: {},
    parentNode: null,
    _innerHTML: "",
    childMap: {},
    addEventListener(evt, fn) {
      this.listeners[evt] = this.listeners[evt] || [];
      this.listeners[evt].push(fn);
    },
    dispatchEvent(evt) {
      const list = this.listeners[evt && evt.type] || [];
      list.forEach(fn => fn(evt));
    },
    click() {
      this.dispatchEvent({ type: "click", preventDefault: () => {} });
    },
    prepend(child) {
      child.parentNode = this;
      this.children.unshift(child);
      this._indexChild(child);
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      this._indexChild(child);
    },
    insertBefore(newNode, refNode) {
      newNode.parentNode = this;
      const idx = this.children.indexOf(refNode);
      if (idx >= 0) this.children.splice(idx, 0, newNode);
      else this.children.push(newNode);
      this._indexChild(newNode);
    },
    _indexChild(node) {
      if (node.id) this.childMap[node.id] = node;
    },
    querySelector(sel) {
      if (!sel) return null;
      const idMatch = sel.match(/#([A-Za-z0-9_-]+)/);
      if (idMatch && this.childMap[idMatch[1]]) return this.childMap[idMatch[1]];
      for (const c of this.children) {
        if (c.id && sel.includes(`#${c.id}`)) return c;
        if (c.querySelector) {
          const found = c.querySelector(sel);
          if (found) return found;
        }
      }
      return null;
    },
    querySelectorAll(sel) {
      const results = [];
      for (const c of this.children) {
        if (sel.includes("name") && c.id === "bulk-name-input") results.push(c);
        if (sel.includes("address") && c.id === "bulk-addr-input") results.push(c);
      }
      return results;
    }
  };

  Object.defineProperty(el, "innerHTML", {
    get() { return this._innerHTML; },
    set(html) {
      this._innerHTML = String(html || "");
      // Parse nested interactive elements with id="..."
      const idRegex = /id=["']([^"']+)["']/g;
      let m;
      while ((m = idRegex.exec(this._innerHTML)) !== null) {
        const childId = m[1];
        if (!this.childMap[childId]) {
          const sub = makeMockEl(childId.includes("chk") ? "INPUT" : "BUTTON", childId);
          if (childId.includes("chk")) sub.checked = true;
          this.childMap[childId] = sub;
        }
      }
    }
  });

  return el;
}

const storedState = {};
global.Event = class Event { constructor(type) { this.type = type; } };
global.chrome = {
  runtime: { lastError: null, onMessage: { addListener: () => {} }, onConnect: { addListener: () => {} } },
  storage: {
    local: {
      get: (keys, cb) => {
        const out = {};
        if (Array.isArray(keys)) keys.forEach(k => { if (k in storedState) out[k] = storedState[k]; });
        if (cb) cb(out);
      },
      set: (obj, cb) => {
        Object.assign(storedState, obj);
        if (cb) cb();
      }
    }
  }
};
global.window = global;
global.window.addEventListener = () => {};
global.window.removeEventListener = () => {};
global.window.location = { href: "https://deencommerce.com/wp-admin/admin.php", origin: "https://deencommerce.com" };
global.MutationObserver = class MutationObserver { observe() {} disconnect() {} };
global.navigator = { userAgent: "node" };

const parser = require("./parser.js");
Object.assign(global, parser);

// Setup WooCommerce Pathao Single-Order Modal DOM
const nameWrapper = makeMockEl("DIV", "name-wrap");
const nameInput = makeMockEl("INPUT", "ptc_wc_shipping_name");
nameInput.value = "  md saiful islam (01715485035)  ";
nameWrapper.appendChild(nameInput);

const addrWrapper = makeMockEl("DIV", "addr-wrap");
const addrInput = makeMockEl("TEXTAREA", "ptc_wc_shipping_address");
addrInput.value = "H-12, R-4, Mirpur 10, Dhaka";
addrWrapper.appendChild(addrInput);

const ptcModal = makeMockEl("DIV", "ptc-custom-modal");
ptcModal.appendChild(nameWrapper);
ptcModal.appendChild(addrWrapper);

// Setup Bulk Modal DOM
const bulkModal = makeMockEl("DIV", "ptc-bulk-modal-overlay");
const bulkFooter = makeMockEl("DIV", "ptc-modal-footer");
const bulkNameInput = makeMockEl("INPUT", "bulk-name-input");
bulkNameInput.value = "TANVIR HOSSAIN - MIRPUR";
bulkModal.appendChild(bulkFooter);
bulkModal.appendChild(bulkNameInput);

let hotCells = [["  MD. RAFIQUL ISLAM  ", "H-12, Dhaka"]];
global.window.hotInstance = {
  getData: () => hotCells,
  getColHeader: () => ["Recipient Name", "Recipient Address"],
  setDataAtCell: (r, c, v) => { hotCells[r][c] = v; },
  render: () => {}
};

global.document = {
  readyState: "complete",
  body: ptcModal,
  addEventListener: () => {},
  createElement: (tag) => makeMockEl(tag),
  getElementById: (id) => {
    if (id === "ptc-custom-modal") return ptcModal;
    if (id === "ptc-bulk-modal-overlay") return bulkModal;
    if (id === "deen-ptc-bulk-helper") return bulkModal.querySelector("#deen-ptc-bulk-helper");
    if (id === "deen-merchant-name-helper") return null;
    return ptcModal.querySelector(`#${id}`);
  },
  querySelectorAll: (sel) => {
    if (sel.includes("ptc-custom-modal")) return [ptcModal];
    return [];
  },
  querySelector: (sel) => {
    if (sel.includes("ptc_wc_shipping_name")) return nameInput;
    return null;
  }
};

const wc = require("./woocommerce.js");
wc.initPathaoPluginAddressNormalizer();

const nameHelper = nameWrapper.querySelector("#deen-ptc-name-helper");
assert(nameHelper, "#deen-ptc-name-helper must be injected above recipient name input in Pathao modal");
assert.strictEqual(nameInput.value, "Md. Saiful Islam", "Name should auto-normalize on popup open");
assert.strictEqual(nameInput.dataset.deenOriginalName, "  md saiful islam (01715485035)  ", "Raw name preserved for Revert");

// Click Revert option
const revertBtn = nameHelper.querySelector("#deen-ptc-btn-name-revert");
assert(revertBtn, "Must provide Revert button inside #deen-ptc-name-helper");
revertBtn.click();
assert.strictEqual(nameInput.value, "  md saiful islam (01715485035)  ", "Clicking Revert must restore original name");

// Toggle Auto off, test blur does not auto-normalize, then click manual Normalize Name button
const autoChk = nameHelper.querySelector("#deen-ptc-chk-auto-name");
autoChk.checked = false;
autoChk.dispatchEvent({ type: "change" });
assert.strictEqual(storedState.deen_auto_normalize_name, false, "Auto-normalize toggle preference saved");

nameInput.value = "engr. nazmul hasan";
nameInput.dispatchEvent({ type: "blur" });
assert.strictEqual(nameInput.value, "engr. nazmul hasan", "Blur must respect Auto=false");

const cleanBtn = nameHelper.querySelector("#deen-ptc-btn-name-clean");
cleanBtn.click();
assert.strictEqual(nameInput.value, "Engr. Nazmul Hasan", "Manual ✨ Normalize Name button must normalize immediately");
// Verify #deen-ptc-name-helper is placed directly below nameInput (after nameInput, matching Phone rating card)
assert.strictEqual(nameWrapper.children.indexOf(nameHelper), nameWrapper.children.indexOf(nameInput) + 1, "#deen-ptc-name-helper must be placed directly after nameInput");
console.log("  ✅ Pathao single-order popup Name Normalizer (Normalize, Revert, Auto toggle & layout) verified!");

// Verify "Name:" label fallback when Pathao plugin uses custom input IDs (like screenshot modal)
const fallbackModal = makeMockEl("DIV", "ptc-custom-modal");
const fallbackFieldRow = makeMockEl("DIV", "ptc-field-row");
const fallbackLabel = makeMockEl("LABEL", "lbl-name");
fallbackLabel.textContent = "Name:";
const fallbackInput = makeMockEl("INPUT", "custom_name_field_xyz");
fallbackInput.value = "Boro dealer Sahadat";
fallbackFieldRow.appendChild(fallbackLabel);
fallbackFieldRow.appendChild(fallbackInput);
fallbackModal.appendChild(fallbackFieldRow);

fallbackModal.querySelectorAll = (sel) => {
  if (sel.includes("label")) return [fallbackLabel];
  return [];
};
fallbackModal.querySelector = (sel) => {
  if (sel.includes("deen-ptc-name-helper")) return fallbackFieldRow.querySelector("#deen-ptc-name-helper");
  if (sel.includes("input")) return fallbackInput;
  return null;
};
fallbackFieldRow.querySelector = (sel) => {
  if (sel.includes("deen-ptc-name-helper")) return fallbackFieldRow.children.find(c => c.id === "deen-ptc-name-helper") || null;
  if (sel.includes("input")) return fallbackInput;
  return null;
};

const origQSA = global.document.querySelectorAll;
global.document.querySelectorAll = (sel) => {
  if (sel.includes("ptc-custom-modal")) return [fallbackModal];
  return [];
};
wc.initPathaoPluginAddressNormalizer();
global.document.querySelectorAll = origQSA;

const fallbackHelper = fallbackFieldRow.querySelector("#deen-ptc-name-helper");
assert(fallbackHelper, "Label fallback ('Name:') must inject #deen-ptc-name-helper even for unknown input IDs");
assert.strictEqual(fallbackInput.value, "Boro Dealer Sahadat", "'Boro dealer Sahadat' must normalize to 'Boro Dealer Sahadat'");
console.log("  ✅ Pathao modal 'Name:' label fallback + 'Boro dealer Sahadat' normalization verified!");

// Verify Bulk Modal Normalize All Names
const bulkCleanNamesBtn = bulkFooter.querySelector("#deen-ptc-btn-bulk-clean-names");
assert(bulkCleanNamesBtn, "Bulk Pathao modal must provide 👤 Normalize All Names button");
bulkCleanNamesBtn.click();
assert.strictEqual(hotCells[0][0], "Md. Rafiqul Islam", "Bulk Normalize Names must update Handsontable Recipient Name column");
assert.strictEqual(bulkNameInput.value, "Tanvir Hossain", "Bulk Normalize Names must update DOM name inputs");
console.log("  ✅ Bulk Pathao modal Normalize All Names verified!");

// Verify Pathao Merchant Portal injectMerchantNameNormalizer
const content = require("./content.js");
const merchantWrap = makeMockEl("DIV", "merchant-name-wrap");
const merchantNameInp = makeMockEl("INPUT", "recipient_name");
merchantNameInp.value = "Customer: mrs. farhana akter [Order #120]";
merchantWrap.appendChild(merchantNameInp);

const merchantBar = content.injectMerchantNameNormalizer(merchantNameInp);
assert(merchantBar, "content.js must inject #deen-merchant-name-helper on Pathao Merchant create-order form");
const merchantCleanBtn = merchantBar.querySelector("#deen-merchant-btn-name-clean");
const merchantRevertBtn = merchantBar.querySelector("#deen-merchant-btn-name-revert");
merchantCleanBtn.click();
assert.strictEqual(merchantNameInp.value, "Mrs. Farhana Akter", "Merchant Normalize button must clean customer name");
merchantRevertBtn.click();
assert.strictEqual(merchantNameInp.value, "Customer: mrs. farhana akter [Order #120]", "Merchant Revert button must restore raw name");
console.log("  ✅ Pathao Merchant portal inline Name Normalizer (Normalize & Revert) verified!");
process.exit(0);
