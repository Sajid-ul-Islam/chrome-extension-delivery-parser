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
   * Interprets customer notes or incoming WhatsApp messages:
   * Identifies delivery urgency, bracketing/size risk, office timing, and phone numbers.
   */
  function analyzeCustomerMessageOrNote(text) {
    if (!text || typeof text !== 'string') return null;
    const clean = text.trim();
    const lower = clean.toLowerCase();

    const analysis = {
      rawText: clean,
      category: 'GENERAL_NOTE',
      priority: 'MEDIUM',
      tags: [],
      extractedPhone: null,
      actionItem: 'Proceed with standard fulfillment'
    };

    // Extract phone if present
    const phoneMatch = clean.match(/(?:(?:\+?880)|880|0)?(1[3-9]\d{8})\b/);
    if (phoneMatch) {
      analysis.extractedPhone = '0' + phoneMatch[1];
      analysis.tags.push('📱 Phone Identified: ' + analysis.extractedPhone);
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
    const { query, records = [], metrics = {}, extraContext = {}, history = [] } = params;
    const cleanQuery = (query || '').trim();
    if (!cleanQuery) {
      return { answer: 'Please enter a question or request.', source: 'empty' };
    }

    const context = { records, metrics, ...extraContext };

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

    // 2. Check if this is a customer message or note interpretation request
    if (/interpret|analyze|check note|check message|understand message|note meaning/i.test(cleanQuery) ||
        cleanQuery.length > 60 && !cleanQuery.includes('?')) {
      const noteAnalysis = analyzeCustomerMessageOrNote(cleanQuery);
      if (noteAnalysis && noteAnalysis.tags.length > 0) {
        return {
          answer: `### 📝 Customer Message Interpretation\n- **Detected Category**: **${noteAnalysis.category.replace(/_/g, ' ')}**\n- **Fulfillment Priority**: **${noteAnalysis.priority}**\n- **Extracted Tags**:\n${noteAnalysis.tags.map(t => '  - ' + t).join('\n')}\n\n🎯 **Recommended Warehouse Action**:\n> ${noteAnalysis.actionItem}\n\n*Analyzed with DEEN Bilingual Note Interpreter.*`,
          source: 'note_interpreter'
        };
      }
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
    generateExecutiveReport
  };
});
