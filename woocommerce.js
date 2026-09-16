/**
 * DEEN Delivery Parser - WooCommerce Integration Content Script
 * Injected on WooCommerce admin pages (e.g. wc-orders, wc-processing)
 */

(function () {
  "use strict";

  const BD_PHONE_REGEX = /(?:(?:\+?880)|880|0)?(1[3-9]\d{8})\b/;

  /**
   * Clean and normalize a Bangladeshi phone number to standard 11 digits (01XXXXXXXXX)
   */
  function normalizeBDPhone(raw) {
    if (!raw) return null;
    const digits = raw.replace(/[^\d+]/g, "");
    const match = digits.match(BD_PHONE_REGEX);
    if (match && match[1]) {
      return "0" + match[1];
    }
    // Also try simple 11 digit check
    const onlyDigits = raw.replace(/\D/g, "");
    if (onlyDigits.length === 11 && /^01[3-9]\d{8}$/.test(onlyDigits)) {
      return onlyDigits;
    } else if (onlyDigits.length === 13 && onlyDigits.startsWith("8801")) {
      return onlyDigits.slice(2);
    }
    return null;
  }

  /**
   * Extract order details from a table row element
   */
  function extractRowOrderDetails(row) {
    if (!row) return {};

    const text = row.innerText || "";
    const phone = normalizeBDPhone(text);

    // Extract Order ID
    let orderId = "";
    const orderLink = row.querySelector(".order_number a, .column-order_number a, a.order-view");
    if (orderLink) {
      orderId = orderLink.textContent.trim().replace(/^#/, "");
    } else {
      const idMatch = text.match(/#(\d{3,8})/);
      if (idMatch) orderId = idMatch[1];
    }

    // Extract Customer Name
    let customerName = "";
    const customerEl = row.querySelector(".customer_user, .column-order_title a, .column-customer_user, .order_title a");
    if (customerEl) {
      customerName = customerEl.textContent.trim();
    }

    // Extract COD / Total Amount
    let cod = "";
    const totalEl = row.querySelector(".order_total, .column-order_total, .amount");
    if (totalEl) {
      const numMatch = totalEl.textContent.replace(/,/g, "").match(/[\d.]+/);
      if (numMatch) cod = Math.round(parseFloat(numMatch[0])).toString();
    }

    // Extract Address if present
    let address = "";
    const addressEl = row.querySelector(".shipping_address, .billing_address, [data-colname='Address']");
    if (addressEl) {
      address = addressEl.textContent.replace(/\s+/g, " ").trim();
    }

    return {
      phone: phone || "",
      name: customerName,
      orderId: orderId,
      cod: cod,
      address: address
    };
  }

  /**
   * Sync customer information to Pathao (only executed when user explicitly triggers)
   */
  function syncToPathao(payload, options = {}) {
    if (!payload || !payload.phone) return;

    const isUserTriggered = options.userTriggered === true;

    const data = {
      phone: payload.phone,
      name: payload.name || "",
      address: payload.address || "",
      cod: payload.cod || "",
      orderId: payload.orderId || "",
      source: "woocommerce",
      userTriggered: isUserTriggered,
      timestamp: Date.now()
    };

    // Store in chrome storage ONLY when explicitly triggered
    if (isUserTriggered && typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ "pathao_autofill_data": data });
    }

    // Send message to background
    if (isUserTriggered && typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        action: "sync_to_pathao",
        data: data,
        autoSwitch: options.autoSwitch || false
      }).catch(() => {
        // Extension reloaded or inactive
      });
    }

    // Show on-screen toast
    if (isUserTriggered) {
      const msg = `⚡ Customer <strong>${data.phone}</strong> sent to Pathao!`;
      showWCToast(msg, "👉 Switch to Pathao", () => {
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ action: "focus_or_open_pathao" }).catch(() => {});
        }
      });
    }
  }

  /**
   * Listen for native Copy events on WooCommerce
   * Does NOT auto-fill Pathao automatically. Only offers a 1-click button.
   */
  function initCopyListener() {
    document.addEventListener("copy", () => {
      // Small timeout to allow clipboard data selection to complete
      setTimeout(() => {
        const selection = window.getSelection ? window.getSelection().toString().trim() : "";
        if (!selection) return;

        const phone = normalizeBDPhone(selection);
        if (!phone) return;

        // Check if copy happened within a WooCommerce order row
        let rowDetails = {};
        const activeEl = document.activeElement;
        const selObj = window.getSelection();
        let targetNode = selObj && selObj.anchorNode ? selObj.anchorNode : activeEl;
        if (targetNode && targetNode.nodeType === Node.TEXT_NODE) {
          targetNode = targetNode.parentElement;
        }

        const row = targetNode ? targetNode.closest("tr") : null;
        if (row) {
          rowDetails = extractRowOrderDetails(row);
        }

        const payload = {
          phone: phone,
          name: rowDetails.name || "",
          address: rowDetails.address || "",
          cod: rowDetails.cod || "",
          orderId: rowDetails.orderId || ""
        };

        // Do NOT automatically auto-put into Pathao on mere copy!
        // Show an optional 1-click action so the user can trigger it explicitly if they want:
        showWCToast(`📋 Phone <strong>${phone}</strong> copied`, "⚡ Send to Pathao", () => {
          syncToPathao(payload, { autoSwitch: true, userTriggered: true });
        });
      }, 50);
    });
  }

  /**
   * Inject 1-Click "⚡ Pathao" buttons into WooCommerce orders table
   */
  function injectTableActionButtons() {
    const rows = document.querySelectorAll(
      "table.wp-list-table tbody tr, table.wc-orders-list-table tbody tr, #the-list tr"
    );

    rows.forEach(row => {
      if (row.dataset.deenPathaoInjected) return;

      const text = row.innerText || "";
      const phone = normalizeBDPhone(text);
      if (!phone) return;

      row.dataset.deenPathaoInjected = "true";

      // Find an ideal location for the button
      let targetContainer = row.querySelector(".wc_actions, .column-order_actions, .order_actions");
      if (!targetContainer) {
        targetContainer = row.querySelector(".customer_user, .column-order_title, .column-customer_user");
      }
      if (!targetContainer) {
        targetContainer = row.querySelector("td:last-child");
      }

      if (targetContainer) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "deen-wc-pathao-btn";
        btn.innerHTML = `<span>⚡ Pathao</span>`;
        btn.title = `Auto-detect ${phone} in Pathao Recipient Details`;

        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();

          btn.classList.add("deen-btn-active");
          setTimeout(() => btn.classList.remove("deen-btn-active"), 800);

          const details = extractRowOrderDetails(row);
          details.phone = phone; // Ensure phone is set
          syncToPathao(details, { autoSwitch: true, userTriggered: true });
        });

        // Add to container
        targetContainer.appendChild(btn);
      }
    });
  }

  /**
   * Inject button on single order edit page
   */
  function injectSingleOrderPageButton() {
    const phoneInput = document.querySelector("#_billing_phone, input[name='_billing_phone'], #_shipping_phone");
    if (phoneInput && !document.getElementById("deen-single-order-pathao-btn")) {
      const phone = normalizeBDPhone(phoneInput.value);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = "deen-single-order-pathao-btn";
      btn.className = "deen-wc-pathao-btn single-order-btn";
      btn.innerHTML = `<span>⚡ Send to Pathao Recipient Details</span>`;

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const currentPhone = normalizeBDPhone(phoneInput.value);
        if (!currentPhone) {
          alert("Please enter a valid Bangladeshi phone number first.");
          return;
        }

        const firstName = (document.querySelector("#_billing_first_name") || {}).value || "";
        const lastName = (document.querySelector("#_billing_last_name") || {}).value || "";
        const fullName = `${firstName} ${lastName}`.trim();
        const address1 = (document.querySelector("#_billing_address_1") || {}).value || "";
        const city = (document.querySelector("#_billing_city") || {}).value || "";
        const total = (document.querySelector("#_order_total") || {}).value || "";

        const payload = {
          phone: currentPhone,
          name: fullName,
          address: `${address1}, ${city}`.trim().replace(/^,\s*|,\s*$/g, ""),
          cod: total ? Math.round(parseFloat(total)).toString() : "",
          orderId: (document.querySelector("#post_ID") || {}).value || ""
        };

        syncToPathao(payload, { autoSwitch: true });
      });

      if (phoneInput.parentElement) {
        phoneInput.parentElement.appendChild(btn);
      }
    }
  }

  /**
   * Modern Floating Toast Notification
   */
  function showWCToast(htmlContent, actionText, onAction) {
    let container = document.getElementById("deen-wc-toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "deen-wc-toast-container";
      document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = "deen-wc-toast";

    const contentDiv = document.createElement("div");
    contentDiv.className = "deen-wc-toast-content";
    contentDiv.innerHTML = htmlContent;
    toast.appendChild(contentDiv);

    if (actionText && onAction) {
      const actionBtn = document.createElement("button");
      actionBtn.className = "deen-wc-toast-action";
      actionBtn.textContent = actionText;
      actionBtn.addEventListener("click", () => {
        onAction();
        toast.remove();
      });
      toast.appendChild(actionBtn);
    }

    const closeBtn = document.createElement("button");
    closeBtn.className = "deen-wc-toast-close";
    closeBtn.innerHTML = "&times;";
    closeBtn.addEventListener("click", () => toast.remove());
    toast.appendChild(closeBtn);

    container.appendChild(toast);

    // Auto remove after 5 seconds
    setTimeout(() => {
      if (toast.parentElement) {
        toast.classList.add("deen-toast-fading");
        setTimeout(() => toast.remove(), 300);
      }
    }, 5000);
  }

  // Initialize
  function init() {
    initCopyListener();
    injectTableActionButtons();
    injectSingleOrderPageButton();

    // Observe DOM mutations for AJAX pagination / filter reload
    const observer = new MutationObserver(() => {
      injectTableActionButtons();
      injectSingleOrderPageButton();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }
})();
