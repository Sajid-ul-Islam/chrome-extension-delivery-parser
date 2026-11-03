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

    // 1. Check in-memory deterministic engine first
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
    clearChatHistory
  };
});
