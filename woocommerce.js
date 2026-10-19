/**
 * DEEN Delivery Parser - WooCommerce Integration Content Script
 * Injected on WooCommerce admin pages (e.g. wc-orders, wc-processing)
 */

(function () {
  "use strict";

  // Prevent duplicate execution if script is injected multiple times in browser
  if (typeof window !== "undefined") {
    if (typeof module === "undefined" && window.__deenWcActive) return;
    window.__deenWcActive = true;
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

  const BD_PHONE_SEARCH_REGEX = /(?:(?:\+|00)?880[\s.-]?)?0?(1[3-9][0-9]{2}[\s.-]?[0-9]{3}[\s.-]?[0-9]{3})\b/;
  const BD_PHONE_CLEAN_REGEX = /(?:(?:\+?880)|880|0)?(1[3-9]\d{8})\b/;

  /**
   * Clean and normalize a Bangladeshi phone number to standard 11 digits (01XXXXXXXXX)
   */
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

  /**
   * Convert Bengali digits [০-৯] to standard ASCII [0-9]
   */
  function bengaliToAsciiDigits(str) {
    if (!str) return "";
    const bengaliDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
    return String(str).replace(/[০-৯]/g, d => bengaliDigits.indexOf(d));
  }

  /**
   * Clean unescaped HTML entities in strings
   */
  function cleanHtmlEntities(str) {
    if (!str || typeof str !== "string") return "";
    return str
      .replace(/&times;/gi, "×")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#039;|&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&nbsp;/gi, " ")
      .replace(/&#2547;/gi, "৳")
      .trim();
  }

  /**
   * Filter out WooCommerce admin metadata, action buttons, or standalone size rows
   */
  function isExcludedMetaOrButtonRow(row, itemName) {
    if (row) {
      if (typeof row.closest === "function") {
        if (row.closest("table.wc-order-item-meta, table.display_meta, table.meta, .item-meta, .display_meta, .meta_items, tfoot")) {
          return true;
        }
      }
      if (typeof row.querySelector === "function") {
        if (row.querySelector(".add_order_item_meta, .add-order-item-meta, button[class*='add_order_item']")) {
          return true;
        }
      }
    }
    if (itemName) {
      const clean = itemName.trim();
      if (/^(?:Add meta|Add item|Add fee|Add shipping|Apply coupon|Refund|Tax|Shipping|Fee|Subtotal|Total|Custom meta)$/i.test(clean)) {
        return true;
      }
      if (/^(?:XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|\d{1,3})$/i.test(clean)) {
        return true;
      }
    }
    return false;
  }

  function findRowCell(row, selectors) {
    if (!row) return null;
    if (typeof row.querySelectorAll === "function") {
      const candidates = row.querySelectorAll(selectors);
      if (candidates && candidates.length > 0) {
        for (let i = 0; i < candidates.length; i++) {
          const el = candidates[i];
          if (typeof el.closest === "function") {
            if (el.closest("table.wc-order-item-meta, table.display_meta, table.meta, .item-meta, .display_meta, .meta_items, tfoot")) {
              continue;
            }
            if (el.closest("tr") !== row && el.closest("table") !== row.closest("table")) {
              continue;
            }
          }
          return el;
        }
      }
    }
    if (typeof row.querySelector === "function") {
      const el = row.querySelector(selectors);
      if (el) {
        if (typeof el.closest === "function") {
          if (el.closest("table.wc-order-item-meta, table.display_meta, table.meta, .item-meta, .display_meta, .meta_items, tfoot")) {
            return null;
          }
        }
        return el;
      }
    }
    return null;
  }

  // In-memory cache for fetched authoritative order details (prevents repeated network requests)
  const orderDetailsCache = new Map();

  /**
   * Discover WooCommerce Admin AJAX URL & Preview Nonce from DOM or window context
   */
  function getWooCommerceAjaxConfig() {
    let ajaxUrl = "/wp-admin/admin-ajax.php";
    let nonce = "";

    if (typeof window !== "undefined") {
      if (window.wc_orders_params && window.wc_orders_params.order_preview_nonce) {
        return { ajaxUrl: window.wc_orders_params.ajax_url || ajaxUrl, nonce: window.wc_orders_params.order_preview_nonce };
      }
      if (window.wc_orders_params && window.wc_orders_params.preview_nonce) {
        return { ajaxUrl: window.wc_orders_params.ajax_url || ajaxUrl, nonce: window.wc_orders_params.preview_nonce };
      }
      if (window.woocommerce_admin && window.woocommerce_admin.order_preview_nonce) {
        return { ajaxUrl: window.woocommerce_admin.ajax_url || ajaxUrl, nonce: window.woocommerce_admin.order_preview_nonce };
      }
      if (window.woocommerce_admin_meta_boxes && window.woocommerce_admin_meta_boxes.order_preview_nonce) {
        return { ajaxUrl: window.woocommerce_admin_meta_boxes.ajax_url || ajaxUrl, nonce: window.woocommerce_admin_meta_boxes.order_preview_nonce };
      }
    }

    if (typeof document !== "undefined") {
      const scripts = document.querySelectorAll("script");
      for (let s of scripts) {
        const text = s.textContent || s.innerText || "";
        if (!text || (!text.includes("order_preview_nonce") && !text.includes("preview_nonce"))) continue;

        const nonceMatch = text.match(/["'](?:order_preview_nonce|preview_nonce)["']\s*:\s*["']([a-zA-Z0-9_-]+)["']/i);
        if (nonceMatch) nonce = nonceMatch[1];

        const urlMatch = text.match(/["']ajax_url["']\s*:\s*["']([^"']+)["']/i);
        if (urlMatch) {
          ajaxUrl = urlMatch[1].replace(/\\/g, "");
        }
        if (nonce) break;
      }

      if (!nonce && document.documentElement) {
        const docHtml = document.documentElement.innerHTML || "";
        const nm = docHtml.match(/["'](?:order_preview_nonce|preview_nonce)["']\s*:\s*["']([a-zA-Z0-9_-]+)["']/i);
        if (nm) nonce = nm[1];
        const um = docHtml.match(/["']ajax_url["']\s*:\s*["']([^"']+)["']/i);
        if (um) ajaxUrl = um[1].replace(/\\/g, "");
      }
    }

    return { ajaxUrl, nonce };
  }

  /**
   * Parse structured order details returned from WooCommerce native AJAX endpoint
   * (action=woocommerce_get_order_details)
   */
  function parseWooCommerceAjaxOrderDetails(ajaxResponse, fallbackId) {
    if (!ajaxResponse) return null;
    let res = ajaxResponse;
    if (typeof ajaxResponse === "string") {
      try {
        res = JSON.parse(ajaxResponse);
      } catch (e) {
        return null;
      }
    }
    if (!res) return null;

    const dataWrapper = res.data || res;
    const orderData = dataWrapper.data || dataWrapper;

    const resolvedId = String(orderData.id || dataWrapper.order_number || fallbackId || "").replace(/^#/, "").trim();
    const billing = orderData.billing || {};
    const fn = (billing.first_name || "").trim();
    const ln = (billing.last_name || "").trim();
    let name = `${fn} ${ln}`.trim();
    if (!name && dataWrapper.formatted_billing_address) {
      const pb = parseWooCommerceAddressBlock(dataWrapper.formatted_billing_address);
      if (pb.name && !isInvalidCustomerName(pb.name)) name = pb.name;
    }

    const phone = normalizeBDPhone(billing.phone || orderData.phone || dataWrapper.phone || "");
    const addrParts = [billing.address_1, billing.address_2, billing.city, billing.state, billing.postcode].filter(Boolean);
    let address = addrParts.join(", ");
    if (!address && dataWrapper.formatted_billing_address) {
      const pb = parseWooCommerceAddressBlock(dataWrapper.formatted_billing_address);
      if (pb.address) address = pb.address;
      if (!name && pb.name && !isInvalidCustomerName(pb.name)) name = pb.name;
      if (!phone && pb.phone) phone = pb.phone;
    }

    let cod = "";
    if (orderData.total !== undefined && orderData.total !== null) {
      const tm = bengaliToAsciiDigits(String(orderData.total)).replace(/,/g, "").match(/[\d.]+/);
      if (tm) cod = Math.round(parseFloat(tm[0])).toString();
    }
    if (!cod && dataWrapper.total_html) {
      const tm = bengaliToAsciiDigits(dataWrapper.total_html).replace(/,/g, "").match(/[\d.]+/);
      if (tm) cod = Math.round(parseFloat(tm[0])).toString();
    }

    const items = [];
    const rawItems = orderData.line_items || dataWrapper.line_items || [];
    if (Array.isArray(rawItems) && rawItems.length > 0) {
      rawItems.forEach(it => {
        let itemName = (it.name || it.product_name || "").trim();
        const vars = [];
        const metas = it.meta_data || it.item_meta || it.meta || [];
        if (Array.isArray(metas)) {
          metas.forEach(m => {
            const k = (m.key || m.label || "").replace(/^pa_/, "").replace(/:$/, "").trim();
            const v = String(m.value || m.display_value || "").trim();
            if (/^(?:sku|id|cost|vendor|দাম)/i.test(k)) return;
            if (v && !/^(?:sku|id):/i.test(v)) {
              vars.push(`${k}: ${v}`);
            }
          });
        }
        const cleanVars = vars.filter(v => {
          const trimmed = v.trim();
          const valOnly = trimmed.replace(/^[^:]+:\s*/, "").trim();
          if (!valOnly || /^(?:Size|সাইজ|Color|কালার|রঙ|Fit|Variation|ভেরিয়েশন)[:\s-]*$/i.test(trimmed)) return false;
          if (itemName.toLowerCase().includes(trimmed.toLowerCase())) return false;
          if (itemName.toLowerCase().includes(valOnly.toLowerCase())) return false;
          return true;
        });
        if (cleanVars.length > 0) {
          itemName += ` (${cleanVars.join(", ")})`;
        }
        itemName = itemName.replace(/\s*\((?:Size|সাইজ|Color|কালার|রঙ|Fit|Variation|ভেরিয়েশন)[:\s]*\)/gi, "").trim();

        const qty = parseInt(bengaliToAsciiDigits(String(it.quantity || it.qty || "1")), 10) || 1;
        let total = "";
        if (it.total !== undefined && it.total !== null && it.total !== "") {
          const tm = bengaliToAsciiDigits(String(it.total)).replace(/,/g, "").match(/[\d.]+/);
          if (tm) total = Math.round(parseFloat(tm[0])).toString();
        }
        let unitPrice = "";
        if (it.subtotal !== undefined && it.subtotal !== null && it.subtotal !== "" && qty > 0) {
          const sm = bengaliToAsciiDigits(String(it.subtotal)).replace(/,/g, "").match(/[\d.]+/);
          if (sm) unitPrice = Math.round(parseFloat(sm[0]) / qty).toString();
        }
        if (!unitPrice && total && qty) unitPrice = Math.round(Number(total) / qty).toString();
        if (!total && unitPrice && qty) total = (Number(unitPrice) * qty).toString();

        items.push({ name: itemName, qty, unitPrice, total });
      });
    }

    // Fallback: check item_html if items array was empty
    if (items.length === 0 && dataWrapper.item_html) {
      const parsedFromHtml = parseOrderEditPageHTML(dataWrapper.item_html, resolvedId);
      if (parsedFromHtml && parsedFromHtml.items && parsedFromHtml.items.length > 0) {
        items.push(...parsedFromHtml.items);
      }
    }

    if (!cod && items.length > 0) {
      const sum = items.reduce((a, b) => a + (Number(b.total) || 0), 0);
      if (sum > 0) cod = Math.round(sum).toString();
    }

    let parsed = { district: "", zone: "", streetAddress: address };
    let parseBD = typeof parseBDAddress === "function" ? parseBDAddress : null;
    if (!parseBD && typeof require !== "undefined") {
      try { parseBD = require("./parser.js").parseBDAddress; } catch (e) {}
    }
    if (address && parseBD) parsed = parseBD(address);

    const isOutside = (parsed.district && !parsed.district.toLowerCase().includes("dhaka")) ||
                      (address && !address.toLowerCase().includes("dhaka"));

    return {
      orderId: resolvedId,
      name: name,
      phone: phone,
      address: address,
      district: parsed.district || "",
      zone: parsed.zone || "",
      items: items,
      cod: cod,
      isOutsideDhaka: isOutside
    };
  }

  /**
   * Parse complete authoritative order details from WooCommerce order edit page HTML
   * Supports both classic WooCommerce (post.php) and HPOS (admin.php?page=wc-orders&action=edit)
   */
  function parseOrderEditPageHTML(htmlOrDoc, orderId) {
    if (!htmlOrDoc) return null;
    let doc = htmlOrDoc;
    if (typeof htmlOrDoc === "string") {
      if (typeof DOMParser !== "undefined") {
        try {
          doc = new DOMParser().parseFromString(htmlOrDoc, "text/html");
        } catch (e) {
          doc = null;
        }
      } else {
        doc = null;
      }
    }

    // Resilient fallback for Node.js / worker contexts lacking DOMParser
    if (typeof htmlOrDoc === "string" && (!doc || !doc.querySelector)) {
      let rawHtml = cleanHtmlEntities(htmlOrDoc);
      rawHtml = rawHtml.replace(/&#\d+;|&[a-z]+;/gi, " ");

      let resolvedOrderId = orderId || "";
      const pidMatch = rawHtml.match(/name=['"](?:post_ID|order_id)['"][^>]*value=['"]([^'"]+)['"]/i) ||
                       rawHtml.match(/value=['"]([^'"]+)['"][^>]*name=['"](?:post_ID|order_id)['"]/i) ||
                       rawHtml.match(/(?:Order|অর্ডার)\s*#\s*(\d{3,8})/i) ||
                       rawHtml.match(/(?:^|[^\w&#])#(\d{3,8})/);
      if (pidMatch) resolvedOrderId = pidMatch[1].trim();

      const fnMatch = rawHtml.match(/name=['"]_billing_first_name['"][^>]*value=['"]([^'"]+)['"]/i) ||
                      rawHtml.match(/value=['"]([^'"]+)['"][^>]*name=['"]_billing_first_name['"]/i);
      const lnMatch = rawHtml.match(/name=['"]_billing_last_name['"][^>]*value=['"]([^'"]+)['"]/i) ||
                      rawHtml.match(/value=['"]([^'"]+)['"][^>]*name=['"]_billing_last_name['"]/i);
      let name = `${fnMatch ? fnMatch[1] : ''} ${lnMatch ? lnMatch[1] : ''}`.trim();
      if (!name) {
        const strongM = rawHtml.match(/<div class=['"][^'"]*address[^'"]*['"][\s\S]*?<strong>([^<]+)<\/strong>/i);
        if (strongM) name = strongM[1].trim();
      }

      const phoneMatch = rawHtml.match(/name=['"](?:_billing_phone|_shipping_phone)['"][^>]*value=['"]([^'"]+)['"]/i) ||
                         rawHtml.match(/value=['"]([^'"]+)['"][^>]*name=['"](?:_billing_phone|_shipping_phone)['"]/i) ||
                         rawHtml.match(/(?:01[3-9]\d{8})/);
      const phone = phoneMatch ? normalizeBDPhone(phoneMatch[1] || phoneMatch[0]) : "";

      const a1Match = rawHtml.match(/name=['"]_billing_address_1['"][^>]*value=['"]([^'"]+)['"]/i);
      const cityMatch = rawHtml.match(/name=['"]_billing_city['"][^>]*value=['"]([^'"]+)['"]/i);
      const address = [a1Match ? a1Match[1] : "", cityMatch ? cityMatch[1] : ""].filter(Boolean).join(", ");

      const totMatch = rawHtml.match(/name=['"]_order_total['"][^>]*value=['"]([^'"]+)['"]/i) ||
                       rawHtml.match(/value=['"]([^'"]+)['"][^>]*name=['"]_order_total['"]/i);
      let cod = "";
      if (totMatch) {
        const tm = bengaliToAsciiDigits(totMatch[1]).replace(/,/g, "").match(/[\d.]+/);
        if (tm) cod = Math.round(parseFloat(tm[0])).toString();
      }

      // Line items regex
      // Neutralize nested meta table <tr>/</tr> tags so row matching does not stop prematurely at inner tables
      const sanitizedHtml = rawHtml.replace(/<table\b[^>]*class=['"][^'"]*(?:display_meta|meta|wc-order-item-meta)[^'"]*['"][^>]*>([\s\S]*?)<\/table>/gi, (tblMatch) => {
        return tblMatch
          .replace(/<tr\b/gi, "<nested-tr")
          .replace(/<\/tr>/gi, "</nested-tr>");
      });

      const items = [];
      const itemRowMatches = sanitizedHtml.match(/<tr[^>]*class=['"][^'"]*(?:item|wc-order-preview-table__item)[^'"]*['"][^>]*>[\s\S]*?<\/tr>/gi) || [];
      itemRowMatches.forEach(rowHtml => {
        if (/^<tr[^>]*class=['"][^'"]*(?:display_meta|meta_items|add_order_item)[^'"]*['"]/i.test(rowHtml.trim())) return;
        const nameM = rowHtml.match(/<a[^>]*class=['"][^'"]*wc-order-item-name[^'"]*['"][^>]*>([^<]+)<\/a>/i) ||
                      rowHtml.match(/class=['"][^'"]*wc-order-item-name[^'"]*['"][^>]*>([^<]+)</i) ||
                      rowHtml.match(/class=['"][^'"]*wc-order-preview-table__column--product[^'"]*['"][^>]*>([\s\S]*?)<\/td>/i);
        if (!nameM) return;
        let itemName = cleanHtmlEntities(nameM[1].replace(/<[^>]+>/g, " ").trim());
        itemName = itemName.replace(/\s*(?:&times;|×|x|\*)\s*\d+$/i, "").trim();
        if (isExcludedMetaOrButtonRow(null, itemName)) return;

        // Variations / sizes
        const metaMatches = rowHtml.match(/<strong[^>]*>([^<]+)<\/strong>[\s\S]*?<p>([^<]+)<\/p>/gi) || [];
        const vars = [];
        metaMatches.forEach(m => {
          const lblM = m.match(/<strong[^>]*>([^<]+)<\/strong>/i);
          const valM = m.match(/<p>([^<]+)<\/p>/i);
          if (lblM && valM) {
            const lbl = lblM[1].replace(/:$/, "").trim();
            const val = valM[1].trim();
            if (!/^(?:SKU|ID|Cost)/i.test(lbl)) vars.push(`${lbl}: ${val}`);
          }
        });
        const metaTableRows = rowHtml.match(/<(?:tr|nested-tr)[^>]*>[\s\S]*?<th[^>]*>([^<]+)<\/th>[\s\S]*?<td[^>]*>([^<]+)<\/td>[\s\S]*?<\/(?:tr|nested-tr)>/gi) || [];
        metaTableRows.forEach(mtr => {
          const mth = mtr.match(/<th[^>]*>([^<]+)<\/th>/i);
          const mtd = mtr.match(/<td[^>]*>([^<]+)<\/td>/i);
          if (mth && mtd) {
            const k = mth[1].replace(/:$/, "").trim();
            const v = mtd[1].trim();
            if (!/^(?:SKU|ID|Cost)/i.test(k) && !vars.some(x => x.startsWith(k))) {
              vars.push(`${k}: ${v}`);
            }
          }
        });
        const cleanVars = vars.filter(v => {
          const trimmed = v.trim();
          const valOnly = trimmed.replace(/^[^:]+:\s*/, "").trim();
          if (!valOnly || /^(?:Size|সাইজ|Color|কালার|রঙ|Fit|Variation|ভেরিয়েশন)[:\s-]*$/i.test(trimmed)) return false;
          if (itemName.toLowerCase().includes(trimmed.toLowerCase())) return false;
          if (itemName.toLowerCase().includes(valOnly.toLowerCase())) return false;
          return true;
        });
        if (cleanVars.length > 0) itemName += ` (${cleanVars.join(", ")})`;
        itemName = itemName.replace(/\s*\((?:Size|সাইজ|Color|কালার|রঙ|Fit|Variation|ভেরিয়েশন)[:\s]*\)/gi, "").trim();

        let qty = 1;
        const qM = rowHtml.match(/class=['"][^'"]*(?:quantity|wc-order-preview-table__column--quantity)[^'"]*['"][\s\S]*?(?:times['"][^>]*>[^<]*<\/small>)?\s*(\d+)/i) ||
                   rowHtml.match(/name=['"](?:order_item_qty|quantity)[^'"]*['"][^>]*value=['"](\d+)['"]/i);
        if (qM) qty = parseInt(qM[1], 10);

        let lineTotal = "";
        const lineCostBlock = rowHtml.match(/<td[^>]*class=['"][^'"]*(?:line_cost|line_total|wc-order-preview-table__column--total)[^'"]*['"][\s\S]*?<\/td>/i);
        if (lineCostBlock) {
          const tm = bengaliToAsciiDigits(lineCostBlock[0].replace(/<[^>]+>/g, " ")).replace(/,/g, "").match(/[\d.]+/);
          if (tm) lineTotal = Math.round(parseFloat(tm[0])).toString();
        }
        if (!lineTotal) {
          const totInputM = rowHtml.match(/name=['"]line_total[^'"]*['"][^>]*value=['"]([^'"]+)['"]/i);
          if (totInputM) {
            const tm = bengaliToAsciiDigits(totInputM[1]).replace(/,/g, "").match(/[\d.]+/);
            if (tm) lineTotal = Math.round(parseFloat(tm[0])).toString();
          }
        }

        let unitPrice = "";
        const itemCostBlock = rowHtml.match(/<td[^>]*class=['"][^'"]*(?:item_cost|wc-order-preview-table__column--cost)[^'"]*['"][\s\S]*?<\/td>/i);
        if (itemCostBlock) {
          const cm = bengaliToAsciiDigits(itemCostBlock[0].replace(/<[^>]+>/g, " ")).replace(/,/g, "").match(/[\d.]+/);
          if (cm) unitPrice = Math.round(parseFloat(cm[0])).toString();
        }
        if (!unitPrice) {
          const costInputM = rowHtml.match(/name=['"](?:order_item_cost|item_cost)[^'"]*['"][^>]*value=['"]([^'"]+)['"]/i);
          if (costInputM) {
            const cm = bengaliToAsciiDigits(costInputM[1]).replace(/,/g, "").match(/[\d.]+/);
            if (cm) unitPrice = Math.round(parseFloat(cm[0])).toString();
          }
        }

        if (!lineTotal && unitPrice && qty) lineTotal = (Number(unitPrice) * qty).toString();
        if (!unitPrice && lineTotal && qty) unitPrice = Math.round(Number(lineTotal) / qty).toString();

        items.push({ name: itemName, qty, unitPrice, total: lineTotal });
      });

      let parsed = { district: "", zone: "", streetAddress: address };
      let parseBD = typeof parseBDAddress === "function" ? parseBDAddress : null;
      if (!parseBD && typeof require !== "undefined") {
        try { parseBD = require("./parser.js").parseBDAddress; } catch (e) {}
      }
      if (address && parseBD) parsed = parseBD(address);

      const isOutside = (parsed.district && !parsed.district.toLowerCase().includes("dhaka")) ||
                        (address && !address.toLowerCase().includes("dhaka"));

      return {
        orderId: resolvedOrderId,
        name: name,
        phone: phone,
        address: address,
        district: parsed.district || "",
        zone: parsed.zone || "",
        items: items,
        cod: cod || (items.length > 0 ? items.reduce((a, b) => a + (Number(b.total) || 0), 0).toString() : "0"),
        isOutsideDhaka: isOutside
      };
    }

    // 1. Order ID
    let resolvedOrderId = orderId || "";
    if (!resolvedOrderId && doc.querySelector) {
      const postEl = doc.querySelector("#post_ID, input[name='post_ID'], input[name='order_id']");
      if (postEl && postEl.value) resolvedOrderId = postEl.value.trim();
    }
    if (!resolvedOrderId && doc.querySelector) {
      const h1 = doc.querySelector("h1.wp-heading-inline, .wc-order-number, h1");
      if (h1) {
        const hm = bengaliToAsciiDigits(h1.textContent || h1.innerText || "").match(/#(\d+)/);
        if (hm) resolvedOrderId = hm[1];
      }
    }

    // 2. Customer details
    let name = "";
    if (doc.querySelector) {
      const fnInput = doc.querySelector("#_billing_first_name, input[name='_billing_first_name']");
      const lnInput = doc.querySelector("#_billing_last_name, input[name='_billing_last_name']");
      if (fnInput || lnInput) {
        name = `${(fnInput ? fnInput.value : '')} ${(lnInput ? lnInput.value : '')}`.trim();
      }
      if (isInvalidCustomerName(name)) {
        const strongName = doc.querySelector(".order_data_column address p strong, .woocommerce-order-data__billing strong");
        if (strongName) name = (strongName.textContent || strongName.innerText || "").trim();
      }
    }

    let phone = "";
    if (doc.querySelector) {
      const phoneInput = doc.querySelector("#_billing_phone, input[name='_billing_phone'], #_shipping_phone, input[name='_shipping_phone']");
      if (phoneInput && phoneInput.value) {
        phone = normalizeBDPhone(phoneInput.value) || "";
      }
      if (!phone) {
        const phoneLink = doc.querySelector("a[href^='tel:']");
        if (phoneLink) phone = normalizeBDPhone(phoneLink.getAttribute("href").replace("tel:", "")) || "";
      }
      if (!phone) {
        const addrCol = doc.querySelector(".order_data_column, .address, address");
        if (addrCol) phone = normalizeBDPhone(addrCol.textContent || addrCol.innerText || "") || "";
      }
    }

    let address = "";
    if (doc.querySelector) {
      const a1 = doc.querySelector("#_billing_address_1, input[name='_billing_address_1']");
      const a2 = doc.querySelector("#_billing_address_2, input[name='_billing_address_2']");
      const city = doc.querySelector("#_billing_city, input[name='_billing_city']");
      if (a1 && a1.value) {
        const parts = [a1.value, a2 ? a2.value : "", city ? city.value : ""].filter(Boolean);
        address = parts.join(", ");
      }
      if (!address) {
        const addrEl = doc.querySelector(".order_data_column address, address");
        if (addrEl) {
          const parsedBlock = parseWooCommerceAddressBlock(addrEl);
          if (parsedBlock.address) address = parsedBlock.address;
          if (parsedBlock.name && isInvalidCustomerName(name)) name = parsedBlock.name;
          if (parsedBlock.phone && !phone) phone = parsedBlock.phone;
        }
      }
    }

    // 3. Line Items (#order_line_items tr.item, HPOS & classic support)
    const items = [];
    if (doc.querySelectorAll) {
      const itemRows = doc.querySelectorAll(
        "#order_line_items > tr.item, #order_line_items > tr[data-order_item_id], tbody#order_line_items > tr, table.woocommerce_order_items > tbody > tr.item, table.wc-order-preview-table > tbody > tr, .order-preview-line-items table > tbody > tr, tr.order-preview-item, tr.wc-order-item, tr.wc-order-preview-table__item, tr.woocommerce-table__line-item, tr.item"
      );
      itemRows.forEach(row => {
        if (row.querySelector("th") && !row.querySelector("td")) return;
        if (isExcludedMetaOrButtonRow(row)) return;

        const nameEl = findRowCell(
          row,
          ".wc-order-item-name, td.name a, td.name .view a, td.name, td.column-item, .wc-order-preview-table__column--product, [data-colname='Item'], .product-name"
        ) || (row.children && row.children[0]);
        if (!nameEl) return;
        const itemName = extractItemNameWithSize(nameEl, row);
        if (!itemName || isExcludedMetaOrButtonRow(row, itemName)) return;

        let qty = 1;
        const qtyInput = row.querySelector("input.quantity, .quantity input, input[name*='order_item_qty']");
        if (qtyInput && qtyInput.value) {
          const qVal = parseInt(bengaliToAsciiDigits(qtyInput.value), 10);
          if (!isNaN(qVal) && qVal > 0) qty = qVal;
        } else {
          const qtyEl = findRowCell(
            row,
            ".wc-order-preview-table__column--quantity, td[class*='column--quantity'], .wc-order-item-qty, .quantity .view, td.quantity, td.column-qty, .item-qty"
          );
          if (qtyEl) {
            const qm = bengaliToAsciiDigits(qtyEl.textContent || qtyEl.innerText || "").match(/\d+/);
            if (qm) qty = parseInt(qm[0], 10);
          }
        }

        let lineTotal = "";
        const totalEl = findRowCell(
          row,
          ".wc-order-preview-table__column--total, td[class*='column--total'], .line_cost .amount, td.line_cost .view .amount, td.line_cost, .line_total .amount, .wc-order-item-total, td.total, td.column-total"
        );
        if (totalEl) {
          const tm = bengaliToAsciiDigits(totalEl.textContent || totalEl.innerText || "").replace(/,/g, "").match(/[\d.]+/);
          if (tm) lineTotal = Math.round(parseFloat(tm[0])).toString();
        }
        if (!lineTotal) {
          const totalInput = row.querySelector("input[name*='line_total'], input.line_total");
          if (totalInput && totalInput.value) {
            const tm = bengaliToAsciiDigits(totalInput.value).replace(/,/g, "").match(/[\d.]+/);
            if (tm) lineTotal = Math.round(parseFloat(tm[0])).toString();
          }
        }
        if (!lineTotal && row.getAttribute("data-sort-value")) {
          const sv = bengaliToAsciiDigits(row.getAttribute("data-sort-value")).replace(/,/g, "").match(/[\d.]+/);
          if (sv) lineTotal = Math.round(parseFloat(sv[0])).toString();
        }

        let unitPrice = "";
        const costEl = findRowCell(
          row,
          ".wc-order-preview-table__column--cost, td[class*='column--cost'], .item_cost .amount, td.item_cost .view .amount, td.item_cost, .view .amount"
        );
        if (costEl) {
          const cm = bengaliToAsciiDigits(costEl.textContent || costEl.innerText || "").replace(/,/g, "").match(/[\d.]+/);
          if (cm) unitPrice = Math.round(parseFloat(cm[0])).toString();
        }
        if (!unitPrice) {
          const costInput = row.querySelector("input[name*='order_item_cost'], input[name*='item_cost'], input.item_cost");
          if (costInput && costInput.value) {
            const cm = bengaliToAsciiDigits(costInput.value).replace(/,/g, "").match(/[\d.]+/);
            if (cm) unitPrice = Math.round(parseFloat(cm[0])).toString();
          }
        }
        if (!lineTotal && unitPrice && qty) {
          lineTotal = (Number(unitPrice) * qty).toString();
        }
        if (!unitPrice && lineTotal && qty) {
          unitPrice = Math.round(Number(lineTotal) / qty).toString();
        }

        items.push({
          name: itemName,
          qty: qty,
          unitPrice: unitPrice,
          total: lineTotal
        });
      });
    }

    // 4. Total COD
    let cod = "";
    if (doc.querySelector) {
      const totalInput = doc.querySelector("#_order_total, input[name='_order_total']");
      if (totalInput && totalInput.value) {
        const tm = bengaliToAsciiDigits(totalInput.value).replace(/,/g, "").match(/[\d.]+/);
        if (tm) cod = Math.round(parseFloat(tm[0])).toString();
      }
      if (!cod) {
        const orderTotalEl = doc.querySelector(".wc-order-totals #_order_total, .wc-order-totals .order_total .amount, .order-totals .amount, .order_total .amount, .order-total .amount, bdi");
        if (orderTotalEl) {
          const tm = bengaliToAsciiDigits(orderTotalEl.textContent || orderTotalEl.innerText || "").replace(/,/g, "").match(/[\d.]+/);
          if (tm) cod = Math.round(parseFloat(tm[0])).toString();
        }
      }
    }
    if (!cod && items.length > 0) {
      const sum = items.reduce((acc, it) => acc + (parseFloat(it.total) || 0), 0);
      if (sum > 0) cod = Math.round(sum).toString();
    }

    let parsed = { district: "", zone: "", streetAddress: address };
    let parseBD = typeof parseBDAddress === "function" ? parseBDAddress : null;
    if (!parseBD && typeof require !== "undefined") {
      try { parseBD = require("./parser.js").parseBDAddress; } catch (e) {}
    }
    if (address && parseBD) {
      parsed = parseBD(address);
    }

    const isOutside = (parsed.district && !parsed.district.toLowerCase().includes("dhaka")) ||
                      (address && !address.toLowerCase().includes("dhaka"));

    return {
      orderId: resolvedOrderId,
      name: name,
      phone: phone,
      address: address,
      district: parsed.district || "",
      zone: parsed.zone || "",
      items: items,
      cod: cod,
      isOutsideDhaka: isOutside
    };
  }

  /**
   * Fetch authoritative order details in background via WooCommerce AJAX or same-origin edit page fetch
   */
  function fetchOrderDetailsViaEditPage(orderId, orderUrl, callback) {
    if (!orderId && !orderUrl) {
      if (typeof callback === "function") callback(null);
      return;
    }

    const idKey = orderId ? String(orderId).replace(/^#/, "").trim() : "";
    if (idKey && orderDetailsCache.has(idKey)) {
      const cached = orderDetailsCache.get(idKey);
      if (cached && cached.items && cached.items.length > 0) {
        if (typeof callback === "function") callback(cached);
        return;
      }
    }

    if (typeof fetch !== "function") {
      if (typeof callback === "function") callback(null);
      return;
    }

    // Step 1: Try WooCommerce Admin AJAX endpoint if nonce is available
    const ajaxCfg = getWooCommerceAjaxConfig();
    if (ajaxCfg.nonce && idKey) {
      const baseOrigin = typeof window !== "undefined" && window.location ? window.location.origin : "";
      const ajaxEndpoint = ajaxCfg.ajaxUrl.startsWith("http")
        ? `${ajaxCfg.ajaxUrl}?action=woocommerce_get_order_details&order_id=${idKey}&security=${ajaxCfg.nonce}`
        : `${baseOrigin}${ajaxCfg.ajaxUrl}?action=woocommerce_get_order_details&order_id=${idKey}&security=${ajaxCfg.nonce}`;

      fetch(ajaxEndpoint, { credentials: "same-origin" })
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then(json => {
          const parsed = parseWooCommerceAjaxOrderDetails(json, idKey);
          if (parsed && parsed.items && parsed.items.length > 0) {
            orderDetailsCache.set(idKey, parsed);
            if (typeof callback === "function") callback(parsed);
            return;
          }
          fetchEditPageFallback();
        })
        .catch(() => {
          fetchEditPageFallback();
        });
      return;
    }

    fetchEditPageFallback();

    function fetchEditPageFallback() {
      let targetUrl = orderUrl || "";
      if (!targetUrl && idKey) {
        const isWcOrders = typeof window !== "undefined" && window.location && typeof window.location.href === "string" && window.location.href.includes("page=wc-orders");
        targetUrl = isWcOrders
          ? `/wp-admin/admin.php?page=wc-orders&action=edit&id=${idKey}`
          : `/wp-admin/post.php?post=${idKey}&action=edit`;
      }
      if (targetUrl && !targetUrl.startsWith("http") && typeof window !== "undefined" && window.location) {
        targetUrl = window.location.origin + targetUrl;
      }

      fetch(targetUrl, { credentials: "same-origin" })
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        })
        .then(html => {
          let parsed = parseOrderEditPageHTML(html, idKey);
          // If no items found and we attempted HPOS url, try classic post.php url as fallback
          if ((!parsed || !parsed.items || parsed.items.length === 0) && idKey && targetUrl.includes("page=wc-orders")) {
            const classicUrl = `${(typeof window !== "undefined" && window.location ? window.location.origin : "")}/wp-admin/post.php?post=${idKey}&action=edit`;
            fetch(classicUrl, { credentials: "same-origin" })
              .then(cRes => cRes.ok ? cRes.text() : "")
              .then(cHtml => {
                if (cHtml) {
                  const cParsed = parseOrderEditPageHTML(cHtml, idKey);
                  if (cParsed && cParsed.items && cParsed.items.length > 0) {
                    parsed = cParsed;
                  }
                }
                if (parsed && idKey && parsed.items && parsed.items.length > 0) {
                  orderDetailsCache.set(idKey, parsed);
                }
                if (typeof callback === "function") callback(parsed);
              })
              .catch(() => {
                if (typeof callback === "function") callback(parsed);
              });
            return;
          }

          if (parsed && idKey && parsed.items && parsed.items.length > 0) {
            orderDetailsCache.set(idKey, parsed);
          }
          if (typeof callback === "function") callback(parsed);
        })
        .catch(err => {
          if (typeof callback === "function") callback(null, err);
        });
    }
  }

  function isInvalidCustomerName(name) {
    if (!name || typeof name !== "string") return true;
    const trimmed = name.trim().toLowerCase();
    return !trimmed ||
           trimmed === "email" ||
           trimmed === "guest" ||
           trimmed === "customer" ||
           trimmed === "n/a" ||
           trimmed === "user" ||
           trimmed === "billing" ||
           trimmed === "shipping" ||
           trimmed === "billing details" ||
           trimmed === "shipping details" ||
           trimmed === "phone" ||
           trimmed.includes("@") ||
           /^(?:email|guest|customer|বিলিং|নাম|গ্রাহক|শিপিং)$/i.test(trimmed);
  }

  function parseWooCommerceAddressBlock(source) {
    if (!source) return { name: "", phone: "", address: "", paymentMethod: "" };

    let rawText = "";
    if (typeof source === "string") {
      rawText = source;
    } else if (source.innerText) {
      rawText = source.innerText;
    } else if (source.textContent) {
      rawText = source.textContent;
    }

    let phone = normalizeBDPhone(rawText) || "";
    let name = "";
    let paymentMethod = "";
    const cleanTokens = [];
    let addressStarted = false;

    const rawLines = rawText.includes("\n")
      ? rawText.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean)
      : rawText.split(",").map(l => l.trim()).filter(Boolean);

    for (let i = 0; i < rawLines.length; i++) {
      let line = rawLines[i].trim();
      if (!line) continue;

      if (/^(?:Billing details|Billing|Shipping details|Shipping|বিলিং ডিটেইলস|বিলিং|শিপিং details|শিপিং)[:\s-]*$/i.test(line)) {
        continue;
      }
      if (/^(?:Phone|Tel|Telephone|Mobile|ফোন|মোবাইল)[:\s-]*$/i.test(line)) {
        continue;
      }
      if (/^(?:Email|E-mail|ইমেইল)[:\s-]*$/i.test(line) || /@/.test(line)) {
        continue;
      }
      if (/^(?:Payment via|Payment method|পেমেন্ট মাধ্যম|পেমেন্ট)[:\s-]*$/i.test(line)) {
        continue;
      }
      if (/^(?:Cash on delivery|COD|bKash|Nagad|Rocket|পেমেন্ট|ক্যাশ অন ডেলিভারি)$/i.test(line) ||
          /^Payment via/i.test(line)) {
        paymentMethod = line;
        continue;
      }

      if (normalizeBDPhone(line) && line.replace(/[^\d+]/g, "").length >= 10) {
        if (!phone) phone = normalizeBDPhone(line);
        continue;
      }

      line = line.replace(/^(?:Billing details|Shipping details|Payment via|Phone|Email)[:\s,]*/gi, "").trim();
      line = line.replace(/[,:\s]+(?:Payment via|Cash on delivery|Phone|Email).*$/gi, "").trim();
      if (!line) continue;

      const isAddressKeyword = /^(?:Road|House|Block|Sector|Village|Holding|Flat|Apt|Post|PO|Thana|District|Dist|বাসস্ট্যান্ড|স্টেশন|পোস্ট|পোঃ|সদর|থানা|উপজেলা|জেলা|গ্রাম|রোড|বাসা|বাড়ি)/i.test(line);
      const isDistrictOrZone = /^(?:Dhaka|Chattogram|Chittagong|Sylhet|Khulna|Rajshahi|Barishal|Rangpur|Mymensingh|Gazipur|Narayanganj|Bagerhat|Cumilla|Comilla|Bogura|Bogra|Uttara|Mirpur|Banani|Gulshan|Dhanmondi|Mohammadpur)/i.test(line);
      const hasNumberDigits = /\d{3,}/.test(line) || /^\d+$/.test(line);

      if (isAddressKeyword || isDistrictOrZone || hasNumberDigits) {
        addressStarted = true;
      }

      // Name can only be captured before any address lines start, and must not be invalid
      if (!name && !addressStarted && !isInvalidCustomerName(line)) {
        name = line;
        continue;
      }

      addressStarted = true;
      cleanTokens.push(line);
    }

    return {
      name: name,
      phone: phone,
      address: cleanTokens.join(", "),
      paymentMethod: paymentMethod
    };
  }

  /**
   * Extract order details from a table row element
   */
  function extractRowOrderDetails(row) {
    if (!row) return {};

    const text = row.innerText || "";
    const cleanAsciiText = bengaliToAsciiDigits(text);
    let phone = normalizeBDPhone(text) || "";

    // 1. Extract Order ID & Order URL
    let orderId = "";
    let orderUrl = "";
    const orderLink = row.querySelector(".order_number a, .column-order_number a, a.order-view, .order_title a, a[href*='action=edit'], a[href*='post=']");
    if (orderLink) {
      if (orderLink.href) orderUrl = orderLink.href;
      const linkText = bengaliToAsciiDigits(orderLink.textContent || orderLink.innerText || "").trim();
      const idMatch = linkText.match(/#?((?:D|EX)\s*-\s*\d{3,8}(?:\s*[a-zA-Z0-9_-]+)?)/i) || linkText.match(/#?(\d{3,8})/);
      if (idMatch) orderId = idMatch[1].trim();
    }
    if (!orderId) {
      const idMatch = cleanAsciiText.match(/#?((?:D|EX)\s*-\s*\d{3,8}(?:\s*[a-zA-Z0-9_-]+)?)/i) || cleanAsciiText.match(/#(\d{3,8})/);
      if (idMatch) orderId = idMatch[1].trim();
    }
    if (!orderUrl && orderId) {
      const isWcOrders = typeof window !== "undefined" && window.location && typeof window.location.href === "string" && window.location.href.includes("page=wc-orders");
      orderUrl = isWcOrders
        ? `/wp-admin/admin.php?page=wc-orders&action=edit&id=${orderId}`
        : `/wp-admin/post.php?post=${orderId}&action=edit`;
    }

    // 2. Parse Address Cell (Billing or Shipping)
    let address = "";
    let customerName = "";
    const addressEl = row.querySelector(".billing_address, .column-billing_address, .shipping_address, .column-shipping_address, [data-colname='Billing'], [data-colname='Shipping'], [data-colname='Address']");
    if (addressEl) {
      const parsedBlock = parseWooCommerceAddressBlock(addressEl);
      if (parsedBlock.name && !isInvalidCustomerName(parsedBlock.name)) customerName = parsedBlock.name;
      if (parsedBlock.address) address = parsedBlock.address;
      if (parsedBlock.phone && !phone) phone = parsedBlock.phone;
    }

    // 3. Customer Name from customer_user column or order title (has highest priority when valid)
    const customerEl = row.querySelector(".customer_user, .column-customer_user, .customer-preview");
    if (customerEl) {
      const nameLink = typeof customerEl.querySelector === "function" ? customerEl.querySelector("a:not([href^='mailto:']), strong, span") : null;
      const cText = (nameLink ? (nameLink.textContent || nameLink.innerText || "") : (customerEl.textContent || customerEl.innerText || "")).trim();
      if (!isInvalidCustomerName(cText)) {
        customerName = cText;
      }
    }

    if (isInvalidCustomerName(customerName)) {
      const orderCol = row.querySelector(".order_number, .column-order_number, .order_title, .column-order_title");
      if (orderCol) {
        const fullOrderText = (orderCol.textContent || orderCol.innerText || "").trim();
        const byMatch = fullOrderText.match(/(?:by|থেকে|গ্রাহক)\s+([^\n\r,]+)/i);
        if (byMatch && !isInvalidCustomerName(byMatch[1])) {
          customerName = byMatch[1].trim();
        } else {
          const afterNum = fullOrderText.replace(/#\d+[\s-]*/, "").trim();
          if (afterNum && !isInvalidCustomerName(afterNum) && !/\d{3,}/.test(afterNum)) {
            customerName = afterNum.split("\n")[0].trim();
          }
        }
      }
    }

    // Fallback search in raw text if address or name still missing
    if (!address) {
      const addrAttr = row.querySelector("[data-address], [title*='Address' i], .column-shipping_address");
      if (addrAttr) {
        const rawAddr = ((addrAttr.dataset && addrAttr.dataset.address) || (addrAttr.getAttribute && addrAttr.getAttribute("title")) || addrAttr.innerText || "").trim();
        const pb = parseWooCommerceAddressBlock(rawAddr);
        address = pb.address || rawAddr;
        if (!customerName && pb.name) customerName = pb.name;
      }
    }

    if (isInvalidCustomerName(customerName)) {
      customerName = "";
    }

    // 4. Extract COD / Total Amount (with Bengali numeral [০-৯] support)
    let cod = "";
    const totalEl = row.querySelector(
      ".order_total, .column-order_total, td.total, td.column-total, [data-colname='Total'], [data-colname*='Total' i], [data-colname='Order Total'], [data-colname='মোট'], [data-colname*='মোট'], [data-colname*='সর্বমোট'], .wc-order-total, td.column-net_total"
    );
    if (totalEl) {
      const priceEl = (typeof totalEl.querySelector === "function" ? totalEl.querySelector(".amount, .woocommerce-Price-amount, bdi") : null) || totalEl;
      const asciiPrice = bengaliToAsciiDigits(priceEl.textContent || priceEl.innerText || "");
      const numMatch = asciiPrice.replace(/,/g, "").match(/[\d.]+/);
      if (numMatch) {
        const val = parseFloat(numMatch[0]);
        if (!isNaN(val) && val > 0 && Math.round(val).toString() !== orderId) {
          cod = Math.round(val).toString();
        }
      }
    }
    if (!cod && typeof row.querySelectorAll === "function") {
      const allAmts = row.querySelectorAll(".amount, .woocommerce-Price-amount, bdi");
      for (let i = allAmts.length - 1; i >= 0; i--) {
        const asciiAmt = bengaliToAsciiDigits(allAmts[i].textContent || allAmts[i].innerText || "");
        const numMatch = asciiAmt.replace(/,/g, "").match(/[\d.]+/);
        if (numMatch) {
          const val = parseFloat(numMatch[0]);
          if (!isNaN(val) && val > 0 && Math.round(val).toString() !== orderId) {
            cod = Math.round(val).toString();
            break;
          }
        }
      }
    }
    if (!cod) {
      const rowTxt = cleanAsciiText;
      const curMatches = rowTxt.match(/(?:Total|মোট|সর্বমোট|৳|BDT|Tk\.?|টাকা)[\s:]*([0-9,]+(?:\.[0-9]+)?)/gi) ||
                         rowTxt.match(/([0-9,]+(?:\.[0-9]+)?)\s*(?:৳|Tk\.?|টাকা)/gi);
      if (curMatches) {
        for (let m of curMatches) {
          const cleanM = m.replace(/[^\d.]/g, "");
          const val = parseFloat(cleanM);
          if (!isNaN(val) && val > 0 && Math.round(val).toString() !== orderId) {
            cod = Math.round(val).toString();
            break;
          }
        }
      }
    }

    // 5. Parse BD Address details if parser is available
    let parsed = { district: "", zone: "", area: "", postcode: "", streetAddress: address };
    let parseBD = typeof parseBDAddress === "function" ? parseBDAddress : null;
    if (!parseBD && typeof require !== "undefined") {
      try {
        parseBD = require("./parser.js").parseBDAddress;
      } catch (e) {}
    }
    if (address && parseBD) {
      parsed = parseBD(address);
    }

    // 6. Extract Items from row if items column or list exists
    const items = [];
    const itemsCol = row.querySelector(".order_items, .column-order_items, [data-colname='Items'], [data-colname='পণ্য'], .items");
    if (itemsCol) {
      const itemNodes = itemsCol.querySelectorAll(".order-item, li, tr, .wc-order-item");
      if (itemNodes.length > 0) {
        itemNodes.forEach(inEl => {
          let iName = typeof extractItemNameWithSize === "function" ? extractItemNameWithSize(inEl, inEl) : (inEl.textContent || inEl.innerText || "").split("\n")[0].trim();
          if (iName) {
            let iQty = 1;
            const asciiItemText = bengaliToAsciiDigits(inEl.textContent || "");
            const qm = asciiItemText.match(/(?:x|×|\*)\s*(\d+)/i) || asciiItemText.match(/(\d+)\s*(?:pcs|পিস|টি)/i);
            if (qm) iQty = parseInt(qm[1], 10);
            items.push({ name: iName, qty: iQty, total: "" });
          }
        });
      } else {
        const fullItemText = (itemsCol.textContent || itemsCol.innerText || "").trim();
        if (fullItemText) {
          const lines = fullItemText.split(/[\n,;]+/).map(l => l.trim()).filter(Boolean);
          lines.forEach(l => {
            if (/^\d+\s*items?$/i.test(l)) return;
            items.push({ name: l, qty: 1, total: "" });
          });
        }
      }
    }

    return {
      phone: phone || "",
      name: customerName,
      orderId: orderId,
      orderUrl: orderUrl,
      cod: cod,
      address: address,
      items: items,
      district: parsed.district || "",
      zone: parsed.zone || "",
      area: parsed.area || "",
      postcode: parsed.postcode || "",
      streetAddress: parsed.streetAddress || address
    };
  }

  /**
   * Sync customer information to Pathao (only executed when user explicitly triggers)
   */
  function syncToPathao(payload, options = {}) {
    if (!isExtensionValid()) return;
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
   * Syncs the copied phone number to Pathao so customer delivery ratio / fraud check is detected
   */
  function initCopyListener() {
    document.addEventListener("copy", () => {
      if (!isExtensionValid()) return;

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
          orderId: rowDetails.orderId || "",
          source: "woocommerce_copy",
          userTriggered: true,
          timestamp: Date.now()
        };

        // Automatically sync to Pathao so customer delivery ratio check is triggered!
        syncToPathao(payload, { autoSwitch: false, userTriggered: true });

        showWCToast(
          `⚡ Phone <strong>${phone}</strong> ready in Pathao for customer ratio check!`,
          "👉 Open Pathao",
          () => {
            if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
              chrome.runtime.sendMessage({ action: "focus_or_open_pathao" }).catch(() => {});
            }
          }
        );
      }, 50);
    });
  }

  /**
   * --------------------------------------------------------------------------
   * WhatsApp Quick Reply & Advance COD Integration for WooCommerce
   * --------------------------------------------------------------------------
   */
  const DEFAULT_QUICK_REPLY_CONFIG = {
    storeName: "DEEN Commerce",
    bkashNumber: "01XXXXXXXXX",
    bkashType: "Personal",
    nagadNumber: "",
    nagadType: "Personal",
    insideDhakaFee: 70,
    outsideDhakaFee: 130,
    customNote: ""
  };

  const DEEN_LOGO_BASE64 = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCADIAMgDASIAAhEBAxEB/8QAHQABAAMAAwEBAQAAAAAAAAAAAAEHCAUGCQIEA//EAD4QAAEDAwIDBQQIAwgDAAAAAAABAgMEBREGIQcxQQgSUWFxExQisxUjNmJydYGhM3SRJEJDUmOCscGSsuH/xAAaAQEAAwEBAQAAAAAAAAAAAAAABgcIBQMC/8QAOxEAAgAFAAcFBgQEBwAAAAAAAAECAwQFEQYHITFBUWESE3GBkTVScqGxwSIyQtEUI+HwFSQzNGLC0v/aAAwDAQACEQMRAD8A5sAGLzcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARO9lG74543wRzVW9U5p4H33cSWcHx3kLeMkgA+D7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAI5+hozgv2ZG3alg1PxEhljglRJaa1oqsc9q7o6ZU3TP+RML4r0Okdm3QEOtuIEdTcKdJbbY2JWTtVMtklziJi+Wcux93zNwNTuphE5FvavdEJFfLdzroe1DnEML3PG9vnySKX1kaaVFvm/4Vb4uzFjMUS3rO5Lk8bW+pxlo0zp6wUraOzWWiooWIjWsghaxP2Q4rUnC7QOr2OTUOl6Cpc7/E9kjJU9Htw5P6naUT0J9ELnjoaaZL7mOWnDyaWPQo+XW1MuZ30ExqLmm8+u8zTrXsfUUjZKvQd+fTv5pR1/xxr5JKid5P1RxQGsOHmsdCVK02qLDPRtzhk+O/DJ+GRNl9OfkeiiZz/9Py11uobnSyUdxo4KmGVvdfHLGj2vTwVF2Ugt41cWy4Jx0v8AKj6bYfT9miwLHrOu1tal1n86Drsi9ePmn4nmnv0G3U1txD7Junrwktx0JVJZ6tfi90ky+levl/ej/TKfdM0aw0HqzQtf9H6ps89G5XYjlX4opvNj02X05+KFPXzRG52F5nwZg95bV/TzLrsGmVq0hXZp4+zH7sWyL+vlk4EAEVJaAAAAAAAAAAAAAAAAAAAAAAAAat7Gtvji0vf7p3U79TcGQKvXDImqn7yKaJRMLjyKE7Ha44f3Tzu8nyoi+06mp9DIFBYqdL3fq2ZH01jim3+qb976YQTbK4HTlghUxsi4Q4q/6osGlqP6R1Bd6Wgp0XHfqJmsRV8EzzXyQkkybBJhccx4S4sjMuXHNiUEtZb4I5XOEJRdjqNi4rcO9TVHuVj1ja6moVcJE2oaj3L5NXCr+h21FRW5RyY8T4kVUmpXakxqJc00/oek+mn0sXYnwOF8mmn8z6OMvVhtOoaCW2Xq3U9ZSzJ3Xwzxo9j09F6+ZySKmCfPY9JkuCbC4I1lM8oI4pcSjgeGjLnE3smvjSa7cNqrvJu5bXUv/aOVf+H/APkZzuVruVmrpbZdrfPR1cC4khmYrHt9UX/k9LXJ3vA6jrzhfpHiLQe5altjXyRtVIaqP4J4vwv/AOlyi9UKy0j1b0ldmfbX3cfu/pf7fToWpozrPrLdinuic2X736l/689vU890zjfZQm+/7lq8Uuzzq/h86W40DH3myN396hj+shT/AFGJy/EmU8cFVKnToUpcrXV2mc5FXA4Ylz+z3NeBe1ru9HeJCqKKNRQvlw6Nb0/EkAHLOqAAAAAAAAAAAAAAAAAAa77Hf2Bun5vJ8qIvtOhQnY7+wN0/N5PlRF9p0NVaG+wqb4TIumXt6q+NkOXu5VU5JkwHxq1zW644gXSrnmetJQ1ElHRRd7LY443KxVROiuVFcvqidEN8zKqxSY/y/wDR5u6j21Bdf56p+a4hutWqnSqOTJgeIYm89cYx9SbaoaSTOrp9RGsxQpJdMt5+hx/NO8u6NLT4ddo3XWhUjoq2db5aWYT3arkX2jG+DJd1T0dlPQqrC5yq7eBPoU5brrWWmap1JMcMXT7rc/Mu+52ehu8nuK2Wo4evDwe9PqjenDvjfobiM1sFruXutyVuXUFUqMmTx7qZw9PNqr+hYWUcmc8zzLbI+N7ZYnq17FRzHNXCovii9C5uGfad1fpJ8Nt1VJJfbU1UarpF/tUTfFr1/iejt/NC3tH9Z0qfiTdYey/eW7zW9eWSldItVU6nTqLRF24fce/ye5+ePFmzspv4oEVV8MdFOI0zqOz6ts1NqCxVjaqjqm96ORP6Kip0VFRUVF3RUU5duycsFsS5kE6BTJbyntTXFFQTJccqNy41hrY096ZCta5vdciY6mfONnZuoL1BUao0DSR0t0b3pJqFiI2Kq8VanJj/ANl64Xc0KqY38CFRMbJzOdd7PSXundNVw5XB8U+afBnTs16rLFUqpo4sPiuDXJriv7W08y5IpYJXwzRvjkjcrHsemHNVFwqKnRUPleaJ4l8drDQFLp/UtJrC3QsjgvneZUsamE94ame9/ubz82qvUodE3Uy/fbTMstfMopjy4Xv5p7U/Q1ho9eJd9t8uulrHaW1cmtjXkyQAcU7YAAAAAAAAAAAAAABrvsd/YG6fm8nyoi+06FCdjv7A3T83k+VEX2nQ1Vob7CpvhMi6Ze3qr42RN/Cf+FTzZ1H9obr/AD1T81x6TTfwX/hU82dR/aG6/wA9U/NcQXWz/o03jF9iwNT3+4qvCH/sfgIJIKPL6GFUZ6cz7p6eepmjpqWKSaaVyNYyNiuc9fBETdVLz4ZdljUuoJYbprlX2e3Lh/uqL/apk8F6RJ65d5JzO1abHXXub3VHLcXN8F4vccO8aQW+wye9rZih5Li/Bb2WD2PoLtHoq6y1KSJQy3FVpEdyVUY1JFb5Z29Ud5l/7J1Pw2azW7T9sp7NZ6SKlo6ViRwwxphrGp0P3Z6KmTUFjt0Vqt8qjii7TgWM/wB8ORlC+3KG73GdWww9lRvOOn78+p9gjKHy97Y2K9zkRrUOq3hZZylt3Gfe2NVwN0ZZKN+PbTXTvs/C2J/e/wDZpkvfHmWj2huJUXEPWqsts6SWqzNdS0jmr8MrlX6yRPJVRETyai9Src5cZh03uUq53mbNkPMKxCnzwsN+ucGqtALVNtVjlS56xFFmJrll5S9MZ6n0ACHE2AAAAAAAAAAAAAAANd9jv7A3T83k+VEX34FCdjv7A3T83k+VEX34GqtDfYVN8JkXTL29VfGz5cneaqeKKhgHjNom46H4g3WgqoXNpKyokrKKVeUkMjldsvVWqqtX080N/ocNqLSenNW0X0fqSz0lxgR2UZURI9Gr4pnkvmh46W6Mw6S0sMlRdmOF5T4dU/E99D9KItFqyKe4e1BGsNcejXVfc840TKo1Oa7IniW1w27NeuNbLFX3eJ1htb8P9tUx/XyJ9yLZU9XY/U1dYeFPDvS9QlZY9H2ymqEXKTNp0V7V8nLlU/Q7b8KbImyEPs2q2RTx95cpnb/4w5S83v8ATBNb3rZqKiDurXL7vP6osN+S3euTo3D/AIO6H4dQtWxWxslYre7JW1GHzv8AH4sfCnk3CHedsYwF3Gy8y0qSjkUMpSaaBQwrglgqSqrJ9dNc6pjcUT4t5ZONiFTHTmHZRMqVTxK7RGiOH/tbfTz/AExeGbLR0z0xEv8AqP5N9N3eR5V1ypbZKc+rjUMK5/bm+iPa322ruk5U9HLccT4L78Eur2FnVVXS0VPJVVlRHDDG1XPkkcjWtROaqq7Ihljjz2jGX6nqNGaBqXe4PRYq24synt05LHF91eruvJNt1q3iDxe1txGmc2/XJYqBHZioKZVZA3wynORfN2fLB0rO+OpS2lOsWOvgipLYnDA9jie9rpyXzLz0R1ZQW6OGturUca2qFflT5vm/kupIAKnyXAlgAAAAAAAAAAAAAAAAEKAax7HFxhk0nfbU1fraa4pO5M/3XxtRF/qxxoVM88GG+zhr2PRHECGC4TpHb701KGocrsNY/OYnr/u+HPRHqbiYqOTvovM0tq9uMFdZYJaf4peYX65XyMtaxrZMt99mTGvwzMRJ+WH816NH9SCQTogh8NXbfcIq55EdUU4fUmrNOaPt0l01HeKehp2c3yuxlfBqc3L5JlTymTZcmFxzXhLe3sR9SpUydEpcpNt7ktrZzHqdP19xY0Xw5pfbahuzEnemYqSL455fws8PNcJ5lA8Su1ldrn7W1cO6Z1vp1y1bhO1Fmen3GLsz1XK+SGf62trblVy3C4Vc1VVTu70s8sive9fFVXdSr9IdZdNSZkWxduP3n+VeHF/QtfRrVbV1uKi6vu4PdX5n48Ifm+iLV4k9pLWut1moLPI+xWlyq32VO/6+VPvyJyRfBuE8VUqPPkRv15Ep5cimbndqy7Te+rJjii68PBbl5F42qzUNmk9zRS1Cum9+L3t+JJBIOUdYAAAAAAAAAAAAAAAAAAAAAjOF3NL8Fe0zRUdDBpXiLUujWBqRU91VFcjmpsjZsboqcu/yXrhd1zRvzI5ddjv2K/1mj9R39K9+9Pc11I7pBo3RaSU3cVa2rc1vT6ftuPSW1alsV7p21NovFFVxOTKSQzte3+qKfkvmutI6ZidNftSW6ia1N/a1DWr+iZyv6IeczVVufZp3c88bEJnPexv453LEi1tTe7xDTLtc+1s9MfcrSDU7LUeYqp9nl2Vn17X2NV8RO1taKKOS3cO6N1wqFy336pY5kDPNrVw56+uE9TNmp9Waj1hcnXbUt2qK+pXdHSr8LE8GNTZqeSIhxHNCNl2yQK96U3K/Rf5mP8PurZCvLj55LEsOiFr0ehX8LBmPjE9sT8+HgsEkgEZJSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACCQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf/Z";

  let deenLogoImg = null;
  if (typeof Image !== "undefined") {
    try {
      deenLogoImg = new Image();
      deenLogoImg.src = DEEN_LOGO_BASE64;
    } catch (e) {}
  }

  /**
   * Extract item name combined with size / variation attributes
   */
  function extractItemNameWithSize(nameEl, context) {
    if (typeof require !== "undefined") {
      try {
        const pExtract = require("./parser.js").extractItemNameWithSize;
        if (typeof pExtract === "function") return pExtract(nameEl, context);
      } catch (e) {}
    }

    if (!nameEl) return "";
    if (typeof nameEl === "string") {
      let str = cleanHtmlEntities(nameEl.trim());
      if (!str) return "";
      let extraSize = "";
      if (context && typeof context === "object") {
        extraSize = (context.size || context.variation || context.attribute || context.variant || "").toString().trim();
      }
      if (str.includes("\n")) {
        const lines = str.split("\n").map(l => cleanHtmlEntities(l.trim())).filter(Boolean);
        let title = lines[0].replace(/^[-•*]\s*/, "").trim();
        title = title.replace(/\s*(?:&times;|×|x|\*)\s*\d+$/i, "").trim();
        const vars = [];
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          if (/^(?:SKU|ID|Price|Qty|৳|BDT|Cost):?/i.test(line)) continue;
          if (/^(?:Add meta|Add item|button)$/i.test(line)) continue;
          const varM = line.match(/^(?:Size|সাইজ|Color|কালার|রঙ|Fit|Variation|ভেরিয়েশন)[:\s]+(\S.*)$/i);
          if (varM) {
            const val = varM[1].trim();
            if (val && !/^(?:Size|সাইজ|Color|কালার|রঙ|Fit|Variation|ভেরিয়েশন)[:\s-]*$/i.test(val)) {
              vars.push(line);
            }
          } else if (/^(?:XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|[2-5][0-9])$/i.test(line)) {
            vars.push(`Size: ${line.toUpperCase()}`);
          } else if (line.length < 30 && !/^\d+$/.test(line) && !/^(?:Refund|Shipping|Tax)/i.test(line)) {
            vars.push(line);
          }
        }
        if (extraSize && !vars.some(v => v.toLowerCase().includes(extraSize.toLowerCase()))) {
          const cleanExtra = extraSize.replace(/^size[:\s]*/i, "").trim();
          if (cleanExtra && !title.toLowerCase().includes(cleanExtra.toLowerCase())) {
            vars.push(extraSize.startsWith("Size:") ? extraSize : `Size: ${extraSize}`);
          }
        }
        const cleanVars = vars.filter(v => {
          const trimmed = v.trim();
          const valOnly = trimmed.replace(/^[^:]+:\s*/, "").trim();
          if (!valOnly || /^(?:Size|সাইজ|Color|কালার|রঙ|Fit|Variation|ভেরিয়েশন)[:\s-]*$/i.test(trimmed)) return false;
          if (title.toLowerCase().includes(trimmed.toLowerCase())) return false;
          if (title.toLowerCase().includes(valOnly.toLowerCase())) return false;
          return true;
        });
        if (cleanVars.length > 0) {
          title = `${title} (${cleanVars.join(", ")})`;
        }
        title = title.replace(/\s*\((?:Size|সাইজ|Color|কালার|রঙ|Fit|Variation|ভেরিয়েশন)[:\s]*\)/gi, "").trim();
        return title;
      }
      str = str.replace(/\s*(?:&times;|×|x|\*)\s*\d+$/i, "").trim();
      str = str.replace(/^[-•*]\s*/, "").trim();
      if (extraSize) {
        const cleanSize = extraSize.replace(/^size[:\s]*/i, "").trim();
        if (!str.toLowerCase().includes(cleanSize.toLowerCase())) {
          return `${str} (Size: ${cleanSize})`;
        }
      }
      return str;
    }

    const el = nameEl;
    const ctx = (context && typeof context.querySelectorAll === "function") ? context : el;

    let title = "";
    if (typeof el.querySelector === "function") {
      const titleNode = el.querySelector(".wc-order-item-name, a.wc-order-item-name, a, strong, .product-name");
      if (titleNode) {
        title = (titleNode.textContent || titleNode.innerText || "").trim();
      }
    }
    if (!title) {
      const raw = (el.innerText || el.textContent || "").trim();
      title = raw.split("\n")[0].trim();
    }
    title = cleanHtmlEntities(title);
    title = title.replace(/\s*(?:&times;|×|x|\*)\s*\d+$/i, "").trim();
    title = title.replace(/^[-•*]\s*/, "").trim();
    if (!title) return "";

    const vars = [];

    if (typeof ctx.querySelectorAll === "function") {
      const metas = ctx.querySelectorAll(".wc-order-item-meta li, .item-meta li");
      metas.forEach(li => {
        const lblEl = li.querySelector ? li.querySelector(".wc-item-meta-label, strong") : null;
        const lbl = lblEl ? (lblEl.textContent || lblEl.innerText || "").replace(/:$/, "").trim() : "";
        let val = (li.textContent || li.innerText || "").trim();
        if (lbl && val.includes(lbl)) {
          val = val.replace(lbl, "").replace(/^[:\s-]+/, "").trim();
        }
        if (/^(?:SKU|ID|Cost|Vendor|দাম|আইডি)/i.test(lbl)) return;
        if (val && !/^(?:SKU|ID):/i.test(val)) {
          if (lbl) {
            vars.push(`${lbl}: ${val}`);
          } else {
            vars.push(val);
          }
        }
      });

      const dls = ctx.querySelectorAll("dl.variation");
      dls.forEach(dl => {
        const dts = dl.querySelectorAll ? dl.querySelectorAll("dt") : [];
        const dds = dl.querySelectorAll ? dl.querySelectorAll("dd") : [];
        for (let i = 0; i < Math.min(dts.length, dds.length); i++) {
          const dt = (dts[i].textContent || "").replace(/:$/, "").trim();
          const dd = (dds[i].textContent || "").trim();
          if (/^(?:SKU|ID|Cost)/i.test(dt)) continue;
          if (dd) {
            vars.push(`${dt}: ${dd}`);
          }
        }
      });

      const varNodes = ctx.querySelectorAll(".wc-order-item-variation, .variation, .order-item-variation");
      varNodes.forEach(vn => {
        const vt = (vn.textContent || vn.innerText || "").trim();
        if (vt && !/^(?:SKU|ID):/i.test(vt) && !vars.some(v => v.includes(vt))) {
          vars.push(vt.replace(/^[:\s-]+/, "").trim());
        }
      });

      const metaRows = ctx.querySelectorAll("table.wc-order-item-meta tr, table.display_meta tr");
      metaRows.forEach(tr => {
        const th = tr.querySelector("th");
        const td = tr.querySelector("td");
        if (th && td) {
          const k = (th.textContent || "").replace(/:$/, "").trim();
          const v = (td.textContent || "").trim();
          if (k && v && !/^(?:SKU|ID|Cost)/i.test(k) && v.toLowerCase() !== k.toLowerCase()) {
            vars.push(`${k}: ${v}`);
          }
        }
      });
    }

    const fullText = (el.innerText || el.textContent || "").trim();
    if (fullText.includes("\n")) {
      const lines = fullText.split("\n").map(l => cleanHtmlEntities(l.trim())).filter(Boolean);
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (/^(?:SKU|ID|Price|Qty|৳|BDT|Cost):?/i.test(line)) continue;
        if (/^(?:Add meta|Add item|button)$/i.test(line)) continue;
        const varM = line.match(/^(?:Size|সাইজ|Color|কালার|রঙ|Fit|Variation|ভেরিয়েশন)[:\s]+(\S.*)$/i);
        if (varM) {
          const val = varM[1].trim();
          if (val && !/^(?:Size|সাইজ|Color|কালার|রঙ|Fit|Variation|ভেরিয়েশন)[:\s-]*$/i.test(val)) {
            if (!vars.some(v => v.toLowerCase() === line.toLowerCase())) {
              vars.push(line);
            }
          }
        } else if (/^(?:XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|[2-5][0-9])$/i.test(line)) {
          const sizeStr = `Size: ${line.toUpperCase()}`;
          if (!vars.some(v => v.toLowerCase().includes(line.toLowerCase()))) {
            vars.push(sizeStr);
          }
        }
      }
    }

    const cleanVars = vars.filter((v, idx, arr) => {
      if (!v) return false;
      const trimmed = v.trim();
      const valOnly = trimmed.replace(/^[^:]+:\s*/, "").trim();
      if (!valOnly || /^(?:Size|সাইজ|Color|কালার|রঙ|Fit|Variation|ভেরিয়েশন)[:\s-]*$/i.test(trimmed)) {
        return false;
      }
      const lowerV = trimmed.toLowerCase();
      if (title.toLowerCase().includes(lowerV)) return false;
      if (title.toLowerCase().includes(valOnly.toLowerCase())) return false;
      return arr.findIndex(x => x.toLowerCase() === lowerV) === idx;
    });

    let result = title;
    if (cleanVars.length > 0) {
      const combined = cleanVars.join(", ");
      if (combined.startsWith("(") && combined.endsWith(")")) {
        result = `${title} ${combined}`;
      } else {
        result = `${title} (${combined})`;
      }
    }
    result = result.replace(/\s*\((?:Size|সাইজ|Color|কালার|রঙ|Fit|Variation|ভেরিয়েশন)[:\s]*\)/gi, "").trim();
    return result;
  }

  function normalizeCustomerAndOrderData(rawDetails) {
    if (typeof require !== "undefined") {
      try {
        const pNorm = require("./parser.js").normalizeCustomerAndOrderData;
        if (typeof pNorm === "function") return pNorm(rawDetails);
      } catch (e) {}
    }
    const d = Object.assign({}, rawDetails || {});
    
    // Check if address has labels like "Billing details" or if name is invalid
    let rawAddr = (d.address || "").trim();
    let parsedBlock = null;
    if (isInvalidCustomerName(d.name) || /Billing details|Payment via|Cash on delivery/i.test(rawAddr)) {
      parsedBlock = parseWooCommerceAddressBlock(rawAddr);
    }

    let cleanPhone = normalizeBDPhone(d.phone || "");
    if (!cleanPhone && parsedBlock && parsedBlock.phone) {
      cleanPhone = parsedBlock.phone;
    }

    let name = (d.name || "").trim().replace(/\s+/g, " ");
    if (isInvalidCustomerName(name) && parsedBlock && parsedBlock.name) {
      name = parsedBlock.name;
    }
    name = name.replace(/^(?:Customer|Name|বিলিং|গ্রাহক|নাম)[:\s-]*/i, "").trim();
    name = name.replace(/(?:\+?880|0)?1[3-9]\d{8}/g, "").replace(/\S+@\S+\.\S+/g, "").trim();

    let address = parsedBlock && parsedBlock.address ? parsedBlock.address : rawAddr;
    address = address.replace(/^(?:Billing details|Shipping details|Payment via|Phone|Email)[:\s,]*/gi, "")
                     .replace(/[,:\s]+(?:Payment via|Cash on delivery|Phone|Email).*$/gi, "")
                     .replace(/\s+/g, " ")
                     .replace(/^,\s*|,\s*$/g, "")
                     .trim();

    let district = (d.district || "").trim();
    let zone = (d.zone || "").trim();

    const items = [];
    let subtotalCalc = 0;
    if (Array.isArray(d.items) && d.items.length > 0) {
      d.items.forEach(it => {
        let rawName = extractItemNameWithSize(it.name || it.title || "", it);
        if (!rawName) return;
        rawName = rawName.replace(/\s*\((?:Size|সাইজ|Color|কালার|রঙ|Fit|Variation|ভেরিয়েশন)[:\s]*\)/gi, "").trim();
        if (isExcludedMetaOrButtonRow(null, rawName)) return;

        const qty = parseInt(it.qty || it.quantity, 10) || 1;
        let totalNum = 0;
        if (it.total !== undefined && it.total !== null && it.total !== "") {
          const numMatch = String(it.total).replace(/,/g, "").match(/[\d.]+/);
          if (numMatch) totalNum = Math.round(parseFloat(numMatch[0]));
        }

        let unitPrice = 0;
        if (it.unitPrice || it.price) {
          const upMatch = String(it.unitPrice || it.price).replace(/,/g, "").match(/[\d.]+/);
          if (upMatch) unitPrice = Math.round(parseFloat(upMatch[0]));
        }
        if (!unitPrice && totalNum > 0 && qty > 0) {
          unitPrice = Math.round(totalNum / qty);
        }
        if (!totalNum && unitPrice > 0 && qty > 0) {
          totalNum = unitPrice * qty;
        }

        subtotalCalc += totalNum;

        items.push({
          name: rawName,
          qty: qty,
          unitPrice: unitPrice > 0 ? unitPrice.toString() : "",
          total: totalNum > 0 ? totalNum.toString() : ""
        });
      });
    }

    let cod = "";
    if (d.cod !== undefined && d.cod !== null && d.cod !== "") {
      let cleanCod = bengaliToAsciiDigits(String(d.cod)).replace(/^[৳BDT\s:Tk\.?]+/i, "").trim();
      cleanCod = cleanCod.replace(/\.00$/, "");
      if (cleanCod !== "0") cod = cleanCod;
    }
    if (!cod && subtotalCalc > 0) {
      cod = subtotalCalc.toString();
    }
    if (!cod && d.cod !== undefined && d.cod !== null && d.cod !== "") {
      cod = String(d.cod).trim();
    }

    const isOutside = (district && !district.toLowerCase().includes("dhaka")) ||
                      (address && !address.toLowerCase().includes("dhaka"));

    // Auto-resolve single item price if total was missing but COD is known
    if (items.length === 1 && (!items[0].total || items[0].total === "0" || !items[0].unitPrice)) {
      const codNum = Number(cod);
      if (codNum > 0) {
        const estDelivery = isOutside ? (Number(DEFAULT_QUICK_REPLY_CONFIG.outsideDhakaFee) || 130) : (Number(DEFAULT_QUICK_REPLY_CONFIG.insideDhakaFee) || 70);
        const resolvedTotal = (codNum > estDelivery && estDelivery > 0) ? (codNum - estDelivery) : codNum;
        if (!items[0].total || items[0].total === "0") {
          items[0].total = resolvedTotal.toString();
        }
        if (!items[0].unitPrice || items[0].unitPrice === "0") {
          items[0].unitPrice = Math.round(resolvedTotal / (items[0].qty || 1)).toString();
        }
        if (subtotalCalc === 0) {
          subtotalCalc = resolvedTotal;
        }
      }
    }

    let finalSubtotal = subtotalCalc > 0 ? subtotalCalc.toString() : "";
    if (!finalSubtotal || finalSubtotal === "0") {
      if (items.length === 1 && items[0].total && Number(items[0].total) > 0) {
        finalSubtotal = items[0].total;
      } else if (cod && cod !== "0") {
        finalSubtotal = cod;
      } else {
        finalSubtotal = "0";
      }
    }
    const finalCod = cod && cod !== "0" ? cod : (finalSubtotal !== "0" ? finalSubtotal : "0");

    return Object.assign({}, d, {
      orderId: (d.orderId || "").toString().trim().replace(/^#/, ""),
      name: name || (d.name && !isInvalidCustomerName(d.name) ? d.name.trim() : "Customer"),
      phone: cleanPhone || d.phone || "",
      address: address,
      district: district,
      zone: zone,
      items: items,
      subtotal: finalSubtotal,
      cod: finalCod,
      isOutsideDhaka: isOutside
    });
  }

  function getQuickReplyConfig(callback) {
    const fallback = Object.assign({}, DEFAULT_QUICK_REPLY_CONFIG);
    if (typeof chrome !== "undefined" && chrome.storage) {
      const storageArea = chrome.storage.sync || chrome.storage.local;
      storageArea.get(["deen_quick_reply_config"], (result) => {
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.lastError) {
          void chrome.runtime.lastError.message;
        }
        const saved = result && result.deen_quick_reply_config;
        const merged = Object.assign({}, fallback, saved || {});
        // Auto-migrate legacy "DEEN Store" or empty name to "DEEN Commerce"
        if (!merged.storeName || merged.storeName === "DEEN Store") {
          merged.storeName = "DEEN Commerce";
        }
        if (typeof callback === "function") {
          callback(merged);
        }
      });
    } else {
      if (typeof callback === "function") callback(fallback);
    }
  }

  function injectWhatsAppMessage(text, options) {
    const opts = options || {};
    const phone = opts.phone || "";
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      try {
        navigator.clipboard.writeText(text).catch(() => {});
      } catch (e) {}
    }
    let buildLink = typeof buildWhatsAppDeepLink === "function" ? buildWhatsAppDeepLink : null;
    if (!buildLink && typeof require !== "undefined") {
      try { buildLink = require("./parser.js").buildWhatsAppDeepLink; } catch (e) {}
    }
    if (phone && buildLink) {
      const url = buildLink(phone, text);
      if (typeof window !== "undefined" && window.open) {
        window.open(url, "_blank");
      }
      showWCToast(`💬 WhatsApp Quick Reply copied & opened for <strong>${phone}</strong>!`);
      return { injected: false, copied: true, openedUrl: url };
    }
    showWCToast(`📋 WhatsApp Quick Reply copied to clipboard!`);
    return { injected: false, copied: true };
  }

  function escapeHTML(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * Extract comprehensive order details from WooCommerce Order Preview modal
   * Supports both classic WooCommerce and HPOS modal formats
   */
  function extractOrderDetailsFromModal(modal) {
    if (!modal) return {};

    const text = modal.innerText || "";
    let phone = "";

    // 1. Phone number: check tel link or parse with BD regex
    const telLink = modal.querySelector("a[href^='tel:']");
    if (telLink) {
      phone = normalizeBDPhone(telLink.getAttribute("href").replace("tel:", "")) || "";
    }
    if (!phone) {
      phone = normalizeBDPhone(text) || "";
    }

    // 2. Order ID & Order URL
    let orderId = "";
    let orderUrl = "";
    const headerEl = modal.querySelector(".wc-backbone-modal-header h1, .wc-order-preview__order-number, #wc-modal-dialog-description, h1");
    if (headerEl) {
      const asciiText = bengaliToAsciiDigits(headerEl.textContent || "");
      const idMatch = asciiText.match(/#?((?:D|EX)\s*-\s*\d{3,8}(?:\s*[a-zA-Z0-9_-]+)?)/i) || asciiText.match(/#(\d{3,8})/);
      if (idMatch) orderId = idMatch[1].trim();
    }
    if (!orderId) {
      const asciiText = bengaliToAsciiDigits(text);
      const idMatch = asciiText.match(/#?((?:D|EX)\s*-\s*\d{3,8}(?:\s*[a-zA-Z0-9_-]+)?)/i) || asciiText.match(/#(\d{3,8})/);
      if (idMatch) orderId = idMatch[1].trim();
    }

    const editLink = modal.querySelector("a[href*='action=edit'], a[href*='post=']");
    if (editLink && editLink.href) {
      orderUrl = editLink.href;
    } else if (orderId) {
      const isWcOrders = typeof window !== "undefined" && window.location && typeof window.location.href === "string" && window.location.href.includes("page=wc-orders");
      orderUrl = isWcOrders
        ? `/wp-admin/admin.php?page=wc-orders&action=edit&id=${orderId}`
        : `/wp-admin/post.php?post=${orderId}&action=edit`;
    }

    // 3. Address & Customer Name
    let address = "";
    let customerName = "";
    const addrEl = modal.querySelector(".wc-order-preview-address, .wc-order-preview__section--address, address, .order-preview-address");
    if (addrEl) {
      const parsedBlock = parseWooCommerceAddressBlock(addrEl);
      if (parsedBlock.name) customerName = parsedBlock.name;
      if (parsedBlock.address) address = parsedBlock.address;
      if (parsedBlock.phone && !phone) phone = parsedBlock.phone;
    }

    if (isInvalidCustomerName(customerName)) {
      const strongName = modal.querySelector(".wc-order-preview-customer strong, .wc-order-preview-address strong, .customer_user strong");
      if (strongName && !isInvalidCustomerName(strongName.innerText)) {
        customerName = strongName.innerText.trim();
      }
    }
    if (isInvalidCustomerName(customerName)) {
      const nameMatch = text.match(/(?:Customer|Name|বিলিং|গ্রাহক):\s*([^\n\r]+)/i);
      if (nameMatch && !isInvalidCustomerName(nameMatch[1])) {
        customerName = nameMatch[1].trim();
      } else {
        customerName = "";
      }
    }

    // 4. Items List (with Bengali numeral [০-৯] support and all WooCommerce modal variants)
    const items = [];
    const itemRows = modal.querySelectorAll(
      ".order-preview-line-items table tbody tr, .order-preview-line-items tr.order-preview-item, table.wc-order-preview-table tbody tr, table.wc-order-preview-table__items tbody tr, tr.wc-order-preview-table__item, tr.order-preview-item, tr[data-item_id], .wc-order-preview table tbody tr, .wc-modal-order-preview table tbody tr, table.woocommerce_order_items tbody tr, .wc-order-item"
    );

    const rowsToProcess = itemRows.length > 0
      ? Array.from(itemRows)
      : Array.from(modal.querySelectorAll(".order-preview-line-items tr, table tbody tr, .wc-order-preview tr")).filter(r => !r.querySelector("th") && (r.innerText || "").trim());

    rowsToProcess.forEach(row => {
      if (row.querySelector("th") && !row.querySelector("td")) return;
      if (isExcludedMetaOrButtonRow(row)) return;
      const nameEl = findRowCell(row, ".wc-order-item-name, td.name a, td.name, td.column-item, .wc-order-preview-table__column--product, .wc-order-preview-table__column--item, .product-name") ||
                     (row.children && row.children[0]);
      if (!nameEl) return;
      let itemName = extractItemNameWithSize(nameEl, row);
      if (!itemName || isExcludedMetaOrButtonRow(row, itemName)) return;

      const cells = Array.from(row.children || []).filter(el => el.tagName && el.tagName.toUpperCase() === "TD");

      let qty = 1;
      const qtyEl = findRowCell(row, ".wc-order-preview-table__column--quantity, td[class*='column--quantity'], .wc-order-item-qty, .quantity .view, td.quantity, td.column-qty, .item-qty") ||
                    (cells.length >= 3 ? cells[1] : null);
      if (qtyEl) {
        const rawQty = bengaliToAsciiDigits(qtyEl.innerText || qtyEl.textContent || "");
        const qm = rawQty.match(/\d+/);
        if (qm) qty = parseInt(qm[0], 10);
      }

      let total = "";
      const totalEl = findRowCell(row, ".wc-order-preview-table__column--total, td[class*='column--total'], .wc-order-item-total, .line_cost .amount, td.line_cost, td.total, td.column-total") ||
                      (cells.length >= 4 ? cells[cells.length - 1] : (cells.length === 3 ? cells[2] : null));
      if (totalEl) {
        const rawTot = bengaliToAsciiDigits(totalEl.innerText || totalEl.textContent || "");
        const tm = rawTot.replace(/,/g, "").match(/[\d.]+/);
        if (tm) total = Math.round(parseFloat(tm[0])).toString();
      }

      let unitPrice = "";
      const unitEl = findRowCell(row, ".wc-order-preview-table__column--cost, td[class*='column--cost'], .wc-order-item-cost, td.item_cost, td.cost, td.column-cost, .item-cost, .unit-price");
      if (unitEl) {
        const rawUnit = bengaliToAsciiDigits(unitEl.innerText || unitEl.textContent || "");
        const um = rawUnit.replace(/,/g, "").match(/[\d.]+/);
        if (um) unitPrice = Math.round(parseFloat(um[0])).toString();
      }
      if (!unitPrice && total && qty) {
        unitPrice = Math.round(Number(total) / qty).toString();
      }
      if (!total && unitPrice && qty) {
        total = (Number(unitPrice) * qty).toString();
      }

      items.push({ name: itemName, qty, unitPrice, total });
    });

    // 5. Total COD Amount (with Bengali numeral [০-৯] support)
    let cod = "";
    const totalsSec = modal.querySelector(
      ".wc-order-preview-totals, .order-preview-totals, .order-totals, .wc-order-preview__section--totals"
    );
    if (totalsSec) {
      const rows = totalsSec.querySelectorAll ? totalsSec.querySelectorAll("tr") : [];
      for (let r of rows) {
        const thText = (r.querySelector && r.querySelector("th") ? r.querySelector("th").textContent : "").toLowerCase();
        if ((thText.includes("total") || thText.includes("মোট") || thText.includes("সর্বমোট")) &&
            !thText.includes("subtotal") && !thText.includes("উপমোট")) {
          const amtEl = (r.querySelector ? r.querySelector(".amount, bdi") : null) || r.querySelector("td");
          if (amtEl) {
            const raw = bengaliToAsciiDigits(amtEl.textContent || amtEl.innerText || "");
            const m = raw.replace(/,/g, "").match(/[\d.]+/);
            if (m && parseFloat(m[0]) > 0) {
              cod = Math.round(parseFloat(m[0])).toString();
              break;
            }
          }
        }
      }
      if (!cod && typeof totalsSec.querySelectorAll === "function") {
        const allAmts = totalsSec.querySelectorAll(".amount, bdi");
        if (allAmts.length > 0) {
          const lastAmt = allAmts[allAmts.length - 1];
          const raw = bengaliToAsciiDigits(lastAmt.textContent || lastAmt.innerText || "");
          const m = raw.replace(/,/g, "").match(/[\d.]+/);
          if (m && parseFloat(m[0]) > 0) {
            cod = Math.round(parseFloat(m[0])).toString();
          }
        }
      }
    }
    if (!cod) {
      const singleTotalEl = modal.querySelector(".order-total .amount, .order-total, .wc-order-preview-total .amount, .wc-order-preview-total");
      if (singleTotalEl) {
        const raw = bengaliToAsciiDigits(singleTotalEl.textContent || singleTotalEl.innerText || "");
        const m = raw.replace(/,/g, "").match(/[\d.]+/);
        if (m && parseFloat(m[0]) > 0) {
          cod = Math.round(parseFloat(m[0])).toString();
        }
      }
    }
    if (!cod && items.length > 0) {
      const sum = items.reduce((acc, it) => acc + (parseFloat(it.total) || 0), 0);
      if (sum > 0) cod = Math.round(sum).toString();
    }

    // 6. Address parsing
    let parsed = { district: "", zone: "", streetAddress: address };
    let parseBD = typeof parseBDAddress === "function" ? parseBDAddress : null;
    if (!parseBD && typeof require !== "undefined") {
      try { parseBD = require("./parser.js").parseBDAddress; } catch (e) {}
    }
    if (address && parseBD) {
      parsed = parseBD(address);
    }

    const isOutside = (parsed.district && !parsed.district.toLowerCase().includes("dhaka")) ||
                      (address && !address.toLowerCase().includes("dhaka"));

    return {
      orderId,
      orderUrl,
      phone,
      name: customerName,
      address,
      district: parsed.district || "",
      zone: parsed.zone || "",
      cod,
      items,
      isOutsideDhaka: isOutside
    };
  }

  function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    if (typeof radius === "undefined") radius = 5;
    if (typeof radius === "number") {
      radius = { tl: radius, tr: radius, br: radius, bl: radius };
    }
    ctx.beginPath();
    ctx.moveTo(x + radius.tl, y);
    ctx.lineTo(x + width - radius.tr, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
    ctx.lineTo(x + width, y + height - radius.br);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
    ctx.lineTo(x + radius.bl, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
    ctx.lineTo(x, y + radius.tl);
    ctx.quadraticCurveTo(x, y, x + radius.tl, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  /**
   * Render high-resolution visual receipt snapshot on HTML5 Canvas
   * Produces retina (2x) PNG ready to paste directly into WhatsApp
   */
  function renderOrderReceiptCanvas(orderDetails, config) {
    if (typeof document === "undefined") return null;
    const details = normalizeCustomerAndOrderData(orderDetails);
    const cfg = Object.assign({}, DEFAULT_QUICK_REPLY_CONFIG, config || {});

    const canvas = document.createElement("canvas");
    if (!canvas || typeof canvas.getContext !== "function") return null;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const width = 640;
    const subtotalNum = Number(details.subtotal) || 0;
    let effectiveCod = details.cod && details.cod !== "0" ? details.cod : (subtotalNum > 0 ? subtotalNum.toString() : "0");
    if ((!details.cod || details.cod === "0") && effectiveCod !== "0") {
      details.cod = effectiveCod;
    }

    const items = (Array.isArray(details.items) && details.items.length > 0) ? details.items : [
      { name: `Order Parcel #${details.orderId || "1"}`, qty: 1, unitPrice: effectiveCod !== "0" ? effectiveCod : "", total: effectiveCod !== "0" ? effectiveCod : "" }
    ];

    if (items.length === 1 && (!items[0].total || items[0].total === "0") && effectiveCod !== "0") {
      items[0].total = effectiveCod;
      items[0].unitPrice = effectiveCod;
    }

    const headerHeight = 90;
    const customerSectionHeight = 110;
    const tableHeaderHeight = 46;
    let totalItemsHeight = 0;
    items.forEach(it => {
      const nm = (it.name || "").trim();
      totalItemsHeight += (nm.length > 35 || nm.includes("\n") || (nm.includes("(") && nm.length > 25)) ? 36 : 28;
    });
    const itemsHeight = Math.max(totalItemsHeight + 8, 40);
    const subtotalBreakdownHeight = 36;
    const totalsHeight = 80;
    const footerHeight = 84;
    const height = headerHeight + customerSectionHeight + tableHeaderHeight + itemsHeight + subtotalBreakdownHeight + totalsHeight + footerHeight;

    const scale = 2;
    canvas.width = width * scale;
    canvas.height = height * scale;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";

    ctx.scale(scale, scale);

    // Background: pure crisp white theme
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    // Top DEEN Orange Accent Bar (#FF6000)
    ctx.fillStyle = "#FF6000";
    ctx.fillRect(0, 0, width, 5);

    // Clean outer border
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, width, height);

    // 1. Header: Brand Logo Badge + Store Name & Order Info
    const logoX = 24;
    const logoY = 20;
    const logoSize = 44;
    ctx.fillStyle = "#FF6000";
    roundRect(ctx, logoX, logoY, logoSize, logoSize, 10, true, false);

    // Try drawing brand logo image if available, otherwise draw vector mark
    let imageDrawn = false;
    if (deenLogoImg && deenLogoImg.complete && deenLogoImg.naturalWidth > 0 && typeof ctx.drawImage === "function") {
      try {
        ctx.save();
        roundRect(ctx, logoX, logoY, logoSize, logoSize, 10, false, false);
        ctx.clip();
        ctx.drawImage(deenLogoImg, logoX, logoY, logoSize, logoSize);
        ctx.restore();
        imageDrawn = true;
      } catch (e) {}
    }

    if (!imageDrawn) {
      // Crisp vector DEEN rounded triangle / play loop logo
      if (typeof ctx.save === "function") ctx.save();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(logoX + 13, logoY + 10);
      ctx.lineTo(logoX + 29, logoY + 20);
      ctx.quadraticCurveTo(logoX + 34, logoY + 22, logoX + 29, logoY + 25);
      ctx.lineTo(logoX + 13, logoY + 34);
      ctx.quadraticCurveTo(logoX + 9, logoY + 36, logoX + 9, logoY + 31);
      ctx.lineTo(logoX + 9, logoY + 13);
      ctx.quadraticCurveTo(logoX + 9, logoY + 8, logoX + 13, logoY + 10);
      ctx.closePath();
      ctx.fill();

      // Inner orange cutout
      ctx.fillStyle = "#FF6000";
      ctx.beginPath();
      ctx.moveTo(logoX + 15, logoY + 16);
      ctx.lineTo(logoX + 24, logoY + 22);
      ctx.lineTo(logoX + 15, logoY + 28);
      ctx.closePath();
      ctx.fill();
      if (typeof ctx.restore === "function") ctx.restore();
    }

    // Brand title beside logo
    const textStartX = logoX + logoSize + 12; // 80px
    ctx.font = "bold 20px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillStyle = "#0f172a";
    ctx.fillText(cfg.storeName || "DEEN Commerce", textStartX, 38);

    // Subtitle: Order ID & Date
    const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText(`Order #${details.orderId || "N/A"}  •  Date: ${dateStr}`, textStartX, 56);

    // Order Confirmation Badge (Right Side)
    const badgeText = "ORDER CONFIRMATION";
    ctx.font = "bold 10px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    const badgeWidth = (ctx.measureText ? ctx.measureText(badgeText).width : 120) + 16;
    ctx.fillStyle = "#fff7ed";
    roundRect(ctx, width - 24 - badgeWidth, 22, badgeWidth, 24, 12, true, false);
    ctx.strokeStyle = "#FF6000";
    roundRect(ctx, width - 24 - badgeWidth, 22, badgeWidth, 24, 12, false, true);
    ctx.fillStyle = "#EA580C";
    ctx.fillText(badgeText, width - 24 - badgeWidth + 8, 38);

    // Header separator
    ctx.strokeStyle = "#e2e8f0";
    ctx.beginPath();
    ctx.moveTo(24, 76);
    ctx.lineTo(width - 24, 76);
    ctx.stroke();

    // 2. Customer Information Section
    let curY = 98;
    ctx.font = "bold 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillStyle = "#EA580C";
    ctx.fillText("CUSTOMER & DELIVERY DETAILS", 24, curY);

    curY += 20;
    ctx.font = "bold 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillStyle = "#0f172a";
    ctx.fillText(`Name: ${details.name || "Customer"}`, 24, curY);

    ctx.fillStyle = "#EA580C";
    ctx.fillText(`Phone: ${details.phone || "N/A"}`, width / 2, curY);

    curY += 20;
    ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillStyle = "#334155";
    const addrText = `Address: ${details.address || "Inside Dhaka"}`;
    if (ctx.measureText && ctx.measureText(addrText).width > width - 48) {
      const words = addrText.split(" ");
      let l1 = "";
      let l2 = "";
      for (let w of words) {
        if (ctx.measureText(l1 + w + " ").width < width - 60 && !l2) {
          l1 += w + " ";
        } else {
          l2 += w + " ";
        }
      }
      ctx.fillText(l1.trim(), 24, curY);
      curY += 16;
      ctx.fillText(l2.trim(), 24, curY);
    } else {
      ctx.fillText(addrText, 24, curY);
    }

    curY += 20;
    // Divider before items table
    ctx.strokeStyle = "#e2e8f0";
    ctx.beginPath();
    ctx.moveTo(24, curY);
    ctx.lineTo(width - 24, curY);
    ctx.stroke();

    curY += 12;

    // 3. Product Items Table Header (Item, Qty, Unit Price, Total)
    ctx.fillStyle = "#f8fafc";
    roundRect(ctx, 24, curY, width - 48, 28, 4, true, false);
    ctx.strokeStyle = "#e2e8f0";
    roundRect(ctx, 24, curY, width - 48, 28, 4, false, true);

    ctx.font = "bold 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillStyle = "#475569";
    ctx.fillText("PRODUCT / ITEM", 36, curY + 18);
    ctx.fillText("QTY", width - 240, curY + 18);
    ctx.textAlign = "right";
    ctx.fillText("UNIT PRICE", width - 130, curY + 18);
    ctx.fillText("TOTAL", width - 36, curY + 18);
    ctx.textAlign = "left";

    curY += 44;

    // Items rows
    items.forEach((item) => {
      const maxNameWidth = width - 250; // 390px
      let itName = (item.name || "").trim();
      let subLine = "";

      if (itName.includes("\n")) {
        const parts = itName.split("\n");
        itName = parts[0];
        subLine = parts.slice(1).join(", ");
      } else if (itName.includes("(") && itName.includes(")")) {
        if (ctx.measureText && ctx.measureText(itName).width > maxNameWidth) {
          const m = itName.match(/^(.*?)\s*(\([^\)]+\))$/);
          if (m) {
            itName = m[1].trim();
            subLine = m[2].trim();
          }
        }
      }

      ctx.font = "600 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillStyle = "#0f172a";
      if (ctx.measureText && ctx.measureText(itName).width > maxNameWidth) {
        while (ctx.measureText(itName + "...").width > maxNameWidth && itName.length > 5) {
          itName = itName.slice(0, -1);
        }
        itName += "...";
      }
      ctx.fillText(itName, 36, curY);

      if (subLine) {
        ctx.font = "500 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.fillStyle = "#EA580C"; // Highlight size/attribute in DEEN orange
        if (ctx.measureText && ctx.measureText(subLine).width > maxNameWidth) {
          while (ctx.measureText(subLine + "...").width > maxNameWidth && subLine.length > 5) {
            subLine = subLine.slice(0, -1);
          }
          subLine += "...";
        }
        ctx.fillText(subLine, 36, curY + 15);
      }

      // Qty
      ctx.fillStyle = "#64748b";
      ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillText(`x ${item.qty || 1}`, width - 235, curY);

      // Unit Price
      ctx.textAlign = "right";
      ctx.fillStyle = "#64748b";
      let uPrice = item.unitPrice || (item.total && item.qty ? Math.round(Number(item.total) / Number(item.qty)).toString() : item.total || "");
      if (!uPrice || uPrice === "-" || uPrice === "0") {
        if (item.total && Number(item.total) > 0) {
          uPrice = Math.round(Number(item.total) / (item.qty || 1)).toString();
        } else if (details.subtotal && Number(details.subtotal) > 0 && items.length === 1) {
          uPrice = Math.round(Number(details.subtotal) / (item.qty || 1)).toString();
        } else if (details.cod && Number(details.cod) > 0 && items.length === 1) {
          uPrice = Math.round(Number(details.cod) / (item.qty || 1)).toString();
        }
      }
      ctx.fillText(uPrice && uPrice !== "-" ? `৳${uPrice}` : "-", width - 130, curY);

      // Line Total
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      let lTotal = item.total;
      if (!lTotal || lTotal === "-" || lTotal === "0") {
        if (uPrice && Number(uPrice) > 0) {
          lTotal = (Number(uPrice) * (item.qty || 1)).toString();
        } else if (details.subtotal && Number(details.subtotal) > 0 && items.length === 1) {
          lTotal = details.subtotal.toString();
        } else if (details.cod && Number(details.cod) > 0 && items.length === 1) {
          lTotal = details.cod.toString();
        }
      }
      ctx.fillText(lTotal && lTotal !== "-" ? `৳${lTotal}` : "-", width - 36, curY);
      ctx.textAlign = "left";

      curY += subLine ? 36 : 28;
    });

    curY += 4;
    // Subtotal & Delivery Fee breakdown row
    const isOutside = details.isOutsideDhaka;
    let feeCalc = isOutside ? (Number(cfg.outsideDhakaFee) || 130) : (Number(cfg.insideDhakaFee) || 70);
    ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillStyle = "#64748b";
    let subtotalVal = details.subtotal;
    if ((!subtotalVal || subtotalVal === "0" || subtotalVal === details.cod) && details.cod && Number(details.cod) > feeCalc) {
      if (items.length > 0 && items.every(it => it.total && Number(it.total) > 0)) {
        const sum = items.reduce((a, b) => a + Number(b.total), 0);
        if (sum > 0) subtotalVal = sum.toString();
      } else {
        subtotalVal = (Number(details.cod) - feeCalc).toString();
      }
    }
    const subtotalText = subtotalVal && subtotalVal !== "0" ? `Subtotal: ৳${subtotalVal}` : "";
    const feeText = `Delivery (${isOutside ? "Outside Dhaka" : "Inside Dhaka"}): ৳${feeCalc}`;
    ctx.fillText(`${subtotalText}${subtotalText ? "  •  " : ""}${feeText}`, 36, curY + 10);

    curY += 20;
    // Divider before totals
    ctx.strokeStyle = "#e2e8f0";
    ctx.beginPath();
    ctx.moveTo(24, curY);
    ctx.lineTo(width - 24, curY);
    ctx.stroke();

    curY += 12;

    // 4. Totals & COD Summary Card (Crisp Warm Tint with DEEN Orange Border)
    const totalsBoxHeight = 56;
    ctx.fillStyle = "#fff7ed";
    roundRect(ctx, 24, curY, width - 48, totalsBoxHeight, 8, true, false);
    ctx.strokeStyle = "#FF6000";
    ctx.lineWidth = 1.5;
    roundRect(ctx, 24, curY, width - 48, totalsBoxHeight, 8, false, true);
    ctx.lineWidth = 1;

    ctx.font = "bold 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillStyle = "#EA580C";
    ctx.fillText("CASH ON DELIVERY (COD)", 40, curY + 22);

    ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText("Pay upon receiving your parcel", 40, curY + 42);

    // Large COD Amount on Right
    ctx.textAlign = "right";
    ctx.font = "bold 24px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillStyle = "#EA580C";
    ctx.fillText(`৳${details.cod || "0"}`, width - 40, curY + 36);
    ctx.textAlign = "left";

    curY += totalsBoxHeight + 14;

    // 5. Call to Action / Bengali Confirmation Prompt
    ctx.fillStyle = "#f8fafc";
    roundRect(ctx, 24, curY, width - 48, 44, 6, true, false);
    ctx.strokeStyle = "#e2e8f0";
    roundRect(ctx, 24, curY, width - 48, 44, 6, false, true);

    // Vector speech bubble icon in DEEN Orange
    const bubbleX = 38;
    const bubbleY = curY + 9;
    if (typeof ctx.save === "function") {
      ctx.save();
      ctx.fillStyle = "#FF6000";
      // Speech bubble body
      roundRect(ctx, bubbleX, bubbleY, 15, 11, 2.5, true, false);
      // Pointer tail
      ctx.beginPath();
      ctx.moveTo(bubbleX + 3, bubbleY + 11);
      ctx.lineTo(bubbleX + 1, bubbleY + 15);
      ctx.lineTo(bubbleX + 6, bubbleY + 11);
      ctx.closePath();
      ctx.fill();
      // Inner detail lines
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(bubbleX + 3.5, bubbleY + 3.5, 8, 1.5);
      ctx.fillRect(bubbleX + 3.5, bubbleY + 6.5, 5, 1.5);
      ctx.restore();
    }

    ctx.font = "bold 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillStyle = "#0f172a";
    ctx.fillText("অর্ডারটি কনফার্ম করতে দয়া করে রিপ্লাই দিন: হ্যাঁ / কনফার্ম", bubbleX + 22, curY + 19);

    ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText("DEEN Commerce  •  100% Authentic Products  •  deencommerce.com", bubbleX + 22, curY + 34);

    return canvas;
  }

  /**
   * Copy rendered canvas screenshot directly to system clipboard as PNG
   */
  function copyCanvasScreenshotToClipboard(canvas, callback) {
    if (!canvas) {
      if (callback) callback(false, "No canvas provided");
      return;
    }

    if (typeof canvas.toBlob === "function" && typeof navigator !== "undefined" && navigator.clipboard && typeof ClipboardItem !== "undefined") {
      canvas.toBlob((blob) => {
        if (!blob) {
          if (callback) callback(false, "Failed to create PNG blob");
          return;
        }
        try {
          navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob })
          ]).then(() => {
            showWCToast("📸 Order screenshot copied to clipboard! Paste directly in WhatsApp (<strong>Ctrl+V</strong>)");
            if (callback) callback(true);
          }).catch((err) => {
            showWCToast("⚠️ Direct image copy restricted. Downloading PNG screenshot instead...");
            downloadCanvasScreenshot(canvas, `Order_Receipt_${Date.now()}.png`);
            if (callback) callback(false, err);
          });
        } catch (err) {
          downloadCanvasScreenshot(canvas, `Order_Receipt_${Date.now()}.png`);
          if (callback) callback(false, err);
        }
      }, "image/png");
    } else {
      downloadCanvasScreenshot(canvas, `Order_Receipt_${Date.now()}.png`);
      if (callback) callback(false, "ClipboardItem not supported");
    }
  }

  function downloadCanvasScreenshot(canvas, filename) {
    if (!canvas || typeof canvas.toDataURL !== "function" || typeof document === "undefined") return;
    const name = filename || `Order_Receipt_${Date.now()}.png`;
    const dataUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showWCToast(`📥 Order receipt screenshot downloaded as <strong>${name}</strong>`);
  }

  /**
   * Show interactive in-page Order Confirmation & WhatsApp dialog
   */
  function showOrderConfirmModal(orderDetails) {
    if (typeof document === "undefined") return;

    const existing = document.getElementById("deen-order-confirm-modal");
    if (existing) existing.remove();

    const details = normalizeCustomerAndOrderData(orderDetails);
    const items = Array.isArray(details.items) ? details.items : [];

    let genReply = typeof generateQuickReply === "function" ? generateQuickReply : null;
    if (!genReply && typeof require !== "undefined") {
      try { genReply = require("./parser.js").generateQuickReply; } catch (err) {}
    }

    getQuickReplyConfig((config) => {
      const isOutside = details.isOutsideDhaka;

      let currentMsg = genReply ? genReply("order_details_confirm", {
        name: details.name,
        phone: details.phone,
        orderId: details.orderId,
        cod: details.cod,
        address: details.address,
        items: items,
        isOutsideDhaka: isOutside
      }, config) : `আসসালামু আলাইকুম ${details.name || ""}!\n${config.storeName || "DEEN Commerce"} থেকে আপনার অর্ডার #${details.orderId || ""} কনফার্ম করতে রিপ্লাই দিন।`;

      const backdrop = document.createElement("div");
      backdrop.id = "deen-order-confirm-modal";
      backdrop.className = "deen-order-modal-backdrop";

      const modal = document.createElement("div");
      modal.className = "deen-order-modal-card";

      modal.innerHTML = `
        <div class="deen-order-modal-header">
          <div class="deen-modal-title-box">
            <img src="${DEEN_LOGO_BASE64}" alt="DEEN" width="28" height="28" style="border-radius: 6px; vertical-align: middle; box-shadow: 0 2px 6px rgba(255,96,0,0.35); flex-shrink: 0;" />
            <span class="deen-modal-badge">🛍️ Order Confirmation</span>
            <h3 class="deen-modal-title">DEEN Commerce — Order #${escapeHTML(details.orderId || "N/A")}</h3>
          </div>
          <button type="button" class="deen-modal-close" id="deen-modal-close-btn">&times;</button>
        </div>

        <div class="deen-order-modal-body">
          <div class="deen-modal-info-grid">
            <div class="deen-info-item">
              <span class="deen-info-lbl">Customer</span>
              <span class="deen-info-val">${escapeHTML(details.name || "Customer")}</span>
            </div>
            <div class="deen-info-item">
              <span class="deen-info-lbl">Phone</span>
              <span class="deen-info-val phone-highlight">${escapeHTML(details.phone || "N/A")}</span>
            </div>
            <div class="deen-info-item full-width">
              <span class="deen-info-lbl">Address</span>
              <span class="deen-info-val">${escapeHTML(details.address || "N/A")}</span>
            </div>
            <div class="deen-info-item">
              <span class="deen-info-lbl">Total COD</span>
              <span class="deen-info-val cod-highlight">৳${escapeHTML(details.cod || "0")}</span>
            </div>
            <div class="deen-info-item">
              <span class="deen-info-lbl">Delivery Fee</span>
              <span class="deen-info-val">${isOutside ? "Outside Dhaka (৳" + config.outsideDhakaFee + ")" : "Inside Dhaka (৳" + config.insideDhakaFee + ")"}</span>
            </div>
          </div>

          <div class="deen-modal-items-section">
            <div class="deen-items-header" style="display: flex; justify-content: space-between; align-items: center;">
              <span>Ordered Products (${items.length})</span>
              ${details.subtotal ? `<span style="color: #EA580C; font-size: 11px; font-weight: 600;">Subtotal: ৳${escapeHTML(details.subtotal)}</span>` : ""}
            </div>
            <div class="deen-items-table-wrapper">
              ${items.length > 0 ? `
                <table class="deen-modal-items-table">
                  <thead>
                    <tr>
                      <th>Product / Item</th>
                      <th style="text-align: center;">Qty</th>
                      <th style="text-align: right;">Unit Price</th>
                      <th style="text-align: right;">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${items.map(it => {
                      const uPrice = it.unitPrice || (it.total && it.qty ? Math.round(Number(it.total) / Number(it.qty)).toString() : "");
                      const lTotal = it.total || (uPrice && it.qty ? (Number(uPrice) * Number(it.qty)).toString() : "");
                      return `
                      <tr>
                        <td class="item-name">${escapeHTML(it.name)}</td>
                        <td class="item-qty" style="text-align: center;">${it.qty || 1}</td>
                        <td class="item-unit-price" style="text-align: right; color: #64748b;">${uPrice ? '৳' + escapeHTML(uPrice) : '-'}</td>
                        <td class="item-total" style="text-align: right; color: #0f172a; font-weight: 600;">${lTotal ? '৳' + escapeHTML(lTotal) : '-'}</td>
                      </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              ` : `
                <div class="deen-no-items-hint">
                  <span>ℹ️ Tip: Open WooCommerce order preview popup to automatically load product items, or send order summary below.</span>
                </div>
              `}
            </div>
          </div>

          <div class="deen-modal-template-tabs">
            <button type="button" class="deen-tab-btn deen-tab-active" data-tpl="order_details_confirm">🛍️ Details & Confirm</button>
            <button type="button" class="deen-tab-btn" data-tpl="advance_fee">💰 Advance COD Fee</button>
            <button type="button" class="deen-tab-btn" data-tpl="confirm_order">✅ Simple Confirm</button>
            <button type="button" class="deen-tab-btn" data-tpl="high_risk_notice">⚠️ High Risk Notice</button>
          </div>

          <div class="deen-modal-msg-section">
            <label class="deen-msg-label" for="deen-order-msg-text">
              <span>WhatsApp Message Preview (Editable)</span>
              <span class="deen-msg-hint">Will be copied & opened in WhatsApp</span>
            </label>
            <textarea id="deen-order-msg-text" class="deen-order-msg-text" rows="6">${escapeHTML(currentMsg)}</textarea>
          </div>
        </div>

        <div class="deen-order-modal-footer">
          <div class="deen-footer-left">
            <button type="button" class="deen-btn-footer deen-btn-copy-shot" id="deen-footer-btn-shot" title="Copy high-res screenshot to clipboard for WhatsApp (Ctrl+V)">
              📸 Copy Screenshot
            </button>
            <button type="button" class="deen-btn-footer deen-btn-download-shot" id="deen-footer-btn-dl" title="Download receipt PNG">
              📥 Download
            </button>
            <button type="button" class="deen-btn-footer deen-btn-copy-txt" id="deen-footer-btn-copy" title="Copy text to clipboard">
              📋 Copy Text
            </button>
          </div>
          <div class="deen-footer-right">
            <button type="button" class="deen-btn-footer deen-btn-wa-cta" id="deen-footer-btn-send" title="Copy text and open WhatsApp chat">
              💬 Ask Customer to Confirm (WhatsApp)
            </button>
          </div>
        </div>
      `;

      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      const closeBtn = modal.querySelector("#deen-modal-close-btn");
      if (closeBtn) closeBtn.addEventListener("click", () => backdrop.remove());
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) backdrop.remove();
      });
      const keyHandler = (e) => {
        if (e.key === "Escape") {
          backdrop.remove();
          if (typeof document.removeEventListener === "function") {
            document.removeEventListener("keydown", keyHandler);
          }
        }
      };
      if (typeof document.addEventListener === "function") {
        document.addEventListener("keydown", keyHandler);
      }

      const textarea = modal.querySelector("#deen-order-msg-text");
      const tabButtons = modal.querySelectorAll(".deen-tab-btn");
      tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
          tabButtons.forEach(b => b.classList.remove("deen-tab-active"));
          btn.classList.add("deen-tab-active");
          const tpl = btn.dataset.tpl;
          if (genReply) {
            const newText = genReply(tpl, {
              name: details.name,
              phone: details.phone,
              orderId: details.orderId,
              cod: details.cod,
              address: details.address,
              items: items,
              isOutsideDhaka: isOutside
            }, config);
            textarea.value = newText;
          }
        });
      });

      const sendBtn = modal.querySelector("#deen-footer-btn-send");
      if (sendBtn) {
        sendBtn.addEventListener("click", () => {
          const textToSend = textarea.value.trim() || currentMsg;
          injectWhatsAppMessage(textToSend, { phone: details.phone, openChat: true });
          backdrop.remove();
        });
      }

      const shotBtn = modal.querySelector("#deen-footer-btn-shot");
      if (shotBtn) {
        shotBtn.addEventListener("click", () => {
          shotBtn.disabled = true;
          shotBtn.textContent = "⏳ Generating...";
          const canvas = renderOrderReceiptCanvas(details, config);
          copyCanvasScreenshotToClipboard(canvas, () => {
            shotBtn.disabled = false;
            shotBtn.textContent = "📸 Copy Screenshot";
          });
        });
      }

      const dlBtn = modal.querySelector("#deen-footer-btn-dl");
      if (dlBtn) {
        dlBtn.addEventListener("click", () => {
          const canvas = renderOrderReceiptCanvas(details, config);
          downloadCanvasScreenshot(canvas, `Order_${details.orderId || "receipt"}.png`);
        });
      }

      const copyBtn = modal.querySelector("#deen-footer-btn-copy");
      if (copyBtn) {
        copyBtn.addEventListener("click", () => {
          const text = textarea.value.trim() || currentMsg;
          if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
              showWCToast("📋 WhatsApp confirmation text copied to clipboard!");
            });
          }
        });
      }
    });
  }

  /**
   * Inject 1-Click WhatsApp Quick Actions toolbar into WooCommerce Order Preview modal
   */
  function injectOrderPreviewModalActions() {
    if (typeof document === "undefined") return;

    const previewModal = document.querySelector(
      ".wc-backbone-modal .wc-order-preview, .wc-order-preview, .wc-backbone-modal"
    );
    if (!previewModal) return;

    const isOrderPreview = previewModal.querySelector("table.wc-order-preview-table") ||
                           previewModal.querySelector(".wc-order-preview-address") ||
                           previewModal.querySelector(".wc-order-preview__order-number") ||
                           /Order\s*#/i.test(previewModal.innerText || "");
    if (!isOrderPreview) return;

    function renderBarStats(barEl, d) {
      const count = (d.items && d.items.length) || 0;
      const infoEl = barEl.querySelector(".deen-preview-info");
      if (infoEl) {
        const newHtml = `
          ${d.phone ? `Phone: <strong>${escapeHTML(d.phone)}</strong> • ` : ""}
          <strong>${count} item${count === 1 ? '' : 's'}</strong> • COD: <strong>৳${escapeHTML(d.cod || "0")}</strong>
        `.trim();
        // Guard against duplicate DOM writes to eliminate infinite MutationObserver microtask loops
        if (infoEl.dataset.renderedHtml !== newHtml) {
          infoEl.dataset.renderedHtml = newHtml;
          infoEl.innerHTML = newHtml;
        }
      }
    }

    let bar = previewModal.querySelector("#deen-wc-preview-action-bar");
    if (bar) {
      const currentDetails = extractOrderDetailsFromModal(previewModal);
      if ((currentDetails.items && currentDetails.items.length > 0) || (currentDetails.cod && currentDetails.cod !== "0")) {
        renderBarStats(bar, currentDetails);
      }
      return;
    }

    let initialDetails = extractOrderDetailsFromModal(previewModal);

    bar = document.createElement("div");
    bar.id = "deen-wc-preview-action-bar";
    bar.className = "deen-wc-preview-action-bar";

    const itemCount = initialDetails.items ? initialDetails.items.length : 0;
    bar.innerHTML = `
      <div class="deen-preview-bar-left">
        <span class="deen-preview-badge">⚡ DEEN WhatsApp Quick Actions</span>
        <span class="deen-preview-info">
          ${initialDetails.phone ? `Phone: <strong>${escapeHTML(initialDetails.phone)}</strong> • ` : ""}
          <strong>${itemCount} item${itemCount === 1 ? '' : 's'}</strong> • COD: <strong>৳${escapeHTML(initialDetails.cod || "0")}</strong>
        </span>
      </div>
      <div class="deen-preview-bar-actions">
        <button type="button" class="deen-preview-btn deen-btn-ask-wa" id="deen-modal-btn-ask-wa" title="Send itemized order confirmation via WhatsApp">
          💬 Ask Customer to Confirm
        </button>
        <button type="button" class="deen-preview-btn deen-btn-copy-shot" id="deen-modal-btn-copy-shot" title="Copy visual order receipt screenshot to clipboard (Ctrl+V in WhatsApp)">
          📸 Copy Screenshot
        </button>
        <button type="button" class="deen-preview-btn deen-btn-open-dialog" id="deen-modal-btn-open-dialog" title="View details, edit message & download options">
          🔍 Details & Options
        </button>
      </div>
    `;

    const targetContainer = previewModal.querySelector("article") ||
                            previewModal.querySelector(".wc-backbone-modal-main") ||
                            previewModal.querySelector(".wc-backbone-modal-content") ||
                            previewModal;

    if (targetContainer.firstChild) {
      targetContainer.insertBefore(bar, targetContainer.firstChild);
    } else {
      targetContainer.appendChild(bar);
    }

    // Dynamic resolution helper that fetches authoritative edit page if items or COD are missing
    function getFreshestModalDetails(actionCallback) {
      let fresh = extractOrderDetailsFromModal(previewModal);
      if (fresh.items && fresh.items.length > 0 && fresh.cod && fresh.cod !== "0") {
        renderBarStats(bar, fresh);
        actionCallback(fresh);
        return;
      }

      // Check cache first
      if (fresh.orderId && orderDetailsCache.has(fresh.orderId)) {
        const cached = orderDetailsCache.get(fresh.orderId);
        if (cached && cached.items && cached.items.length > 0) {
          const merged = Object.assign({}, fresh, cached);
          renderBarStats(bar, merged);
          actionCallback(merged);
          return;
        }
      }

      // Fallback: fetch authoritative details from order edit page
      if (fresh.orderId) {
        showWCToast("⏳ Loading ordered products & details from WooCommerce...", null, null, 1500);
        fetchOrderDetailsViaEditPage(fresh.orderId, fresh.orderUrl, (fetched) => {
          if (fetched && fetched.items && fetched.items.length > 0) {
            const merged = Object.assign({}, fresh, fetched);
            renderBarStats(bar, merged);
            actionCallback(merged);
          } else {
            actionCallback(fresh);
          }
        });
      } else {
        actionCallback(fresh);
      }
    }

    // Observe modal DOM mutations when WooCommerce Backbone loads items asynchronously (guarded & debounced)
    if (!previewModal.dataset.deenModalObserved) {
      previewModal.dataset.deenModalObserved = "true";
      try {
        let modalDebounceTimer = null;
        const modalObserver = new MutationObserver((mutations) => {
          // Ignore mutations originating strictly from our own action bar
          const allFromBar = mutations.every(m => bar.contains(m.target) || bar === m.target);
          if (allFromBar) return;

          if (modalDebounceTimer) clearTimeout(modalDebounceTimer);
          modalDebounceTimer = setTimeout(() => {
            const updated = extractOrderDetailsFromModal(previewModal);
            if (updated.items && updated.items.length > 0) {
              renderBarStats(bar, updated);
            }
          }, 200);
        });

        // Observe table wrapper or modal article, avoiding our own bar
        const observeTarget = previewModal.querySelector(".wc-order-preview-table-wrapper, .wc-order-preview") || previewModal;
        modalObserver.observe(observeTarget, { childList: true, subtree: true });
      } catch (e) {}
    }

    const askBtn = bar.querySelector("#deen-modal-btn-ask-wa");
    if (askBtn) {
      askBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        askBtn.classList.add("deen-btn-active");
        setTimeout(() => askBtn.classList.remove("deen-btn-active"), 800);

        getFreshestModalDetails((currentDetails) => {
          if (!currentDetails.phone) {
            showWCToast("⚠️ Could not find a valid Bangladeshi phone number in this order preview.");
            return;
          }

          let genReply = typeof generateQuickReply === "function" ? generateQuickReply : null;
          if (!genReply && typeof require !== "undefined") {
            try { genReply = require("./parser.js").generateQuickReply; } catch (err) {}
          }

          getQuickReplyConfig((config) => {
            const msg = genReply ? genReply("order_details_confirm", currentDetails, config) :
              `আসসালামু আলাইকুম ${currentDetails.name || ""}! আপনার অর্ডার #${currentDetails.orderId || ""} কনফার্ম করতে রিপ্লাই দিন।`;

            injectWhatsAppMessage(msg, { phone: currentDetails.phone, openChat: true });
            showWCToast(`💬 WhatsApp confirmation with <strong>${currentDetails.items ? currentDetails.items.length : 0} items</strong> copied & opened!`);
          });
        });
      });
    }

    const shotBtn = bar.querySelector("#deen-modal-btn-copy-shot");
    if (shotBtn) {
      shotBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        shotBtn.classList.add("deen-btn-active");
        setTimeout(() => shotBtn.classList.remove("deen-btn-active"), 800);

        getFreshestModalDetails((currentDetails) => {
          getQuickReplyConfig((config) => {
            const canvas = renderOrderReceiptCanvas(currentDetails, config);
            copyCanvasScreenshotToClipboard(canvas);
          });
        });
      });
    }

    const dialogBtn = bar.querySelector("#deen-modal-btn-open-dialog");
    if (dialogBtn) {
      dialogBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        getFreshestModalDetails((currentDetails) => {
          showOrderConfirmModal(currentDetails);
        });
      });
    }
  }

  /**
   * Inject 1-Click "⚡ Pathao" and "💬 WhatsApp" buttons into WooCommerce orders table
   */
  function injectTableActionButtons() {
    const rows = document.querySelectorAll(
      "table.wp-list-table tbody tr, table.wc-orders-list-table tbody tr, #the-list tr"
    );

    rows.forEach(row => {
      if (row.dataset.deenPathaoInjected) return;
      // Mark as inspected immediately so future debounced cycles don't re-scan non-order rows
      row.dataset.deenPathaoInjected = "true";

      if (row.querySelector(".deen-wc-pathao-btn, .deen-wc-wa-btn")) return;

      // Use textContent to avoid expensive layout recalculation reflows on table rows
      const text = row.textContent || row.innerText || "";
      const phone = normalizeBDPhone(text);
      if (!phone) return;

      // Find an ideal location for the button
      let targetContainer = row.querySelector(".wc_actions, .column-order_actions, .order_actions");
      if (!targetContainer) {
        targetContainer = row.querySelector(".customer_user, .column-order_title, .column-customer_user");
      }
      if (!targetContainer) {
        targetContainer = row.querySelector("td:last-child");
      }

      if (targetContainer) {
        // Pathao button
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

        // WhatsApp Quick Reply & Confirm Dialog button
        const waBtn = document.createElement("button");
        waBtn.type = "button";
        waBtn.className = "deen-wc-wa-btn";
        waBtn.innerHTML = `<span>💬 WhatsApp</span>`;
        waBtn.title = `1-Click WhatsApp Order Confirm & Screenshot for ${phone}`;

        waBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();

          waBtn.classList.add("deen-btn-active");
          setTimeout(() => waBtn.classList.remove("deen-btn-active"), 800);

          const details = extractRowOrderDetails(row);
          details.phone = phone;

          // If products or COD are not loaded yet, attempt background fetch or auto-preview
          if (!details.items || details.items.length === 0 || !details.cod || details.cod === "0") {
            // Check cache first
            if (details.orderId && orderDetailsCache.has(details.orderId)) {
              const cached = orderDetailsCache.get(details.orderId);
              if (cached && cached.items && cached.items.length > 0) {
                if (cached.items) details.items = cached.items;
                if (cached.cod && (!details.cod || details.cod === "0")) details.cod = cached.cod;
                if (cached.name && (!details.name || isInvalidCustomerName(details.name))) details.name = cached.name;
                if (cached.address && (!details.address || details.address.length < 5)) details.address = cached.address;
                showOrderConfirmModal(details);
                return;
              }
            }

            function triggerPreviewFallback() {
              const previewBtn = row.querySelector(".order-preview, button.order-preview, a.order-preview, .wc-action-button-preview, a.wc-action-button-view");
              if (previewBtn && typeof previewBtn.click === "function") {
                showWCToast("⏳ Loading ordered products via WooCommerce preview...", null, null, 2500);
                previewBtn.click();

                let attempts = 0;
                const checkModalInterval = setInterval(() => {
                  attempts++;
                  const modal = document.querySelector(".wc-backbone-modal, .wc-order-preview, #wc-backbone-modal-dialog");
                  if (modal) {
                    const modalDetails = extractOrderDetailsFromModal(modal);
                    const hasItems = Boolean(modalDetails.items && modalDetails.items.length > 0);
                    const isStillLoading = Boolean(modal.querySelector(".blockUI, .loading, .spinner.is-active, .wc-order-preview--loading, .wc-order-preview-table--loading"));

                    if ((hasItems && !isStillLoading) || attempts >= 35) {
                      clearInterval(checkModalInterval);
                      if (modalDetails) {
                        if (modalDetails.items && modalDetails.items.length > 0) {
                          details.items = modalDetails.items;
                        }
                        if (modalDetails.cod && (!details.cod || details.cod === "0")) {
                          details.cod = modalDetails.cod;
                        }
                        if (modalDetails.name && (!details.name || isInvalidCustomerName(details.name))) {
                          details.name = modalDetails.name;
                        }
                        if (modalDetails.address && (!details.address || details.address.length < 5)) {
                          details.address = modalDetails.address;
                        }
                      }
                      showOrderConfirmModal(details);
                      return;
                    }
                  } else if (attempts >= 35) {
                    clearInterval(checkModalInterval);
                    showOrderConfirmModal(details);
                  }
                }, 100);
                return;
              }
              showOrderConfirmModal(details);
            }

            // Direct authoritative fetch via WooCommerce AJAX / Edit Page
            if (details.orderId) {
              showWCToast("⏳ Loading ordered products & details from WooCommerce...", null, null, 2000);
              fetchOrderDetailsViaEditPage(details.orderId, details.orderUrl, (fetched) => {
                if (fetched && fetched.items && fetched.items.length > 0) {
                  details.items = fetched.items;
                  if (fetched.cod && (!details.cod || details.cod === "0")) details.cod = fetched.cod;
                  if (fetched.name && (!details.name || isInvalidCustomerName(details.name))) details.name = fetched.name;
                  if (fetched.address && (!details.address || details.address.length < 5)) details.address = fetched.address;
                  showOrderConfirmModal(details);
                  return;
                }
                triggerPreviewFallback();
              });
              return;
            }

            triggerPreviewFallback();
            return;
          }

          showOrderConfirmModal(details);
        });

        // Add to container
        targetContainer.appendChild(btn);
        targetContainer.appendChild(waBtn);
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

        syncToPathao(payload, { autoSwitch: true, userTriggered: true });
      });

      const waBtn = document.createElement("button");
      waBtn.type = "button";
      waBtn.id = "deen-single-order-wa-btn";
      waBtn.className = "deen-wc-wa-btn single-order-btn";
      waBtn.innerHTML = `<span>💬 WhatsApp Advance COD Request</span>`;
      waBtn.style.marginLeft = "8px";

      waBtn.addEventListener("click", (e) => {
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
        const orderId = (document.querySelector("#post_ID") || {}).value || "";

        let genReply = typeof generateQuickReply === "function" ? generateQuickReply : null;
        if (!genReply && typeof require !== "undefined") {
          try { genReply = require("./parser.js").generateQuickReply; } catch (err) {}
        }

        getQuickReplyConfig((config) => {
          const msg = genReply ? genReply("advance_fee", {
            name: fullName,
            phone: currentPhone,
            orderId: orderId,
            cod: total ? Math.round(parseFloat(total)).toString() : "",
            address: `${address1}, ${city}`.trim()
          }, config) : `আসসালামু আলাইকুম ${fullName}! আপনার অর্ডার #${orderId} কনফার্ম করার জন্য ডেলিভারি চার্জ অগ্রিম বিকাশ করুন: ${config.bkashNumber}`;

          injectWhatsAppMessage(msg, { phone: currentPhone, openChat: true });
        });
      });

      if (phoneInput.parentElement) {
        phoneInput.parentElement.appendChild(btn);
        phoneInput.parentElement.appendChild(waBtn);
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
    if (!toast) return;
    toast.className = "deen-wc-toast";

    const contentDiv = document.createElement("div");
    if (contentDiv) {
      contentDiv.className = "deen-wc-toast-content";
      contentDiv.innerHTML = htmlContent;
      if (toast.appendChild) toast.appendChild(contentDiv);
    }

    if (actionText && onAction) {
      const actionBtn = document.createElement("button");
      if (actionBtn) {
        actionBtn.className = "deen-wc-toast-action";
        actionBtn.textContent = actionText;
        actionBtn.addEventListener("click", () => {
          onAction();
          toast.remove();
        });
        if (toast.appendChild) toast.appendChild(actionBtn);
      }
    }

    const closeBtn = document.createElement("button");
    if (closeBtn) {
      closeBtn.className = "deen-wc-toast-close";
      closeBtn.innerHTML = "&times;";
      closeBtn.addEventListener("click", () => toast.remove());
      if (toast.appendChild) toast.appendChild(closeBtn);
    }

    if (container && container.appendChild) {
      container.appendChild(toast);
    }

    // Auto remove after 5 seconds
    setTimeout(() => {
      if (toast.parentElement) {
        toast.classList.add("deen-toast-fading");
        setTimeout(() => toast.remove(), 300);
      }
    }, 5000);
  }

  /**
   * Listen for messages from popup (e.g. tab extraction request)
   */
  function initMessageListener() {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.onMessage) return;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "extract_page_data") {
        const rows = Array.from(document.querySelectorAll(
          "table.wp-list-table tbody tr, table.wc-orders-list-table tbody tr, tr[id*='post-'], tr.type-shop_order"
        ));
        if (rows.length > 0) {
          const rowTexts = rows.map(r => {
            const cells = Array.from(r.querySelectorAll("td, th"));
            if (cells.length > 0) {
              return cells.map(c => (c.innerText || "").trim()).filter(Boolean).join("\n");
            }
            return (r.innerText || "").trim();
          });
          sendResponse({ rawText: rowTexts.join("\n---\n"), count: rows.length });
        } else {
          sendResponse({ rawText: (document.body ? document.body.innerText : ""), count: 0 });
        }
      }
      return true;
    });
  }

  /**
   * Get all checked rows in WooCommerce orders table
   */
  function getSelectedOrderRows() {
    if (typeof document === "undefined") return [];
    const checkboxes = document.querySelectorAll(
      "table.wp-list-table tbody .check-column input[type='checkbox']:checked, " +
      "table.wc-orders-list-table tbody .check-column input[type='checkbox']:checked, " +
      "#the-list .check-column input[type='checkbox']:checked, " +
      "table tbody tr input[name='id[]']:checked, " +
      "table tbody tr input[name='post[]']:checked"
    );

    const selectedRows = [];
    checkboxes.forEach(cb => {
      const row = cb.closest("tr");
      if (row && !selectedRows.includes(row)) {
        selectedRows.push(row);
      }
    });
    return selectedRows;
  }

  /**
   * Render or update floating batch dispatch toolbar
   */
  function updateBulkDispatchBar() {
    if (typeof document === "undefined") return;

    const selectedRows = getSelectedOrderRows();
    const count = selectedRows.length;

    let bar = document.getElementById("deen-wc-bulk-bar");

    if (count === 0) {
      if (bar) bar.classList.remove("deen-bar-visible");
      return;
    }

    if (!bar) {
      bar = document.createElement("div");
      bar.id = "deen-wc-bulk-bar";
      bar.className = "deen-wc-bulk-bar";
      document.body.appendChild(bar);
    }

    bar.innerHTML = `
      <div class="deen-bulk-info">
        <span class="deen-bulk-badge">⚡ Batch Dispatch</span>
        <span class="deen-bulk-count"><strong id="deen-bulk-count-num">${count}</strong> orders selected</span>
      </div>
      <div class="deen-bulk-actions">
        <button type="button" class="deen-bulk-btn deen-btn-csv" id="deen-bulk-csv-btn" title="Download official Pathao Bulk CSV format">
          📥 Download Pathao CSV
        </button>
        <button type="button" class="deen-bulk-btn deen-btn-queue" id="deen-bulk-queue-btn" title="Open Pathao and autofill sequentially">
          🚀 Queue to Pathao (${count})
        </button>
        <button type="button" class="deen-bulk-btn deen-btn-dismiss" id="deen-bulk-deselect-btn" title="Deselect All">&times;</button>
      </div>
    `;

    bar.classList.add("deen-bar-visible");

    // CSV Export Button
    const csvBtn = bar.querySelector("#deen-bulk-csv-btn");
    if (csvBtn) {
      csvBtn.addEventListener("click", () => {
        const orders = selectedRows.map(r => extractRowOrderDetails(r));
        let exportCSV = typeof exportPathaoBatchCSV === "function" ? exportPathaoBatchCSV : null;
        if (!exportCSV && typeof require !== "undefined") {
          try {
            exportCSV = require("./parser.js").exportPathaoBatchCSV;
          } catch (e) {}
        }
        if (exportCSV) {
          exportCSV(orders);
        } else {
          const header = "Merchant Order ID,Recipient Name,Recipient Phone,Recipient Address,Recipient City,Recipient Zone,Recipient Area,Amount to Collect,Item Type,Item Quantity,Special Instruction";
          const rows = orders.map(o => `"${o.orderId}","${o.name}","${o.phone}","${o.streetAddress || o.address}","${o.district || 'Dhaka'}","${o.zone || ''}","","${o.cod || '0'}","Parcel","1","Order #${o.orderId}"`);
          const csv = [header, ...rows].join("\r\n");
          const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `Pathao_Bulk_Orders_${new Date().toISOString().slice(0, 10)}.csv`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        }

        showWCToast(`📥 Downloaded Pathao bulk CSV for <strong>${orders.length}</strong> orders!`);
      });
    }

    // Queue to Pathao Button
    const queueBtn = bar.querySelector("#deen-bulk-queue-btn");
    if (queueBtn) {
      queueBtn.addEventListener("click", () => {
        const orders = selectedRows.map(r => extractRowOrderDetails(r));
        if (orders.length === 0) return;

        const queuePayload = {
          orders: orders,
          currentIndex: 0,
          total: orders.length,
          userTriggered: true,
          timestamp: Date.now()
        };

        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({
            pathao_batch_queue: queuePayload,
            pathao_autofill_data: {
              ...orders[0],
              source: "woocommerce_batch",
              userTriggered: true,
              timestamp: Date.now()
            }
          });
        }

        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            action: "focus_or_open_pathao",
            url: "https://merchant.pathao.com/courier/orders/create"
          }).catch(() => {});
        }

        showWCToast(
          `🚀 Queued <strong>${orders.length}</strong> orders to Pathao!`,
          "👉 Open Pathao",
          () => {
            if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
              chrome.runtime.sendMessage({ action: "focus_or_open_pathao" }).catch(() => {});
            }
          }
        );
      });
    }

    // Deselect All Button
    const deselectBtn = bar.querySelector("#deen-bulk-deselect-btn");
    if (deselectBtn) {
      deselectBtn.addEventListener("click", () => {
        const allCheckboxes = document.querySelectorAll(
          "table.wp-list-table tbody .check-column input[type='checkbox'], " +
          "table.wc-orders-list-table tbody .check-column input[type='checkbox'], " +
          "#the-list .check-column input[type='checkbox'], " +
          "input[name='id[]'], input[name='post[]'], " +
          "#cb-select-all-1, #cb-select-all-2"
        );
        allCheckboxes.forEach(cb => { cb.checked = false; });
        updateBulkDispatchBar();
      });
    }
  }

  /**
   * Listen for table checkbox changes for batch selection
   */
  function initBulkDispatchBar() {
    if (typeof document === "undefined") return;

    // Attach delegated change listener to document body
    document.addEventListener("change", (e) => {
      const target = e.target;
      if (!target || target.type !== "checkbox") return;

      if (
        target.closest(".check-column") ||
        target.name === "id[]" ||
        target.name === "post[]" ||
        target.id === "cb-select-all-1" ||
        target.id === "cb-select-all-2"
      ) {
        setTimeout(updateBulkDispatchBar, 20);
      }
    });

    injectTopBulkActionButton();
  }

  function injectTopBulkActionButton() {
    if (typeof document === "undefined") return;
    const bulkActionContainers = document.querySelectorAll(".tablenav.top .alignleft.actions.bulkactions, .tablenav.top .actions");
    bulkActionContainers.forEach(container => {
      if (container.querySelector(".deen-top-bulk-btn")) return;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "button deen-top-bulk-btn";
      btn.innerHTML = "<span>⚡ Pathao Batch</span>";
      btn.title = "Dispatch checked orders with Pathao";
      btn.style.marginLeft = "4px";

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const selected = getSelectedOrderRows();
        if (selected.length === 0) {
          alert("Please select one or more orders from the table checkboxes first.");
          return;
        }
        updateBulkDispatchBar();
      });

      container.appendChild(btn);
    });
  }

  // Initialize
  function init() {
    if (!isExtensionValid()) return;

    try {
      initCopyListener();
      initMessageListener();
      injectTableActionButtons();
      injectSingleOrderPageButton();
      initBulkDispatchBar();
      injectOrderPreviewModalActions();
    } catch (e) {
      if (!isExtensionValid()) return;
    }

    // Observe DOM mutations for AJAX pagination / filter reload / modal opening (debounced)
    let observer = null;
    let debounceTimer = null;
    try {
      observer = new MutationObserver(() => {
        if (!isExtensionValid()) {
          if (observer) {
            try { observer.disconnect(); } catch (e) {}
          }
          return;
        }

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          try {
            injectTableActionButtons();
            injectSingleOrderPageButton();
            injectTopBulkActionButton();
            updateBulkDispatchBar();
            injectOrderPreviewModalActions();
          } catch (err) {
            if (!isExtensionValid() && observer) {
              try { observer.disconnect(); } catch (e) {}
            }
          }
        }, 120);
      });

      if (document.body && isExtensionValid()) {
        observer.observe(document.body, {
          childList: true,
          subtree: true
        });
      }
    } catch (obsErr) {
      // Ignored if extension context invalidated
    }
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      extractRowOrderDetails,
      extractOrderDetailsFromModal,
      renderOrderReceiptCanvas,
      copyCanvasScreenshotToClipboard,
      downloadCanvasScreenshot,
      showOrderConfirmModal,
      injectOrderPreviewModalActions,
      getSelectedOrderRows,
      syncToPathao,
      initBulkDispatchBar,
      updateBulkDispatchBar,
      normalizeBDPhone,
      injectTableActionButtons,
      injectSingleOrderPageButton,
      injectWhatsAppMessage,
      getQuickReplyConfig,
      DEFAULT_QUICK_REPLY_CONFIG,
      normalizeCustomerAndOrderData,
      parseWooCommerceAddressBlock,
      isInvalidCustomerName,
      extractItemNameWithSize,
      bengaliToAsciiDigits,
      parseOrderEditPageHTML,
      fetchOrderDetailsViaEditPage,
      orderDetailsCache,
      DEEN_LOGO_BASE64,
      getWooCommerceAjaxConfig,
      parseWooCommerceAjaxOrderDetails
    };
  }
})();

