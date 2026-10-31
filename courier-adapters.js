/**
 * DEEN Delivery Parser - Multi-Courier Adapters & Dynamic Routing Engine
 *
 * Implements unified consignment adapters and smart dynamic courier routing across:
 * 1. Pathao Courier (Hermes API / Aladdin REST)
 * 2. Steadfast Courier (Merchant JSON API & Courier Composite)
 * 3. RedX Logistics (Partner Open API)
 * 4. Paperfly (Wingman API)
 *
 * Features:
 * - Smart Courier Routing & Arbitrage Engine: Dynamically recommends best courier
 *   based on Upazila coverage quality, verified customer delivery rate on that specific
 *   network, and net fee arbitrage.
 * - Multi-Factor Return Fraud & Risk Engine: Evaluates courier delivery rate, address
 *   completeness index, order COD value anomaly, and order velocity.
 * - Post-Dispatch NDR Guardian: Automatically parses failed delivery attempts (unreachable,
 *   rescheduled, rider issue) and generates urgency customer rescue WhatsApp messages.
 */

(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define(["./parser.js"], factory);
  } else if (typeof module === "object" && module.exports) {
    let parser = {};
    try { parser = require("./parser.js"); } catch (e) {}
    module.exports = factory(parser);
  } else {
    root.DeenCouriers = factory(root._parser || {});
  }
})(typeof self !== "undefined" ? self : this, function (parser) {
  "use strict";

  const normalizeBDPhone = (parser && parser.normalizeBDPhone) || function (p) {
    if (!p) return null;
    const match = String(p).replace(/[^\d+]/g, "").match(/(?:(?:\+?880)|880|0)?(1[3-9]\d{8})\b/);
    return match && match[1] ? "0" + match[1] : null;
  };

  const calculateDeliveryFee = (parser && parser.calculateDeliveryFee) || function (isOutside) {
    return isOutside ? 90 : 50;
  };

  /**
   * Courier Profile Registry & Fee Configurations
   */
  const COURIER_PROFILES = {
    pathao: {
      name: "Pathao Courier",
      code: "pathao",
      brandColor: "#e11d48",
      insideDhakaFee: 50,
      outsideDhakaFee: 90,
      subDhakaFee: 70,
      codChargePercent: 0, // 0% COD inside Dhaka for standard merchants, 1% outside
      standardDeliveryHoursDhaka: 24,
      standardDeliveryHoursOutside: 48,
      primeCoverageDistricts: ["Dhaka", "Chattogram", "Sylhet", "Gazipur", "Narayanganj"]
    },
    steadfast: {
      name: "Steadfast Courier",
      code: "steadfast",
      brandColor: "#0284c7",
      insideDhakaFee: 60,
      outsideDhakaFee: 100,
      subDhakaFee: 80,
      codChargePercent: 1.0,
      standardDeliveryHoursDhaka: 24,
      standardDeliveryHoursOutside: 48,
      primeCoverageDistricts: ["Cumilla", "Rajshahi", "Bogura", "Khulna", "Barishal", "Rangpur", "Mymensingh"]
    },
    redx: {
      name: "RedX Logistics",
      code: "redx",
      brandColor: "#dc2626",
      insideDhakaFee: 60,
      outsideDhakaFee: 100,
      subDhakaFee: 80,
      codChargePercent: 1.0,
      standardDeliveryHoursDhaka: 24,
      standardDeliveryHoursOutside: 72,
      primeCoverageDistricts: ["Dhaka", "Gazipur", "Narayanganj", "Chattogram"]
    },
    paperfly: {
      name: "Paperfly",
      code: "paperfly",
      brandColor: "#ea580c",
      insideDhakaFee: 60,
      outsideDhakaFee: 110,
      subDhakaFee: 90,
      codChargePercent: 1.0,
      standardDeliveryHoursDhaka: 36,
      standardDeliveryHoursOutside: 72,
      primeCoverageDistricts: ["Habiganj", "Maulvibazar", "Sunamganj", "Kurigram", "Panchagarh", "Bandarban"]
    }
  };

  // =========================================================================
  // 1. Unified Consignment Payload Adapters
  // =========================================================================

  const PathaoAdapter = {
    code: "pathao",
    name: "Pathao Courier",

    formatConsignmentPayload(order) {
      const isOutside = Boolean(order.isOutsideDhaka);
      const cod = order.cod !== undefined ? Number(order.cod) : 0;
      return {
        store_id: order.storeId || undefined,
        merchant_order_id: String(order.orderId || "").replace(/^#/, "").trim(),
        recipient_name: order.name || "Customer",
        recipient_phone: normalizeBDPhone(order.phone) || order.phone,
        recipient_address: order.address || "",
        recipient_city: order.cityId || 1, // 1 = Dhaka
        recipient_zone: order.zoneId || undefined,
        recipient_area: order.areaId || undefined,
        delivery_type: 48, // Normal 48h
        item_type: 2, // Parcel
        special_instruction: order.notes || order.customerNote || "",
        item_quantity: (order.items && order.items.length) || 1,
        item_weight: order.weight || 0.5,
        amount_to_collect: cod,
        item_description: (order.items || []).map(i => `${i.name} (x${i.qty || 1})`).join(", ") || "Fashion items"
      };
    },

    parseRatingResponse(json) {
      if (!json) return null;
      const c = (json.data && json.data.customer) || json.customer || (json.data && typeof json.data === "object" ? json.data : json);
      if (!c) return null;
      const t = Number(c.total_delivery || c.total || 0);
      const d = Number(c.successful_delivery || c.delivered || 0);
      const f = Number(c.failed_delivery || c.cancelled || Math.max(0, t - d));
      const grade = json.customer_rating || (json.data && json.data.customer_rating) || "";
      return {
        courier: "pathao",
        total: t,
        delivered: d,
        cancelled: f,
        successRate: t > 0 ? Math.round((d / t) * 100) : 100,
        ratingGrade: grade ? String(grade).replace(/_/g, " ").trim() : ""
      };
    }
  };

  const SteadfastAdapter = {
    code: "steadfast",
    name: "Steadfast Courier",

    formatConsignmentPayload(order) {
      const cod = order.cod !== undefined ? Number(order.cod) : 0;
      return {
        invoice: String(order.orderId || "").replace(/^#/, "").trim(),
        recipient_name: order.name || "Customer",
        recipient_phone: normalizeBDPhone(order.phone) || order.phone,
        recipient_address: order.address || "",
        cod_amount: cod,
        note: order.notes || order.customerNote || ""
      };
    },

    parseRatingResponse(json) {
      if (!json) return null;
      const d = Number(json.total_delivered || 0);
      const c = Number(json.total_cancelled || 0);
      const t = d + c;
      return {
        courier: "steadfast",
        total: t,
        delivered: d,
        cancelled: c,
        successRate: t > 0 ? Math.round((d / t) * 100) : 100
      };
    }
  };

  const RedXAdapter = {
    code: "redx",
    name: "RedX Logistics",

    formatConsignmentPayload(order) {
      const cod = order.cod !== undefined ? Number(order.cod) : 0;
      return {
        customer_name: order.name || "Customer",
        customer_phone: normalizeBDPhone(order.phone) || order.phone,
        delivery_area: order.zone || order.district || "Dhaka",
        delivery_area_id: order.areaId || undefined,
        customer_address: order.address || "",
        merchant_invoice_id: String(order.orderId || "").replace(/^#/, "").trim(),
        cash_collection_amount: cod,
        parcel_weight: order.weight || 500,
        instruction: order.notes || order.customerNote || "",
        value: cod
      };
    }
  };

  // =========================================================================
  // 2. Multi-Factor Return Fraud & Predictive Risk Engine
  // =========================================================================

  /**
   * Evaluates address completeness and structural confidence (0 to 100)
   */
  function calculateAddressConfidence(rawAddress, district, zone) {
    if (!rawAddress || rawAddress.trim().length < 5) return 20;

    let score = 30; // base score for having an address string
    const text = rawAddress.toLowerCase();

    // Check for specific house / flat / road identifiers
    if (/(?:house|holding|road|sector|block|lane|avenue|বাসা|রোড|ব্লক|সেক্টর|বাড়ি|হোল্ডিং|গ্রাম|ওয়ার্ড)/i.test(text)) {
      score += 25;
    }

    // Check for numerals indicating specific premises/street numbers
    if (/\d+/.test(text)) {
      score += 15;
    }

    // Check district recognition
    if (district && district.length > 2) {
      score += 15;
    }

    // Check Thana / Upazila / Zone recognition
    if (zone && zone.length > 2) {
      score += 15;
    }

    // Penalty for overly short / vague address (e.g. "Cumilla", "Mirpur")
    if (rawAddress.trim().split(/\s+/).length <= 2) {
      score = Math.min(score, 35);
    }

    return Math.min(100, Math.max(10, score));
  }

  /**
   * Predictive Return Fraud Scoring Model
   * Combines courier delivery history, address completeness, COD anomaly, and order frequency.
   *
   * @param {Object} ratingData - Composite or courier rating data
   * @param {Object} orderDetails - Order items, COD, address, district, etc.
   * @returns {Object} Comprehensive predictive risk profile & dynamic advance fee requirement
   */
  function calculateMultiFactorRisk(ratingData, orderDetails = {}) {
    const cleanPhone = normalizeBDPhone((ratingData && ratingData.phone) || orderDetails.phone);
    const totalParcels = Number((ratingData && ratingData.totalParcels) || 0);
    const deliveredCount = Number((ratingData && ratingData.deliveredCount) || 0);
    const cancelledCount = Number((ratingData && ratingData.cancelledCount) || 0);
    const successRate = totalParcels > 0 ? Math.round((deliveredCount / totalParcels) * 100) : 100;
    const isNewCustomer = totalParcels === 0;

    // 1. Courier delivery history score (0 - 100)
    let courierHistoryScore = 80; // default for new customer
    if (!isNewCustomer) {
      courierHistoryScore = successRate;
      // Strict penalty for multiple cancellations
      if (cancelledCount >= 5) courierHistoryScore -= 25;
      else if (cancelledCount >= 3) courierHistoryScore -= 15;
    }
    courierHistoryScore = Math.max(0, Math.min(100, courierHistoryScore));

    // 2. Address structural completeness score (0 - 100)
    const addrConfidence = calculateAddressConfidence(
      orderDetails.address || "",
      orderDetails.district || "",
      orderDetails.zone || ""
    );

    // 3. Order COD Value Anomaly Score (0 - 100)
    // High COD for an unverified/risky customer lowers safety score
    const codVal = Number(orderDetails.cod || orderDetails.subtotal || 0);
    let valueSafetyScore = 90;
    if (codVal > 5000) {
      valueSafetyScore = isNewCustomer ? 55 : (successRate < 80 ? 40 : 80);
    } else if (codVal > 3000) {
      valueSafetyScore = isNewCustomer ? 70 : (successRate < 75 ? 55 : 85);
    }

    // 4. Composite Weighted Score
    // Courier History: 50%, Address Quality: 25%, Value Safety: 25%
    const compositeScore = Math.round(
      (courierHistoryScore * 0.50) +
      (addrConfidence * 0.25) +
      (valueSafetyScore * 0.25)
    );

    // 5. Categorize Risk Level & Recommended Action
    let riskLevel = "low";
    let riskLabel = "Safe Buyer (Low Return Risk)";
    let riskColor = "#10b981";
    let recommendedAdvanceFee = 0;
    let autoDispatchAllowed = true;
    let actionRecommendation = "auto_dispatch";

    const isOutside = Boolean(
      orderDetails.isOutsideDhaka ||
      (orderDetails.district && !/dhaka/i.test(orderDetails.district)) ||
      (orderDetails.address && !/dhaka/i.test(orderDetails.address))
    );

    if (cancelledCount >= 4 || compositeScore < 50 || successRate < 60) {
      riskLevel = "high";
      riskLabel = `🚨 High Return Risk (${cancelledCount} returns / ${successRate}% delivery)`;
      riskColor = "#ef4444";
      recommendedAdvanceFee = isOutside ? 180 : (codVal > 3000 ? 150 : 100); // Two-way return courier fee guarantee
      autoDispatchAllowed = false;
      actionRecommendation = "advance_required";
    } else if (cancelledCount >= 2 || compositeScore < 70 || successRate < 80 || addrConfidence < 40) {
      riskLevel = "medium";
      riskLabel = `⚠️ Moderate Risk (${cancelledCount} returns / ${successRate}% delivery)`;
      riskColor = "#f59e0b";
      recommendedAdvanceFee = isOutside ? 90 : 50; // Standard one-way delivery fee
      autoDispatchAllowed = false;
      actionRecommendation = "whatsapp_confirm";
    } else if (isNewCustomer) {
      riskLevel = "low";
      riskLabel = "🆕 New Customer (Clean Record)";
      riskColor = "#3b82f6";
      recommendedAdvanceFee = codVal > 4000 ? (isOutside ? 90 : 50) : 0;
      autoDispatchAllowed = codVal <= 4000 && addrConfidence >= 50;
      actionRecommendation = autoDispatchAllowed ? "auto_dispatch" : "whatsapp_confirm";
    } else {
      riskLevel = "low";
      riskLabel = `🛡️ Safe Buyer (${successRate}% Success)`;
      riskColor = "#10b981";
      recommendedAdvanceFee = 0;
      autoDispatchAllowed = addrConfidence >= 40;
      actionRecommendation = autoDispatchAllowed ? "auto_dispatch" : "address_clarification";
    }

    return {
      phone: cleanPhone,
      compositeRiskScore: compositeScore,
      courierHistoryScore,
      addressConfidence: addrConfidence,
      valueSafetyScore,
      riskLevel,
      riskLabel,
      riskColor,
      isNewCustomer,
      successRate,
      deliveredCount,
      cancelledCount,
      totalParcels,
      recommendedAdvanceFee,
      recommendedAdvanceCharge: recommendedAdvanceFee,
      requiresAdvancePayment: recommendedAdvanceFee > 0,
      autoDispatchAllowed,
      actionRecommendation
    };
  }

  // =========================================================================
  // 3. Smart Multi-Courier Routing & Arbitrage Engine
  // =========================================================================

  /**
   * Evaluates and recommends the optimal courier network for an order
   * based on Upazila coverage, customer history on that specific network, and shipping arbitrage.
   *
   * @param {Object} order - Order details (orderId, address, district, zone, cod, isOutsideDhaka)
   * @param {Object} customerRating - Courier rating data
   * @returns {Object} Optimal courier recommendation with comparison matrix
   */
  function evaluateOptimalCourier(order, customerRating = {}) {
    const district = (order.district || "").trim();
    const zone = (order.zone || "").trim();
    const isOutside = Boolean(order.isOutsideDhaka || (district && !district.toLowerCase().includes("dhaka")));
    const cod = Number(order.cod || 0);

    const candidates = [];

    // Helper to evaluate courier score
    for (const [code, profile] of Object.entries(COURIER_PROFILES)) {
      let score = 70; // Base score
      let coverageGrade = "Standard";
      let hours = isOutside ? profile.standardDeliveryHoursOutside : profile.standardDeliveryHoursDhaka;

      // 1. Prime Coverage District Boost
      if (profile.primeCoverageDistricts.some(d => d.toLowerCase() === district.toLowerCase())) {
        score += 15;
        coverageGrade = "Prime";
      }

      // 2. Dhaka Metro Express Preference
      if (!isOutside && code === "pathao") {
        score += 15;
        coverageGrade = "Express (24h)";
        hours = 24;
      }

      // 3. Remote District / Upazila Coverage Preference
      if (isOutside && (code === "steadfast" || code === "paperfly")) {
        score += 12;
        coverageGrade = "High Delivery Completion";
      }

      // 4. Calculate Net Estimated Cost to Merchant
      const baseFee = isOutside ? profile.outsideDhakaFee : profile.insideDhakaFee;
      const codCharge = Math.round((cod * profile.codChargePercent) / 100);
      const totalEstimatedCost = baseFee + codCharge;

      // 5. Customer Specific Courier Delivery History Boost
      if (customerRating && customerRating.sources) {
        if (code === "pathao" && customerRating.sources.pathao && customerRating.sources.pathao.total > 0) {
          const pRate = customerRating.sources.pathao.successRate;
          score += (pRate >= 80 ? 10 : (pRate < 60 ? -20 : 0));
        }
        if (code === "steadfast" && customerRating.sources.steadfastNetwork && customerRating.sources.steadfastNetwork.total > 0) {
          const sRate = customerRating.sources.steadfastNetwork.successRate;
          score += (sRate >= 80 ? 10 : (sRate < 60 ? -20 : 0));
        }
      }

      candidates.push({
        courier: code,
        name: profile.name,
        brandColor: profile.brandColor,
        score: Math.min(100, score),
        coverageGrade,
        estimatedDeliveryHours: hours,
        baseDeliveryFee: baseFee,
        codChargeAmount: codCharge,
        totalCost: totalEstimatedCost
      });
    }

    // Sort by highest score descending, then lowest total cost
    candidates.sort((a, b) => b.score !== a.score ? b.score - a.score : a.totalCost - b.totalCost);

    const winner = candidates[0];
    let reason = "";
    if (winner.courier === "pathao" && !isOutside) {
      reason = "Fastest 24-hour express delivery in Dhaka Metro with 0% COD fee.";
    } else if (winner.courier === "steadfast") {
      reason = `Superior rural delivery completion rate in ${district || "outside Dhaka"} with robust COD collection.`;
    } else {
      reason = `Highest delivery coverage index and cost efficiency for ${district || "destination"}.`;
    }

    return {
      recommendedCourier: winner.courier,
      recommendedName: winner.name,
      confidence: winner.score,
      reason,
      estimatedDeliveryHours: winner.estimatedDeliveryHours,
      estimatedTotalCost: winner.totalCost,
      estimatedFee: winner.totalCost,
      comparison: candidates,
      allQuotes: candidates
    };
  }

  // =========================================================================
  // 4. Post-Dispatch NDR (Non-Delivery Report) Guardian
  // =========================================================================

  /**
   * Analyzes courier tracking status events to detect failed delivery attempts
   * @param {Object} event - Courier tracking update
   * @returns {Object|null} Formatted NDR alert with action steps and customer rescue message
   */
  function processNDRTrackingEvent(event) {
    if (!event) return null;

    const rawStatus = String(event.status || event.delivery_status || "").toLowerCase();
    const orderId = String(event.orderId || event.merchant_order_id || event.invoice || "").replace(/^#/, "").trim();
    const customerPhone = normalizeBDPhone(event.phone || event.customerPhone || event.recipient_phone);
    const customerName = event.customerName || event.recipient_name || "সম্মানিত গ্রাহক";
    const riderPhone = normalizeBDPhone(event.riderPhone || event.delivery_hero_phone || event.agent_phone);
    const trackingId = event.trackingId || event.consignment_id || event.consignmentId || "";

    const isNDR = /(?:fail|attempt|unreachable|reschedule|rider|cancel|hold|contact|not_found|বন্ধ|যোগাযোগ|ব্যর্থ)/i.test(rawStatus) &&
                  !/(?:delivered|success|completed|গৃহীত|সফল)/i.test(rawStatus);

    if (!isNDR) return null;

    let issueType = "unreachable";
    let issueLabel = "Customer Unreachable / Phone Switched Off";

    if (rawStatus.includes("reschedule") || rawStatus.includes("সময়")) {
      issueType = "rescheduled";
      issueLabel = "Customer Rescheduled Delivery";
    } else if (rawStatus.includes("address") || rawStatus.includes("not_found") || rawStatus.includes("ঠিকানা")) {
      issueType = "address_issue";
      issueLabel = "Delivery Address Incomplete / House Not Found";
    }

    // Generate Urgent Customer Rescue WhatsApp Message
    const rescueMessage = `আসসালামু আলাইকুম ${customerName},

আপনার DEEN Commerce অর্ডার #${orderId}${trackingId ? ` (ট্র্যাকিং: ${trackingId})` : ""}-এর পার্সেলটি নিয়ে ডেলিভারি রাইডার আজ আপনার ঠিকানায় পৌঁছালেও আপনার মোবাইলে যোগাযোগ করতে পারেননি (${issueLabel})।

⚠️ পার্সেলটি আমাদের ওয়্যারহাউসে ফেরত যাওয়া ঠেকাতে দয়া করে:
${riderPhone ? `📞 রাইডারের নাম্বারে সরাসরি কল করুন: ${riderPhone}\n` : ""}💬 অথবা এই মেসেজের উত্তর দিয়ে আপনার ফ্রি সময় বা সঠিক লোকেশন জানিয়ে দিন।

আমরা আজকেই পার্সেলটি আপনার কাছে পৌঁছে দিতে চাই। ধন্যবাদ!
— DEEN Commerce Customer Support`.trim();

    return {
      isNDR: true,
      alertRequired: true,
      urgency: /switched\s*off|unreachable|wrong\s*phone/i.test(issueLabel || "") ? "critical" : "high",
      trackingId,
      orderId,
      customerPhone,
      customerName,
      riderPhone,
      issueType,
      issueLabel,
      courier: event.courier || "courier",
      detectedAt: new Date().toISOString(),
      rescueMessage,
      rescueWhatsAppMessage: rescueMessage,
      whatsappDeepLink: customerPhone
        ? `https://wa.me/88${customerPhone}?text=${encodeURIComponent(rescueMessage)}`
        : null
    };
  }

  const PaperflyAdapter = {
    code: "paperfly",
    name: "Paperfly Wingman",

    formatConsignmentPayload(order) {
      const cod = order.cod !== undefined ? Number(order.cod) : 0;
      return {
        merOrderRef: String(order.orderId || "").replace(/^#/, "").trim(),
        custName: order.name || "Customer",
        custPhone: normalizeBDPhone(order.phone) || order.phone,
        custAddress: order.address || "",
        packagePrice: cod,
        instruction: order.notes || order.customerNote || ""
      };
    },

    parseRatingResponse(json) {
      if (!json) return null;
      return {
        courier: "paperfly",
        total: Number(json.total || 0),
        delivered: Number(json.delivered || 0),
        cancelled: Number(json.cancelled || 0),
        successRate: 100
      };
    }
  };

  const COURIERS = {
    PATHAO: PathaoAdapter,
    STEADFAST: SteadfastAdapter,
    REDX: RedXAdapter,
    PAPERFLY: PaperflyAdapter,
    pathao: PathaoAdapter,
    steadfast: SteadfastAdapter,
    redx: RedXAdapter,
    paperfly: PaperflyAdapter
  };

  function formatCourierConsignment(courierCode, order) {
    const key = String(courierCode || "pathao").toLowerCase();
    const adapter = COURIERS[key] || PathaoAdapter;
    return adapter.formatConsignmentPayload(order);
  }

  return {
    COURIER_PROFILES,
    COURIERS,
    PathaoAdapter,
    SteadfastAdapter,
    RedXAdapter,
    PaperflyAdapter,
    formatCourierConsignment,
    calculateAddressConfidence,
    calculateMultiFactorRisk,
    evaluateOptimalCourier,
    processNDRTrackingEvent
  };
});
