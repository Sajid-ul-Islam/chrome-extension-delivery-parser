/**
 * DEEN Delivery Parser - Floating AI Assistant Chatbox
 * Platforms: WordPress Admin, Pathao Merchant Portal, WhatsApp Web
 * 
 * Provides an in-page, draggable/dockable AI Copilot chatbox powered by
 * DeenAssistant intelligence core (zero-latency deterministic analytics + BYOK).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DeenFloatingChat = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 1. Platform Detection
  function detectPlatform() {
    if (typeof window === 'undefined' || !window.location) return 'unsupported';
    const host = (window.location.hostname || '').toLowerCase();
    const href = (window.location.href || '').toLowerCase();

    if (host.includes('web.whatsapp.com')) return 'whatsapp';
    if (host.includes('pathao.com') || host.includes('merchant.pathao.com')) return 'pathao';
    if (href.includes('/wp-admin') || (typeof document !== 'undefined' && document.body && document.body.classList.contains('wp-admin'))) {
      return 'wordpress';
    }
    return 'unsupported';
  }

  function isExtensionValid() {
    try {
      return typeof chrome !== 'undefined' && Boolean(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  // State Management
  let currentPlatform = 'unsupported';
  let isChatOpen = false;
  let activeContext = {
    platform: 'unsupported',
    records: [],
    metrics: {},
    phone: '',
    customerName: '',
    recentText: ''
  };

  // Markdown to Safe HTML Formatter
  function renderMarkdownToHTML(text) {
    if (!text) return '';
    let html = String(text);

    // Extract raw chart/svg blocks to prevent escaping them
    const rawBlocks = [];
    html = html.replace(/(<div class="deen-chart-card"[\s\S]*?<\/div>|<svg[\s\S]*?<\/svg>)/gi, (match) => {
      const token = `__DEEN_RAW_BLOCK_${rawBlocks.length}__`;
      rawBlocks.push(match);
      return token;
    });

    // Escape raw HTML entities
    html = html
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Format markdown tables (| col1 | col2 | ...)
    html = html.replace(/((?:\|[^\n]+\|\r?\n)+)/g, (tableBlock) => {
      const lines = tableBlock.trim().split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) return tableBlock;
      const headerCols = lines[0].split('|').slice(1, -1).map(c => c.trim());
      const rows = lines.slice(2).map(line => line.split('|').slice(1, -1).map(c => c.trim()));
      
      let tableHtml = '<div style="overflow-x:auto; margin: 8px 0;"><table style="width:100%; border-collapse: collapse; font-size: 11px; text-align: left;">';
      tableHtml += '<thead><tr style="border-bottom: 1px solid #334155; background: rgba(30,41,59,0.7);">';
      headerCols.forEach(h => { tableHtml += `<th style="padding: 6px 8px; color: #94a3b8; font-weight: 600;">${h}</th>`; });
      tableHtml += '</tr></thead><tbody>';
      rows.forEach(r => {
        tableHtml += '<tr style="border-bottom: 1px solid rgba(51,65,85,0.4);">';
        r.forEach(cell => { tableHtml += `<td style="padding: 5px 8px; color: #f8fafc;">${cell}</td>`; });
        tableHtml += '</tr>';
      });
      tableHtml += '</tbody></table></div>';
      return tableHtml;
    });

    // Headers (### Header)
    html = html.replace(/^### (.*$)/gim, '<h4>$1</h4>');
    html = html.replace(/^## (.*$)/gim, '<h3>$1</h3>');

    // Bold (**text**)
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Inline code (`code`)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bullet lists (- item or * item)
    html = html.replace(/^\s*[-*]\s+(.*)$/gim, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/gims, '<ul>$1</ul>');

    // Links [text](url)
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color: #38bdf8; text-decoration: underline;">$1</a>');

    // Line breaks
    html = html.replace(/\n\n+/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');

    // Restore raw HTML blocks
    for (let i = 0; i < rawBlocks.length; i++) {
      html = html.replace(`__DEEN_RAW_BLOCK_${i}__`, rawBlocks[i]);
    }

    return `<p>${html}</p>`.replace(/<p><\/p>/g, '');
  }

  // 2. Platform Context Gatherers
  function gatherGenericTableContext() {
    if (typeof document === 'undefined') return { records: [], metrics: {}, totalCount: 0 };

    const tables = Array.from(document.querySelectorAll('table, [role="table"], .table, .grid'));
    if (tables.length === 0) return { records: [], metrics: {}, totalCount: 0 };

    let bestTable = tables[0];
    let maxRows = 0;
    for (const tbl of tables) {
      const rows = tbl.querySelectorAll('tr, [role="row"]');
      if (rows.length > maxRows) {
        maxRows = rows.length;
        bestTable = tbl;
      }
    }

    const rows = Array.from(bestTable.querySelectorAll('tr, [role="row"]'));
    if (rows.length < 2) return { records: [], metrics: {}, totalCount: 0 };

    const records = [];
    let totalCOD = 0;

    const headerRow = rows[0];
    const headerCells = (headerRow && typeof headerRow.querySelectorAll === 'function')
      ? Array.from(headerRow.querySelectorAll('th, td, [role="columnheader"]')).map(c => (c.innerText || '').trim().toLowerCase())
      : [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const text = row.innerText || '';
      if (!text.trim()) continue;

      const cells = (row && typeof row.querySelectorAll === 'function')
        ? Array.from(row.querySelectorAll('td, th, [role="cell"]')).map(c => (c.innerText || '').trim())
        : (text.split(/\s{2,}|\t/) || []);
      
      const phoneMatch = text.match(/(?:(?:\+8801|8801)|01)[3-9]\d{8}/);
      const phone = phoneMatch ? phoneMatch[0] : '';

      const idMatch = text.match(/(?:#|ID:?\s*|ord_?)([A-Z0-9_-]+)/i) || text.match(/\b\d{4,8}\b/);
      const orderId = idMatch ? idMatch[1] || idMatch[0] : `ROW_${i}`;

      const priceMatch = text.match(/(?:৳|BDT|TK|\$)\s*([\d,]+(?:\.\d{2})?)/i) || text.match(/\b([\d,]+(?:\.\d{2})?)\s*(?:৳|BDT|TK)/i);
      let amount = 0;
      if (priceMatch) {
        amount = parseFloat(priceMatch[1].replace(/,/g, '')) || 0;
      } else {
        const nums = text.match(/\b\d+(?:\.\d{2})?\b/g) || [];
        const possiblePrices = nums.map(Number).filter(n => n >= 100 && n <= 50000);
        amount = possiblePrices.length > 0 ? possiblePrices[possiblePrices.length - 1] : 0;
      }
      totalCOD += amount;

      const isOutside = /Outside|ঢাকার\s*বাইরে|Chittagong|Sylhet|Rajshahi|Khulna|Barishal|Rangpur|Mymensingh/i.test(text);

      records.push({
        orderId,
        customerName: cells[1] || cells[0] || 'Customer',
        phone,
        cod: amount,
        isOutsideDhaka: isOutside,
        status: /delivered|completed/i.test(text) ? 'Completed' : (/paid/i.test(text) ? 'Paid' : 'Pending'),
        rawText: text
      });
    }

    const metrics = {
      totalParcels: records.length,
      paidCount: records.filter(r => /paid|completed/i.test(r.status)).length,
      unpaidCount: records.filter(r => !/paid|completed/i.test(r.status)).length,
      totalCOD,
      totalCharge: records.length * 70,
      netRevenue: Math.max(0, totalCOD - (records.length * 70))
    };

    return { records, metrics, totalCount: records.length };
  }

  function gatherWordPressContext() {
    if (typeof document === 'undefined') return { records: [], metrics: {}, totalCount: 0 };
    
    // Look for WooCommerce table rows
    const rows = Array.from(document.querySelectorAll('#the-list tr, table.wp-list-table tr, .woocommerce-orders-table__row'));
    const orderRows = rows.filter(r => r.id && r.id.startsWith('order-') || r.querySelector('.order-number, .order_number'));

    const records = [];
    let totalCOD = 0;
    let outsideDhakaCount = 0;
    let insideDhakaCount = 0;

    for (const row of orderRows) {
      try {
        const orderIdMatch = (row.id || '').match(/\d+/) || (row.querySelector('.order-number, .order_number')?.textContent || '').match(/\d+/);
        const orderId = orderIdMatch ? orderIdMatch[0] : '';
        const nameEl = row.querySelector('.order_title a, .customer_user, .order-number a');
        const customerName = nameEl ? nameEl.textContent.trim() : '';
        
        // Scan for phone
        const text = row.innerText || '';
        const phoneMatch = text.match(/(?:(?:\+8801|8801)|01)[3-9]\d{8}/);
        const phone = phoneMatch ? phoneMatch[0] : '';

        // Scan for price / COD
        const totalEl = row.querySelector('.order_total, .order-total, .woocommerce-Price-amount');
        let amount = 0;
        if (totalEl) {
          const m = (totalEl.textContent || '').match(/[\d,]+(?:\.\d{2})?/);
          if (m) amount = parseFloat(m[0].replace(/,/g, '')) || 0;
        } else {
          const amountMatch = text.match(/(?:৳|BDT|TK)\s*([\d,]+(?:\.\d{2})?)/i);
          amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) || 0 : 0;
        }
        totalCOD += amount;

        // Outside Dhaka check
        const isOutside = /Outside|ঢাকার\s*বাইরে|Chittagong|Sylhet|Rajshahi|Khulna|Barishal|Rangpur|Mymensingh/i.test(text);
        if (isOutside) outsideDhakaCount++; else insideDhakaCount++;

        records.push({
          orderId,
          customerName,
          phone,
          cod: amount,
          isOutsideDhaka: isOutside,
          status: row.querySelector('.order_status')?.textContent?.trim() || ''
        });
      } catch (e) {}
    }

    const metrics = {
      totalParcels: records.length,
      paidCount: records.filter(r => /completed|processing/i.test(r.status)).length,
      unpaidCount: records.length,
      totalCOD: totalCOD,
      totalCharge: (insideDhakaCount * 50) + (outsideDhakaCount * 90),
      netRevenue: Math.max(0, totalCOD - ((insideDhakaCount * 50) + (outsideDhakaCount * 90))),
      outsideDhakaCount,
      insideDhakaCount
    };

    return { records, metrics, totalCount: records.length };
  }

  function gatherPathaoContext() {
    if (typeof window === 'undefined') return { records: [], metrics: {}, totalCount: 0 };
    
    // Check if content.js already parsed records
    if (window.deenParsedParcels && Array.isArray(window.deenParsedParcels.records) && window.deenParsedParcels.records.length > 0) {
      return {
        records: window.deenParsedParcels.records,
        metrics: window.deenParsedParcels.metrics || {},
        totalCount: window.deenParsedParcels.records.length
      };
    }

    // Fallback: parse table rows directly
    const rows = Array.from(document.querySelectorAll("table tbody tr, .ant-table-tbody tr, tr[class*='row'], div[role='row']"));
    const isConsignmentId = (s) => /[A-Z]{2}\d{6}[A-Z0-9]+/i.test(s);
    const parcelRows = rows.filter(r => isConsignmentId(r.innerText || ''));

    const records = [];
    let totalCOD = 0;
    let paidCount = 0;
    let unpaidCount = 0;

    for (const r of parcelRows) {
      const text = r.innerText || '';
      const cidMatch = text.match(/[A-Z]{2}\d{6}[A-Z0-9]+/i);
      const phoneMatch = text.match(/(?:(?:\+8801|8801)|01)[3-9]\d{8}/);
      const isPaid = (/\bpaid\b|settled|সম্পন্ন/i.test(text)) && !/\bunpaid\b|বকেয়া/i.test(text);
      if (isPaid) paidCount++; else unpaidCount++;

      // Strip phone numbers and consignment IDs to isolate pure price amount
      const cleanedForCod = text.replace(/(?:(?:\+8801|8801)|01)[3-9]\d{8}/g, '').replace(/[A-Z]{2}\d{6}[A-Z0-9]+/gi, '');
      const nums = cleanedForCod.match(/\b\d+(?:\.\d{1,2})?\b/g) || [];
      const cod = nums.length > 0 ? parseFloat(nums[0]) : 0;
      totalCOD += cod;

      // Scan for NDR failed delivery status
      const isNDR = /(?:fail|attempt|unreachable|reschedule|rider|cancel|hold|contact|not_found|ব্যর্থ|যোগাযোগ|পুনঃনির্ধারিত|ঠিকানা)/i.test(text) &&
                    !/(?:successful|delivered|সফল|ডেলিভারড)/i.test(text);

      records.push({
        consignmentId: cidMatch ? cidMatch[0] : '',
        phone: phoneMatch ? phoneMatch[0] : '',
        cod: cod,
        isPaid: isPaid,
        isNDR: isNDR
      });
    }

    const ndrCount = records.filter(r => r.isNDR).length;

    const metrics = {
      totalParcels: records.length,
      paidCount,
      unpaidCount,
      totalCOD,
      totalCharge: records.length * 60,
      netRevenue: Math.max(0, totalCOD - (records.length * 60)),
      ndrCount
    };

    return { records, metrics, totalCount: records.length };
  }

  function gatherWhatsAppContext() {
    if (typeof document === 'undefined') return { phone: '', customerName: '', recentText: '' };
    
    // 1. Scan active chat header
    const header = document.querySelector('#main header') || document.querySelector('header[data-testid="conversation-header"]');
    let phone = '';
    let customerName = '';

    if (header) {
      const titleEl = header.querySelector('span[data-testid="conversation-info-header-chat-title"]') ||
                      header.querySelector('div[role="button"] span[title]') ||
                      header.querySelector('span[title]');
      if (titleEl) {
        customerName = (titleEl.getAttribute('title') || titleEl.innerText || '').trim();
      }

      // Check header text for phone
      const headerText = header.innerText || '';
      const match = headerText.match(/(?:(?:\+8801|8801)|01)[3-9]\d{8}/);
      if (match) {
        phone = match[0];
      }
    }

    // 2. Scan recent messages in #main for customer statements / notes
    const messages = Array.from(document.querySelectorAll('#main .message-in, #main div[data-pre-plain-text]'));
    let recentText = '';
    if (messages.length > 0) {
      const lastFew = messages.slice(-4);
      recentText = lastFew.map(m => m.innerText || '').join('\n').trim();
      
      // If phone wasn't in header, try finding it in recent chat text
      if (!phone) {
        const textMatch = recentText.match(/(?:(?:\+8801|8801)|01)[3-9]\d{8}/);
        if (textMatch) phone = textMatch[0];
      }
    }

    return {
      phone,
      customerName,
      recentText,
      records: [],
      metrics: {}
    };
  }

  // Collect active context based on current platform
  function syncActiveContext() {
    currentPlatform = detectPlatform();
    if (currentPlatform === 'wordpress') {
      const data = gatherWordPressContext();
      activeContext = {
        platform: 'wordpress',
        records: data.records,
        metrics: data.metrics,
        phone: '',
        customerName: '',
        recentText: ''
      };
    } else if (currentPlatform === 'pathao') {
      const data = gatherPathaoContext();
      activeContext = {
        platform: 'pathao',
        records: data.records,
        metrics: data.metrics,
        phone: '',
        customerName: '',
        recentText: ''
      };
    } else if (currentPlatform === 'whatsapp') {
      const data = gatherWhatsAppContext();
      activeContext = {
        platform: 'whatsapp',
        records: [],
        metrics: {},
        phone: data.phone,
        customerName: data.customerName,
        recentText: data.recentText
      };
    } else {
      const data = gatherGenericTableContext();
      activeContext = {
        platform: data.totalCount > 0 ? 'generic_table' : currentPlatform,
        records: data.records,
        metrics: data.metrics,
        phone: '',
        customerName: '',
        recentText: ''
      };
    }
    updateContextBanner();
    updateChipsBar();
  }

  // Official DEEN Brand Logo URL
  function getOfficialDeenLogoUrl() {
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
      try {
        return chrome.runtime.getURL('icons/deen_logo.png');
      } catch (e) {}
    }
    return 'icons/deen_logo.png';
  }

  // Draggable Trigger Engine with Boundary Constraints & Storage Persistence
  function initDraggableTrigger(trigger, widget) {
    if (!trigger || typeof trigger.addEventListener !== 'function') return null;

    let isPointerDown = false;
    let hasDragged = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    // Restore saved position if available
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('deen_floating_trigger_pos');
        if (saved) {
          const pos = JSON.parse(saved);
          if (typeof pos.x === 'number' && typeof pos.y === 'number') {
            const maxX = Math.max(10, (window.innerWidth || 1200) - (trigger.offsetWidth || 130) - 10);
            const maxY = Math.max(10, (window.innerHeight || 800) - (trigger.offsetHeight || 44) - 10);
            const clampedX = Math.max(10, Math.min(maxX, pos.x));
            const clampedY = Math.max(10, Math.min(maxY, pos.y));
            if (trigger.style) {
              trigger.style.left = `${clampedX}px`;
              trigger.style.top = `${clampedY}px`;
              trigger.style.right = 'auto';
              trigger.style.bottom = 'auto';
            }
            if (typeof trigger.setAttribute === 'function') {
              trigger.setAttribute('data-dragged', 'true');
            }
          }
        }
      }
    } catch (e) {}

    function onPointerDown(e) {
      if (e.type === 'mousedown' && e.button !== 0) return;
      isPointerDown = true;
      hasDragged = false;

      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      startX = clientX;
      startY = clientY;

      const rect = trigger.getBoundingClientRect ? trigger.getBoundingClientRect() : { left: 0, top: 0 };
      initialLeft = rect.left;
      initialTop = rect.top;

      if (trigger.style) {
        trigger.style.left = `${initialLeft}px`;
        trigger.style.top = `${initialTop}px`;
        trigger.style.right = 'auto';
        trigger.style.bottom = 'auto';
      }
    }

    function onPointerMove(e) {
      if (!isPointerDown) return;

      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const deltaX = clientX - startX;
      const deltaY = clientY - startY;

      // 5px threshold distinguishes click from intentional drag
      if (!hasDragged && Math.hypot(deltaX, deltaY) > 5) {
        hasDragged = true;
        if (trigger.classList && typeof trigger.classList.add === 'function') {
          trigger.classList.add('deen-is-dragging');
        }
        if (typeof document !== 'undefined' && document.body && document.body.style) {
          document.body.style.userSelect = 'none';
        }
      }

      if (hasDragged) {
        if (e.cancelable && typeof e.preventDefault === 'function') {
          e.preventDefault();
        }
        const width = trigger.offsetWidth || 130;
        const height = trigger.offsetHeight || 44;
        const maxX = Math.max(10, (window.innerWidth || 1200) - width - 10);
        const maxY = Math.max(10, (window.innerHeight || 800) - height - 10);

        const currentX = Math.max(10, Math.min(maxX, initialLeft + deltaX));
        const currentY = Math.max(10, Math.min(maxY, initialTop + deltaY));

        if (trigger.style) {
          trigger.style.left = `${currentX}px`;
          trigger.style.top = `${currentY}px`;
        }
      }
    }

    function onPointerUp() {
      if (!isPointerDown) return;
      isPointerDown = false;

      if (typeof document !== 'undefined' && document.body && document.body.style) {
        document.body.style.userSelect = '';
      }
      if (trigger.classList && typeof trigger.classList.remove === 'function') {
        trigger.classList.remove('deen-is-dragging');
      }

      if (hasDragged) {
        if (typeof trigger.setAttribute === 'function') {
          trigger.setAttribute('data-dragged', 'true');
        }
        const finalRect = trigger.getBoundingClientRect ? trigger.getBoundingClientRect() : { left: initialLeft, top: initialTop };
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('deen_floating_trigger_pos', JSON.stringify({
              x: Math.round(finalRect.left),
              y: Math.round(finalRect.top)
            }));
          }
        } catch (err) {}
      }
    }

    // Attach listeners
    trigger.addEventListener('mousedown', onPointerDown);
    trigger.addEventListener('touchstart', onPointerDown, { passive: false });

    if (typeof document !== 'undefined') {
      document.addEventListener('mousemove', onPointerMove);
      document.addEventListener('touchmove', onPointerMove, { passive: false });
      document.addEventListener('mouseup', onPointerUp);
      document.addEventListener('touchend', onPointerUp);
    }

    // Resize bounding listener
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', () => {
        if (!trigger.hasAttribute || !trigger.hasAttribute('data-dragged')) return;
        const rect = trigger.getBoundingClientRect ? trigger.getBoundingClientRect() : { left: 0, top: 0 };
        const width = trigger.offsetWidth || 130;
        const height = trigger.offsetHeight || 44;
        const maxX = Math.max(10, (window.innerWidth || 1200) - width - 10);
        const maxY = Math.max(10, (window.innerHeight || 800) - height - 10);
        const clampedX = Math.max(10, Math.min(maxX, rect.left));
        const clampedY = Math.max(10, Math.min(maxY, rect.top));
        if (trigger.style) {
          trigger.style.left = `${clampedX}px`;
          trigger.style.top = `${clampedY}px`;
        }
      });
    }

    // Disambiguate click vs drag
    trigger.addEventListener('click', (e) => {
      if (hasDragged) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        hasDragged = false;
        return;
      }
      toggleChat();
    });

    // Keyboard trigger activation
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        toggleChat();
      }
    });

    return {
      hasDragged: () => hasDragged,
      isDragging: () => isPointerDown,
      onPointerDown,
      onPointerMove,
      onPointerUp
    };
  }

  // 3. Floating Widget UI Builder
  function injectFloatingWidget() {
    if (typeof document === 'undefined') return;
    currentPlatform = detectPlatform();
    if (currentPlatform === 'unsupported') return;

    // Avoid duplicate injection
    if (document.getElementById('deen-chat-widget')) return;

    // Tag body with current platform
    document.body.setAttribute('data-deen-platform', currentPlatform);

    // Create Launcher Trigger with Authentic Circular DEEN Brand Logo
    const trigger = document.createElement('div');
    trigger.id = 'deen-chat-trigger';
    trigger.title = 'DEEN Assistant AI Copilot (Drag to reposition)';
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('tabindex', '0');
    trigger.setAttribute('aria-label', 'DEEN Assistant AI Copilot');
    trigger.innerHTML = `
      <div class="deen-chat-trigger-avatar-wrap">
        <img src="${getOfficialDeenLogoUrl()}" class="deen-chat-trigger-avatar" alt="DEEN AI" />
        <div class="deen-chat-trigger-pulse"></div>
      </div>
      <span class="deen-chat-trigger-label">DEEN AI</span>
      <span class="deen-chat-trigger-badge" id="deen-chat-badge">0</span>
    `;
    document.body.appendChild(trigger);

    // Create Chatbox Window
    const widget = document.createElement('div');
    widget.id = 'deen-chat-widget';
    widget.className = 'deen-chat-widget deen-chat-hidden';
    widget.innerHTML = `
      <!-- Header -->
      <div class="deen-chat-header">
        <div class="deen-chat-header-brand">
          <img src="${getOfficialDeenLogoUrl()}" class="deen-chat-header-avatar" alt="DEEN AI" />
          <div class="deen-chat-title-group">
            <div class="deen-chat-title">
              <span>DEEN Assistant AI</span>
            </div>
            <span class="deen-chat-platform-badge" id="deen-chat-platform-badge">${currentPlatform}</span>
          </div>
        </div>
        <div class="deen-chat-header-actions">
          <button class="deen-chat-hdr-btn" id="deen-chat-btn-refresh" title="Rescan Page Data">🔄</button>
          <button class="deen-chat-hdr-btn" id="deen-chat-btn-clear" title="Clear Chat History">🗑️</button>
          <button class="deen-chat-hdr-btn deen-chat-hdr-btn-close" id="deen-chat-btn-close" title="Minimize / Close">✕</button>
        </div>
      </div>

      <!-- Telemetry Context Bar -->
      <div class="deen-chat-context-bar" id="deen-chat-context-bar">
        <div class="deen-chat-context-left">
          <span class="deen-chat-context-dot">●</span>
          <span id="deen-chat-context-text">Scanning page data...</span>
        </div>
        <span class="deen-chat-context-sync-tag" id="deen-chat-context-resync">Sync</span>
      </div>

      <!-- Dynamic Context Chips Bar -->
      <div class="deen-chat-chips-bar" id="deen-chat-chips-bar"></div>

      <!-- Chat Messages Stream -->
      <div class="deen-chat-stream" id="deen-chat-stream"></div>

      <!-- Typing Indicator -->
      <div class="deen-chat-typing deen-hidden" id="deen-chat-typing">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="deen-typing-label">DEEN AI is analyzing...</span>
      </div>

      <!-- Input Bar -->
      <div class="deen-chat-input-bar">
        <textarea id="deen-chat-input" placeholder="Ask about orders, COD, notes, or Banglish queries..." rows="1"></textarea>
        <button class="deen-chat-send-btn" id="deen-chat-send-btn" title="Send (Enter)">➤</button>
      </div>
    `;
    document.body.appendChild(widget);

    // Initialize Draggable Behavior on Launcher Trigger
    initDraggableTrigger(trigger, widget);

    const closeBtn = widget.querySelector('#deen-chat-btn-close');
    if (closeBtn) closeBtn.addEventListener('click', closeChat);

    const refreshBtn = widget.querySelector('#deen-chat-btn-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        syncActiveContext();
        appendAssistantMessage('🔄 **Page Telemetry Resynced!** Ready for your queries.');
      });
    }

    const resyncLink = widget.querySelector('#deen-chat-context-resync');
    if (resyncLink) resyncLink.addEventListener('click', syncActiveContext);

    const clearBtn = widget.querySelector('#deen-chat-btn-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (typeof window.DeenAssistant !== 'undefined' && window.DeenAssistant.clearChatHistory) {
          await window.DeenAssistant.clearChatHistory();
        }
        const stream = document.getElementById('deen-chat-stream');
        if (stream) stream.innerHTML = '';
        sendWelcomeGreeting();
      });
    }

    const sendBtn = widget.querySelector('#deen-chat-send-btn');
    const inputArea = widget.querySelector('#deen-chat-input');

    if (sendBtn) sendBtn.addEventListener('click', handleUserSend);
    if (inputArea) {
      inputArea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleUserSend();
        }
      });

      // Auto-grow textarea
      inputArea.addEventListener('input', () => {
        inputArea.style.height = 'auto';
        inputArea.style.height = Math.min(inputArea.scrollHeight, 100) + 'px';
      });
    }

    // Initial context sync & welcome
    syncActiveContext();
    loadPreviousHistory();

    // Listen for Escape key to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isChatOpen) {
        closeChat();
      }
    });
  }

  // 4. Update UI Components
  function updateContextBanner() {
    const textEl = document.getElementById('deen-chat-context-text');
    const badgeEl = document.getElementById('deen-chat-badge');
    const platformBadge = document.getElementById('deen-chat-platform-badge');
    if (platformBadge) platformBadge.textContent = currentPlatform.toUpperCase();

    if (currentPlatform === 'wordpress') {
      const count = activeContext.records.length;
      const cod = (activeContext.metrics.totalCOD || 0).toLocaleString();
      if (textEl) textEl.textContent = `🛒 ${count} Orders on page • ৳${cod} COD`;
      if (badgeEl) badgeEl.textContent = count;
    } else if (currentPlatform === 'pathao') {
      const count = activeContext.records.length;
      const cod = (activeContext.metrics.totalCOD || 0).toLocaleString();
      const ndr = activeContext.metrics.ndrCount || 0;
      if (textEl) {
        textEl.textContent = ndr > 0
          ? `🚚 ${count} Parcels • 🚨 ${ndr} Failed Attempt${ndr > 1 ? 's' : ''} • ৳${cod} COD`
          : `🚚 ${count} Parcels loaded • ৳${cod} COD`;
      }
      if (badgeEl) badgeEl.textContent = ndr > 0 ? `🚨 ${ndr}` : count;
    } else if (currentPlatform === 'whatsapp') {
      const label = activeContext.phone || activeContext.customerName || 'Active Conversation';
      if (textEl) textEl.textContent = `💬 WhatsApp: ${label}`;
      if (badgeEl) badgeEl.textContent = activeContext.phone ? '1' : '●';
    }
  }

  function updateChipsBar() {
    const chipsBar = document.getElementById('deen-chat-chips-bar');
    if (!chipsBar) return;

    let chips = [];
    if (currentPlatform === 'wordpress') {
      chips = [
        { label: '📊 Executive Report', query: 'Generate a full executive report with core financial metrics, visual portfolio breakdown, and operational risk radar.' },
        { label: '📈 Visual Chart', query: 'Show me a visual chart breakdown of revenue and volume across districts.' },
        { label: '🔍 Run SQL Query', query: 'SELECT district, COUNT(*) as orders, SUM(cod) as revenue FROM orders GROUP BY district ORDER BY revenue DESC;' },
        { label: '💰 COD Breakdown', query: 'What is the total cash on delivery amount to collect from these orders?' },
        { label: '⚠️ Risk Radar', query: 'Identify high-risk orders with low delivery rates or outside Dhaka delivery.' },
        { label: '📝 Note Check', query: 'Analyze customer notes on this page for special delivery instructions.' }
      ];
    } else if (currentPlatform === 'pathao') {
      chips = [
        { label: '💰 Uncollected COD', query: 'What is the total uncollected COD amount and how many parcels are unpaid?' },
        { label: '📦 Unpaid Parcels', query: 'List all unpaid parcels with their amounts.' },
        { label: '🚚 In-Transit Status', query: 'Show delivery performance: how many parcels are delivered vs cancelled vs in-transit?' },
        { label: '📈 Net Revenue', query: 'What is the net revenue after deducting courier delivery charges?' }
      ];
      if (activeContext.metrics.ndrCount > 0) {
        chips.unshift({
          label: `🚨 Rescue ${activeContext.metrics.ndrCount} NDR`,
          query: `Identify all ${activeContext.metrics.ndrCount} failed delivery parcels and generate immediate WhatsApp rescue messages with reasons and phone numbers.`
        });
      }
    } else if (currentPlatform === 'whatsapp') {
      const phone = activeContext.phone;
      chips = [
        { label: '🛡️ Check Rating', query: `Check courier delivery success rate and fraud history for customer ${phone || 'in this chat'}` },
        { label: '💰 ৳90 Advance Fee', query: `Generate polite WhatsApp advance delivery charge message of ৳90 for ${phone || 'this customer'}` },
        { label: '✅ Confirm Order', query: `Generate order confirmation message with details for ${phone || 'this customer'}` },
        { label: '⚠️ Note & Risk Check', query: `Analyze recent customer message for return risk: ${activeContext.recentText || 'Customer asked: dekhe nibo'}` }
      ];
    }

    chipsBar.innerHTML = chips.map((c, i) => `
      <div class="deen-chat-chip" data-index="${i}">${c.label}</div>
    `).join('');

    // Attach chip clicks
    chipsBar.querySelectorAll('.deen-chat-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-index'), 10);
        if (chips[idx]) {
          executeUserPrompt(chips[idx].query);
        }
      });
    });
  }

  // 5. Chat History & Greeting
  async function loadPreviousHistory() {
    const stream = document.getElementById('deen-chat-stream');
    if (!stream) return;

    if (typeof window.DeenAssistant !== 'undefined' && window.DeenAssistant.loadChatHistory) {
      try {
        const history = await window.DeenAssistant.loadChatHistory();
        if (Array.isArray(history) && history.length > 0) {
          stream.innerHTML = '';
          for (const msg of history.slice(-20)) {
            if (msg.role === 'user') {
              appendUserMessage(msg.content, false);
            } else {
              appendAssistantMessage(msg.content, msg.source, false);
            }
          }
          scrollStreamToBottom();
          return;
        }
      } catch (e) {}
    }
    sendWelcomeGreeting();
  }

  function sendWelcomeGreeting() {
    let contextHint = '';
    if (currentPlatform === 'wordpress') {
      contextHint = `I have loaded **${activeContext.records.length} WooCommerce orders** from this page. You can ask for COD audits, high-risk flags, or district distributions.`;
    } else if (currentPlatform === 'pathao') {
      contextHint = `I am synced with **${activeContext.records.length} Pathao parcels**. Ask me about uncollected COD, unpaid consignments, or net revenue.`;
    } else if (currentPlatform === 'whatsapp') {
      contextHint = `I am connected to your active WhatsApp chat${activeContext.phone ? ` with **${activeContext.phone}**` : ''}. Ask me to check courier risk, generate ৳90 advance fee requests, or interpret Banglish customer notes!`;
    }

    const greeting = `### 🤖 Assalamu Alaikum! I am DEEN Assistant
Your AI Executive Logistics Copilot for **DEEN Commerce**.

${contextHint}

💡 *Click any quick prompt chip above or type your question below.*`;

    appendAssistantMessage(greeting, 'system', false);
  }

  // 6. Messaging Functions
  function appendUserMessage(text, save = true) {
    const stream = document.getElementById('deen-chat-stream');
    if (!stream) return;

    const div = document.createElement('div');
    div.className = 'deen-chat-msg user';
    div.innerHTML = `
      <div class="deen-chat-bubble">${renderMarkdownToHTML(text)}</div>
      <div class="deen-chat-meta">You • Just now</div>
    `;
    stream.appendChild(div);
    scrollStreamToBottom();

    if (save && typeof window.DeenAssistant !== 'undefined' && window.DeenAssistant.saveChatMessage) {
      window.DeenAssistant.saveChatMessage({
        role: 'user',
        content: text,
        timestamp: Date.now()
      });
    }
  }

  function appendAssistantMessage(text, source = 'deen_ai', save = true) {
    const stream = document.getElementById('deen-chat-stream');
    if (!stream) return;

    const div = document.createElement('div');
    div.className = 'deen-chat-msg assistant';

    // Check if message contains a WhatsApp draft to provide 1-click insert
    const isWADraft = /আসসালামু\s*আলাইকুম|অগ্রিম|ডেলিভারি\s*চার্জ|wa\.me/i.test(text);

    div.innerHTML = `
      <div class="deen-chat-bubble">
        ${renderMarkdownToHTML(text)}
        <div class="deen-chat-actions">
          <button class="deen-chat-act-btn deen-chat-act-copy" title="Copy Message Text">📋 Copy</button>
          ${currentPlatform === 'whatsapp' && isWADraft ? `
            <button class="deen-chat-act-btn wa-insert deen-chat-act-insert" title="Insert directly into WhatsApp input box">✉️ Insert in WhatsApp</button>
          ` : ''}
        </div>
      </div>
      <div class="deen-chat-meta">
        <span>🤖 DEEN Assistant</span>
        <span>•</span>
        <span>${escapeSourceTag(source)}</span>
      </div>
    `;

    // Attach copy button
    const copyBtn = div.querySelector('.deen-chat-act-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(text);
        copyBtn.textContent = '✅ Copied!';
        setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 2000);
      });
    }

    // Attach WhatsApp insert button
    const insertBtn = div.querySelector('.deen-chat-act-insert');
    if (insertBtn) {
      insertBtn.addEventListener('click', () => {
        insertTextIntoWhatsAppInput(cleanWhatsAppMessageForInput(text));
        insertBtn.textContent = '✅ Inserted!';
        setTimeout(() => { insertBtn.textContent = '✉️ Insert in WhatsApp'; }, 2500);
      });
    }

    stream.appendChild(div);
    scrollStreamToBottom();

    if (save && typeof window.DeenAssistant !== 'undefined' && window.DeenAssistant.saveChatMessage) {
      window.DeenAssistant.saveChatMessage({
        role: 'assistant',
        content: text,
        source: source,
        timestamp: Date.now()
      });
    }
  }

  function cleanWhatsAppMessageForInput(text) {
    // Extract actual message if enclosed in markdown quotes or code
    let cleaned = text.replace(/###\s*[^\n]+\n/g, '');
    const blockMatch = text.match(/```(?:\w+)?\n([\s\S]*?)```/);
    if (blockMatch) return blockMatch[1].trim();

    const quoteMatch = text.match(/(?:>|")(আসসালামু[\s\S]+?)(?:"|<|\n\n)/);
    if (quoteMatch) return quoteMatch[1].trim();

    return text.trim();
  }

  function insertTextIntoWhatsAppInput(text) {
    if (typeof document === 'undefined') return;
    const input = document.querySelector('#main footer div[contenteditable="true"]') ||
                  document.querySelector('footer div[contenteditable="true"]');
    if (!input) {
      navigator.clipboard.writeText(text);
      alert('Could not find active WhatsApp input box. Copied text to clipboard instead!');
      return;
    }

    input.focus();
    try {
      document.execCommand('insertText', false, text);
    } catch (e) {
      input.innerText = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function escapeSourceTag(source) {
    if (!source) return 'Deterministic Engine';
    if (source.includes('gemini')) return '⚡ Google Gemini';
    if (source.includes('openai')) return '🧠 OpenAI GPT';
    if (source.includes('groq')) return '⚡ Groq Llama';
    if (source === 'system') return 'System';
    return 'Zero-Cost Heuristic';
  }

  function scrollStreamToBottom() {
    const stream = document.getElementById('deen-chat-stream');
    if (stream) {
      setTimeout(() => { stream.scrollTop = stream.scrollHeight; }, 50);
    }
  }

  function setTyping(isTyping) {
    const typing = document.getElementById('deen-chat-typing');
    if (typing) {
      if (isTyping) typing.classList.remove('deen-hidden');
      else typing.classList.add('deen-hidden');
    }
    scrollStreamToBottom();
  }

  // 7. Core Execution Pipeline
  async function executeUserPrompt(query) {
    if (!query || !query.trim()) return;
    const cleanQuery = query.trim();

    appendUserMessage(cleanQuery, true);
    setTyping(true);

    try {
      syncActiveContext();

      if (typeof window.DeenAssistant !== 'undefined' && window.DeenAssistant.generateDeenAssistantReply) {
        const response = await window.DeenAssistant.generateDeenAssistantReply({
          query: cleanQuery,
          records: activeContext.records,
          metrics: activeContext.metrics,
          phone: activeContext.phone,
          note: activeContext.recentText
        });
        setTyping(false);
        appendAssistantMessage(response.answer, response.source || 'deen_ai', true);
      } else {
        setTyping(false);
        appendAssistantMessage(`⚠️ DEEN Assistant core engine is loading. Please try again in a moment.`, 'system', false);
      }
    } catch (err) {
      setTyping(false);
      appendAssistantMessage(`❌ **Error processing query**: ${err.message}`, 'error', false);
    }
  }

  function handleUserSend() {
    const input = document.getElementById('deen-chat-input');
    if (!input) return;
    const text = input.value;
    input.value = '';
    input.style.height = 'auto';
    executeUserPrompt(text);
  }

  // 8. Public Control API
  function openChat() {
    const widget = document.getElementById('deen-chat-widget');
    const trigger = document.getElementById('deen-chat-trigger');
    if (widget) {
      syncActiveContext();
      if (trigger && (trigger.hasAttribute('data-dragged') || (trigger.style && trigger.style.left && trigger.style.left !== 'auto'))) {
        const rect = trigger.getBoundingClientRect ? trigger.getBoundingClientRect() : null;
        if (rect && typeof rect.left === 'number') {
          const widgetWidth = 390;
          const widgetHeight = 540;
          const winWidth = (typeof window !== 'undefined' ? window.innerWidth : 1200) || 1200;
          const winHeight = (typeof window !== 'undefined' ? window.innerHeight : 800) || 800;

          let left = rect.right + 12;
          if (left + widgetWidth > winWidth - 12) {
            left = Math.max(12, rect.left - widgetWidth - 12);
          }
          let top = rect.bottom - widgetHeight;
          if (top < 12) top = Math.max(12, rect.top);
          if (top + widgetHeight > winHeight - 12) {
            top = Math.max(12, winHeight - widgetHeight - 12);
          }

          if (widget.style) {
            widget.style.left = `${Math.round(left)}px`;
            widget.style.top = `${Math.round(top)}px`;
            widget.style.right = 'auto';
            widget.style.bottom = 'auto';
          }
        }
      }
      widget.classList.remove('deen-chat-hidden');
      isChatOpen = true;
      const input = document.getElementById('deen-chat-input');
      if (input) setTimeout(() => input.focus(), 150);
    }
  }

  function closeChat() {
    const widget = document.getElementById('deen-chat-widget');
    if (widget) {
      widget.classList.add('deen-chat-hidden');
      isChatOpen = false;
    }
  }

  function toggleChat() {
    if (isChatOpen) closeChat();
    else openChat();
  }

  function openChatWithPrompt(prompt) {
    openChat();
    if (prompt) {
      executeUserPrompt(prompt);
    }
  }

  // 9. Auto-initialization
  function init() {
    if (!isExtensionValid()) return;
    const platform = detectPlatform();
    if (platform === 'unsupported') return;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectFloatingWidget);
    } else {
      injectFloatingWidget();
    }
  }

  // Self-boot in browser environment
  if (typeof window !== 'undefined') {
    init();
  }

  return {
    detectPlatform,
    getPlatformContext: () => currentPlatform,
    syncActiveContext,
    injectFloatingWidget,
    openChat,
    closeChat,
    toggleChat,
    openChatWithPrompt,
    executeUserPrompt,
    gatherWordPressContext,
    gatherPathaoContext,
    gatherWhatsAppContext,
    gatherGenericTableContext,
    cleanWhatsAppMessageForInput,
    renderMarkdownToHTML,
    getOfficialDeenLogoUrl,
    initDraggableTrigger
  };
});
