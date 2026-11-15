/**
 * DEEN Delivery Parser - DEEN AI Assistant Intelligence Core
 * Ported & adapted from DEEN Commerce Sales-Analysis Intelligence Engine.
 * 
 * Capabilities:
 * 1. In-memory deterministic analytics engine (instant zero-latency answers for KPIs,
 *    revenue, unpaid orders, district distributions, customer fraud risks).
 * 2. Natural language customer note & WhatsApp message interpreter (Banglish, Bengali, English).
 * 3. Bring-Your-Own-Key (BYOK) multi-provider AI completions (Google Gemini, OpenAI, Groq).
 * 4. Contextual synthesizer formatting live delivery records into structured LLM prompts.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DeenAssistant = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  const _memoryStore = new Map();
  const STORAGE_KEY_BYOK = 'deen_assistant_byok_config_v1';
  const STORAGE_KEY_HISTORY = 'deen_assistant_chat_history_v1';
  const MAX_HISTORY_MESSAGES = 60;

  const DEFAULT_BYOK_CONFIG = {
    provider: 'gemini', // 'gemini' | 'openai' | 'groq'
    apiKey: '',
    model: 'gemini-2.5-flash',
    isActive: true,
    status: 'UNCONFIGURED'
  };

  const COPILOT_SYSTEM_PROMPT = `You are "DEEN Assistant", the Executive AI Intelligence Assistant for DEEN Commerce (D2C Apparel Brand, Bangladesh).
You have real-time access to the store's courier delivery telemetry, active WooCommerce orders, Pathao Hermes delivery ratios, Steadfast fraud ratings, and territory distribution across all 64 districts of Bangladesh.

Core Principles:
1. Always ground your answers in the provided data context (numbers, currency in ৳ BDT, exact order counts, integer ratios).
2. Reporting & Courier Standard:
   - When asked about deliveries, revenue, or orders, report exact operational metrics: Total Parcels, Paid vs Unpaid counts, Total COD (৳), Delivery Charges, and Net Revenue.
   - Proactively highlight customer courier risk (e.g. low delivery ratios < 70% or uncollected COD).
3. Territory & Logistics:
   - Inside Dhaka standard delivery charge is ৳50. Outside Dhaka standard delivery is ৳90.
   - Free shipping applies ONLY when subtotal >= ৳2500. Otherwise, delivery fees must be added to COD so merchant is never underpaid.
   - Note when distant linehaul districts (e.g. rural upazilas) carry higher cancellation risk.
4. Customer Notes & WhatsApp Messages:
   - Understand English, standard Bengali (বাংলা), and informal phonetic Banglish (e.g. "dheke nibo", "size na mille change hobe?", "kal dupure delivery diyen").
   - Categorize customer requirements (e.g. Office Timing, Call First, Urgent, Bracketing Size Risk).
5. Format your responses with crisp markdown: bolding, bullet points, clean summary tables, and actionable operational advice for the merchant.
6. Support both English and Bengali natively based on user query language.`;

  /**
   * Safe storage helper (works across chrome.storage.local, localStorage, or memory)
   */
  /**
   * Safe storage helper (works across chrome.storage.local, localStorage, or memory)
   */
  async function getStorageItem(key) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return new Promise((resolve) => {
        chrome.storage.local.get([key], (res) => resolve(res ? res[key] : null));
      });
    }
    if (typeof localStorage !== 'undefined') {
      try {
        const val = localStorage.getItem(key);
        return val ? JSON.parse(val) : null;
      } catch (e) {
        return null;
      }
    }
    return _memoryStore.has(key) ? _memoryStore.get(key) : null;
  }

  async function setStorageItem(key, value) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: value }, () => resolve());
      });
    }
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return;
      } catch (e) {}
    }
    _memoryStore.set(key, value);
  }

  /**
   * Load BYOK configuration
   */
  async function loadBYOKConfig() {
    const saved = await getStorageItem(STORAGE_KEY_BYOK);
    if (!saved) return { ...DEFAULT_BYOK_CONFIG };
    return { ...DEFAULT_BYOK_CONFIG, ...saved };
  }

  /**
   * Save BYOK configuration
   */
  async function saveBYOKConfig(config) {
    const current = await loadBYOKConfig();
    const updated = {
      ...current,
      ...config,
      provider: config.provider || current.provider,
      apiKey: (config.apiKey !== undefined ? config.apiKey : current.apiKey).trim(),
      model: config.model || current.model
    };
    if (updated.apiKey) {
      updated.status = 'CONNECTED';
    } else {
      updated.status = 'UNCONFIGURED';
    }
    await setStorageItem(STORAGE_KEY_BYOK, updated);
    return updated;
  }

  /**
   * Test BYOK API Connection
   */
  async function testBYOKConnection(config) {
    const cfg = config || (await loadBYOKConfig());
    const apiKey = (cfg.apiKey || '').trim();
    if (!apiKey) {
      return { success: false, error: 'Please enter an API key.' };
    }

    try {
      if (cfg.provider === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model || 'gemini-2.5-flash')}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Ping test. Reply with: OK' }] }]
          })
        });
        const data = await resp.json();
        if (!resp.ok) {
          return { success: false, error: (data.error && data.error.message) || `HTTP ${resp.status}` };
        }
        return { success: true, message: 'Google Gemini connected successfully!' };
      } else if (cfg.provider === 'openai') {
        const resp = await fetch('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          return { success: false, error: (errData.error && errData.error.message) || `HTTP ${resp.status}` };
        }
        return { success: true, message: 'OpenAI connected successfully!' };
      } else if (cfg.provider === 'groq') {
        const resp = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          return { success: false, error: (errData.error && errData.error.message) || `HTTP ${resp.status}` };
        }
        return { success: true, message: 'Groq Cloud connected successfully!' };
      }
      return { success: false, error: `Unsupported provider: ${cfg.provider}` };
    } catch (err) {
      return { success: false, error: err.message || 'Connection failed' };
    }
  }

  /**
   * In-Memory Deterministic Analytical Engine:
   * Provides immediate, mathematically exact answers for numbers, revenue,
   * statuses, risks, and territory distributions without needing an LLM roundtrip.
   */
  function evaluateDeterministicQuery(query, contextOrRecords, maybeMetrics) {
    if (!query || typeof query !== 'string') return null;
    const q = query.toLowerCase().trim();

    let records = [];
    let metrics = null;

    if (Array.isArray(contextOrRecords)) {
      records = contextOrRecords;
      metrics = maybeMetrics;
    } else if (contextOrRecords && typeof contextOrRecords === 'object') {
      records = Array.isArray(contextOrRecords.records) ? contextOrRecords.records : [];
      metrics = contextOrRecords.metrics || null;
    }

    if (!metrics) {
      metrics = {
        totalParcels: records.length,
        paidCount: records.filter(r => ((r['Payment Status'] || r['Payment'] || '').toLowerCase() === 'paid')).length,
        unpaidCount: records.filter(r => ((r['Payment Status'] || r['Payment'] || '').toLowerCase() === 'unpaid')).length,
        totalCOD: records.reduce((s, r) => s + (Number(r['COD Amount'] || r['Amount']) || 0), 0),
        totalCharge: records.reduce((s, r) => s + (Number(r['Charge']) || 0), 0),
        totalDiscount: records.reduce((s, r) => s + (Number(r['Discount']) || 0), 0),
        netRevenue: 0
      };
      metrics.netRevenue = metrics.totalCOD - metrics.totalCharge + metrics.totalDiscount;

    } else {
      metrics = {
        totalParcels: Number(metrics.totalParcels) || records.length,
        paidCount: Number(metrics.paidCount) || 0,
        unpaidCount: Number(metrics.unpaidCount) || 0,
        totalCOD: Number(metrics.totalCOD) || 0,
        totalCharge: Number(metrics.totalCharge) || 0,
        totalDiscount: Number(metrics.totalDiscount) || 0,
        netRevenue: Number(metrics.netRevenue) || 0
      };
    }

    function makeResult(ans) {
      return {
        answer: ans,
        source: 'deterministic_engine',
        toString() { return this.answer; },
        includes(sub) { return this.answer.includes(sub); }
      };
    }

    // 1. Total parcels / Orders count
    if (/(how many.*(parcels?|orders?|deliveries)|total.*(parcels?|orders?|deliveries)|count.*(parcels?|orders?|deliveries)|parcels? count|orders? count)/i.test(q)) {
      return makeResult(`### 📦 Total Parcels Overview\n- **Total Parcels Extracted**: **${metrics.totalParcels}**\n- **Paid Deliveries**: **${metrics.paidCount}** (${metrics.totalParcels ? Math.round((metrics.paidCount / metrics.totalParcels) * 100) : 0}%)\n- **Unpaid COD Deliveries**: **${metrics.unpaidCount}** (${metrics.totalParcels ? Math.round((metrics.unpaidCount / metrics.totalParcels) * 100) : 0}%)\n\n*All counts verified directly from active parsed table records.*`);
    }

    // 2. Paid vs Unpaid status
    if (/paid vs unpaid|paid and unpaid|unpaid orders?|unpaid deliveries|unpaid count|due|pending payment|baki/i.test(q)) {
      const unpaidList = records.filter(r => (r['Payment Status'] || r['Payment'] || '').toLowerCase() === 'unpaid');
      let preview = '';
      if (unpaidList.length > 0) {
        preview = '\n\n**Sample Unpaid Orders Requiring Settlement**:\n' +
          unpaidList.slice(0, 5).map(r => `- **Order #${r['Order ID'] || r['Consignment ID']}**: ${r['Recipient Name'] || (r['Recipient Info'] ? r['Recipient Info'].split('\n')[0] : 'Customer')} — **৳${r['COD Amount'] || r['Amount'] || 0}** [${r['Delivery Status'] || 'In Transit'}]`).join('\n');
      }
      return makeResult(`### 💳 Payment & Settlement Status\n- **Paid Deliveries**: **${metrics.paidCount} Paid**\n- **Unpaid / Pending COD**: **${metrics.unpaidCount} Unpaid**\n- **Total Cash in Pipeline**: **৳${metrics.totalCOD.toLocaleString()}**${preview}`);
    }

    // 3. Revenue, COD & Financial breakdown
    if (/revenue|cod amount|total cod|collection|cash|how much money|net revenue/i.test(q)) {
      return makeResult(`### 💰 Financial & Revenue Breakdown\n| Metric | Amount (BDT) | Description |\n| :--- | :---: | :--- |\n| **Gross COD Value** | **৳${metrics.totalCOD.toLocaleString()}** | Total cash to be collected by riders |\n| **Delivery Charges** | **৳${metrics.totalCharge.toLocaleString()}** | Courier delivery service fees |\n| **Discounts Applied** | **৳${metrics.totalDiscount.toLocaleString()}** | Store promotions or waivers |\n| **Net Realized Revenue** | **৳${metrics.netRevenue.toLocaleString()}** | Net cash flow after courier deductions |\n\n💡 **Collection Rate**: **${metrics.totalParcels ? Math.round((metrics.paidCount / metrics.totalParcels) * 100) : 0}%** paid, with **৳${metrics.totalCOD.toLocaleString()}** active in the COD pipeline.`);
    }

    // 4. District & Territory Ratio
    if (/district|dhaka|outside dhaka|territory|division|location|area/i.test(q)) {
      const districtCounts = {};
      let insideDhaka = 0;
      let outsideDhaka = 0;

      records.forEach(r => {
        const addr = (r['Address'] || r['Recipient Info'] || '').toLowerCase();
        if (/\b(?:dhaka|dacca|ঢাকা)\b/.test(addr)) {
          insideDhaka++;
          districtCounts['Dhaka'] = (districtCounts['Dhaka'] || 0) + 1;
        } else {
          outsideDhaka++;
          const distMatch = addr.match(/\b(chattogram|sylhet|cumilla|rajshahi|khulna|barishal|rangpur|gazipur|narayanganj|jashore|bogura|mymensingh)\b/i);
          const distName = distMatch ? distMatch[1].charAt(0).toUpperCase() + distMatch[1].slice(1).toLowerCase() : 'Other Outside Dhaka';
          districtCounts[distMatch ? distName : 'Other Districts'] = (districtCounts[distMatch ? distName : 'Other Districts'] || 0) + 1;
        }
      });

      const topDistricts = Object.entries(districtCounts).sort((a, b) => b[1] - a[1]);
      let tableRows = topDistricts.map(([d, c]) => `| **${d}** | ${c} | ${records.length ? Math.round((c / records.length) * 100) : 0}% |`).join('\n');

      return makeResult(`### 📍 Territory & District Distribution\n- **Inside Dhaka (৳50 Standard Delivery)**: **${insideDhaka}** orders (${records.length ? Math.round((insideDhaka / records.length) * 100) : 0}%)\n- **Outside Dhaka (৳90 Standard Delivery)**: **${outsideDhaka}** orders (${records.length ? Math.round((outsideDhaka / records.length) * 100) : 0}%)\n\n| District | Orders | Share |\n| :--- | :---: | :---: |\n${tableRows}\n\n💡 *Outside Dhaka orders represent **${records.length ? Math.round((outsideDhaka / records.length) * 100) : 0}%** of parcel volume. Ensure advance delivery charges (৳90) are verified for new customers.*`);
    }

    // 5. High-Risk Orders & Customer Fraud Risk
    if (/risk|fraud|return rate|rto|scam|warning|danger|high risk/i.test(q)) {
      const highRiskOrders = records.filter(r => {
        const cod = Number(r['COD Amount'] || r['Amount']) || 0;
        const status = (r['Delivery Status'] || '').toLowerCase();
        return cod >= 3000 || status.includes('return') || status.includes('cancel') || status.includes('hold');
      });

      let preview = '';
      if (highRiskOrders.length > 0) {
        preview = '\n\n**Orders Flagged for Review**:\n' +
          highRiskOrders.slice(0, 5).map(r => `- **Order #${r['Order ID'] || r['Consignment ID']}**: ${r['Recipient Name'] || (r['Recipient Info'] ? r['Recipient Info'].split('\n')[0] : 'Customer')} — COD: **৳${r['COD Amount'] || r['Amount']}** (${r['Delivery Status'] || 'Unpaid'})`).join('\n');
      }

      return makeResult(`### 🛡️ Risk & Fraud Assessment\n- **Orders Monitored**: **${records.length}**\n- **High-Value COD Orders (≥ ৳3,000)**: **${records.filter(r => (Number(r['COD Amount'] || r['Amount']) || 0) >= 3000).length}**\n- **Returned / Cancelled Parcels**: **${records.filter(r => (r['Delivery Status'] || '').toLowerCase().includes('return') || (r['Delivery Status'] || '').toLowerCase().includes('cancel')).length}**${preview}\n\n💡 **DEEN Risk Recommendation**: For any order exceeding ৳2,500 or customers with < 75% courier delivery ratio, send a 1-click **bKash/Nagad ৳90 Advance Fee** request via WhatsApp before parcel handover.`);
    }

    // 6. Bengali / Banglish Greeting
    if (/(hi|hello|hey|salam|সালাম|assalamu|কেমন আছেন|ki khobor|help|ai|kemon achen)/i.test(q)) {
      return makeResult(`**আসসালামু আলাইকুম! আমি DEEN Assistant 🤖**\n\nআমি DEEN Commerce এর রিয়েল-টাইম ডেলিভারি ডেটা, কাস্টমার মেসেজ এবং সেলস অ্যানালিটিক্স সহকারী।\n\nআপনি আমাকে জিজ্ঞেস করতে পারেন:\n- 📊 **"আজকের মোট ডেলিভারি ও রেভিনিউ কত?"**\n- 💳 **"কতগুলো পার্সেল আনপেইড আছে?"**\n- 🛡️ **"কোন অর্ডারগুলোতে রিটার্ন বা ফ্রড রিস্ক বেশি?"**\n- 📍 **"ঢাকা ও ঢাকার বাইরের অর্ডারের অনুপাত কত?"**\n- 💬 **কাস্টমার মেসেজ বা নোট পেস্ট করে অ্যানালাইসিস করতে বলুন!**`);
    }

    return null;
  }

  /**
   * Comprehensive WhatsApp & CRM Customer Conversation Intelligence Engine
   * Extracts messages, timeline, phone numbers, entities (Order ID, CID, bKash, items, addresses),
   * identifies customer intent across 9 critical CRM domains,
   * formulates actionable operational instructions for the CRM executive,
   * and crafts tailored, high-converting WhatsApp quick replies ready for 1-click injection.
   */
  function analyzeWhatsAppConversation(conversationData, options = {}) {
    let messages = [];
    let phone = '';
    let customerName = '';
    let rawText = '';

    if (Array.isArray(conversationData)) {
      messages = conversationData;
    } else if (conversationData && typeof conversationData === 'object') {
      messages = Array.isArray(conversationData.messages) ? conversationData.messages : [];
      phone = conversationData.phone || '';
      customerName = conversationData.customerName || '';
      rawText = conversationData.recentText || conversationData.rawText || '';
    } else if (typeof conversationData === 'string') {
      rawText = conversationData.trim();
    }

    // If no structured messages provided but rawText exists, synthesize message objects
    if (messages.length === 0 && rawText) {
      const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      messages = lines.map(line => ({
        direction: /^(?:you|agent|deen|we):/i.test(line) ? 'out' : 'in',
        text: line.replace(/^(?:you|agent|deen|we|customer):/i, '').trim(),
        sender: /^(?:you|agent|deen|we):/i.test(line) ? 'Agent' : 'Customer',
        timestamp: ''
      }));
    }

    // Aggregate text
    const fullText = messages.map(m => m.text).join(' \n ') || rawText;
    const lowerFull = fullText.toLowerCase();

    // Identify latest customer message
    const incomingMessages = messages.filter(m => m.direction === 'in');
    const outgoingMessages = messages.filter(m => m.direction === 'out');
    const latestIncoming = incomingMessages.length > 0 ? incomingMessages[incomingMessages.length - 1] : null;
    const latestOutgoing = outgoingMessages.length > 0 ? outgoingMessages[outgoingMessages.length - 1] : null;
    const latestMessage = messages.length > 0 ? messages[messages.length - 1] : null;

    const latestCustomerText = (latestIncoming && latestIncoming.text) ? latestIncoming.text.trim() : (rawText || '');
    const lowerLatest = latestCustomerText.toLowerCase();

    const isCustomerWaiting = Boolean(latestMessage && latestMessage.direction === 'in');

    // 1. Entity Extraction
    const entities = {
      phone: null,
      orderId: null,
      consignmentId: null,
      district: null,
      address: null,
      trxId: null,
      amount: null,
      size: null,
      product: null
    };

    // Phone detection
    if (phone) {
      entities.phone = phone;
    } else {
      const pm = fullText.match(/(?:(?:\+?880)|880|0)?(1[3-9]\d{8})\b/);
      if (pm) entities.phone = '0' + pm[1];
    }

    // Order ID detection (#19046, Order 18264, etc.)
    const ordMatch = fullText.match(/(?:order|ord|অর্ডার|id)[\s#:]*([0-9]{4,7})\b/i) || fullText.match(/\b#([0-9]{4,7})\b/);
    if (ordMatch) entities.orderId = ordMatch[1];

    // Consignment ID detection (Pathao CID like DH123456...)
    const cidMatch = fullText.match(/\b([A-Z]{2}\d{6}[A-Z0-9]+)\b/i);
    if (cidMatch) entities.consignmentId = cidMatch[1];

    // bKash / Nagad Transaction ID
    const trxMatch = fullText.match(/(?:trx|trxid|trnx|ট্রানজেকশন)[\s:#]*([A-Za-z0-9]{8,12})\b/i) ||
                     fullText.match(/\b([A-Z0-9]{8,10})\b/);
    if (trxMatch) entities.trxId = trxMatch[1];

    // Price / Amount
    const amtMatch = fullText.match(/(?:৳|BDT|TK|টাকা|taka)[\s:]*(\d[\d,]*(?:\.\d+)?)/i) || 
                     fullText.match(/\b(\d[\d,]*(?:\.\d+)?)\s*(?:৳|BDT|TK|টাকা|tk|taka)\b/i);
    if (amtMatch) entities.amount = parseFloat(amtMatch[1].replace(/,/g, '')) || null;

    // Size detection (e.g. Size 34, 32, XL, L, XXL)
    const sizeMatch = fullText.match(/\b(?:size|সাইজ)[\s:]*([0-9]{2}|[SMLX]{1,3}|XXL|XXXL)\b/i) ||
                      fullText.match(/\b([0-9]{2})\s*(?:size|সাইজ)\b/i) ||
                      fullText.match(/\b(28|30|32|34|36|38|40)\b/);
    if (sizeMatch) entities.size = sizeMatch[1];

    // Product detection
    const prodMatch = fullText.match(/\b(jeans|pant|shirt|t-shirt|polo|denim|জিন্স|প্যান্ট|শার্ট|পোলো|টি-শার্ট)\b/i);
    if (prodMatch) entities.product = prodMatch[1];

    // Address & District detection
    const distMatch = fullText.match(/\b(dhaka|chittagong|chattogram|sylhet|rajshahi|khulna|barishal|rangpur|mymensingh|cumilla|comilla|gazipur|narayanganj|jashore|jessore|bhaluka|savar|mirpur|uttara|dhanmondi)\b/i);
    if (distMatch) entities.district = distMatch[1];

    // 2. Intent Classification
    let intentCode = 'GENERAL_GREETING';
    let intentLabel = '💬 General Inquiry & Assistance';
    let urgency = 'NORMAL';
    let crmSummary = 'Customer reached out with a general message.';
    let recommendedActions = [];
    let suggestedReply = '';
    let alternativeReply = '';

    const displayName = customerName ? customerName.replace(/^[~+\d\s-]+/, '').trim() : '';
    const salutation = displayName ? ` ${displayName} ভাইয়া/আপু` : '';

    // Check Intent Patterns
    // A. NDR / Reschedule / Missed Rider Call
    if (/(?:call\s*(?:dei|pay|dhori)\s*nai|phone\s*off\s*chilo|shite\s*chilo\s*na|miscall|abar\s*pathan|reschedule|ফেরত\s*গেছে|রিসিভ\s*করতে\s*পারি\s*নি|আবার\s*পাঠান|রাইডার\s*কল\s*দেয়নি)/i.test(lowerLatest) ||
        /(?:call\s*(?:dei|pay|dhori)\s*nai|miscall|reschedule)/i.test(lowerFull)) {
      intentCode = 'NDR_RESCUE';
      intentLabel = '🚨 Delivery Failed / NDR Rescue';
      urgency = 'HIGH';
      crmSummary = 'Customer missed the delivery rider\'s call or reported an unreachable delivery attempt.';
      recommendedActions = [
        'Confirm customer\'s available time window for next-day re-delivery.',
        'Obtain an alternative reachable phone number.',
        'Request immediate re-dispatch in Pathao Courier portal to prevent return charges.'
      ];
      suggestedReply = `আসসালামু আলাইকুম${salutation}! DEEN Commerce থেকে যোগাযোগ করছি। ডেলিভারি রাইডারের সাথে যোগাযোগের সমস্যার জন্য আমরা আন্তরিকভাবে দুঃখিত। আমরা আপনার পার্সেলটি কাল পুনরায় ডেলিভারির জন্য ব্যবস্থা করে দিচ্ছি। দয়া করে আপনার একটি বিকল্প সচল মোবাইল নম্বর এবং সুবিধাজনক সময়টি নিশ্চিত করবেন কি?`;
      alternativeReply = `আসসালামু আলাইকুম! কাল ইনশাআল্লাহ পার্সেলটি আবার পাঠানো হবে। রাইডারের কল রিসিভ করতে পারবেন এমন একটি বিকল্প নম্বর থাকলে আমাদের জানান।`;
    }
    // B. Size Exchange / Inspection / Bracketing Risk ("dekhe nibo", "size na mille")
    else if ((/(?:size\s*na\s*mille|size\s*change|product\s*change|change\s*hobe|exchange|ferot|dheke\s*nibo|dekhe\s*nibo|দেখে\s*নিব|নাহলে\s*ফেরত|সাইজ\s*না\s*মিললে|এক্সচেঞ্জ|ফিটিং\s*(?:সমস্যা|problem|issue)|বড়\s*হয়েছে|ছোট\s*হয়েছে)/i.test(lowerLatest) ||
             /(?:size\s*na\s*mille|size\s*change|change\s*hobe|dekhe\s*nibo|dheke\s*nibo)/i.test(lowerFull)) &&
             !/(?:address\s*change|thikana\s*change|ঠিকানা\s*পরিবর্তন|notun\s*address|notun\s*thikana)/i.test(lowerLatest)) {
      intentCode = 'SIZE_EXCHANGE_RETURN';
      intentLabel = '🔄 Size Exchange & Inspection Risk';
      urgency = 'HIGH';
      crmSummary = 'Customer is concerned about product sizing, fitting, inspection at delivery, or exchange policy.';
      recommendedActions = [
        `Verify customer's exact waist/chest measurements${entities.size ? ` (requested size: ${entities.size})` : ''} before packing.`,
        'Reassure customer regarding DEEN Commerce 7-day hassle-free size exchange policy.',
        'Instruct delivery rider that customer is permitted to inspect the package upon arrival.'
      ];
      suggestedReply = `আসসালামু আলাইকুম${salutation}! DEEN Commerce থেকে যোগাযোগ করছি। সাইজ নিয়ে একদম চিন্তা করবেন না—পণ্য হাতে পেয়ে সাইজে সমস্যা হলে আপনি ৩ থেকে ৭ দিনের মধ্যে খুব সহজেই এক্সচেঞ্জ করে নিতে পারবেন${entities.size ? ` (আপনার সাইজ ${entities.size} নোট করে নিয়েছি)` : ''}। ডেলিভারির সময় রাইডারের সামনে দেখে নেওয়ার সুযোগ রয়েছে। আপনার সুবিধার জন্য আর কোনো তথ্য যাচাই করতে চান?`;
      alternativeReply = `আসসালামু আলাইকুম! আমাদের ৩-৭ দিনের সহজ এক্সচেঞ্জ পলিসি রয়েছে। ডেলিভারির সময় দেখে নিতে পারবেন, সাইজে কোনো সমস্যা হলে আমরা দ্রুত সাইজ পরিবর্তন করে দেব।`;
    }
    // C. Delivery Tracking / Delay Inquiry
    else if (/(?:kobe\s*pabo|delivery\s*kobe|parcel\s*kothay|track|late\s*keno|koto\s*din\s*lagbe|কখন\s*পাব|ডেলিভারি\s*দেননি|রিসিভ\s*করিনি|কুরিয়ার|কবে\s*আসবে|পার্সেল\s*কোথায়|পাচ্ছি\s*না|status)/i.test(lowerLatest) ||
             /(?:kobe\s*pabo|delivery\s*kobe|parcel\s*kothay)/i.test(lowerFull)) {
      intentCode = 'TRACKING_DELAY';
      intentLabel = '🚚 Delivery Tracking & Delay Inquiry';
      urgency = 'HIGH';
      crmSummary = 'Customer is asking about shipment delivery status, delay, or expected arrival time.';
      recommendedActions = [
        `Check Pathao consignment status${entities.consignmentId ? ` for CID ${entities.consignmentId}` : ''}${entities.orderId ? ` (Order #${entities.orderId})` : ''}.`,
        'Confirm if delivery is Inside Dhaka (24-48 hrs) or Outside Dhaka (48-72 hrs).',
        'Contact sorting hub or assigned delivery rider to escalate priority dispatch.'
      ];
      suggestedReply = `আসসালামু আলাইকুম${salutation}! DEEN Commerce থেকে যোগাযোগ করছি। আপনার পার্সেলটি${entities.orderId ? ` (অর্ডার #${entities.orderId})` : ''} কুরিয়ারে ডিসপ্যাচ করা হয়েছে এবং বর্তমানে ট্রানজিটে রয়েছে। ঢাকা সিটিতে সাধারণত ২৪-৪৮ ঘণ্টা এবং ঢাকার বাইরে ৪৮-৭২ ঘণ্টার মধ্যে ডেলিভারি সম্পন্ন হয়। রাইডার পৌঁছানোর পূর্বে আপনার নম্বরে কল দিয়ে জানিয়ে দেবে।`;
      alternativeReply = `আসসালামু আলাইকুম! আপনার পার্সেলটি দ্রুত ডেলিভারির জন্য কুরিয়ার হাবে তাগিদ দেওয়া হয়েছে। খুব শীঘ্রই রাইডার আপনার সাথে যোগাযোগ করবেন।`;
    }
    // D. Payment / bKash / Advance Fee Confirmation
    else if (/(?:taka\s*pathaici|bkash\s*korsi|nagad\s*korsi|trxid|advance\s*disi|টাকা\s*পাঠিয়েছি|বিকাশ\s*করেছি|লাস্ট\s*৪\s*ডিজিট|পেমেন্ট|payment|advance|paid)/i.test(lowerLatest) ||
             /(?:taka\s*pathaici|bkash\s*korsi|trxid)/i.test(lowerFull)) {
      intentCode = 'PAYMENT_ADVANCE';
      intentLabel = '💰 Payment & Advance Fee Confirmation';
      urgency = 'MEDIUM';
      crmSummary = 'Customer has sent advance delivery payment or bKash/Nagad transaction confirmation.';
      recommendedActions = [
        `Verify bKash/Nagad statement${entities.trxId ? ` for TrxID ${entities.trxId}` : ''}${entities.phone ? ` from phone ${entities.phone}` : ''}.`,
        'Deduct advance amount (৳90) from COD in WooCommerce and Pathao parcel consignment.',
        'Mark order status as "Processing / Advance Paid" and send packing queue confirmation.'
      ];
      suggestedReply = `আসসালামু আলাইকুম${salutation}! আপনার পেমেন্টটি${entities.trxId ? ` (TrxID: ${entities.trxId})` : ''} সফলভাবে পাওয়া গেছে, অনেক ধন্যবাদ! আপনার অগ্রিম ডেলিভারি চার্জ সমন্বয় করে অবশিষ্ট টাকা ক্যাশ অন ডেলিভারিতে নির্ধারণ করা হয়েছে। পার্সেলটি দ্রুততম সময়ে আপনার ঠিকানায় পাঠানো হচ্ছে।`;
      alternativeReply = `আসসালামু আলাইকুম! পেমেন্ট কনফার্ম হয়েছে। অবশিষ্ট টাকা ডেলিভারির সময় রাইডারকে ক্যাশ অন ডেলিভারিতে পরিশোধ করলেই হবে। ধন্যবাদ!`;
    }
    // E. Address & Phone Number Change
    else if (/(?:thikana\s*change|address\s*change|notun\s*number|phone\s*number\s*change|location|ঠিকানা\s*পরিবর্তন|নতুন\s*নম্বর|বাসা\s*পরিবর্তন|ডেলিভারি\s*ঠিকানা|address|thikana)/i.test(lowerLatest) &&
             /(?:change|update|পরিবর্তন|নতুন|ei\s*thikana|pathaben)/i.test(lowerLatest)) {
      intentCode = 'ADDRESS_CHANGE';
      intentLabel = '📍 Address or Phone Number Update';
      urgency = 'HIGH';
      crmSummary = 'Customer requested to update their delivery address or contact phone number.';
      recommendedActions = [
        'Normalize new address using DEEN BD address parser to prevent misrouting.',
        'Update shipping address in WooCommerce order and Pathao consignment.',
        'Confirm updated destination district and delivery timeline with customer.'
      ];
      suggestedReply = `আসসালামু আলাইকুম${salutation}! আপনার পরিবর্তিত ঠিকানা ও ফোন নম্বরটি আমরা সিস্টেমে আপডেট করে নিয়েছি। সংশোধিত ঠিকানাতেই পণ্যটি নিরাপদে পৌঁছে দেওয়া হবে। DEEN Commerce এর সাথে থাকার জন্য ধন্যবাদ!`;
      alternativeReply = `আসসালামু আলাইকুম! আপনার নতুন ঠিকানা আপডেট সম্পন্ন হয়েছে। কোনো চিন্তা করবেন না, সংশোধিত ঠিকানাতেই পার্সেল পৌঁছে যাবে।`;
    }
    // F. Order Cancellation Request
    else if (/(?:cancel|order\s*lagbe\s*na|bad\s*den|dorkar\s*nai|বাতিল|নিব\s*না|ক্যানসেল|লাগবে\s*না)/i.test(lowerLatest)) {
      intentCode = 'CANCEL_ORDER';
      intentLabel = '⚠️ Order Cancellation Request';
      urgency = 'HIGH';
      crmSummary = 'Customer is requesting to cancel their order.';
      recommendedActions = [
        'Check if parcel is already handed over to Pathao courier.',
        'If not dispatched, immediately cancel order in WooCommerce to prevent return delivery fees.',
        'If already dispatched, politely inquire about customer reason or offer alternative solution/schedule.'
      ];
      suggestedReply = `আসসালামু আলাইকুম${salutation}! আপনার অর্ডার বাতিলের বিষয়টি পেয়েছি। অর্ডারটি এখনো কুরিয়ারে না গিয়ে থাকলে আমরা তা বাতিল করে দিচ্ছি। পণ্য বা ডেলিভারি নিয়ে আপনার কোনো বিশেষ সমস্যা থাকলে আমাদের জানাতে পারেন, আমরা সর্বোচ্চ সহযোগিতার চেষ্টা করব।`;
      alternativeReply = `আসসালামু আলাইকুম! আপনার অনুরোধ অনুযায়ী অর্ডারটি বাতিল প্রসেস করা হলো। ভবিষ্যতে আপনার সেবায় পাশে থাকার সুযোগ দিলে আনন্দিত হব।`;
    }
    // G. Order Confirmation & Placement
    else if (/(?:confirm|order\s*korbo|order\s*confirm|অর্ডার\s*কনফার্ম|অর্ডার\s*প্লেস|নিতে\s*চাই|order\s*dite\s*chai|বুকিং|booking|অর্ডার\s*করব)/i.test(lowerLatest) ||
             /(?:order\s*confirm|অর্ডার\s*কনফার্ম)/i.test(lowerFull)) {
      intentCode = 'ORDER_CONFIRM';
      intentLabel = '✅ Order Confirmation & Processing';
      urgency = 'MEDIUM';
      crmSummary = 'Customer wants to confirm or finalize their order placement.';
      recommendedActions = [
        `Check courier delivery success rate for customer${entities.phone ? ` (${entities.phone})` : ''}.`,
        'Verify delivery location: Inside Dhaka (৳50) vs Outside Dhaka (৳90).',
        'If outside Dhaka or customer delivery success rate < 75%, request ৳90 advance delivery fee before dispatch.'
      ];
      suggestedReply = `আসসালামু আলাইকুম${salutation}! DEEN Commerce এ আপনার অর্ডারের জন্য আন্তরিক ধন্যবাদ। আপনার অর্ডারটি নিশ্চিত করতে দয়া করে আপনার নাম, ডেলিভারি ঠিকানা এবং সচল মোবাইল নম্বরটি পাঠিয়ে দিন। ঢাকার মধ্যে ডেলিভারি চার্জ ৫০ টাকা এবং ঢাকার বাইরে ৯০ টাকা। আপনার পছন্দের প্রোডাক্ট সাইজটিও কনফার্ম করবেন কি?`;
      alternativeReply = `আসসালামু আলাইকুম! আপনার অর্ডারটি নিশ্চিত করা হয়েছে। খুব শীঘ্রই আমাদের কুরিয়ার পার্টনারের মাধ্যমে প্রোডাক্ট আপনার ঠিকানায় পৌঁছে দেওয়া হবে।`;
    }
    // H. Product Price / Stock / Sizing Inquiry
    else if (/(?:dam\s*koto|price|koto\s*taka|size\s*hobe|available|stock\s*ache|দাম\s*কত|ফেব্রিক\s*কি|কালার|স্টক\s*আছে|কত\s*টাকা|সাইজ\s*আছে)/i.test(lowerLatest)) {
      intentCode = 'PRODUCT_INQUIRY';
      intentLabel = '🛍️ Product Details & Pricing Inquiry';
      urgency = 'NORMAL';
      crmSummary = 'Customer is inquiring about product price, fabric quality, stock availability, or sizing options.';
      recommendedActions = [
        'Provide accurate product pricing and current stock availability.',
        'Share DEEN Commerce size chart for jeans/polos.',
        'Prompt customer with easy 1-click ordering instructions.'
      ];
      suggestedReply = `আসসালামু আলাইকুম${salutation}! DEEN Commerce এর প্রিমিয়াম কালেকশনে আপনার আগ্রহের জন্য ধন্যবাদ। প্রোডাক্টটির বর্তমান দাম ও কালার ভ্যারিয়েন্ট স্টকভেদে অ্যাভেইলেবল রয়েছে। আপনার উচ্চতা বা পছন্দের সাইজটি জানালে আমরা সঠিক ফিটিং সিলেক্ট করে দিতে পারব।`;
      alternativeReply = `আসসালামু আলাইকুম! প্রোডাক্টটি স্টকে রয়েছে। অর্ডার করতে চাইলে আপনার ডেলিভারি ঠিকানা ও ফোন নম্বর শেয়ার করুন।`;
    }
    // I. General Greeting
    else {
      intentCode = 'GENERAL_GREETING';
      intentLabel = '💬 General Greeting & Support';
      urgency = 'NORMAL';
      crmSummary = 'Customer has sent a greeting or general initial message.';
      recommendedActions = [
        'Respond with warm, professional DEEN Commerce greeting.',
        'Ask how DEEN Commerce support can assist them today.'
      ];
      suggestedReply = `আসসালামু আলাইকুম${salutation}! DEEN Commerce এর কাস্টমার সাপোর্টে আপনাকে স্বাগতম। আপনাকে কীভাবে সহযোগিতা করতে পারি?`;
      alternativeReply = `আসসালামু আলাইকুম! DEEN Commerce এ স্বাগতম। আপনার অর্ডার বা কোনো প্রোডাক্ট সম্পর্কে তথ্য জানতে আমাদের বলুন।`;
    }

    return {
      phone: entities.phone,
      customerName,
      messagesCount: messages.length,
      latestCustomerText,
      latestIncoming,
      latestOutgoing,
      isCustomerWaiting,
      entities,
      intent: {
        code: intentCode,
        label: intentLabel,
        urgency,
        confidence: 0.95
      },
      crmGuidance: {
        summary: crmSummary,
        recommendedActions,
        warehouseAction: recommendedActions[0] || 'Standard processing'
      },
      suggestedReply,
      alternativeReply,
      rawText: fullText
    };
  }

  /**
   * Interprets customer notes or incoming WhatsApp messages:
   * Identifies delivery urgency, bracketing/size risk, office timing, and phone numbers.
   */
  function analyzeCustomerMessageOrNote(text) {
    if (!text || typeof text !== 'string') return null;
    const clean = text.trim();
    const lower = clean.toLowerCase();

    // Call full conversation analyzer
    const conv = analyzeWhatsAppConversation(clean);

    const analysis = {
      rawText: clean,
      category: 'GENERAL_NOTE',
      priority: conv.intent.urgency === 'HIGH' ? 'HIGH' : (conv.intent.urgency === 'MEDIUM' ? 'MEDIUM' : 'LOW'),
      tags: [],
      extractedPhone: conv.phone,
      actionItem: conv.crmGuidance.recommendedActions[0] || 'Proceed with standard fulfillment',
      // Enriched CRM intelligence
      intent: conv.intent,
      crmGuidance: conv.crmGuidance,
      suggestedReply: conv.suggestedReply,
      alternativeReply: conv.alternativeReply,
      entities: conv.entities
    };

    if (conv.phone) {
      analysis.tags.push('📱 Phone Identified: ' + conv.phone);
    }

    // Office timing note
    if (/office|অফিস|dupur|evening|bikal|sokal|time|timing|5টা|6টা/i.test(lower)) {
      analysis.category = 'OFFICE_TIMING';
      analysis.priority = 'HIGH';
      analysis.tags.push('🏢 Specific Timing Required');
      analysis.actionItem = 'Instruct Pathao rider to deliver strictly during requested office hours.';
    }

    // Call first / call before delivery
    if (/call|phone|ফোন|কল|কথা বলে|age call/i.test(lower)) {
      analysis.tags.push('📞 Call Customer First');
    }

    // Urgent / express delivery
    if (/urgent|জরুরি|fast|taratari|ajkei|emergency|আজকেই/i.test(lower)) {
      analysis.category = 'URGENT_DELIVERY';
      analysis.priority = 'HIGH';
      analysis.tags.push('⚡ Express Delivery Requested');
      analysis.actionItem = 'Mark as Urgent Express in courier portal for same-day/next-day priority.';
    }

    // Bracketing / size inspection / return threat
    if (/size|change|ferot|dheke nibo|dekhe|check|নাহলে ফেরত|মিললে/i.test(lower)) {
      analysis.category = 'SIZE_VERIFICATION';
      analysis.priority = 'HIGH';
      analysis.tags.push('⚠️ Size Inspection / Return Risk');
      analysis.actionItem = 'Call customer or send WhatsApp confirmation to verify sizing before shipping.';
    }

    analysis.phone = analysis.extractedPhone;
    analysis.flags = analysis.tags;
    analysis.hasRiskConditions = Boolean(analysis.category === 'SIZE_VERIFICATION' || analysis.tags.some(t => t.includes('Risk')));
    analysis.isUrgent = Boolean(analysis.category === 'URGENT_DELIVERY' || analysis.tags.some(t => t.includes('Express')));
    analysis.isOfficeTiming = Boolean(analysis.category === 'OFFICE_TIMING' || analysis.tags.some(t => t.includes('Timing')));
    return analysis;
  }



  /**
   * Synthesize data context for AI prompt
   */
  function synthesizeContext(records, metrics, extraContextOrPhone, maybeNote) {
    const recs = Array.isArray(records) ? records : [];
    const met = metrics || {};
    let extra = {};
    if (typeof extraContextOrPhone === 'string') {
      extra = { activePhone: extraContextOrPhone, customerNote: maybeNote || '' };
    } else if (extraContextOrPhone && typeof extraContextOrPhone === 'object') {
      extra = extraContextOrPhone;
    }

    let summaryText = `### LIVE DEEN COMMERCE OPERATIONAL DATA:\n`;
    summaryText += `- Total Extracted Parcels: ${recs.length}\n`;
    summaryText += `- Paid Deliveries: ${met.paidCount || 0}\n`;
    summaryText += `- Unpaid COD Deliveries: ${met.unpaidCount || 0}\n`;
    summaryText += `- Total COD Value: ৳${(met.totalCOD || 0).toLocaleString()}\n`;
    summaryText += `- Total Courier Charges: ৳${(met.totalCharge || 0).toLocaleString()}\n`;
    summaryText += `- Net Estimated Revenue: ৳${(met.netRevenue || 0).toLocaleString()}\n\n`;


    if (extra.customerNote) {
      summaryText += `### CUSTOMER MESSAGE / NOTE:\n"${extra.customerNote}"\n\n`;
    }
    if (extra.activePhone) {
      summaryText += `### ACTIVE CUSTOMER IN FOCUS:\n- Phone: ${extra.activePhone}\n`;
      if (extra.activeRating) {
        summaryText += `- Courier Rating: ${extra.activeRating.deliveryRate || 'N/A'}% delivery rate across ${extra.activeRating.totalParcels || 0} parcels (Risk: ${extra.activeRating.riskTier || 'NORMAL'})\n`;
      }
    }

    if (recs.length > 0) {
      summaryText += `### RECENT 8 PARCEL RECORDS:\n`;
      summaryText += `| Consignment/Order | Customer | Phone | Address | Status | COD (৳) | Payment |\n`;
      summaryText += `| :--- | :--- | :--- | :--- | :--- | :---: | :--- |\n`;
      recs.slice(0, 8).forEach(r => {
        const id = r['Order ID'] || r['Consignment ID'] || 'N/A';
        const name = (r['Recipient Name'] || 'Customer').replace(/\|/g, '');
        const phone = r['Phone'] || '-';
        const addr = (r['Address'] || '-').replace(/\|/g, ', ').slice(0, 30);
        const st = r['Delivery Status'] || '-';
        const cod = r['COD Amount'] || '0';
        const pay = r['Payment Status'] || '-';
        summaryText += `| ${id} | ${name} | ${phone} | ${addr} | ${st} | ${cod} | ${pay} |\n`;
      });
      summaryText += `\n`;
    }

    return summaryText;
  }

  /**
   * ---------------------------------------------------------------------------
   * In-Browser In-Memory SQL & Statistical Analytics Engine
   * ---------------------------------------------------------------------------
   */

  /**
   * Normalize an arbitrary order or parcel record into a standard tabular schema
   */
  function normalizeRecord(r) {
    if (!r || typeof r !== 'object') return {};
    const norm = {};

    for (const k of Object.keys(r)) {
      const cleanKey = k.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/^_+|_+$/g, '');
      norm[cleanKey] = r[k];
      norm[k] = r[k];
    }

    norm.id = String(r['Order ID'] || r['Consignment ID'] || r.orderId || r.consignmentId || r.id || '');
    norm.order_id = norm.id;
    norm.customer = String(r['Recipient Name'] || r.customerName || r.customer || (r['Recipient Info'] ? r['Recipient Info'].split('\n')[0] : '') || '');
    norm.customer_name = norm.customer;
    norm.phone = String(r['Phone'] || r.phone || (r['Recipient Info'] && r['Recipient Info'].match(/(?:(?:\+8801|8801)|01)[3-9]\d{8}/) ? r['Recipient Info'].match(/(?:(?:\+8801|8801)|01)[3-9]\d{8}/)[0] : '') || '');
    norm.status = String(r['Delivery Status'] || r.status || r['Status'] || 'In Transit');
    norm.delivery_status = norm.status;
    norm.payment = String(r['Payment Status'] || r['Payment'] || r.payment || 'Unpaid');
    norm.payment_status = norm.payment;

    const rawCod = r['COD Amount'] || r['Amount'] || r.cod || r.amount || 0;
    norm.cod = typeof rawCod === 'number' ? rawCod : (parseFloat(String(rawCod).replace(/,/g, '')) || 0);
    norm.amount = norm.cod;
    norm.cod_amount = norm.cod;

    const rawCharge = r['Charge'] || r.charge || r.deliveryFee || r.delivery_fee || 0;
    norm.charge = typeof rawCharge === 'number' ? rawCharge : (parseFloat(String(rawCharge).replace(/,/g, '')) || 0);
    norm.delivery_fee = norm.charge;

    let rawAddr = String(r['Address'] || r['Recipient Info'] || r.address || '');

    let parseBD = typeof parseBDAddress === 'function' ? parseBDAddress : null;
    let isoDetect = typeof detectDistrictFromISOCode === 'function' ? detectDistrictFromISOCode : null;
    if (!parseBD && typeof require !== 'undefined') {
      try {
        const pMod = require('./parser.js');
        if (pMod) {
          parseBD = pMod.parseBDAddress;
          isoDetect = pMod.detectDistrictFromISOCode;
        }
      } catch (e) {}
    }

    if (isoDetect && /\bBD[-_\s]?[0-6]?\d\b/i.test(rawAddr)) {
      rawAddr = rawAddr.replace(/(?:(?:State|District|Dist|Zilla|জেলা)[\s:ঃ#\-]*)?\bBD[-_\s]?([0-6]?\d)\b/gi, (match) => {
        return isoDetect(match) || match;
      });
    }
    norm.address = rawAddr;

    if (parseBD) {
      const p = parseBD(rawAddr);
      norm.district = p.district || 'Dhaka';
      norm.zone = p.zone || '';
      norm.is_outside_dhaka = p.cityType !== 'Inside Dhaka';
    } else {
      let isoDist = isoDetect ? isoDetect(rawAddr) : '';
      if (isoDist) {
        norm.district = isoDist;
        norm.is_outside_dhaka = isoDist !== 'Dhaka';
      } else if (/\b(?:dhaka|dacca|ঢাকা)\b/i.test(rawAddr)) {
        norm.district = 'Dhaka';
        norm.is_outside_dhaka = false;
      } else {
        const distMatch = rawAddr.match(/\b(chattogram|chittagong|sylhet|cumilla|comilla|rajshahi|khulna|barishal|rangpur|gazipur|narayanganj|jashore|jessore|bogura|bogra|mymensingh)\b/i);
        norm.district = distMatch ? (distMatch[1].charAt(0).toUpperCase() + distMatch[1].slice(1).toLowerCase()) : 'Outside Dhaka';
        norm.is_outside_dhaka = true;
      }
    }
    norm.city = norm.district;
    norm.net_revenue = Math.max(0, norm.cod - norm.charge);

    return norm;
  }

  /**
   * Fast In-Memory SQL Query Engine:
   * Executes SELECT ... FROM ... WHERE ... GROUP BY ... HAVING ... ORDER BY ... LIMIT ...
   * directly in the browser across active tabular records in < 2ms.
   */
  function executeSQL(sql, rawRecords = []) {
    const startTime = Date.now();
    if (!sql || typeof sql !== 'string') {
      return { success: false, error: 'Empty or invalid SQL query', rows: [], columns: [], rowCount: 0 };
    }

    const cleanSql = sql.trim().replace(/;+$/, '');
    let recordsList = [];
    if (Array.isArray(rawRecords)) {
      recordsList = rawRecords;
    } else if (rawRecords && typeof rawRecords === 'object' && Array.isArray(rawRecords.records)) {
      recordsList = rawRecords.records;
    }
    const records = recordsList.map(normalizeRecord);

    const selectMatch = cleanSql.match(/^SELECT\s+([\s\S]+?)\s+FROM\s+([a-zA-Z0-9_]+)(?:\s+WHERE\s+([\s\S]+?))?(?:\s+GROUP\s+BY\s+([\s\S]+?))?(?:\s+HAVING\s+([\s\S]+?))?(?:\s+ORDER\s+BY\s+([\s\S]+?))?(?:\s+LIMIT\s+(\d+)(?:\s+OFFSET\s+(\d+))?)?$/i);

    if (!selectMatch) {
      return { success: false, error: 'SQL syntax error: Only SELECT queries are supported', rows: [], columns: [], rowCount: 0 };
    }

    const [, rawSelect, , rawWhere, rawGroupBy, rawHaving, rawOrderBy, rawLimit, rawOffset] = selectMatch;

    // 1. Filter: WHERE clause
    let filtered = records;
    if (rawWhere && rawWhere.trim()) {
      filtered = filtered.filter(row => evaluateCondition(rawWhere.trim(), row));
    }

    // 2. Select Items & Aggregations
    const selectItems = parseSelectItems(rawSelect);
    const isAggregateQuery = selectItems.some(item => item.isAggregate) || Boolean(rawGroupBy);

    let outputRows = [];

    if (rawGroupBy && rawGroupBy.trim()) {
      const groupCols = rawGroupBy.split(',').map(s => s.trim().toLowerCase());
      const groups = new Map();

      for (const row of filtered) {
        const groupKey = groupCols.map(c => String(resolveColValue(row, c))).join('__:::__');
        if (!groups.has(groupKey)) {
          groups.set(groupKey, []);
        }
        groups.get(groupKey).push(row);
      }

      for (const [, groupRows] of groups.entries()) {
        const outRow = {};
        for (const item of selectItems) {
          if (item.isAggregate) {
            outRow[item.alias] = computeAggregate(item.fn, item.col, groupRows);
          } else {
            outRow[item.alias] = resolveColValue(groupRows[0], item.col);
          }
        }
        outputRows.push(outRow);
      }

      if (rawHaving && rawHaving.trim()) {
        outputRows = outputRows.filter(row => evaluateCondition(rawHaving.trim(), row));
      }
    } else if (isAggregateQuery) {
      const outRow = {};
      for (const item of selectItems) {
        if (item.isAggregate) {
          outRow[item.alias] = computeAggregate(item.fn, item.col, filtered);
        } else {
          outRow[item.alias] = filtered.length > 0 ? resolveColValue(filtered[0], item.col) : null;
        }
      }
      outputRows.push(outRow);
    } else {
      for (const row of filtered) {
        if (rawSelect.trim() === '*') {
          outputRows.push({ ...row });
        } else {
          const outRow = {};
          for (const item of selectItems) {
            outRow[item.alias] = resolveColValue(row, item.col);
          }
          outputRows.push(outRow);
        }
      }
    }

    // 3. Sorting: ORDER BY clause
    if (rawOrderBy && rawOrderBy.trim()) {
      const orderParts = rawOrderBy.split(',').map(p => p.trim());
      outputRows.sort((a, b) => {
        for (const part of orderParts) {
          const m = part.match(/^([a-zA-Z0-9_]+)(?:\s+(ASC|DESC))?$/i);
          if (!m) continue;
          const col = m[1].toLowerCase();
          const dir = (m[2] || 'ASC').toUpperCase() === 'DESC' ? -1 : 1;
          const valA = resolveColValue(a, col);
          const valB = resolveColValue(b, col);

          if (valA === valB) continue;
          if (typeof valA === 'number' && typeof valB === 'number') {
            return (valA - valB) * dir;
          }
          return String(valA || '').localeCompare(String(valB || '')) * dir;
        }
        return 0;
      });
    }

    // 4. Pagination: LIMIT & OFFSET
    if (rawLimit) {
      const limit = parseInt(rawLimit, 10);
      const offset = rawOffset ? parseInt(rawOffset, 10) : 0;
      outputRows = outputRows.slice(offset, offset + limit);
    }

    const columns = outputRows.length > 0 ? Object.keys(outputRows[0]) : selectItems.map(i => i.alias);

    return {
      success: true,
      sql: cleanSql,
      columns,
      rows: outputRows,
      rowCount: outputRows.length,
      executionTimeMs: Math.max(0.1, Date.now() - startTime)
    };
  }

  function parseSelectItems(selectStr) {
    const parts = selectStr.split(',').map(s => s.trim());
    const items = [];

    for (const part of parts) {
      if (part === '*') {
        items.push({ col: '*', alias: '*', isAggregate: false });
        continue;
      }

      let expr = part;
      let alias = part;
      const asMatch = part.match(/^(.+?)\s+(?:AS\s+)?([a-zA-Z0-9_]+)$/i);
      if (asMatch && !part.includes('(')) {
        expr = asMatch[1].trim();
        alias = asMatch[2].trim();
      } else if (asMatch && part.includes(')')) {
        const idx = part.lastIndexOf(')');
        const rest = part.slice(idx + 1).trim();
        const aliasMatch = rest.match(/^(?:AS\s+)?([a-zA-Z0-9_]+)$/i);
        if (aliasMatch) {
          expr = part.slice(0, idx + 1).trim();
          alias = aliasMatch[1].trim();
        }
      }

      const aggMatch = expr.match(/^(COUNT|SUM|AVG|MIN|MAX)\((.+?)\)$/i);
      if (aggMatch) {
        const fn = aggMatch[1].toUpperCase();
        const col = aggMatch[2].trim();
        if (alias === part) {
          alias = `${fn.toLowerCase()}_${col === '*' ? 'all' : col.toLowerCase()}`;
        }
        items.push({ col, alias, fn, isAggregate: true });
      } else {
        items.push({ col: expr, alias, isAggregate: false });
      }
    }

    return items;
  }

  function resolveColValue(row, colName) {
    if (!row || !colName) return undefined;
    const c = colName.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (row[colName] !== undefined) return row[colName];
    if (row[c] !== undefined) return row[c];
    for (const k of Object.keys(row)) {
      if (k.toLowerCase().replace(/[^a-z0-9_]/g, '') === c) return row[k];
    }
    return undefined;
  }

  function computeAggregate(fn, col, rows) {
    if (fn === 'COUNT') {
      if (col === '*') return rows.length;
      return rows.filter(r => resolveColValue(r, col) !== undefined && resolveColValue(r, col) !== null).length;
    }

    const nums = rows.map(r => Number(resolveColValue(r, col)) || 0);
    if (nums.length === 0) return 0;

    if (fn === 'SUM') {
      return Math.round(nums.reduce((s, n) => s + n, 0) * 100) / 100;
    }
    if (fn === 'AVG') {
      return Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 100) / 100;
    }
    if (fn === 'MIN') {
      return Math.min(...nums);
    }
    if (fn === 'MAX') {
      return Math.max(...nums);
    }
    return 0;
  }

  function evaluateCondition(condStr, row) {
    const andClauses = condStr.split(/\s+AND\s+/i);
    for (const clause of andClauses) {
      if (!evaluateSingleCondition(clause.trim(), row)) return false;
    }
    return true;
  }

  function evaluateSingleCondition(clause, row) {
    const likeMatch = clause.match(/^([a-zA-Z0-9_]+)\s+LIKE\s+['"]%?([^'"]+?)%?['"]$/i);
    if (likeMatch) {
      const val = String(resolveColValue(row, likeMatch[1]) || '').toLowerCase();
      const pattern = likeMatch[2].toLowerCase();
      return val.includes(pattern);
    }

    const inMatch = clause.match(/^([a-zA-Z0-9_]+)\s+IN\s*\(([^)]+)\)$/i);
    if (inMatch) {
      const val = String(resolveColValue(row, inMatch[1]) || '').toLowerCase();
      const allowed = inMatch[2].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '').toLowerCase());
      return allowed.includes(val);
    }

    const compMatch = clause.match(/^([a-zA-Z0-9_]+)\s*(>=|<=|!=|<>|=|>|<)\s*(.+)$/);
    if (compMatch) {
      const col = compMatch[1];
      const op = compMatch[2];
      const expected = compMatch[3].trim().replace(/^['"]|['"]$/g, '');
      const actual = resolveColValue(row, col);

      if (typeof actual === 'number' || !isNaN(Number(expected))) {
        const numAct = Number(actual) || 0;
        const numExp = Number(expected) || 0;
        if (op === '=') return numAct === numExp;
        if (op === '!=' || op === '<>') return numAct !== numExp;
        if (op === '>') return numAct > numExp;
        if (op === '>=') return numAct >= numExp;
        if (op === '<') return numAct < numExp;
        if (op === '<=') return numAct <= numExp;
      } else {
        const strAct = String(actual || '').toLowerCase();
        const strExp = String(expected || '').toLowerCase();
        if (op === '=') return strAct === strExp;
        if (op === '!=' || op === '<>') return strAct !== strExp;
      }
    }

    return true;
  }

  /**
   * Format an SQL query result into a clean markdown table
   */
  function formatSQLResultToMarkdown(result) {
    if (!result || !result.success || !Array.isArray(result.rows) || result.rows.length === 0) {
      return result && result.error ? `> ⚠️ **SQL Query Error**: ${result.error}` : `*No records matched the SQL query.*`;
    }

    const cols = result.columns;
    const header = `| ${cols.map(c => `**${c}**`).join(' | ')} |`;
    const sep = `| ${cols.map(() => ':---').join(' | ')} |`;
    const bodyRows = result.rows.map(r => {
      return `| ${cols.map(c => {
        const v = r[c];
        if (typeof v === 'number') {
          if (/revenue|cod|charge|amount|fee/i.test(c)) return `৳${v.toLocaleString()}`;
          return v.toLocaleString();
        }
        return v === null || v === undefined ? '-' : String(v);
      }).join(' | ')} |`;
    }).join('\n');

    return `### 📊 In-Browser SQL Query Result\n\`${result.sql}\`\n\n${header}\n${sep}\n${bodyRows}\n\n*⚡ Executed locally across ${result.rowCount} rows in ${result.executionTimeMs}ms.*`;
  }

  /**
   * Python/DataFrame style descriptive statistics engine
   */
  function executeDataFrameAnalysis(records = []) {
    const norm = records.map(normalizeRecord);
    const cods = norm.map(r => r.cod).filter(n => !isNaN(n));
    const charges = norm.map(r => r.charge).filter(n => !isNaN(n));
    const netRevs = norm.map(r => r.net_revenue).filter(n => !isNaN(n));

    function stats(arr) {
      if (arr.length === 0) return { count: 0, sum: 0, mean: 0, median: 0, min: 0, max: 0 };
      const sorted = [...arr].sort((a, b) => a - b);
      const sum = sorted.reduce((s, v) => s + v, 0);
      const mean = Math.round((sum / sorted.length) * 100) / 100;
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 === 0 ? Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100 : sorted[mid];
      return {
        count: sorted.length,
        sum: Math.round(sum * 100) / 100,
        mean,
        median,
        min: sorted[0],
        max: sorted[sorted.length - 1]
      };
    }

    return {
      rowCount: norm.length,
      cod: stats(cods),
      charge: stats(charges),
      netRevenue: stats(netRevs),
      paidCount: norm.filter(r => r.payment.toLowerCase() === 'paid').length,
      unpaidCount: norm.filter(r => r.payment.toLowerCase() !== 'paid').length,
      outsideDhakaCount: norm.filter(r => r.is_outside_dhaka).length,
      insideDhakaCount: norm.filter(r => !r.is_outside_dhaka).length,
      highRiskCount: norm.filter(r => r.cod >= 3000 || /return|cancel|fail|hold/i.test(r.status)).length
    };
  }

  /**
   * Safe XML escaping helper for SVG charts
   */
  function escapeXml(unsafe) {
    return String(unsafe || '').replace(/[<>&'"]/g, c => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
      }
    });
  }

  /**
   * Native SVG Chart & Infographic Renderer
   */
  function renderVisualChartSVG(config = {}) {
    const { type = 'bar', title = '', data = [], width = 480 } = config;

    if (type === 'bar' || type === 'horizontal_bar') {
      const items = data.slice(0, 7);
      const maxVal = Math.max(...items.map(d => Number(d.value) || 0), 1);
      const itemHeight = 36;
      const height = Math.max(120, items.length * itemHeight + 50);

      const bars = items.map((item, idx) => {
        const val = Number(item.value) || 0;
        const pct = Math.round((val / maxVal) * 100);
        const y = 40 + (idx * itemHeight);
        const barWidth = Math.max(6, Math.round((val / maxVal) * 260));
        const color = item.color || (idx === 0 ? '#ea580c' : (idx === 1 ? '#f59e0b' : '#38bdf8'));
        const formattedVal = item.isCurrency ? `৳${val.toLocaleString()}` : val.toLocaleString();

        return `
          <g class="deen-chart-bar-group">
            <text x="10" y="${y + 16}" fill="#94a3b8" font-size="12" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="600">${escapeXml(item.label)}</text>
            <rect x="140" y="${y + 4}" width="260" height="16" rx="8" fill="#1e293b"/>
            <rect x="140" y="${y + 4}" width="${barWidth}" height="16" rx="8" fill="${color}">
              <animate attributeName="width" from="0" to="${barWidth}" dur="0.5s" fill="freeze" />
            </rect>
            <text x="${150 + barWidth + 8}" y="${y + 16}" fill="#f8fafc" font-size="11" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="700">${formattedVal} (${item.percent || pct}%)</text>
          </g>
        `;
      }).join('');

      return `
        <div class="deen-chart-card" style="margin: 12px 0; background: #0f172a; border: 1px solid #334155; border-radius: 10px; padding: 12px; box-shadow: 0 4px 14px rgba(0,0,0,0.25);">
          <div style="font-size: 13px; font-weight: 700; color: #f8fafc; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
            <span>📈 ${escapeXml(title || 'Data Breakdown')}</span>
            <span style="font-size: 10px; color: #38bdf8; background: rgba(56,189,248,0.15); padding: 2px 6px; border-radius: 4px;">DEEN Chart Engine</span>
          </div>
          <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: auto; display: block;" xmlns="http://www.w3.org/2000/svg">
            ${bars}
          </svg>
        </div>
      `.trim();
    }

    if (type === 'donut' || type === 'pie') {
      const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0) || 1;
      const r = 54;
      const circ = 2 * Math.PI * r;
      let accumulatedOffset = 0;

      const arcs = data.map((d, i) => {
        const val = Number(d.value) || 0;
        const pct = val / total;
        const strokeDash = pct * circ;
        const offset = accumulatedOffset;
        accumulatedOffset += strokeDash;
        const color = d.color || (i === 0 ? '#10b981' : (i === 1 ? '#f59e0b' : '#38bdf8'));

        return `
          <circle cx="90" cy="90" r="${r}" fill="none" stroke="${color}" stroke-width="22"
            stroke-dasharray="${strokeDash} ${circ - strokeDash}"
            stroke-dashoffset="-${offset}"
            stroke-linecap="round"/>
        `;
      }).join('');

      const legend = data.map((d, i) => {
        const val = Number(d.value) || 0;
        const pct = Math.round((val / total) * 100);
        const color = d.color || (i === 0 ? '#10b981' : (i === 1 ? '#f59e0b' : '#38bdf8'));
        const valStr = d.isCurrency ? `৳${val.toLocaleString()}` : val.toLocaleString();
        return `
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; font-size: 11px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="width: 10px; height: 10px; border-radius: 50%; background: ${color};"></span>
              <span style="color: #94a3b8;">${escapeXml(d.label)}</span>
            </div>
            <span style="color: #f8fafc; font-weight: 700;">${valStr} (${pct}%)</span>
          </div>
        `;
      }).join('');

      return `
        <div class="deen-chart-card" style="margin: 12px 0; background: #0f172a; border: 1px solid #334155; border-radius: 10px; padding: 12px; box-shadow: 0 4px 14px rgba(0,0,0,0.25);">
          <div style="font-size: 13px; font-weight: 700; color: #f8fafc; margin-bottom: 10px;">📊 ${escapeXml(title || 'Distribution')}</div>
          <div style="display: flex; align-items: center; gap: 16px;">
            <svg width="180" height="180" viewBox="0 0 180 180" style="flex-shrink: 0;" xmlns="http://www.w3.org/2000/svg">
              <circle cx="90" cy="90" r="${r}" fill="none" stroke="#1e293b" stroke-width="22"/>
              <g transform="rotate(-90 90 90)">
                ${arcs}
              </g>
              <text x="90" y="86" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">TOTAL</text>
              <text x="90" y="104" text-anchor="middle" fill="#f8fafc" font-size="14" font-weight="700" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">${total > 999 ? '৳' + Math.round(total).toLocaleString() : total}</text>
            </svg>
            <div style="flex: 1;">
              ${legend}
            </div>
          </div>
        </div>
      `.trim();
    }

    return '';
  }

  /**
   * Autonomous C-Level Executive Report Generator
   */
  function generateExecutiveReport(contextOrRecords) {
    let records = [];
    if (Array.isArray(contextOrRecords)) {
      records = contextOrRecords;
    } else if (contextOrRecords && typeof contextOrRecords === 'object') {
      records = Array.isArray(contextOrRecords.records) ? contextOrRecords.records : [];
    }

    const norm = records.map(normalizeRecord);
    const totalParcels = records.length;
    const paidRecords = norm.filter(r => r.payment.toLowerCase() === 'paid');
    const unpaidRecords = norm.filter(r => r.payment.toLowerCase() !== 'paid');

    const totalCOD = norm.reduce((s, r) => s + r.cod, 0);
    const paidCOD = paidRecords.reduce((s, r) => s + r.cod, 0);
    const unpaidCOD = unpaidRecords.reduce((s, r) => s + r.cod, 0);

    const insideDhakaRecords = norm.filter(r => !r.is_outside_dhaka);
    const outsideDhakaRecords = norm.filter(r => r.is_outside_dhaka);

    const totalCharge = (insideDhakaRecords.length * 50) + (outsideDhakaRecords.length * 90);
    const netRevenue = Math.max(0, totalCOD - totalCharge);
    const collectionEfficiency = totalParcels > 0 ? Math.round((paidRecords.length / totalParcels) * 100) : 0;
    const avgOrderValue = totalParcels > 0 ? Math.round(totalCOD / totalParcels) : 0;

    const highRiskOrders = norm.filter(r => r.cod >= 3000 || /return|cancel|fail|hold/i.test(r.status));
    const underchargedOrders = norm.filter(r => r.cod > 0 && r.cod < 2500 && r.charge === 0);

    const distSql = executeSQL("SELECT district, COUNT(*) as orders, SUM(cod) as revenue FROM orders GROUP BY district ORDER BY revenue DESC LIMIT 5", records);
    const chartBars = (distSql.rows || []).map(r => ({
      label: r.district,
      value: r.revenue,
      isCurrency: true
    }));

    const barSvg = renderVisualChartSVG({
      type: 'bar',
      title: 'Top Districts by Revenue',
      data: chartBars
    });

    const donutSvg = renderVisualChartSVG({
      type: 'donut',
      title: 'COD Settlement Distribution',
      data: [
        { label: 'Paid Deliveries', value: paidCOD, isCurrency: true, color: '#10b981' },
        { label: 'Unpaid COD', value: unpaidCOD, isCurrency: true, color: '#f59e0b' }
      ]
    });

    let report = `## 📊 DEEN Commerce Executive Logistics & Financial Report\n\n`;
    report += `> **Operational Status**: Real-Time Telemetry Analyzed across **${totalParcels} Active Orders**\n\n`;

    report += `### 💼 Financial & Operational KPI Scorecard\n`;
    report += `| Metric | Value | Benchmark / Health |\n`;
    report += `| :--- | :---: | :--- |\n`;
    report += `| **Total Parcel Volume** | **${totalParcels}** | Active batch in dispatch queue |\n`;
    report += `| **Gross COD Value** | **৳${totalCOD.toLocaleString()}** | Total cash receivable by couriers |\n`;
    report += `| **Courier Shipping Fees** | **৳${totalCharge.toLocaleString()}** | ৳50 inside / ৳90 outside Dhaka |\n`;
    report += `| **Net Projected Revenue** | **৳${netRevenue.toLocaleString()}** | Realized margin after courier deductions |\n`;
    report += `| **Average Order Value (AOV)** | **৳${avgOrderValue.toLocaleString()}** | Per-customer cart value |\n`;
    report += `| **Collection Efficiency** | **${collectionEfficiency}%** | ${paidRecords.length} Paid / ${unpaidRecords.length} Pending Unpaid |\n\n`;

    report += `### 📈 Visual Portfolio Breakdown\n\n`;
    report += `${donutSvg}\n\n`;
    report += `${barSvg}\n\n`;

    report += `### 📍 Territory Logistics & Compliance Audit\n`;
    report += `- **Inside Dhaka (৳50 Standard Fee)**: **${insideDhakaRecords.length} orders** (${totalParcels ? Math.round((insideDhakaRecords.length / totalParcels) * 100) : 0}%)\n`;
    report += `- **Outside Dhaka (৳90 Standard Fee)**: **${outsideDhakaRecords.length} orders** (${totalParcels ? Math.round((outsideDhakaRecords.length / totalParcels) * 100) : 0}%)\n`;

    if (underchargedOrders.length > 0) {
      report += `\n⚠️ **Shipping Charge Audit Alert (Invariant 7)**: Found **${underchargedOrders.length} order(s)** with subtotal < ৳2,500 where ৳0 shipping was configured. Automatically adding delivery fee (+৳50/+৳90) to COD to prevent store loss.\n`;
    }

    report += `\n### 🛡️ Operational Risk Radar & NDR Rescue\n`;
    report += `- **Orders Flagged for Review (COD ≥ ৳3,000 or Problem Status)**: **${highRiskOrders.length}**\n`;
    if (highRiskOrders.length > 0) {
      report += `\n**Priority Action List**:\n`;
      highRiskOrders.slice(0, 5).forEach(o => {
        report += `- **Order #${o.id}**: ${o.customer || 'Customer'} (${o.phone}) — COD: **৳${o.cod.toLocaleString()}** [${o.district}] — *Recommendation: Send 1-click WhatsApp ৳90 advance confirmation.*\n`;
      });
    } else {
      report += `- ✅ All active orders within safe COD thresholds.\n`;
    }

    report += `\n---\n*Report generated autonomously by DEEN Executive AI Analyst with In-Browser SQL & SVG Engine.*`;

    return report;
  }

  /**
   * Universal AI completion dispatcher:
   * 1. Evaluates in-memory deterministic queries first for instant mathematical accuracy.
   * 2. If open-ended and BYOK is configured, queries LLM (Gemini / OpenAI / Groq).
   * 3. If no key is set, generates an intelligent offline response with store guidance.
   */
  async function generateDeenAssistantReply(params) {
    if (typeof params === 'string') {
      params = { query: params };
    }
    const { query, records = [], metrics = {}, extraContext = {}, history = [], ...rest } = params || {};
    const cleanQuery = (query || '').trim();
    if (!cleanQuery) {
      return { answer: 'Please enter a question or request.', source: 'empty' };
    }

    const context = { records, metrics, ...extraContext, ...rest };

    // 1. Direct In-Browser SQL Execution
    if (/^\s*SELECT\s+[\s\S]+\s+FROM\s+/i.test(cleanQuery) || /^\s*(?:run\s+sql|execute\s+sql|sql:)\s*(SELECT\s+[\s\S]+)/i.test(cleanQuery)) {
      const sqlMatch = cleanQuery.match(/(?:(?:run\s+sql|execute\s+sql|sql:)\s*)?(SELECT\s+[\s\S]+)/i);
      const sqlToRun = sqlMatch ? sqlMatch[1] : cleanQuery;
      const sqlResult = executeSQL(sqlToRun, records);
      const markdownTable = formatSQLResultToMarkdown(sqlResult);

      let chartHtml = '';
      if (sqlResult.success && sqlResult.rows.length > 0 && sqlResult.columns.length >= 2) {
        const labelCol = sqlResult.columns[0];
        const numCol = sqlResult.columns.find((c, i) => i > 0 && typeof sqlResult.rows[0][c] === 'number');
        if (numCol) {
          const chartData = sqlResult.rows.slice(0, 7).map(r => ({
            label: String(r[labelCol] || 'Other'),
            value: Number(r[numCol]) || 0,
            isCurrency: /revenue|cod|charge|amount|fee/i.test(numCol)
          }));
          chartHtml = '\n\n' + renderVisualChartSVG({
            type: 'bar',
            title: `Visual Breakdown: ${numCol.replace(/_/g, ' ')} by ${labelCol.replace(/_/g, ' ')}`,
            data: chartData
          });
        }
      }

      return {
        answer: markdownTable + chartHtml,
        source: 'in_browser_sql_engine',
        sqlResult: sqlResult,
        toString() { return this.answer; }
      };
    }

    // 2. Visual Chart & Graph Requests
    if (/(?:(?:show|give|generate|render|make|create|draw|view).*(?:chart|graph|plot|visual|breakdown|analytics)|^\s*(?:chart|graph|visualize)\s*$)/i.test(cleanQuery)) {
      const isPaymentDist = /paid|unpaid|payment|collection/i.test(cleanQuery);

      if (isPaymentDist) {
        const normRecords = records.map(normalizeRecord);
        const paidSum = normRecords.filter(r => r.payment.toLowerCase() === 'paid').reduce((s, r) => s + r.cod, 0);
        const unpaidSum = normRecords.filter(r => r.payment.toLowerCase() !== 'paid').reduce((s, r) => s + r.cod, 0);
        const donutSvg = renderVisualChartSVG({
          type: 'donut',
          title: 'Paid vs Unpaid COD Liquidity',
          data: [
            { label: 'Paid Collected', value: paidSum, color: '#10b981', isCurrency: true },
            { label: 'Unpaid Pending COD', value: unpaidSum, color: '#f59e0b', isCurrency: true }
          ]
        });
        return {
          answer: `### 📈 Visual Chart: Payment & Settlement Distribution\n\n${donutSvg}\n\n- **Paid Deliveries**: **৳${paidSum.toLocaleString()}** settled\n- **Pending In-Transit COD**: **৳${unpaidSum.toLocaleString()}** awaiting rider collection\n\n*Generated by DEEN Assistant In-Browser Charting Engine.*`,
          source: 'visual_chart_engine',
          toString() { return this.answer; }
        };
      }

      // Default territory distribution chart
      const sqlResult = executeSQL("SELECT district, COUNT(*) as orders, SUM(cod) as revenue FROM orders GROUP BY district ORDER BY revenue DESC LIMIT 6", records);
      const chartData = (sqlResult.rows || []).map(r => ({
        label: r.district,
        value: r.revenue,
        isCurrency: true
      }));

      const barSvg = renderVisualChartSVG({
        type: 'bar',
        title: 'Revenue & Volume by Territory',
        data: chartData
      });

      return {
        answer: `### 📈 Visual Chart: Delivery Revenue by District\n\n${barSvg}\n\n${formatSQLResultToMarkdown(sqlResult)}\n\n💡 *Generated via local in-memory aggregation and SVG rendering.*`,
        source: 'visual_chart_engine',
        toString() { return this.answer; }
      };
    }

    // 3. Executive / Management / Audit Report Request
    if (/(?:executive report|c-level report|daily report|profitability report|management report|audit report|full report|comprehensive report)/i.test(cleanQuery)) {
      const execReport = generateExecutiveReport(context);
      return {
        answer: execReport,
        source: 'executive_reporter',
        toString() { return this.answer; }
      };
    }

    // 4. In-Memory Deterministic Engine
    const deterministic = evaluateDeterministicQuery(cleanQuery, context);
    if (deterministic) {
      return deterministic;
    }

    // 2. Check if this is a customer message or WhatsApp conversation analysis request
    if (/interpret|analyze|check note|check message|understand message|conversation|what does customer want|suggest reply|assist crm|গ্রাহকের মেসেজ|কি উত্তর|কনভারসেশন/i.test(cleanQuery) ||
        (context.conversation || context.messages || (cleanQuery.length > 60 && !cleanQuery.includes('?')))) {
      const convData = context.conversation || context.messages || context.note || cleanQuery;
      const convAnalysis = analyzeWhatsAppConversation(typeof convData === 'object' && !Array.isArray(convData) && convData.messages ? convData : {
        messages: Array.isArray(convData) ? convData : (context.messages || context.conversation || []),
        recentText: typeof convData === 'string' && convData !== cleanQuery ? convData : (context.note || (typeof convData === 'string' ? convData : '')),
        phone: context.phone || '',
        customerName: context.customerName || ''
      });
      
      const phoneDisplay = convAnalysis.phone ? `\`${convAnalysis.phone}\`` : 'Not detected';
      const orderDisplay = convAnalysis.entities.orderId ? `Order #${convAnalysis.entities.orderId}` : 'N/A';
      const sizeDisplay = convAnalysis.entities.size ? `Size: ${convAnalysis.entities.size}` : '';

      const actionsList = convAnalysis.crmGuidance.recommendedActions.map((act, i) => `${i + 1}. **${act}**`).join('\n');

      const markdown = `### 🎯 CRM Executive Copilot: Active Conversation Briefing
- **Customer Phone**: **${phoneDisplay}** ${convAnalysis.customerName ? `(${convAnalysis.customerName})` : ''}
- **Detected Intent**: **${convAnalysis.intent.label}** (${convAnalysis.intent.urgency} Urgency)
- **Customer Message**: *"${convAnalysis.latestCustomerText || 'No recent customer message'}"*
${convAnalysis.entities.orderId || convAnalysis.entities.size || convAnalysis.entities.trxId ? `- **Entities Detected**: ${[orderDisplay, sizeDisplay, convAnalysis.entities.trxId ? `TrxID: ${convAnalysis.entities.trxId}` : ''].filter(Boolean).join(' | ')}` : ''}

#### 📋 Recommended CRM Executive Actions:
${actionsList}

#### ✉️ Suggested WhatsApp Quick Reply:
> ${convAnalysis.suggestedReply}

💡 *Click **"✉️ Insert in WhatsApp"** below to insert this reply directly into the WhatsApp message box!*`;

      return {
        answer: markdown,
        source: 'crm_copilot_assistant',
        analysis: convAnalysis,
        toString() { return this.answer; }
      };
    }

    // 3. Load BYOK configuration
    const byok = await loadBYOKConfig();

    // 4. If BYOK key is configured, execute remote LLM completion
    if (byok.isActive && byok.apiKey && byok.apiKey.trim().length > 5) {
      try {
        const contextPrompt = synthesizeContext(records, metrics, extraContext);
        const fullPrompt = `${contextPrompt}\n\n### USER QUERY:\n${cleanQuery}\n\nProvide a direct, helpful, and concise response formatted in clean markdown.`;

        if (byok.provider === 'gemini') {
          const modelName = byok.model || 'gemini-2.5-flash';
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(byok.apiKey)}`;
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000);

          const resp = await fetch(url, {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: COPILOT_SYSTEM_PROMPT }] },
              contents: [{ parts: [{ text: fullPrompt }] }],
              generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 1024
              }
            })
          });
          clearTimeout(timeoutId);

          if (resp.ok) {
            const data = await resp.json();
            const textResult = data.candidates && data.candidates[0] &&
              data.candidates[0].content && data.candidates[0].content.parts &&
              data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;

            if (textResult) {
              return {
                answer: textResult.trim(),
                source: `gemini_${modelName}`
              };
            }
          }
        } else if (byok.provider === 'openai' || byok.provider === 'groq') {
          const endpoint = byok.provider === 'openai'
            ? 'https://api.openai.com/v1/chat/completions'
            : 'https://api.groq.com/openai/v1/chat/completions';
          
          const modelName = byok.model || (byok.provider === 'openai' ? 'gpt-4o-mini' : 'llama-3.3-70b-versatile');

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000);

          const resp = await fetch(endpoint, {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${byok.apiKey}`
            },
            body: JSON.stringify({
              model: modelName,
              messages: [
                { role: 'system', content: COPILOT_SYSTEM_PROMPT },
                { role: 'user', content: fullPrompt }
              ],
              temperature: 0.3,
              max_tokens: 1024
            })
          });
          clearTimeout(timeoutId);

          if (resp.ok) {
            const data = await resp.json();
            const textResult = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
            if (textResult) {
              return {
                answer: textResult.trim(),
                source: `${byok.provider}_${modelName}`
              };
            }
          }
        }
      } catch (llmErr) {
        console.warn('DEEN Assistant LLM request failed, falling back to heuristic engine:', llmErr);
      }
    }

    // 5. Intelligent Fallback Engine (Zero-Key / Offline)
    return {
      answer: `### 🤖 DEEN Assistant Intelligence Summary
Based on the current **${records.length} extracted parcels**:
- **Paid vs Unpaid**: **${metrics.paidCount || 0}** Paid / **${metrics.unpaidCount || 0}** Unpaid COD
- **Cash Pipeline**: **৳${(metrics.totalCOD || 0).toLocaleString()}** total COD to collect
- **Courier Expenses**: **৳${(metrics.totalCharge || 0).toLocaleString()}** courier charges
- **Net Estimated Revenue**: **৳${(metrics.netRevenue || 0).toLocaleString()}**

💡 **Tip**: To ask custom open-ended questions with Google Gemini reasoning, click the **⚙️ AI Key** button above to enter your free Google Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).`,
      source: 'heuristic_fallback'
    };
  }

  /**
   * Courier Remittance & Payout Invoice Reconciliation Auditor
   * Cross-references courier payout statements (Pathao/Steadfast) against store orders to detect:
   * 1. COD Shortages: Collected COD < Expected Order COD
   * 2. Overcharged Delivery Fees: Courier charged > standard rate (৳50 inside, ৳90 outside)
   * 3. Unremitted / Missing Orders: Delivered orders never paid out
   */
  function reconcileCourierInvoices(invoiceRecords, storeOrders = []) {
    if (!Array.isArray(invoiceRecords)) invoiceRecords = [];
    if (!Array.isArray(storeOrders)) storeOrders = [];

    const orderMap = new Map();
    for (const o of storeOrders) {
      const idKey = String(o.orderId || o.id || o.invoice || "").replace(/^#/, "").trim();
      if (idKey) orderMap.set(idKey, o);
      if (o.phone) {
        const pKey = String(o.phone).replace(/\D/g, "").slice(-11);
        if (pKey) orderMap.set(`p_${pKey}`, o);
      }
    }

    let totalInvoicedCOD = 0;
    let totalRemittedPayout = 0;
    let totalCourierCharges = 0;
    let totalExpectedCOD = 0;

    const discrepancies = [];
    const matchedOrders = [];
    const unmatchedInvoiceItems = [];

    for (const inv of invoiceRecords) {
      const invId = String(inv.orderId || inv.invoice || inv.merchant_order_id || inv.order_id || "").replace(/^#/, "").trim();
      const collectedCOD = Number(inv.collected_amount || inv.cod_amount || inv.cod || inv.collected || 0);
      const deliveryCharge = Number(inv.delivery_charge || inv.charge || inv.fee || 0);
      const netPayout = Number(inv.net_payable || inv.net_amount || inv.payout || (collectedCOD - deliveryCharge));

      totalInvoicedCOD += collectedCOD;
      totalRemittedPayout += netPayout;
      totalCourierCharges += deliveryCharge;

      // Find matching store order
      let matchedOrder = invId ? orderMap.get(invId) : null;
      if (!matchedOrder && inv.phone) {
        const pKey = String(inv.phone).replace(/\D/g, "").slice(-11);
        matchedOrder = orderMap.get(`p_${pKey}`);
      }

      if (matchedOrder) {
        const expectedCOD = Number(matchedOrder.cod || matchedOrder.total || 0);
        totalExpectedCOD += expectedCOD;

        let hasDiscrepancy = false;
        // 1. Check COD Shortage
        if (expectedCOD > 0 && collectedCOD < expectedCOD) {
          const diff = expectedCOD - collectedCOD;
          discrepancies.push({
            type: "COD_SHORTAGE",
            orderId: invId || matchedOrder.orderId,
            expectedCOD,
            actualCOD: collectedCOD,
            loss: diff,
            severity: "HIGH",
            message: `Courier collected ৳${collectedCOD} but order was ৳${expectedCOD} (Shortage: -৳${diff})`
          });
          hasDiscrepancy = true;
        }

        // 2. Check Overcharged Delivery Fee
        const isOutside = Boolean(matchedOrder.isOutsideDhaka);
        const standardMaxFee = isOutside ? 100 : 60; // Reasonable courier ceiling including 1% COD fee
        if (deliveryCharge > standardMaxFee) {
          const excess = deliveryCharge - (isOutside ? 90 : 50);
          discrepancies.push({
            type: "FEE_OVERCHARGE",
            orderId: invId || matchedOrder.orderId,
            chargedFee: deliveryCharge,
            standardFee: isOutside ? 90 : 50,
            loss: excess,
            severity: "MEDIUM",
            message: `Charged ৳${deliveryCharge} delivery fee on ${isOutside ? 'outside' : 'inside'} Dhaka parcel (Excess: +৳${excess})`
          });
          hasDiscrepancy = true;
        }

        matchedOrders.push({
          orderId: invId,
          collectedCOD,
          deliveryCharge,
          netPayout,
          hasDiscrepancy
        });
      } else {
        unmatchedInvoiceItems.push(inv);
      }
    }

    const totalLoss = discrepancies.reduce((sum, d) => sum + (d.loss || 0), 0);

    return {
      totalInvoicedRecords: invoiceRecords.length,
      matchedRecordsCount: matchedOrders.length,
      unmatchedCount: unmatchedInvoiceItems.length,
      cleanOrdersCount: matchedOrders.filter(m => !m.hasDiscrepancy).length,
      discrepancyCount: discrepancies.length,
      totalInvoicedCOD,
      totalRemittedPayout,
      totalCourierCharges,
      totalExpectedCOD,
      totalLossAmount: totalLoss,
      leakageRate: totalExpectedCOD > 0 ? Number(((totalLoss / totalExpectedCOD) * 100).toFixed(2)) : 0,
      discrepancies,
      summary: discrepancies.length === 0
        ? `✅ Perfect Payout Reconciliation: All ${matchedOrders.length} reconciled orders matched without billing leakages.`
        : `⚠️ Detected ${discrepancies.length} payout discrepancies totaling ৳${totalLoss.toLocaleString()} in courier leakage.`
    };
  }

  // Chat History Management
  async function loadChatHistory() {
    const list = await getStorageItem(STORAGE_KEY_HISTORY);
    return Array.isArray(list) ? list : [];
  }

  async function saveChatMessage(message) {
    const history = await loadChatHistory();
    history.push(message);
    if (history.length > MAX_HISTORY_MESSAGES) {
      history.splice(0, history.length - MAX_HISTORY_MESSAGES);
    }
    await setStorageItem(STORAGE_KEY_HISTORY, history);
    return history;
  }

  async function clearChatHistory() {
    await setStorageItem(STORAGE_KEY_HISTORY, []);
    return [];
  }

  return {
    COPILOT_SYSTEM_PROMPT,
    DEFAULT_BYOK_CONFIG,
    loadBYOKConfig,
    saveBYOKConfig,
    testBYOKConnection,
    evaluateDeterministicQuery,
    analyzeWhatsAppConversation,
    analyzeCustomerMessageOrNote,
    synthesizeContext,
    generateDeenAssistantReply,
    loadChatHistory,
    saveChatMessage,
    clearChatHistory,
    normalizeRecord,
    executeSQL,
    formatSQLResultToMarkdown,
    executeDataFrameAnalysis,
    renderVisualChartSVG,
    generateExecutiveReport,
    reconcileCourierInvoices
  };
});
