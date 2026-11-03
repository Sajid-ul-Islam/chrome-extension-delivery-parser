# 🤝 Contributing Guidelines for Forward Deployed Engineers & AI Agents (CONTRIBUTING.md)

Welcome to the **DEEN Delivery Parser** codebase! Whether you are an autonomous AI agent (Claude, Gemini, Antigravity) or a human Forward Deployed Engineer (FDE), this document provides guidelines for contributing safely without breaking production invariants.

---

## 1. Core Principles

1. **Production Reliability First**: The extension runs in live operations at **DEEN Commerce**, processing hundreds of daily shipments and thousands of takas in Cash on Delivery (COD). Every commit must be bulletproof.
2. **Deterministic Financial Math**: Never allow a customer outside Dhaka to pay ৳50 delivery fee (False-Dhaka exploit). Never allow an order < ৳2,500 to receive free shipping automatically.
3. **Zero Bengali Text Corruption**: Never modify customer Bengali names or corrupt words with greedy regex.
4. **100% Test Passing Standard**: All 10 test suites must pass 100% before any PR is merged.

---

## 2. Agentic & Developer Workflow

### Step 1: Clone & Setup
```bash
git clone https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser.git
cd chrome-extension-delivery-parser
```

### Step 2: Test Baseline
Run the master automated test suite:
```powershell
node run_all_suites.js
```
Verify that all 10 suites pass with `0` failures.

### Step 3: Implement Changes Adhering to Invariants
Review [`AGENTS.md`](AGENTS.md) thoroughly before editing any code:
- **Module Exports**: Never remove any existing export from `woocommerce.js`, `phone-check.js`, `parser.js`, or `background.js`.
- **Debounced Observers**: Every DOM observer must be debounced with `setTimeout` $\ge 200\text{ms}$.
- **Retina Canvas**: Always maintain 2x Retina resolution, white background (`#ffffff`), and authentic `DEEN Orange` headers.
- **PowerShell CLI Safety**: On Windows, never run complex inline code with `node -e "..."` in PowerShell if it contains `$`, `[`, `]`, or quotation marks. Write a small helper `.js` file, run `node script.js`, and delete it.

### Step 4: Add Automated Verification
When adding new features or fixing bugs:
- If adding a WebMCP tool: Add unit test in `test_webmcp_integration.js`.
- If modifying address parsing or delivery fee logic: Add test cases in `test_parser.js`.
- If modifying WooCommerce DOM extraction or canvas receipts: Add test cases in `test_whatsapp_quick_reply.js` or `test_full_fetch_improvements.js`.
- If modifying WordPress SSO, role extraction, or Pathao bridge: Add test cases in `test_wordpress_login_sync.js`.

### Step 5: Master Verification
Execute:
```powershell
node run_all_suites.js
```
Ensure all 10 suites pass cleanly.

---

## 3. Pre-Commit Checklist

Before committing or pushing changes, verify every item:

- [ ] All 10 test suites pass (`node run_all_suites.js`).
- [ ] No regression in outside-Dhaka ৳90 delivery fee calculation.
- [ ] Free shipping threshold policy (≥ ৳2500) enforced.
- [ ] No unfiltered cookie scraping in `background.js` (Invariant 4).
- [ ] Debounced MutationObservers (Invariant 2).
- [ ] All exported functions in `module.exports` preserved (Invariant 1).
- [ ] No stray or temporary `.js` files left in the workspace.
- [ ] Documentation updated in `README.md`, `AGENTS.md`, `ARCHITECTURE.md`, `WEBMCP.md`, or `OPERATIONS.md`.

---

## 4. Contact & Support

For questions, operational escalations, or bug reports, reach out to the **DEEN Commerce Engineering & Operations Team**.

