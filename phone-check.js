/**
 * DEEN Delivery Parser - Universal Phone Check & Floating Action Pill
 * Runs across all websites (WhatsApp Web, Facebook, CRMs, etc.)
 * Detects Bangladeshi phone numbers on Copy or Highlight and triggers Pathao customer check.
 */

(function () {
  "use strict";

  // Prevent double-injection
  if (typeof window !== "undefined" && window.__deenPhoneCheckInjected) {
    return;
  }
  if (typeof window !== "undefined") {
    window.__deenPhoneCheckInjected = true;
  }

  // Gracefully suppress extension context invalidated errors on orphaned scripts
  if (typeof window !== "undefined") {
    window.addEventListener("error", (event) => {
      if (event && event.message && event.message.includes("Extension context invalidated")) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    }, true);

    window.addEventListener("unhandledrejection", (event) => {
      if (event && event.reason && event.reason.message &&
         (event.reason.message.includes("Extension context invalidated") ||
          event.reason.message.includes("Could not establish connection"))) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    }, true);
  }

  function isExtensionValid() {
    try {
      return typeof chrome !== "undefined" && Boolean(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  /**
   * Comprehensive Bangladeshi phone number extractor & normalizer
   * Supports: 017XXXXXXXX, +88017XXXXXXXX, 88017XXXXXXXX, 0088017XXXXXXXX,
   * with spaces/hyphens (+880 1712-345678, 01712 345 678, etc.)
   * Valid BD mobile prefixes: 013, 014, 015, 016, 017, 018, 019
   */
  const BD_PHONE_SEARCH_REGEX = /(?:(?:\+|00)?880[\s.-]?)?0?(1[3-9][0-9]{2}[\s.-]?[0-9]{3}[\s.-]?[0-9]{3})\b/;
  const BD_PHONE_CLEAN_REGEX = /(?:(?:\+?880)|880|0)?(1[3-9]\d{8})\b/;

  function normalizeBDPhone(raw) {
    if (!raw || typeof raw !== "string") return null;

    // 1. Try search regex on text (handles spaces/hyphens within numbers)
    const searchMatch = raw.match(BD_PHONE_SEARCH_REGEX);
    if (searchMatch && searchMatch[1]) {
      const cleanDigits = searchMatch[1].replace(/\D/g, "");
      if (cleanDigits.length === 10 && /^1[3-9]\d{8}$/.test(cleanDigits)) {
        return "0" + cleanDigits;
      }
    }

    // 2. Strip all non-digit and non-plus characters
    const digits = raw.replace(/[^\d+]/g, "");
    const cleanMatch = digits.match(BD_PHONE_CLEAN_REGEX);
    if (cleanMatch && cleanMatch[1]) {
      return "0" + cleanMatch[1];
    }

    // 3. Fallback checks for 11 or 13 digits
    const onlyDigits = raw.replace(/\D/g, "");
    if (onlyDigits.length === 11 && /^01[3-9]\d{8}$/.test(onlyDigits)) {
      return onlyDigits;
    } else if (onlyDigits.length === 13 && onlyDigits.startsWith("8801") && /^8801[3-9]\d{8}$/.test(onlyDigits)) {
      return onlyDigits.slice(2);
    } else if (onlyDigits.length === 14 && onlyDigits.startsWith("008801") && /^008801[3-9]\d{8}$/.test(onlyDigits)) {
      return onlyDigits.slice(4);
    }

    return null;
  }

  // Export for testing in Node.js
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { normalizeBDPhone };
  }

  // Stop here if running in Node.js environment without DOM
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  // Do not run on Pathao merchant portal (Pathao has its own content script)
  if (window.location && window.location.hostname && window.location.hostname.includes("pathao.com")) {
    return;
  }

  // Global references for pill & toast
  let activePillEl = null;
  let pillDismissTimer = null;

  /**
   * Create or retrieve the floating toast container
   */
  function getToastContainer() {
    let container = document.getElementById("deen-universal-toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "deen-universal-toast-container";
      document.body.appendChild(container);
    }
    return container;
  }

  /**
   * Display a sleek, non-intrusive floating toast notification
   */
  /**
   * Display a sleek, non-intrusive floating toast notification
   * Supports multiple action buttons or single action button
   */
  function showUniversalToast(htmlContent, actionArg, onAction) {
    const container = getToastContainer();

    const toast = document.createElement("div");
    toast.className = "deen-universal-toast";

    const iconSpan = document.createElement("span");
    iconSpan.className = "deen-universal-toast-icon";
    iconSpan.textContent = "⚡";
    toast.appendChild(iconSpan);

    const contentDiv = document.createElement("div");
    contentDiv.className = "deen-universal-toast-content";
    contentDiv.innerHTML = htmlContent;
    toast.appendChild(contentDiv);

    // Support array of buttons or single action
    if (Array.isArray(actionArg)) {
      actionArg.forEach(btnConfig => {
        if (btnConfig && btnConfig.text && btnConfig.onClick) {
          const actionBtn = document.createElement("button");
          actionBtn.className = btnConfig.className || "deen-universal-toast-action";
          actionBtn.textContent = btnConfig.text;
          actionBtn.addEventListener("click", () => {
            btnConfig.onClick();
            toast.remove();
          });
          toast.appendChild(actionBtn);
        }
      });
    } else if (actionArg && onAction) {
      const actionBtn = document.createElement("button");
      actionBtn.className = "deen-universal-toast-action";
      actionBtn.textContent = actionArg;
      actionBtn.addEventListener("click", () => {
        onAction();
        toast.remove();
      });
      toast.appendChild(actionBtn);
    }

    const closeBtn = document.createElement("button");
    closeBtn.className = "deen-universal-toast-close";
    closeBtn.innerHTML = "&times;";
    closeBtn.title = "Dismiss";
    closeBtn.addEventListener("click", () => toast.remove());
    toast.appendChild(closeBtn);

    container.appendChild(toast);

    // Auto remove after 6 seconds
    setTimeout(() => {
      if (toast.parentElement) {
        toast.classList.add("deen-toast-fading");
        setTimeout(() => toast.remove(), 250);
      }
    }, 6000);
  }

  /**
   * Send phone number to Pathao via background service worker
   */
  function triggerPathaoSync(phone, options = {}) {
    if (!isExtensionValid()) return;
    if (!phone) return;

    const payload = {
      phone: phone,
      name: options.name || "",
      address: options.address || "",
      cod: options.cod || "",
      orderId: options.orderId || "",
      source: options.source || "universal_check",
      userTriggered: true,
      timestamp: Date.now()
    };

    // Save to storage
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ "pathao_autofill_data": payload });
    }

    // Dispatch message to background worker
    if (chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        action: "sync_to_pathao",
        data: payload,
        autoSwitch: Boolean(options.autoSwitch)
      }).catch(() => {});
    }
  }

  /**
   * In-Page Customer Rating Mini Modal
   * Displays Pathao and multi-courier stats without switching pages
   */
  let activeRatingModalEl = null;

  function removeRatingModal() {
    if (activeRatingModalEl) {
      if (activeRatingModalEl.parentElement) {
        activeRatingModalEl.parentElement.removeChild(activeRatingModalEl);
      }
      activeRatingModalEl = null;
    }
  }

  function showCustomerRatingModal(phone) {
    removeRatingModal();
    removeFloatingPill();
    if (!phone) return;

    const backdrop = document.createElement("div");
    backdrop.id = "deen-rating-modal-backdrop";

    const modal = document.createElement("div");
    modal.id = "deen-rating-modal";
    backdrop.appendChild(modal);

    // Initial Loading Skeleton
    modal.innerHTML = `
      <div class="deen-modal-header">
        <div class="deen-modal-title-group">
          <div class="deen-modal-badge-icon">⚡</div>
          <div>
            <div class="deen-modal-title">Customer Intelligence</div>
            <div class="deen-modal-subtitle">Pathao & Courier Delivery Check</div>
          </div>
        </div>
        <button class="deen-modal-close-btn" id="deen-modal-btn-close-x">&times;</button>
      </div>
      <div class="deen-modal-skeleton-body">
        <div class="deen-spinner-circle"></div>
        <div class="deen-skeleton-text">Analyzing customer delivery records for <strong>${phone}</strong> across courier networks...</div>
      </div>
    `;

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) removeRatingModal();
    });

    const closeBtnX = modal.querySelector("#deen-modal-btn-close-x");
    if (closeBtnX) closeBtnX.addEventListener("click", removeRatingModal);

    document.body.appendChild(backdrop);
    activeRatingModalEl = backdrop;

    const onKeyEsc = (e) => {
      if (e.key === "Escape") {
        removeRatingModal();
        window.removeEventListener("keydown", onKeyEsc);
      }
    };
    window.addEventListener("keydown", onKeyEsc);

    // Query background service worker
    if (isExtensionValid() && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        action: "fetch_customer_rating",
        phone: phone
      }, (response) => {
        if (chrome.runtime.lastError) {
          void chrome.runtime.lastError.message;
        }
        if (!activeRatingModalEl) return;

        const data = (response && response.success) ? response : {
          success: true,
          phone: phone,
          successRate: 100,
          totalParcels: 0,
          deliveredCount: 0,
          cancelledCount: 0,
          riskLevel: "low",
          riskLabel: "New Customer (No Returns Reported)",
          riskColor: "#3b82f6",
          isNewCustomer: true
        };

        renderRatingModalContent(modal, data);
      });
    } else {
      renderRatingModalContent(modal, {
        phone: phone,
        successRate: 100,
        totalParcels: 0,
        deliveredCount: 0,
        cancelledCount: 0,
        riskLevel: "low",
        riskLabel: "Customer Ready",
        riskColor: "#10b981",
        isNewCustomer: true
      });
    }
  }

  function renderRatingModalContent(modal, data) {
    const riskClass = data.riskLevel === "high" ? "risk-high" : (data.riskLevel === "medium" ? "risk-medium" : "risk-low");
    const progressColor = data.riskColor || (data.riskLevel === "high" ? "#ef4444" : (data.riskLevel === "medium" ? "#f59e0b" : "#10b981"));

    modal.innerHTML = `
      <div class="deen-modal-header">
        <div class="deen-modal-title-group">
          <div class="deen-modal-badge-icon">⚡</div>
          <div>
            <div class="deen-modal-title">Customer Intelligence</div>
            <div class="deen-modal-subtitle">Pathao & Courier Delivery Check</div>
          </div>
        </div>
        <button class="deen-modal-close-btn" id="deen-modal-btn-close-x">&times;</button>
      </div>

      <div class="deen-modal-body">
        <!-- Phone & Copy -->
        <div class="deen-modal-phone-card">
          <div>
            <span style="font-size: 11px; color: #94a3b8; display: block;">${data.customerName ? `Customer: <strong style="color:#f8fafc">${data.customerName}</strong>` : 'Recipient Number'}</span>
            <span class="deen-modal-phone-text">${data.phone}</span>
          </div>
          <button class="deen-modal-copy-btn" id="deen-modal-btn-copy" title="Copy Number">📋 Copy</button>
        </div>

        <!-- Risk Badge & Score -->
        <div class="deen-modal-score-box">
          <div class="deen-modal-risk-badge ${riskClass}">
            <span>●</span>
            <span>${data.riskLabel}</span>
          </div>

          <div class="deen-modal-percent-row">
            <span class="deen-modal-percent-val" style="color: ${progressColor};">${data.successRate}%</span>
            <span class="deen-modal-percent-label">Delivery Rate</span>
          </div>

          <div class="deen-modal-progress-bar">
            <div class="deen-modal-progress-fill" style="width: ${data.successRate}%; background: ${progressColor};"></div>
          </div>
        </div>

        <!-- 3-Col Stats -->
        <div class="deen-modal-stats-grid">
          <div class="deen-modal-stat-card">
            <div class="deen-modal-stat-label">Total Parcels</div>
            <div class="deen-modal-stat-val">${data.totalParcels}</div>
          </div>
          <div class="deen-modal-stat-card">
            <div class="deen-modal-stat-label">Delivered</div>
            <div class="deen-modal-stat-val deen-stat-delivered">${data.deliveredCount}</div>
          </div>
          <div class="deen-modal-stat-card">
            <div class="deen-modal-stat-label">Return / Cancel</div>
            <div class="deen-modal-stat-val deen-stat-cancelled">${data.cancelledCount}</div>
          </div>
        </div>

        <!-- Couriers Verified -->
        <div class="deen-modal-couriers-row">
          <div class="deen-modal-courier-chip" title="Pathao Courier live statistics">
            <span class="deen-modal-courier-dot" style="background: ${data.pathaoStatus === 'live' ? '#10b981' : (data.pathaoStatus === 'clean_record' ? '#3b82f6' : (data.pathaoStatus === 'token_missing' ? '#f59e0b' : '#ef4444'))};"></span>
            <span>Pathao: <strong>${data.pathaoStats ? `${data.pathaoStats.delivered}/${data.pathaoStats.total} (${Math.round((data.pathaoStats.delivered / Math.max(1, data.pathaoStats.total)) * 100)}%)` : (data.pathaoStatus === 'clean_record' ? '0 Orders (Clean)' : (data.pathaoStatus === 'token_missing' ? 'Link Needed' : 'Not Connected'))}</strong></span>
          </div>
          <div class="deen-modal-courier-chip" title="Steadfast Courier network records">
            <span class="deen-modal-courier-dot" style="background: ${data.steadfastStatus === 'live' ? '#10b981' : '#3b82f6'};"></span>
            <span>Steadfast: <strong>${data.steadfastStats ? `${data.steadfastStats.delivered}/${data.steadfastStats.total}` : (data.riskLevel === 'high' ? 'High Risk' : 'Normal')}</strong></span>
          </div>
        </div>

        ${data.pathaoStatus === 'token_missing' ? `
          <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 8px; padding: 8px 10px; font-size: 11px; color: #fbbf24; display: flex; align-items: center; justify-content: space-between;">
            <span>⚠️ Pathao session not synced. Open Pathao once to connect live data.</span>
            <button id="deen-modal-btn-connect-pathao" style="background: #f59e0b; color: #000; border: none; border-radius: 4px; padding: 4px 8px; font-weight: 700; font-size: 10px; cursor: pointer; white-space: nowrap;">Open Pathao</button>
          </div>
        ` : ''}
      </div>

      <!-- Footer Actions -->
      <div class="deen-modal-footer">
        <button class="deen-modal-btn-action" id="deen-modal-btn-open-pathao">
          <span>🚀 Open Pathao Create</span>
        </button>
        <button class="deen-modal-btn-close" id="deen-modal-btn-dock" title="Dock into Sidebar Drawer">📌 Sidebar</button>
        <button class="deen-modal-btn-close" id="deen-modal-btn-done">Close</button>
      </div>
    `;

    // Attach actions
    const closeBtnX = modal.querySelector("#deen-modal-btn-close-x");
    if (closeBtnX) closeBtnX.addEventListener("click", removeRatingModal);

    const btnDone = modal.querySelector("#deen-modal-btn-done");
    if (btnDone) btnDone.addEventListener("click", removeRatingModal);

    const btnConnectPathao = modal.querySelector("#deen-modal-btn-connect-pathao");
    if (btnConnectPathao) {
      btnConnectPathao.addEventListener("click", () => {
        if (isExtensionValid() && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ action: "focus_or_open_pathao" }).catch(() => {});
        }
      });
    }

    const btnDock = modal.querySelector("#deen-modal-btn-dock");
    if (btnDock) {
      btnDock.addEventListener("click", () => {
        removeRatingModal();
        openSidebar(data.phone);
      });
    }

    const btnCopy = modal.querySelector("#deen-modal-btn-copy");
    if (btnCopy) {
      btnCopy.addEventListener("click", () => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(data.phone).then(() => {
            btnCopy.textContent = "✓ Copied!";
            setTimeout(() => { if (btnCopy) btnCopy.textContent = "📋 Copy"; }, 1500);
          });
        }
      });
    }

    const btnOpenPathao = modal.querySelector("#deen-modal-btn-open-pathao");
    if (btnOpenPathao) {
      btnOpenPathao.addEventListener("click", () => {
        triggerPathaoSync(data.phone, { source: "mini_modal", autoSwitch: true });
        removeRatingModal();
      });
    }
  }

  /**
   * Dismiss and remove the active floating action pill
   */
  function removeFloatingPill() {
    if (pillDismissTimer) {
      clearTimeout(pillDismissTimer);
      pillDismissTimer = null;
    }
    if (activePillEl) {
      activePillEl.classList.add("deen-pill-fading");
      const elToRemove = activePillEl;
      activePillEl = null;
      setTimeout(() => {
        if (elToRemove && elToRemove.parentElement) {
          elToRemove.parentElement.removeChild(elToRemove);
        }
      }, 150);
    }
  }

  /**
   * Create and position the floating action pill near highlighted text
   */
  function showFloatingPill(phone, rect) {
    removeFloatingPill();
    if (!phone || !rect) return;

    const pill = document.createElement("div");
    pill.id = "deen-phone-pill-host";
    pill.className = "deen-phone-pill";
    pill.setAttribute("role", "button");
    pill.setAttribute("tabindex", "0");
    pill.title = `Click to view delivery history & fraud check for ${phone}`;

    pill.innerHTML = `
      <span class="deen-phone-pill-icon">⚡</span>
      <span class="deen-phone-pill-text">
        <span class="deen-phone-pill-number">${phone}</span>
        <span style="opacity: 0.5; font-size: 11px;">|</span>
        <span style="color: #cbd5e1;">📊 Check Rating</span>
      </span>
      <span class="deen-phone-pill-arrow">→</span>
    `;

    // Click handler: Instant in-page mini modal without leaving page!
    const handleClick = (e) => {
      e.preventDefault();
      e.stopPropagation();

      showCustomerRatingModal(phone);
      removeFloatingPill();
    };

    pill.addEventListener("mousedown", (e) => {
      // Prevent mousedown from clearing the selection before click fires
      e.preventDefault();
      e.stopPropagation();
    });
    pill.addEventListener("click", handleClick);

    document.body.appendChild(pill);
    activePillEl = pill;

    // Calculate smart positioning
    const pillRect = pill.getBoundingClientRect();
    const pillWidth = pillRect.width || 210;
    const pillHeight = pillRect.height || 36;

    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;

    // Center horizontally relative to selection
    let left = rect.left + (rect.width / 2) - (pillWidth / 2) + scrollX;
    // Place above selection by default
    let top = rect.top - pillHeight - 10 + scrollY;

    // If too close to top of viewport, position below selection
    if (rect.top < pillHeight + 15) {
      top = rect.bottom + 10 + scrollY;
    }

    // Keep within horizontal window boundaries
    const maxLeft = (window.innerWidth || document.documentElement.clientWidth) - pillWidth - 12 + scrollX;
    left = Math.max(12 + scrollX, Math.min(maxLeft, left));

    pill.style.left = `${Math.round(left)}px`;
    pill.style.top = `${Math.round(top)}px`;

    // Auto dismiss after 7 seconds if not interacted with
    pillDismissTimer = setTimeout(() => {
      removeFloatingPill();
    }, 7000);
  }

  /**
   * Listen for text selection (highlight) across all websites (including WhatsApp Web)
   */
  function initHighlightListener() {
    let isSelecting = false;

    document.addEventListener("mousedown", (e) => {
      // If clicking inside active pill, do not dismiss
      if (activePillEl && (activePillEl === e.target || activePillEl.contains(e.target))) {
        return;
      }
      isSelecting = true;
      removeFloatingPill();
    });

    const handleSelectionEnd = () => {
      if (!isExtensionValid()) return;

      setTimeout(() => {
        let selectedText = "";
        let selRect = null;

        // 1. Check if selection is inside an active input or textarea
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA") &&
            typeof activeEl.selectionStart === "number" && typeof activeEl.selectionEnd === "number") {
          const start = activeEl.selectionStart;
          const end = activeEl.selectionEnd;
          if (end > start) {
            selectedText = activeEl.value.substring(start, end).trim();
            selRect = activeEl.getBoundingClientRect();
          }
        }

        // 2. Check regular DOM selection (e.g. WhatsApp Web messages, chat list, any website text)
        if (!selectedText && window.getSelection) {
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
            selectedText = sel.toString().trim();
            try {
              const range = sel.getRangeAt(0);
              selRect = range.getBoundingClientRect();
            } catch (err) {
              selRect = null;
            }
          }
        }

        // Only process if selection is concise (avoids triggering on whole article selection)
        if (selectedText && selectedText.length > 0 && selectedText.length <= 160) {
          const phone = normalizeBDPhone(selectedText);
          if (phone && selRect && (selRect.width > 0 || selRect.height > 0)) {
            showFloatingPill(phone, selRect);
            return;
          }
        }

        // If no phone detected in selection, remove any lingering pill
        if (!activePillEl || !activePillEl.contains(document.activeElement)) {
          removeFloatingPill();
        }
      }, 30);
    };

    document.addEventListener("mouseup", (e) => {
      if (activePillEl && (activePillEl === e.target || activePillEl.contains(e.target))) {
        return;
      }
      isSelecting = false;
      handleSelectionEnd();
    });

    document.addEventListener("keyup", (e) => {
      // Handle keyboard selection (e.g. Shift + Arrow keys)
      if (e.key === "Escape") {
        removeFloatingPill();
        return;
      }
      if (e.shiftKey || e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
        handleSelectionEnd();
      }
    });

    // Dismiss pill on scroll if user moves away
    window.addEventListener("scroll", () => {
      if (activePillEl) {
        removeFloatingPill();
      }
    }, { passive: true });
  }

  /**
   * Listen for native Copy events across all websites (Ctrl+C, Cmd+C, context copy)
   */
  function initCopyListener() {
    document.addEventListener("copy", () => {
      if (!isExtensionValid()) return;

      setTimeout(() => {
        const selection = window.getSelection ? window.getSelection().toString().trim() : "";
        if (!selection) return;

        const phone = normalizeBDPhone(selection);
        if (!phone) return;

        // If on WooCommerce admin, check if woocommerce.js is actively handling row details
        if (window.__deenWcActive && window.location && window.location.href.includes("wp-admin")) {
          // woocommerce.js handles order details enrichment and toast
          return;
        }

        // Sync to Pathao in background (ready for ratio check)
        triggerPathaoSync(phone, {
          source: "universal_copy",
          autoSwitch: false
        });

        // If sidebar is already open on page, auto-update sidebar
        syncWithSidebarIfOpen(phone);

        // Show floating toast notification on current page with Quick Rating, Sidebar and Open Pathao buttons
        showUniversalToast(
          `⚡ Phone <strong>${phone}</strong> copied!`,
          [
            {
              text: "📊 Check Rating",
              className: "deen-universal-toast-action deen-toast-action-secondary",
              onClick: () => showCustomerRatingModal(phone)
            },
            {
              text: "📌 Sidebar",
              className: "deen-universal-toast-action deen-toast-action-secondary",
              onClick: () => openSidebar(phone)
            },
            {
              text: "👉 Open Pathao",
              className: "deen-universal-toast-action",
              onClick: () => {
                if (isExtensionValid() && chrome.runtime && chrome.runtime.sendMessage) {
                  chrome.runtime.sendMessage({ action: "focus_or_open_pathao" }).catch(() => {});
                }
              }
            }
          ]
        );
      }, 60);
    });
  }

  /**
   * --------------------------------------------------------------------------
   * In-Page Dockable Sidebar Drawer (Right-Edge Panel)
   * Collapsible side panel for WhatsApp Web, Facebook, WooCommerce, CRMs
   * --------------------------------------------------------------------------
   */
  let sidebarEl = null;
  let sidebarTabEl = null;

  function loadRecentHistory(cb) {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(["recent_checked_ratings"], (res) => {
        cb((res && res.recent_checked_ratings) || []);
      });
    } else {
      try {
        const stored = sessionStorage.getItem("recent_checked_ratings");
        cb(stored ? JSON.parse(stored) : []);
      } catch (e) {
        cb([]);
      }
    }
  }

  function saveRecentHistory(items) {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ "recent_checked_ratings": items });
    }
    try {
      sessionStorage.setItem("recent_checked_ratings", JSON.stringify(items));
    } catch (e) {}
  }

  function addToRecentHistory(entry) {
    loadRecentHistory((list) => {
      let filtered = (list || []).filter(item => item.phone !== entry.phone);
      filtered.unshift(entry);
      if (filtered.length > 10) filtered = filtered.slice(0, 10);
      saveRecentHistory(filtered);
      renderSidebarHistory(filtered);
    });
  }

  function renderSidebarHistory(items) {
    const listEl = (sidebarEl && sidebarEl.querySelector("#deen-sidebar-history-list")) || document.getElementById("deen-sidebar-history-list");
    if (!listEl) return;

    if (!items || items.length === 0) {
      listEl.innerHTML = `<div style="font-size: 11px; color: #64748b; text-align: center; padding: 10px;">No recent checks yet</div>`;
      return;
    }

    listEl.innerHTML = "";
    items.forEach(item => {
      const row = document.createElement("div");
      row.className = "deen-sidebar-history-item";
      row.title = `Click to view ${item.phone}`;

      const phoneSpan = document.createElement("span");
      phoneSpan.className = "deen-sidebar-history-phone";
      phoneSpan.textContent = item.phone;

      const rateSpan = document.createElement("span");
      rateSpan.className = "deen-sidebar-history-tag";
      const tagColor = item.riskLevel === "high" ? "#ef4444" : (item.riskLevel === "medium" ? "#f59e0b" : "#10b981");
      const tagBg = item.riskLevel === "high" ? "rgba(239, 68, 68, 0.2)" : (item.riskLevel === "medium" ? "rgba(245, 158, 11, 0.2)" : "rgba(16, 185, 129, 0.2)");
      rateSpan.style.cssText = `background: ${tagBg} !important; color: ${tagColor} !important; border: 1px solid ${tagColor} !important;`;
      rateSpan.textContent = `${item.successRate}%`;

      row.appendChild(phoneSpan);
      row.appendChild(rateSpan);

      row.addEventListener("click", () => {
        const input = (sidebarEl && sidebarEl.querySelector("#deen-sidebar-phone-input")) || document.getElementById("deen-sidebar-phone-input");
        if (input) input.value = item.phone;
        checkCustomerInSidebar(item.phone);
      });

      listEl.appendChild(row);
    });
  }

  function renderSidebarActiveCard(container, data) {
    const riskClass = data.riskLevel === "high" ? "risk-high" : (data.riskLevel === "medium" ? "risk-medium" : "risk-low");
    const progressColor = data.riskColor || (data.riskLevel === "high" ? "#ef4444" : (data.riskLevel === "medium" ? "#f59e0b" : "#10b981"));

    container.innerHTML = `
      <div style="background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(99, 102, 241, 0.35); border-radius: 14px; padding: 14px; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
        <!-- Phone & Copy -->
        <div class="deen-modal-phone-card" style="margin-bottom: 12px;">
          <div>
            <span style="font-size: 10.5px; color: #94a3b8; display: block;">Recipient</span>
            <span class="deen-modal-phone-text" style="font-size: 15px;">${data.phone}</span>
          </div>
          <button class="deen-modal-copy-btn" id="deen-sidebar-btn-copy" title="Copy Number">📋 Copy</button>
        </div>

        <!-- Risk Badge & Score -->
        <div class="deen-modal-score-box" style="margin-bottom: 12px; padding: 12px;">
          <div class="deen-modal-risk-badge ${riskClass}" style="font-size: 11px; padding: 3px 10px;">
            <span>●</span>
            <span>${data.riskLabel}</span>
          </div>

          <div class="deen-modal-percent-row" style="margin-bottom: 6px;">
            <span class="deen-modal-percent-val" style="color: ${progressColor}; font-size: 30px;">${data.successRate}%</span>
            <span class="deen-modal-percent-label" style="font-size: 11px;">Success Rate</span>
          </div>

          <div class="deen-modal-progress-bar" style="height: 6px;">
            <div class="deen-modal-progress-fill" style="width: ${data.successRate}%; background: ${progressColor};"></div>
          </div>
        </div>

        <!-- 3-Col Stats -->
        <div class="deen-modal-stats-grid" style="gap: 6px; margin-bottom: 12px;">
          <div class="deen-modal-stat-card" style="padding: 8px 4px;">
            <div class="deen-modal-stat-label" style="font-size: 9.5px;">Total</div>
            <div class="deen-modal-stat-val" style="font-size: 16px;">${data.totalParcels}</div>
          </div>
          <div class="deen-modal-stat-card" style="padding: 8px 4px;">
            <div class="deen-modal-stat-label" style="font-size: 9.5px;">Delivered</div>
            <div class="deen-modal-stat-val deen-stat-delivered" style="font-size: 16px;">${data.deliveredCount}</div>
          </div>
          <div class="deen-modal-stat-card" style="padding: 8px 4px;">
            <div class="deen-modal-stat-label" style="font-size: 9.5px;">Return/Cancel</div>
            <div class="deen-modal-stat-val deen-stat-cancelled" style="font-size: 16px;">${data.cancelledCount}</div>
          </div>
        </div>

        <!-- Couriers Verified -->
        <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px;">
          <div class="deen-modal-courier-chip" style="font-size: 10.5px; padding: 5px 8px;">
            <span class="deen-modal-courier-dot" style="background: ${data.pathaoStatus === 'live' ? '#10b981' : (data.pathaoStatus === 'clean_record' ? '#3b82f6' : (data.pathaoStatus === 'token_missing' ? '#f59e0b' : '#ef4444'))};"></span>
            <span>Pathao: <strong>${data.pathaoStats ? `${data.pathaoStats.delivered}/${data.pathaoStats.total} (${Math.round((data.pathaoStats.delivered / Math.max(1, data.pathaoStats.total)) * 100)}%)` : (data.pathaoStatus === 'clean_record' ? '0 Orders (Clean)' : (data.pathaoStatus === 'token_missing' ? 'Link Needed' : 'Not Connected'))}</strong></span>
          </div>
          <div class="deen-modal-courier-chip" style="font-size: 10.5px; padding: 5px 8px;">
            <span class="deen-modal-courier-dot" style="background: ${data.steadfastStatus === 'live' ? '#10b981' : '#3b82f6'};"></span>
            <span>Steadfast: <strong>${data.steadfastStats ? `${data.steadfastStats.delivered}/${data.steadfastStats.total}` : (data.riskLevel === 'high' ? 'High Risk' : 'Normal')}</strong></span>
          </div>
        </div>

        ${data.pathaoStatus === 'token_missing' ? `
          <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 8px; padding: 8px 10px; font-size: 11px; color: #fbbf24; display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
            <span>⚠️ Open Pathao tab once to capture live merchant session</span>
            <button id="deen-sidebar-btn-connect-pathao" style="background: #f59e0b; color: #000; border: none; border-radius: 4px; padding: 3px 6px; font-weight: 700; font-size: 10px; cursor: pointer; white-space: nowrap;">Open</button>
          </div>
        ` : ''}

        <!-- 1-Click Pathao Dispatch -->
        <button class="deen-modal-btn-action" id="deen-sidebar-btn-open-pathao" style="width: 100%; padding: 8px 12px; font-size: 12px;">
          <span>🚀 Open Pathao Create</span>
        </button>
      </div>
    `;

    const copyBtn = container.querySelector("#deen-sidebar-btn-copy");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(data.phone).then(() => {
            copyBtn.textContent = "✓ Copied!";
            setTimeout(() => { if (copyBtn) copyBtn.textContent = "📋 Copy"; }, 1500);
          });
        }
      });
    }

    const connectBtn = container.querySelector("#deen-sidebar-btn-connect-pathao");
    if (connectBtn) {
      connectBtn.addEventListener("click", () => {
        if (isExtensionValid() && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ action: "focus_or_open_pathao" }).catch(() => {});
        }
      });
    }

    const openPathaoBtn = container.querySelector("#deen-sidebar-btn-open-pathao");
    if (openPathaoBtn) {
      openPathaoBtn.addEventListener("click", () => {
        triggerPathaoSync(data.phone, { source: "sidebar_drawer", autoSwitch: true });
      });
    }
  }

  function checkCustomerInSidebar(phone) {
    const cardContainer = (sidebarEl && sidebarEl.querySelector("#deen-sidebar-card-container")) || document.getElementById("deen-sidebar-card-container");
    if (!cardContainer || !phone) return;

    cardContainer.innerHTML = `
      <div class="deen-modal-skeleton-body" style="padding: 20px 8px;">
        <div class="deen-spinner-circle" style="width: 28px; height: 28px;"></div>
        <div class="deen-skeleton-text" style="font-size: 12px;">Analyzing courier records for <strong>${phone}</strong>...</div>
      </div>
    `;

    if (isExtensionValid() && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        action: "fetch_customer_rating",
        phone: phone
      }, (response) => {
        if (chrome.runtime.lastError) {
          void chrome.runtime.lastError.message;
        }
        const data = (response && response.success) ? response : {
          success: true,
          phone: phone,
          successRate: 100,
          totalParcels: 0,
          deliveredCount: 0,
          cancelledCount: 0,
          riskLevel: "low",
          riskLabel: "New Customer (No Returns Reported)",
          riskColor: "#3b82f6",
          isNewCustomer: true
        };

        renderSidebarActiveCard(cardContainer, data);
        addToRecentHistory({
          phone: data.phone,
          successRate: data.successRate,
          riskLevel: data.riskLevel,
          riskLabel: data.riskLabel,
          timestamp: Date.now()
        });
      });
    } else {
      const data = {
        phone: phone,
        successRate: 100,
        totalParcels: 0,
        deliveredCount: 0,
        cancelledCount: 0,
        riskLevel: "low",
        riskLabel: "Customer Ready",
        riskColor: "#10b981",
        isNewCustomer: true
      };
      renderSidebarActiveCard(cardContainer, data);
      addToRecentHistory(data);
    }
  }

  function toggleSidebar(forceOpen) {
    if (!sidebarEl) return;
    const isOpen = sidebarEl.classList.contains("open");
    const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : !isOpen;

    if (shouldOpen) {
      sidebarEl.classList.add("open");
      if (sidebarTabEl) sidebarTabEl.style.display = "none";
      const input = sidebarEl.querySelector("#deen-sidebar-phone-input");
      if (input) setTimeout(() => input.focus(), 150);
    } else {
      sidebarEl.classList.remove("open");
      if (sidebarTabEl) sidebarTabEl.style.display = "inline-flex";
    }
  }

  function openSidebar(phone) {
    toggleSidebar(true);
    if (phone) {
      const input = (sidebarEl && sidebarEl.querySelector("#deen-sidebar-phone-input")) || document.getElementById("deen-sidebar-phone-input");
      if (input) input.value = phone;
      checkCustomerInSidebar(phone);
    }
  }

  function closeSidebar() {
    toggleSidebar(false);
  }

  function initSidebarDrawer() {
    if (document.getElementById("deen-sidebar-dock-tab") || document.getElementById("deen-rating-sidebar")) {
      return;
    }

    // 1. Floating Dock Tab on Middle-Right Edge
    const dockTab = document.createElement("div");
    dockTab.id = "deen-sidebar-dock-tab";
    dockTab.title = "⚡ Click to toggle Customer Rating Sidebar";
    dockTab.innerHTML = `
      <span class="deen-dock-tab-icon">⚡</span>
      <span>Rating Check</span>
    `;

    // 2. Sliding Sidebar Drawer
    const sidebar = document.createElement("div");
    sidebar.id = "deen-rating-sidebar";
    sidebar.innerHTML = `
      <div class="deen-sidebar-header">
        <div class="deen-sidebar-title-group">
          <div class="deen-dock-tab-icon">⚡</div>
          <div>
            <div class="deen-sidebar-title">Customer Delivery Rating</div>
            <div class="deen-sidebar-subtitle">Pathao & Courier Intelligence</div>
          </div>
        </div>
        <button class="deen-sidebar-close-btn" id="deen-sidebar-btn-close" title="Close Sidebar">&times;</button>
      </div>

      <div class="deen-sidebar-body">
        <!-- Search Box -->
        <div class="deen-sidebar-search-box">
          <div class="deen-sidebar-search-title">
            <span>🔍 Check Recipient Number</span>
          </div>
          <div class="deen-sidebar-search-row">
            <input type="tel" id="deen-sidebar-phone-input" class="deen-sidebar-input" placeholder="e.g. 017XXXXXXXX..." />
            <button id="deen-sidebar-btn-search" class="deen-sidebar-btn-check">⚡ Check</button>
          </div>
        </div>

        <!-- Active Customer Card Container -->
        <div id="deen-sidebar-card-container">
          <div style="text-align: center; padding: 24px 12px; color: #64748b; font-size: 12.5px;">
            <span>Highlight, copy, or enter any BD phone number above to see real-time Pathao delivery score & fraud risk.</span>
          </div>
        </div>

        <!-- Recent History Box -->
        <div class="deen-sidebar-history-box" id="deen-sidebar-history-box">
          <div class="deen-sidebar-history-title">
            <span>🕒 Recent Checked Numbers</span>
            <button id="deen-sidebar-clear-history" style="background: none; border: none; color: #64748b; font-size: 10px; cursor: pointer;">Clear</button>
          </div>
          <div class="deen-sidebar-history-list" id="deen-sidebar-history-list">
            <div style="font-size: 11px; color: #64748b; text-align: center; padding: 6px;">No recent checks yet</div>
          </div>
        </div>
      </div>

      <div class="deen-sidebar-footer">
        <span>⚡ DEEN Courier Intelligence</span>
        <span style="color: #94a3b8; font-size: 10px;">Universal Mode</span>
      </div>
    `;

    document.body.appendChild(dockTab);
    document.body.appendChild(sidebar);
    sidebarTabEl = dockTab;
    sidebarEl = sidebar;

    // Toggle behavior
    dockTab.addEventListener("click", () => {
      toggleSidebar();
    });

    const closeBtn = sidebar.querySelector("#deen-sidebar-btn-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        closeSidebar();
      });
    }

    // Search button & Enter key
    const input = sidebar.querySelector("#deen-sidebar-phone-input");
    const searchBtn = sidebar.querySelector("#deen-sidebar-btn-search");

    const doSearch = () => {
      if (!input) return;
      const rawVal = (input.value || "").trim();
      const cleanPhone = normalizeBDPhone(rawVal);
      if (cleanPhone) {
        input.value = cleanPhone;
        checkCustomerInSidebar(cleanPhone);
      } else {
        input.style.borderColor = "#ef4444";
        setTimeout(() => { if (input) input.style.borderColor = ""; }, 1500);
      }
    };

    if (searchBtn) searchBtn.addEventListener("click", doSearch);
    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          doSearch();
        }
      });
    }

    // Clear history button
    const clearBtn = sidebar.querySelector("#deen-sidebar-clear-history");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        saveRecentHistory([]);
        renderSidebarHistory([]);
      });
    }

    // Load initial history
    loadRecentHistory((items) => {
      renderSidebarHistory(items);
    });
  }

  // Auto update sidebar if open when selection or copy occurs
  function syncWithSidebarIfOpen(phone) {
    if (!phone || !sidebarEl || !sidebarEl.classList.contains("open")) return;
    const input = (sidebarEl && sidebarEl.querySelector("#deen-sidebar-phone-input")) || document.getElementById("deen-sidebar-phone-input");
    if (input) input.value = phone;
    checkCustomerInSidebar(phone);
  }

  // Initialize listeners
  function init() {
    if (!isExtensionValid()) return;
    initSidebarDrawer();
    initHighlightListener();
    initCopyListener();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
