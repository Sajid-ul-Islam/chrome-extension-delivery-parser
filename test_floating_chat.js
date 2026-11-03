/**
 * Automated Test Suite: Floating AI Assistant Chatbox
 * Validates deen-floating-chat.js across WordPress, Pathao, and WhatsApp Web.
 */

const assert = require('assert');

// Mock browser globals for testing
function setupMockDOM(url = 'https://deencommerce.com/wp-admin/edit.php?post_type=shop_order') {
  const parsedUrl = new URL(url);

  const localStore = {};
  global.localStorage = {
    getItem: (k) => localStore[k] || null,
    setItem: (k, v) => { localStore[k] = String(v); },
    removeItem: (k) => { delete localStore[k]; },
    clear: () => { Object.keys(localStore).forEach(k => delete localStore[k]); }
  };

  const docListeners = {};
  global.window = {
    innerWidth: 1280,
    innerHeight: 800,
    location: {
      href: url,
      hostname: parsedUrl.hostname,
      pathname: parsedUrl.pathname
    },
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  global.document = {
    readyState: 'complete',
    location: global.window.location,
    body: {
      classList: {
        contains: (cls) => cls === 'wp-admin' && url.includes('/wp-admin')
      },
      style: {},
      setAttribute: () => {},
      appendChild: () => {}
    },
    createElement: (tag) => {
      const attrs = {};
      const listeners = {};
      const el = {
        tagName: tag.toUpperCase(),
        id: '',
        className: '',
        innerHTML: '',
        innerText: '',
        style: {},
        offsetWidth: 130,
        offsetHeight: 44,
        classList: {
          classes: new Set(),
          add: (c) => el.classList.classes.add(c),
          remove: (c) => el.classList.classes.delete(c),
          contains: (c) => el.classList.classes.has(c)
        },
        setAttribute: (k, v) => { attrs[k] = String(v); },
        getAttribute: (k) => attrs[k] || null,
        hasAttribute: (k) => Boolean(attrs[k]),
        removeAttribute: (k) => { delete attrs[k]; },
        getBoundingClientRect: () => ({
          left: el.style.left ? parseFloat(el.style.left) : 100,
          top: el.style.top ? parseFloat(el.style.top) : 100,
          right: (el.style.left ? parseFloat(el.style.left) : 100) + 130,
          bottom: (el.style.top ? parseFloat(el.style.top) : 100) + 44,
          width: 130,
          height: 44
        }),
        querySelector: (sel) => {
          if (sel && sel.startsWith('#')) {
            const id = sel.slice(1);
            if (el.id === id) return el;
            return {
              id,
              classList: {
                classes: new Set(),
                add: () => {},
                remove: () => {},
                contains: () => false
              },
              addEventListener: () => {},
              removeEventListener: () => {}
            };
          }
          return null;
        },
        querySelectorAll: () => [],
        addEventListener: (evt, fn) => {
          listeners[evt] = listeners[evt] || [];
          listeners[evt].push(fn);
        },
        removeEventListener: (evt, fn) => {
          if (listeners[evt]) {
            listeners[evt] = listeners[evt].filter(f => f !== fn);
          }
        },
        dispatchEvent: (evt) => {
          const type = typeof evt === 'string' ? evt : evt.type;
          if (listeners[type]) {
            listeners[type].forEach(fn => fn(evt));
          }
        },
        _listeners: listeners
      };
      return el;
    },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (evt, fn) => {
      docListeners[evt] = docListeners[evt] || [];
      docListeners[evt].push(fn);
    },
    removeEventListener: () => {},
    _listeners: docListeners
  };

  global.chrome = {
    runtime: {
      id: 'mock-ext-id',
      getURL: (p) => 'chrome-extension://mock-ext-id/' + p
    }
  };

  // Mock DeenAssistant
  const DeenAssistant = require('./deen-assistant.js');
  global.window.DeenAssistant = DeenAssistant;
}

console.log('🧪 Starting DEEN Floating Chatbox Automated Test Suite...\n');

// 1. Platform Detection
{
  setupMockDOM('https://deencommerce.com/wp-admin/edit.php?post_type=shop_order');
  delete require.cache[require.resolve('./deen-floating-chat.js')];
  const floatingChat = require('./deen-floating-chat.js');
  
  assert.strictEqual(floatingChat.detectPlatform(), 'wordpress', 'Failed to detect WordPress platform');
  console.log('✅ Test 1: WordPress Admin URL correctly identified as "wordpress"');
}

{
  setupMockDOM('https://merchant.pathao.com/courier/orders');
  delete require.cache[require.resolve('./deen-floating-chat.js')];
  const floatingChat = require('./deen-floating-chat.js');

  assert.strictEqual(floatingChat.detectPlatform(), 'pathao', 'Failed to detect Pathao platform');
  console.log('✅ Test 2: Pathao Merchant URL correctly identified as "pathao"');
}

{
  setupMockDOM('https://web.whatsapp.com/');
  delete require.cache[require.resolve('./deen-floating-chat.js')];
  const floatingChat = require('./deen-floating-chat.js');

  assert.strictEqual(floatingChat.detectPlatform(), 'whatsapp', 'Failed to detect WhatsApp Web platform');
  console.log('✅ Test 3: WhatsApp Web URL correctly identified as "whatsapp"');
}

{
  setupMockDOM('https://example.com/');
  delete require.cache[require.resolve('./deen-floating-chat.js')];
  const floatingChat = require('./deen-floating-chat.js');

  assert.strictEqual(floatingChat.detectPlatform(), 'unsupported', 'Should reject non-target domains');
  console.log('✅ Test 4: General websites correctly marked as "unsupported" (no floating clutter)');
}

// 2. WordPress Context Gathering
{
  setupMockDOM('https://deencommerce.com/wp-admin/edit.php?post_type=shop_order');
  
  // Mock WooCommerce table rows
  document.querySelectorAll = (selector) => {
    if (selector.includes('#the-list tr')) {
      return [
        {
          id: 'order-19045',
          innerText: 'Order #19045 Tanvir Hossain 01712345678 ৳1,450 processing Outside Dhaka',
          querySelector: (sel) => {
            if (sel.includes('.order_title') || sel.includes('.customer_user')) {
              return { textContent: 'Tanvir Hossain' };
            }
            if (sel.includes('.order_status')) {
              return { textContent: 'Processing' };
            }
            return null;
          }
        },
        {
          id: 'order-19046',
          innerText: 'Order #19046 Farhana Akter 01898765432 ৳2,600 completed Inside Dhaka',
          querySelector: (sel) => {
            if (sel.includes('.order_title') || sel.includes('.customer_user')) {
              return { textContent: 'Farhana Akter' };
            }
            if (sel.includes('.order_status')) {
              return { textContent: 'Completed' };
            }
            return null;
          }
        }
      ];
    }
    return [];
  };

  delete require.cache[require.resolve('./deen-floating-chat.js')];
  const floatingChat = require('./deen-floating-chat.js');
  const wpCtx = floatingChat.gatherWordPressContext();

  assert.strictEqual(wpCtx.records.length, 2, 'Should extract 2 orders from mock WooCommerce DOM');
  assert.strictEqual(wpCtx.records[0].orderId, '19045', 'Order ID should match 19045');
  assert.strictEqual(wpCtx.records[0].phone, '01712345678', 'Phone should match 01712345678');
  assert.strictEqual(wpCtx.metrics.totalCOD, 4050, 'Total COD should sum to 1450 + 2600 = 4050');
  console.log('✅ Test 5: WordPress context extractor successfully parses DOM orders & COD sums');
}

// 3. Pathao Context Gathering
{
  setupMockDOM('https://merchant.pathao.com/courier/orders');
  
  document.querySelectorAll = (selector) => {
    if (selector.includes('table tbody tr')) {
      return [
        { innerText: 'DH123456AB Kazi Morshed 01715485035 1500.00 Delivered paid' },
        { innerText: 'DH123457XY Nazmul Hasan 01912345678 2200.00 In Transit unpaid' }
      ];
    }
    return [];
  };

  delete require.cache[require.resolve('./deen-floating-chat.js')];
  const floatingChat = require('./deen-floating-chat.js');
  const pathaoCtx = floatingChat.gatherPathaoContext();

  assert.strictEqual(pathaoCtx.records.length, 2, 'Should extract 2 parcels from mock Pathao DOM');
  assert.strictEqual(pathaoCtx.records[0].consignmentId, 'DH123456AB', 'CID should match DH123456AB');
  assert.strictEqual(pathaoCtx.records[1].isPaid, false, 'Second parcel should be unpaid');
  assert.strictEqual(pathaoCtx.metrics.paidCount, 1, 'Paid count should be 1');
  assert.strictEqual(pathaoCtx.metrics.unpaidCount, 1, 'Unpaid count should be 1');
  assert.strictEqual(pathaoCtx.metrics.totalCOD, 3700, 'Total COD should be 1500 + 2200 = 3700');
  console.log('✅ Test 6: Pathao context extractor successfully parses consignment IDs, paid status & COD');
}

// 4. WhatsApp Context Gathering
{
  setupMockDOM('https://web.whatsapp.com/');

  document.querySelector = (sel) => {
    if (sel.includes('#main header')) {
      return {
        innerText: 'Mst. Shirin Akter +8801715485035 last seen today at 2:45 PM',
        querySelector: (subSel) => {
          if (subSel.includes('chat-title')) {
            return { innerText: 'Mst. Shirin Akter', getAttribute: () => 'Mst. Shirin Akter' };
          }
          return null;
        }
      };
    }
    return null;
  };

  document.querySelectorAll = (sel) => {
    if (sel.includes('.message-in')) {
      return [
        { innerText: 'Product ki kal pabo? dekhe nibo kintu' }
      ];
    }
    return [];
  };

  delete require.cache[require.resolve('./deen-floating-chat.js')];
  const floatingChat = require('./deen-floating-chat.js');
  const waCtx = floatingChat.gatherWhatsAppContext();

  assert.strictEqual(waCtx.phone, '+8801715485035', 'Should extract active phone from header');
  assert.strictEqual(waCtx.customerName, 'Mst. Shirin Akter', 'Should extract customer name');
  assert.ok(waCtx.recentText.includes('dekhe nibo'), 'Should extract recent customer message for note analysis');
  console.log('✅ Test 7: WhatsApp context extractor successfully extracts active contact & recent customer messages');
}

// 5. Markdown Formatter & WhatsApp Text Cleaner
{
  delete require.cache[require.resolve('./deen-floating-chat.js')];
  const floatingChat = require('./deen-floating-chat.js');

  const markdown = '### 🤖 AI Summary\n**Paid Orders**: 12\n- ৳15,400 COD\n`01715485035`';
  const html = floatingChat.renderMarkdownToHTML(markdown);

  assert.ok(html.includes('<h4>🤖 AI Summary</h4>'), 'Header should be converted');
  assert.ok(html.includes('<strong>Paid Orders</strong>'), 'Bold should be converted');
  assert.ok(html.includes('<code>01715485035</code>'), 'Code should be converted');
  console.log('✅ Test 8: Markdown to HTML formatter safely renders headers, bold, and code');

  const rawAssistantReply = '### 💬 WhatsApp Template\n```\nআসসালামু আলাইকুম! আপনার অর্ডারটি নিশ্চিত করতে অনুগ্রহ করে ৳৯০ অগ্রিম প্রদান করুন।\n```\nClick send to confirm.';
  const cleaned = floatingChat.cleanWhatsAppMessageForInput(rawAssistantReply);
  assert.strictEqual(cleaned, 'আসসালামু আলাইকুম! আপনার অর্ডারটি নিশ্চিত করতে অনুগ্রহ করে ৳৯০ অগ্রিম প্রদান করুন।', 'Should strip code fences and markdown headers for clean WhatsApp input insertion');
  console.log('✅ Test 9: WhatsApp message cleaner extracts pristine Bengali message text for 1-click input insertion');
}

// 6. UI Toggle and Control API
{
  setupMockDOM('https://deencommerce.com/wp-admin/edit.php?post_type=shop_order');
  
  const mockWidget = {
    id: 'deen-chat-widget',
    classList: {
      classes: new Set(['deen-chat-widget', 'deen-chat-hidden']),
      add: function(c) { this.classes.add(c); },
      remove: function(c) { this.classes.delete(c); },
      contains: function(c) { return this.classes.has(c); }
    }
  };

  document.getElementById = (id) => {
    if (id === 'deen-chat-widget') return mockWidget;
    return null;
  };

  delete require.cache[require.resolve('./deen-floating-chat.js')];
  const floatingChat = require('./deen-floating-chat.js');

  floatingChat.openChat();
  assert.strictEqual(mockWidget.classList.contains('deen-chat-hidden'), false, 'openChat should remove deen-chat-hidden');

  floatingChat.closeChat();
  assert.strictEqual(mockWidget.classList.contains('deen-chat-hidden'), true, 'closeChat should add deen-chat-hidden');

  floatingChat.toggleChat();
  assert.strictEqual(mockWidget.classList.contains('deen-chat-hidden'), false, 'toggleChat should reopen chat');
  console.log('✅ Test 10: Public API (openChat, closeChat, toggleChat) controls visibility state accurately');
}

// 7. Official Circular Brand Icon Verification
{
  setupMockDOM('https://deencommerce.com/wp-admin/edit.php?post_type=shop_order');
  delete require.cache[require.resolve('./deen-floating-chat.js')];
  const floatingChat = require('./deen-floating-chat.js');

  const logoUrl = floatingChat.getOfficialDeenLogoUrl();
  assert.ok(logoUrl.includes('deen_logo.png'), 'Logo URL must link to authentic deen_logo.png asset');

  let injectedTrigger = null;
  let injectedWidget = null;
  document.body.appendChild = (el) => {
    if (el.id === 'deen-chat-trigger') injectedTrigger = el;
    if (el.id === 'deen-chat-widget') injectedWidget = el;
  };

  floatingChat.injectFloatingWidget();

  assert.ok(injectedTrigger, 'Trigger element must be injected');
  assert.ok(injectedTrigger.innerHTML.includes('deen-chat-trigger-avatar'), 'Trigger must render official circular avatar image');
  assert.ok(injectedTrigger.innerHTML.includes('deen_logo.png'), 'Trigger avatar must point to official DEEN brand logo');
  assert.ok(injectedTrigger.innerHTML.includes('deen-chat-trigger-pulse'), 'Trigger must include pulse status indicator');

  assert.ok(injectedWidget, 'Chatbox widget must be injected');
  assert.ok(injectedWidget.innerHTML.includes('deen-chat-header-avatar'), 'Chatbox header must render official circular avatar');
  assert.ok(injectedWidget.innerHTML.includes('deen_logo.png'), 'Header avatar must point to official DEEN brand logo');

  console.log('✅ Test 11: Official circular DEEN brand icon rendered in trigger button and widget header');
}

// 8. Draggable Trigger Engine & Coordinate Persistence
{
  setupMockDOM('https://deencommerce.com/wp-admin/edit.php?post_type=shop_order');
  delete require.cache[require.resolve('./deen-floating-chat.js')];
  const floatingChat = require('./deen-floating-chat.js');

  const trigger = document.createElement('div');
  trigger.id = 'deen-chat-trigger';
  trigger.offsetWidth = 130;
  trigger.offsetHeight = 44;
  trigger.style = { left: '100px', top: '100px' };

  const widget = document.createElement('div');
  widget.id = 'deen-chat-widget';

  const dragEngine = floatingChat.initDraggableTrigger(trigger, widget);
  assert.ok(dragEngine, 'Draggable engine must initialize successfully');

  // Verify pointer down
  dragEngine.onPointerDown({ type: 'mousedown', button: 0, clientX: 200, clientY: 200 });
  assert.strictEqual(dragEngine.isDragging(), true, 'isDragging should be true after pointer down');
  assert.strictEqual(dragEngine.hasDragged(), false, 'hasDragged should initially be false');

  // Small movement (<= 5px threshold) should not trigger drag mode
  dragEngine.onPointerMove({ clientX: 202, clientY: 202, cancelable: true });
  assert.strictEqual(dragEngine.hasDragged(), false, 'Move under 5px threshold must not trigger drag mode (click preservation)');

  // Large movement (> 5px threshold) should initiate dragging
  dragEngine.onPointerMove({ clientX: 300, clientY: 350, cancelable: true });
  assert.strictEqual(dragEngine.hasDragged(), true, 'Move beyond 5px threshold must engage active dragging');
  assert.ok(trigger.classList.contains('deen-is-dragging'), 'Trigger must have .deen-is-dragging class during movement');

  // Finish drag
  dragEngine.onPointerUp();
  assert.strictEqual(dragEngine.isDragging(), false, 'isDragging should be false after pointer up');
  assert.strictEqual(trigger.classList.contains('deen-is-dragging'), false, 'deen-is-dragging class must be removed');
  assert.strictEqual(trigger.hasAttribute('data-dragged'), true, 'data-dragged attribute must be marked');

  // Verify coordinates saved to localStorage
  const savedPosStr = localStorage.getItem('deen_floating_trigger_pos');
  assert.ok(savedPosStr, 'Dropped coordinates must be persisted in localStorage');
  const savedPos = JSON.parse(savedPosStr);
  assert.ok(typeof savedPos.x === 'number' && typeof savedPos.y === 'number', 'Saved coordinates must be valid numbers');

  console.log('✅ Test 12: Draggable trigger engine smoothly tracks movement, suppresses inadvertent clicks, and persists position');
}

// 9. Pathao Non-Delivery Report (NDR) Context & Dynamic Rescue Chips
{
  setupMockDOM('https://merchant.pathao.com/courier/orders');

  document.querySelectorAll = (selector) => {
    if (selector.includes('table tbody tr') || selector.includes('.ant-table-tbody tr')) {
      return [
        { innerText: 'DH100001AB Tanvir Islam 01711223344 ৳1500 Delivered paid' },
        { innerText: 'DH100002CD Fahim Ahmed 01822334455 ৳2200 Delivery Attempt Failed: Customer Unreachable' }
      ];
    }
    return [];
  };

  delete require.cache[require.resolve('./deen-floating-chat.js')];
  const floatingChat = require('./deen-floating-chat.js');
  const pathaoCtx = floatingChat.gatherPathaoContext();

  assert.strictEqual(pathaoCtx.records.length, 2, 'Should extract 2 parcels');
  assert.strictEqual(pathaoCtx.metrics.ndrCount, 1, 'Should detect 1 NDR failed delivery parcel');
  assert.strictEqual(pathaoCtx.records[1].isNDR, true, 'Second parcel must be flagged as NDR');

  console.log('✅ Test 13: Pathao NDR failed attempts detected and dynamic telemetry context updated');
}

console.log('\n======================================================');
console.log('🎉 ALL 13 FLOATING CHATBOX TESTS PASSED 100%!');
console.log('======================================================\n');
