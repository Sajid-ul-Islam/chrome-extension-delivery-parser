/**
 * DEEN Delivery Parser Engine
 * Ported from src/processing/delivery_parser.py
 * Handles standard sequential tokens and intelligent fuzzy regex extraction.
 */

const HEADER_TOKENS = new Set([
  "Cons. ID",
  "Consignment ID",
  "Order ID",
  "Store",
  "Recipient Info",
  "Delivery Status",
  "Amount",
  "Payment",
  "Action"
]);

function cleanLines(raw) {
  const lines = [];
  const rawLines = (raw || "").replace(/\t/g, "\n").split(/\r?\n/);
  let lastConsId = null;
  for (let line of rawLines) {
    const val = line.trim();
    if (!val) continue;
    if (val === "---" || /^[-=_*]{3,}$/.test(val)) {
      lastConsId = null;
      continue;
    }
    if (HEADER_TOKENS.has(val)) continue;
    if (isConsignmentId(val)) {
      if (val === lastConsId) {
        continue; // Discard accidental consecutive duplicate consignment ID
      }
      lastConsId = val;
    }
    lines.push(val);
  }
  return lines;
}

function isConsignmentId(value) {
  if (!value || typeof value !== "string") return false;
  return /^[A-Z]{2}\d{6}[A-Z0-9]+$/i.test(value.trim()) || /([A-Z]{2}\d{6}[A-Z0-9]+)/i.test(value.trim());
}

function getConsignmentId(value) {
  const m = value.match(/([A-Z]{2}\d{6}[A-Z0-9]+)/i);
  return m ? m[1] : value.trim();
}

function bengaliToAsciiDigits(str) {
  if (!str) return "";
  const bengaliDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  return String(str).replace(/[০-৯]/g, d => bengaliDigits.indexOf(d));
}

const BD_PHONE_SEARCH_REGEX = /(?:(?:\+|00)?880[\s.-]?)?0?(1[3-9][0-9]{2}[\s.-]?[0-9]{3}[\s.-]?[0-9]{3})\b/;
const BD_PHONE_CLEAN_REGEX = /(?:(?:\+?880)|880|0)?(1[3-9]\d{8})\b/;

const normalizeBDPhone = function(raw) {
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

function escapeHTML(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseAmount(line) {
  if (!line) return 0.0;
  const ascii = bengaliToAsciiDigits(String(line));
  const m = ascii.match(/([\d,]+(?:\.\d+)?)/);
  if (!m) return 0.0;
  const num = parseFloat(m[1].replace(/,/g, ""));
  return isNaN(num) ? 0.0 : num;
}

function parseDate(line) {
  if (!line) return "";
  const lower = line.toLowerCase();
  if (lower.startsWith("updated on")) {
    const parts = line.split(/updated on/i);
    return parts[1] ? parts[1].trim() : line.trim();
  }
  return line.trim();
}

/**
 * Standard sequential token parser with resilient anchors
 */
function parseStandardRecords(raw) {
  const lines = cleanLines(raw);
  const records = [];
  let i = 0;

  while (i < lenSafe(lines)) {
    if (!isConsignmentId(lines[i])) {
      i++;
      continue;
    }

    const rec = {
      "Consignment ID": getConsignmentId(lines[i]),
      "Type": "",
      "Order ID": "",
      "Store": "",
      "Recipient Name": "",
      "Address": "",
      "Phone": "",
      "Delivery Status": "",
      "Status Updated On": "",
      "COD Amount": 0.0,
      "Charge": 0.0,
      "Discount": 0.0,
      "Payment Status": "Unpaid",
      "Action": ""
    };
    i++;

    // 1. Optional Type immediately following Consignment ID
    if (i < lines.length && /^(?:Type:?|Parcel|Express|Normal|Document|Fragile|Exchange)/i.test(lines[i])) {
      rec["Type"] = lines[i].replace(/^Type:\s*/i, "").trim();
      i++;
    }

    // 2. Scan ahead for Phone number anchor (avoids column shifting)
    let phoneIdx = -1;
    for (let p = i; p < Math.min(i + 14, lines.length); p++) {
      if (isConsignmentId(lines[p])) break;
      if (/(?:(?:\+?880)|0)1[3-9]\d{8}/.test(lines[p])) {
        phoneIdx = p;
        break;
      }
    }

    if (phoneIdx !== -1) {
      rec["Phone"] = lines[phoneIdx].match(/(?:(?:\+?880)|0)1[3-9]\d{8}/)[0];
      const preTokens = lines.slice(i, phoneIdx);
      i = phoneIdx + 1;

      let orderId = "";
      let store = "";
      let name = "";
      const addressParts = [];

      for (let t = 0; t < preTokens.length; t++) {
        const token = preTokens[t].trim();
        if (!token) continue;

        if (!rec["Type"] && /^(?:Parcel|Express|Normal|Document|Fragile|Exchange)$/i.test(token)) {
          rec["Type"] = token;
        } else if (!orderId && /^(?:(?:D|EX)\s*-\s*\d{3,8}(?:\s*[a-zA-Z0-9_-]+)?|[a-zA-Z]{1,4}-\d{3,8}(?:\s*[a-zA-Z0-9_-]+)?|#?\d{3,8}(?:\s*[a-zA-Z])?|ORD[-\w]+)$/i.test(token)) {
          orderId = token;
        } else if (!store && (/store|commerce|deen|outlet|mart|shop|enterprise|hub/i.test(token) || (orderId && !name && preTokens.length - t >= 3))) {
          store = token;
        } else if (!name) {
          name = token;
        } else {
          addressParts.push(token);
        }
      }

      // Safeguard: If orderId wasn't found but name looks like an Order ID (e.g. D-14489, 14782 c)
      if (!orderId && /^(?:(?:D|EX)\s*-\s*\d{3,8}(?:\s*[a-zA-Z0-9_-]+)?|[a-zA-Z]{1,4}-\d{3,8}(?:\s*[a-zA-Z0-9_-]+)?|#?\d{3,8}(?:\s*[a-zA-Z])?|ORD[-\w]+)$/i.test(name)) {
        orderId = name;
        name = addressParts.length > 0 ? addressParts.shift() : "";
      }

      rec["Order ID"] = orderId;
      rec["Store"] = store;
      rec["Recipient Name"] = name;
      rec["Address"] = addressParts.join(", ");

      // D- or EX- prefix means Exchange Order
      if (/^(?:D|EX)\s*-\s*\d/i.test(orderId)) {
        if (!rec["Type"] || /^(?:Parcel|Normal)$/i.test(rec["Type"])) {
          rec["Type"] = "Exchange";
        }
      }
    } else {
      // Sequential fallback
      if (i < lines.length && !isConsignmentId(lines[i]) && !/^[\d,]+(?:\.\d+)?$/.test(lines[i])) { rec["Order ID"] = lines[i]; i++; }
      if (i < lines.length && !isConsignmentId(lines[i]) && !/^[\d,]+(?:\.\d+)?$/.test(lines[i])) { rec["Store"] = lines[i]; i++; }
      if (i < lines.length && !isConsignmentId(lines[i]) && !/^[\d,]+(?:\.\d+)?$/.test(lines[i])) { rec["Recipient Name"] = lines[i]; i++; }
      if (i < lines.length && !isConsignmentId(lines[i]) && !/^[\d,]+(?:\.\d+)?$/.test(lines[i])) { rec["Address"] = lines[i]; i++; }
      if (i < lines.length && !isConsignmentId(lines[i]) && !/^[\d,]+(?:\.\d+)?$/.test(lines[i])) { rec["Phone"] = lines[i]; i++; }

      if (/^(?:D|EX)\s*-\s*\d/i.test(rec["Order ID"])) {
        if (!rec["Type"] || /^(?:Parcel|Normal)$/i.test(rec["Type"])) {
          rec["Type"] = "Exchange";
        }
      }
      if (/^(?:D|EX)\s*-\s*\d/i.test(rec["Recipient Name"]) && !rec["Order ID"]) {
        rec["Order ID"] = rec["Recipient Name"];
        rec["Recipient Name"] = "";
        rec["Type"] = "Exchange";
      }
    }

    // 3. Tokens after Phone (Delivery Status, Updated On, Amounts, Payment, Actions)
    const actionLines = [];
    while (i < lines.length && !isConsignmentId(lines[i])) {
      const line = lines[i].trim();

      if (line.toLowerCase().startsWith("updated on")) {
        rec["Status Updated On"] = parseDate(line);
      } else if (/\b(At Delivery Hub|Paid Return|Urgent Delivery Requested|Waiting for Pickup|In Transit|Returned|Delivered|Hold|Pending|Cancelled)\b/i.test(line)) {
        rec["Delivery Status"] = rec["Delivery Status"] ? `${rec["Delivery Status"]}; ${line}` : line;
      } else if (/^COD\b/i.test(line) || (/COD/i.test(line) && /[\d,]+/.test(line))) {
        rec["COD Amount"] = parseAmount(line);
      } else if (/^Charge\b/i.test(line) || (/Charge/i.test(line) && /[\d,]+/.test(line))) {
        rec["Charge"] = parseAmount(line);
      } else if (/^Discount\b/i.test(line) || (/Discount/i.test(line) && /[\d,]+/.test(line))) {
        rec["Discount"] = parseAmount(line);
      } else if (/^(?:Paid|Unpaid)$/i.test(line)) {
        rec["Payment Status"] = line;
      } else if (/^[\d,]+(?:\.\d+)?$/.test(line)) {
        const val = parseAmount(line);
        if (rec["COD Amount"] === 0) rec["COD Amount"] = val;
        else if (rec["Charge"] === 0) rec["Charge"] = val;
        else if (rec["Discount"] === 0) rec["Discount"] = val;
      } else if (!/^(?:View|POD|Action|View POD|Track)$/i.test(line) && !rec["Delivery Status"]) {
        rec["Delivery Status"] = line;
      } else {
        actionLines.push(line);
      }
      i++;
    }

    rec["Action"] = actionLines.filter(a => !/^(?:Action)$/i.test(a)).join(", ");
    if (!rec["Payment Status"]) {
      rec["Payment Status"] = "Unpaid";
    }

    records.push(rec);
  }

  return records;
}

function lenSafe(arr) {
  return arr ? arr.length : 0;
}

/**
 * Fuzzy extraction for a single consignment block
 */
function extractFieldsFuzzy(consId, textBlock) {
  const orderIdMatch = textBlock.match(/\b((?:D|EX)\s*-\s*\d{3,8}(?:\s*[a-zA-Z0-9_-]+)?|[a-zA-Z]{1,4}-\d{3,8}(?:\s*[a-zA-Z0-9_-]+)?|ORD[-\w]+|#?\d{3,8}(?:\s*[a-zA-Z])?)\b/i);
  const orderId = orderIdMatch ? orderIdMatch[1].trim() : "";

  const typeMatch = textBlock.match(/\b(Exchange|Parcel|Express|Normal|Document)\b/i);
  let type = typeMatch ? typeMatch[1] : "Parcel";
  if (/^(?:D|EX)\s*-\s*\d/i.test(orderId)) {
    if (!type || /^(?:Parcel|Normal)$/i.test(type)) {
      type = "Exchange";
    }
  }

  const storeMatch = textBlock.match(/\b(DEEN\s+[A-Za-z\s]+?OUTLET|Deen Commerce|[A-Za-z0-9\s'-]+?(?:Store|Commerce|Outlet|Mart|Shop))\b/i);
  let store = storeMatch ? storeMatch[1].trim().replace(/[\r\n]+/g, " ") : "";
  if (orderId && store.includes(orderId)) store = store.replace(orderId, "").trim();
  if (store.toLowerCase().startsWith("parcel")) store = store.replace(/^parcel\s*/i, "").trim();

  const phoneMatch = textBlock.match(/(?:(?:\+?880)|0)(1[3-9]\d{8})/);
  const phone = phoneMatch ? (phoneMatch[0].startsWith("0") ? phoneMatch[0] : "0" + phoneMatch[1]) : "";

  const codMatch = textBlock.match(/COD\s*[\u09f3৳]?\s*([\d,]+(?:\.\d+)?)/i);
  const cod = codMatch ? parseFloat(codMatch[1].replace(/,/g, "")) : 0.0;

  const chargeMatch = textBlock.match(/Charge\s*[\u09f3৳]?\s*([\d,]+(?:\.\d+)?)/i);
  const charge = chargeMatch ? parseFloat(chargeMatch[1].replace(/,/g, "")) : 0.0;

  const discountMatch = textBlock.match(/Discount\s*[\u09f3৳]?\s*([\d,]+(?:\.\d+)?)/i);
  const discount = discountMatch ? parseFloat(discountMatch[1].replace(/,/g, "")) : 0.0;

  let status = "Unpaid";
  if (/\bPaid\b/i.test(textBlock) && !/\bUnpaid\b/i.test(textBlock)) {
    status = "Paid";
  }

  const deliveryMatch = textBlock.match(/(At Delivery Hub|Paid Return|Urgent Delivery Requested|Waiting for Pickup|Returned|Delivered|In Transit|Pending|Hold|Cancelled)/i);
  const deliveryStatus = deliveryMatch ? deliveryMatch[1] : "";

  const updatedMatch = textBlock.match(/Updated on\s*([\d/]+)/i);
  const statusUpdatedOn = updatedMatch ? updatedMatch[1] : "";

  const lines = textBlock.split(/\r?\n/);
  const infoLines = [];
  const ignoreKeywords = [
    "Type:",
    "Parcel",
    "Normal",
    "Express",
    "Document",
    "COD",
    "Charge",
    "Discount",
    "Paid",
    "Unpaid",
    "View POD",
    "View",
    "POD",
    "Action",
    "Updated on",
    "Paid At:",
    deliveryStatus,
    store,
    orderId,
    consId
  ];

  for (let line of lines) {
    const cleanLine = line.trim();
    if (!cleanLine) continue;
    if (/(?:(?:\+?880)|0)1[3-9]\d{8}/.test(cleanLine)) continue;

    let shouldIgnore = false;
    for (let kw of ignoreKeywords) {
      if (kw && cleanLine.toLowerCase().includes(kw.toLowerCase())) {
        shouldIgnore = true;
        break;
      }
    }

    if (!shouldIgnore) {
      infoLines.push(cleanLine);
    }
  }

  const filteredInfo = [];
  for (let line of infoLines) {
    if (/^\d+$/.test(line)) continue;
    filteredInfo.push(line);
  }

  let name = "";
  let address = "";
  if (filteredInfo.length > 0) {
    name = filteredInfo[0];
  }
  if (filteredInfo.length > 1) {
    address = filteredInfo.slice(1).join(", ");
  }

  return {
    "Consignment ID": consId,
    "Type": type,
    "Order ID": orderId,
    "Store": store,
    "Recipient Name": name,
    "Address": address,
    "Phone": phone,
    "Delivery Status": deliveryStatus,
    "Status Updated On": statusUpdatedOn,
    "COD Amount": isNaN(cod) ? 0.0 : cod,
    "Charge": isNaN(charge) ? 0.0 : charge,
    "Discount": isNaN(discount) ? 0.0 : discount,
    "Payment Status": status,
    "Action": ""
  };
}

/**
 * Fuzzy block extraction
 */
function parseFuzzyRecords(rawText) {
  const pattern = /([A-Z]{2}\d{6}[A-Z0-9]+)/gi;
  const parts = rawText.split(pattern);
  const records = [];

  // parts: [before, match1, text1, match2, text2, ...]
  for (let i = 1; i < parts.length; i += 2) {
    if (i + 1 < parts.length) {
      const consId = parts[i].trim();
      const body = parts[i + 1].trim();
      const rec = extractFieldsFuzzy(consId, body);
      records.push(rec);
    }
  }
  return records;
}

/**
 * Detect if text is from WooCommerce admin orders list
 */
function isWooCommerceText(raw) {
  if (!raw || typeof raw !== "string") return false;
  return /Preview\s*#\d+/i.test(raw) ||
         (/wc-orders/i.test(raw) && /#\d+/i.test(raw)) ||
         (/Send with Pathao/i.test(raw) && /#\d+/i.test(raw)) ||
         (/Orders Add order/i.test(raw) && /Preview/i.test(raw)) ||
         (/woocommerce/i.test(raw) && /#\d+/i.test(raw));
}

/**
 * Intelligent Parser for WooCommerce Orders Admin Table
 */
function parseWooCommerceOrders(raw) {
  const lines = (raw || "").replace(/\t/g, "\n").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const records = [];

  const isOrderHeader = (s) => /^(?:Preview\s*)?#?((?:D|EX)?[-\s]?\d{3,8})\s*(.*)$/i.test(s) &&
                               !/items|page|orders|sort ascending|select all/i.test(s);

  const blocks = [];
  let currentBlock = null;

  for (let line of lines) {
    if (isOrderHeader(line) && (/Preview\s*#/i.test(line) || /^#((?:D|EX)?[-\s]?\d{3,8})\s+[a-zA-Z\u0980-\u09FF]/i.test(line))) {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = [line];
    } else if (currentBlock) {
      currentBlock.push(line);
    }
  }
  if (currentBlock) blocks.push(currentBlock);

  for (let b of blocks) {
    const headerLine = b[0];
    let orderId = "";
    let name = "";

    const mPreview = headerLine.match(/^(?:Preview\s*)?#?((?:D|EX)?[-\s]?\d{3,8})\s*(.*)$/i);
    if (mPreview) {
      orderId = mPreview[1].replace(/\s+/g, "");
      name = mPreview[2].trim();
    }

    const isExchange = /^(?:D|EX)\s*-\s*\d/i.test(orderId);
    const type = isExchange ? "Exchange" : "Parcel";

    let date = "";
    let wcStatus = "";
    let store = "";
    let total = 0;
    let consId = "";
    let pathaoStatus = "";
    let fee = 0;
    let origin = "";
    let invoice = "";
    let phone = "";

    for (let i = 1; i < b.length; i++) {
      const line = b[i];

      if (!phone && /(?:(?:\+?880)|0)1[3-9]\d{8}/.test(line)) {
        const mPhone = line.match(/(?:(?:\+?880)|0)1[3-9]\d{8}/);
        if (mPhone) phone = mPhone[0];
      }

      if (!date && (/\b(?:ago|yesterday|today)\b/i.test(line) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(line))) {
        date = line;
        continue;
      }

      if (!wcStatus && /^(?:Completed|Processing|On hold|Cancelled|Failed|Pending payment|Refunded)$/i.test(line)) {
        wcStatus = line;
        continue;
      }

      if (!store && (/^—\s*[a-zA-Z0-9\s,]+/.test(line) || /online|outlet|warehouse|mart|shop|store/i.test(line))) {
        store = line.replace(/^[—\-\s]+/, "").trim();
        continue;
      }

      if (total === 0 && (line.includes("৳") || /[\d,]+\s*৳/.test(line))) {
        total = parseAmount(line);
        continue;
      }

      if (!consId && isConsignmentId(line)) {
        consId = getConsignmentId(line);
        continue;
      }

      if (/Send with Pathao/i.test(line)) {
        pathaoStatus = "Send with Pathao";
        continue;
      }

      if (consId && !pathaoStatus && /^(?:Pending|In Transit|Delivered|Returned|Hold|Cancelled)$/i.test(line)) {
        pathaoStatus = line;
        continue;
      }

      if (consId && fee === 0 && /^\d+(?:\.\d+)?$/.test(line) && line !== orderId) {
        fee = parseAmount(line);
        continue;
      }

      if (!origin && (/^Source:/i.test(line) || /^(?:Direct|Fb|Website|Facebook)$/i.test(line) || (store && line.toLowerCase() === store.toLowerCase()))) {
        origin = line;
        continue;
      }

      if (!invoice && /^\d+$/.test(line)) {
        invoice = line;
        continue;
      }
    }

    let deliveryStatus = "";
    if (consId) {
      deliveryStatus = pathaoStatus ? `Pathao: ${pathaoStatus}` : "Dispatched";
    } else if (pathaoStatus) {
      deliveryStatus = "Send with Pathao";
    } else {
      deliveryStatus = wcStatus || "Pending";
    }

    records.push({
      "Consignment ID": consId || "Send with Pathao",
      "Type": type,
      "Order ID": orderId,
      "Store": store,
      "Recipient Name": name,
      "Address": origin ? `Origin: ${origin}` : "",
      "Phone": phone,
      "Delivery Status": deliveryStatus,
      "Status Updated On": date,
      "COD Amount": total,
      "Charge": fee,
      "Discount": 0.0,
      "Payment Status": wcStatus || "Unpaid",
      "Action": origin ? `Origin: ${origin}` : ""
    });
  }

  return records;
}

/**
 * Compute KPI metrics for parsed delivery records
 */
function computeMetrics(records) {
  const totalParcels = records.length;
  let paidCount = 0;
  let unpaidCount = 0;
  let unsentCount = 0;
  let dispatchedCount = 0;
  let totalCOD = 0;
  let totalCharge = 0;
  let totalDiscount = 0;

  for (let rec of records) {
    const pStatus = (rec["Payment Status"] || "").toString().toLowerCase();
    if (pStatus === "paid" || pStatus === "completed") {
      paidCount++;
    } else {
      unpaidCount++;
    }

    const cons = (rec["Consignment ID"] || "").toString();
    const delStatus = (rec["Delivery Status"] || "").toString();
    const isUnsent = /Send with Pathao|Unsent/i.test(cons) || /Send with Pathao|Unsent/i.test(delStatus);
    if (isUnsent) {
      unsentCount++;
    } else if (cons && !/Send with Pathao/i.test(cons)) {
      dispatchedCount++;
    }

    totalCOD += Number(rec["COD Amount"]) || 0;
    totalCharge += Number(rec["Charge"]) || 0;
    totalDiscount += Number(rec["Discount"]) || 0;
  }

  const netRevenue = totalCOD - totalCharge + totalDiscount;

  return {
    totalParcels,
    paidCount,
    unpaidCount,
    unsentCount,
    dispatchedCount,
    totalCOD,
    totalCharge,
    totalDiscount,
    netRevenue
  };
}

/**
 * Main parser entrypoint
 */
function parseDeliveryData(rawText, forceFuzzy = false) {
  if (!rawText || !rawText.trim()) {
    return { records: [], metrics: computeMetrics([]), mode: "none" };
  }

  let records = [];
  let mode = "standard";

  // Check if WooCommerce text format
  if (!forceFuzzy && isWooCommerceText(rawText)) {
    try {
      records = parseWooCommerceOrders(rawText);
      if (records.length > 0) {
        mode = "woocommerce";
      }
    } catch (err) {
      records = [];
    }
  }

  if (records.length === 0 && !forceFuzzy) {
    try {
      records = parseStandardRecords(rawText);
    } catch (err) {
      records = [];
    }
  }

  if (records.length === 0) {
    mode = "fuzzy";
    try {
      records = parseFuzzyRecords(rawText);
    } catch (err) {
      records = [];
    }
  }

  return {
    records,
    metrics: computeMetrics(records),
    mode
  };
}

/**
 * Export records as CSV with UTF-8 BOM
 */
function exportToCSV(records, filename = "deliveries.csv") {
  if (!records || records.length === 0) return;

  const columns = [
    "Consignment ID",
    "Type",
    "Order ID",
    "Store",
    "Recipient Name",
    "Address",
    "Phone",
    "Delivery Status",
    "Status Updated On",
    "COD Amount",
    "Charge",
    "Discount",
    "Payment Status",
    "Action"
  ];

  const lines = [columns.map(col => `"${col}"`).join(",")];

  for (let row of records) {
    const rowValues = columns.map(col => {
      const val = row[col] !== undefined && row[col] !== null ? String(row[col]) : "";
      return `"${val.replace(/"/g, '""')}"`;
    });
    lines.push(rowValues.join(","));
  }

  const csvContent = "\uFEFF" + lines.join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export records as Excel XML (.xls) with formatting and formulas
 */
function exportToExcelXML(records, filename = "deliveries.xls") {
  if (!records || records.length === 0) return;

  const columns = [
    "Consignment ID",
    "Type",
    "Order ID",
    "Store",
    "Recipient Name",
    "Address",
    "Phone",
    "Delivery Status",
    "Status Updated On",
    "COD Amount",
    "Charge",
    "Discount",
    "Payment Status",
    "Action"
  ];

  let rowsXML = "";
  // Header row
  rowsXML += '<Row ss:StyleID="HeaderStyle">';
  for (let col of columns) {
    rowsXML += `<Cell><Data ss:Type="String">${escapeXML(col)}</Data></Cell>`;
  }
  rowsXML += "</Row>\n";

  // Data rows
  for (let r of records) {
    rowsXML += "<Row>";
    for (let col of columns) {
      const val = r[col];
      const isNum = ["COD Amount", "Charge", "Discount"].includes(col);
      if (isNum) {
        const num = parseFloat(val) || 0;
        rowsXML += `<Cell ss:StyleID="CurrencyStyle"><Data ss:Type="Number">${num}</Data></Cell>`;
      } else {
        const strVal = val !== undefined && val !== null ? String(val) : "";
        rowsXML += `<Cell><Data ss:Type="String">${escapeXML(strVal)}</Data></Cell>`;
      }
    }
    rowsXML += "</Row>\n";
  }

  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="10"/>
  </Style>
  <Style ss:ID="HeaderStyle">
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#0F172A" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="CurrencyStyle">
   <NumberFormat ss:Format="#,##0.00"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Deliveries">
  <Table>
   <Column ss:Width="120"/>
   <Column ss:Width="60"/>
   <Column ss:Width="80"/>
   <Column ss:Width="140"/>
   <Column ss:Width="130"/>
   <Column ss:Width="260"/>
   <Column ss:Width="100"/>
   <Column ss:Width="120"/>
   <Column ss:Width="100"/>
   <Column ss:Width="90"/>
   <Column ss:Width="70"/>
   <Column ss:Width="70"/>
   <Column ss:Width="90"/>
   <Column ss:Width="100"/>
   ${rowsXML}
  </Table>
 </Worksheet>
</Workbook>`;

  const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export records as genuine OpenXML .xlsx spreadsheet
 */
function exportToXLSX(records, filename = "deliveries.xlsx") {
  if (!records || records.length === 0) return;

  if (typeof XLSX !== "undefined") {
    const ws = XLSX.utils.json_to_sheet(records);

    // Auto-fit column widths
    const colWidths = [];
    const keys = Object.keys(records[0]);
    for (let k of keys) {
      let maxLen = k.length;
      for (let r of records) {
        const valStr = r[k] !== undefined && r[k] !== null ? String(r[k]) : "";
        if (valStr.length > maxLen) maxLen = Math.min(valStr.length, 60);
      }
      colWidths.push({ wch: maxLen + 3 });
    }
    ws["!cols"] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Deliveries");

    // Write binary xlsx array
    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

    if (typeof document !== "undefined" && typeof URL !== "undefined") {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  } else {
    console.warn("XLSX not available, falling back to Excel XML");
    exportToExcelXML(records, filename.replace(/\.xlsx$/i, ".xls"));
  }
}

function escapeXML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * 64 Bangladesh Districts with aliases and Bengali transliterations
 */
const BD_DISTRICTS = [
  { name: "Dhaka", aliases: ["dhaka", "dacca", "ঢাকা"] },
  { name: "Gazipur", aliases: ["gazipur", "গাজীপুর"] },
  { name: "Narayanganj", aliases: ["narayanganj", "narayangonj", "নারায়ণগঞ্জ"] },
  { name: "Tangail", aliases: ["tangail", "টাঙ্গাইল"] },
  { name: "Narsingdi", aliases: ["narsingdi", "narshingdi", "নরসিংদী"] },
  { name: "Munshiganj", aliases: ["munshiganj", "munshigonj", "মুন্সিগঞ্জ", "মুন্সীগঞ্জ"] },
  { name: "Manikganj", aliases: ["manikganj", "manikgonj", "মানিকগঞ্জ"] },
  { name: "Faridpur", aliases: ["faridpur", "ফরিদপুর"] },
  { name: "Gopalganj", aliases: ["gopalganj", "gopalgonj", "গোপালগঞ্জ"] },
  { name: "Madaripur", aliases: ["madaripur", "মাদারীপুর"] },
  { name: "Rajbari", aliases: ["rajbari", "রাজবাড়ী", "রাজবাড়ি"] },
  { name: "Shariatpur", aliases: ["shariatpur", "শরীয়তপুর"] },
  { name: "Kishoreganj", aliases: ["kishoreganj", "kishoregonj", "কিশোরগঞ্জ"] },
  { name: "Chattogram", aliases: ["chattogram", "chittagong", "ctg", "চট্টগ্রাম"] },
  { name: "Cox's Bazar", aliases: ["cox's bazar", "coxs bazar", "coxsbazar", "কক্সবাজার"] },
  { name: "Cumilla", aliases: ["cumilla", "comilla", "কুমিল্লা"] },
  { name: "Feni", aliases: ["feni", "ফেনী"] },
  { name: "Brahmanbaria", aliases: ["brahmanbaria", "b.baria", "bbaria", "ব্রাহ্মণবাড়িয়া"] },
  { name: "Noakhali", aliases: ["noakhali", "নোয়াখালী"] },
  { name: "Chandpur", aliases: ["chandpur", "চাঁদপুর"] },
  { name: "Lakshmipur", aliases: ["lakshmipur", "laxmipur", "লক্ষ্মীপুর"] },
  { name: "Rangamati", aliases: ["rangamati", "রাঙ্গামাটি"] },
  { name: "Khagrachhari", aliases: ["khagrachhari", "khagrachari", "খাগড়াছড়ি"] },
  { name: "Bandarban", aliases: ["bandarban", "বান্দরবান"] },
  { name: "Sylhet", aliases: ["sylhet", "সিলেট"] },
  { name: "Moulvibazar", aliases: ["moulvibazar", "maulvibazar", "মৌলভীবাজার"] },
  { name: "Habiganj", aliases: ["habiganj", "habigonj", "হবিগঞ্জ"] },
  { name: "Sunamganj", aliases: ["sunamganj", "sunamgonj", "সুনামগঞ্জ"] },
  { name: "Rajshahi", aliases: ["rajshahi", "রাজশাহী"] },
  { name: "Bogura", aliases: ["bogura", "bogra", "বগুড়া"] },
  { name: "Pabna", aliases: ["pabna", "পাবনা"] },
  { name: "Sirajganj", aliases: ["sirajganj", "sirajgonj", "সিরাজগঞ্জ"] },
  { name: "Naogaon", aliases: ["naogaon", "নওগাঁ"] },
  { name: "Natore", aliases: ["natore", "নাটোর"] },
  { name: "Joypurhat", aliases: ["joypurhat", "জয়পুরহাট"] },
  { name: "Chapainawabganj", aliases: ["chapainawabganj", "chapai nawabganj", "চাঁপাইনবাবগঞ্জ"] },
  { name: "Khulna", aliases: ["khulna", "খুলনা"] },
  { name: "Jashore", aliases: ["jashore", "jessore", "যশোর"] },
  { name: "Kushtia", aliases: ["kushtia", "কুষ্টিয়া"] },
  { name: "Jhenaidah", aliases: ["jhenaidah", "jhenaidha", "ঝিনাইদহ"] },
  { name: "Satkhira", aliases: ["satkhira", "সাতক্ষীরা"] },
  { name: "Bagerhat", aliases: ["bagerhat", "বাগেরহাট"] },
  { name: "Chuadanga", aliases: ["chuadanga", "চুয়াডাঙ্গা"] },
  { name: "Magura", aliases: ["magura", "মাগুরা"] },
  { name: "Meherpur", aliases: ["meherpur", "মেহেরপুর"] },
  { name: "Narail", aliases: ["narail", "নড়াইল"] },
  { name: "Barishal", aliases: ["barishal", "barisal", "বরিশাল"] },
  { name: "Bhola", aliases: ["bhola", "ভোলা"] },
  { name: "Patuakhali", aliases: ["patuakhali", "পটুয়াখালী"] },
  { name: "Pirojpur", aliases: ["pirojpur", "পিরোজপুর"] },
  { name: "Barguna", aliases: ["barguna", "বরগুনা"] },
  { name: "Jhalokathi", aliases: ["jhalokathi", "jhalakati", "ঝালকাঠি"] },
  { name: "Rangpur", aliases: ["rangpur", "রংপুর"] },
  { name: "Dinajpur", aliases: ["dinajpur", "দিনাজপুর"] },
  { name: "Gaibandha", aliases: ["gaibandha", "গাইবান্ধা"] },
  { name: "Kurigram", aliases: ["kurigram", "কুড়িগ্রাম"] },
  { name: "Lalmonirhat", aliases: ["lalmonirhat", "লালমনিরহাট"] },
  { name: "Nilphamari", aliases: ["nilphamari", "নীলফামারী"] },
  { name: "Panchagarh", aliases: ["panchagarh", "পঞ্চগড়"] },
  { name: "Thakurgaon", aliases: ["thakurgaon", "ঠাকুরগাঁও"] },
  { name: "Mymensingh", aliases: ["mymensingh", "ময়মনসিংহ"] },
  { name: "Jamalpur", aliases: ["jamalpur", "জামালপুর"] },
  { name: "Netrokona", aliases: ["netrokona", "netrakona", "নেত্রকোণা", "নেত্রকোনা"] },
  { name: "Sherpur", aliases: ["sherpur", "শেরপুর"] }
];

/**
 * ISO 3166-2:BD District Codes for Bangladesh (used by WooCommerce states BD-01 to BD-64)
 */
const BD_ISO_DISTRICTS = {
  "BD-01": "Bandarban",
  "BD-02": "Barguna",
  "BD-03": "Bogura",
  "BD-04": "Brahmanbaria",
  "BD-05": "Bagerhat",
  "BD-06": "Barishal",
  "BD-07": "Bhola",
  "BD-08": "Cumilla",
  "BD-09": "Chandpur",
  "BD-10": "Chattogram",
  "BD-11": "Cox's Bazar",
  "BD-12": "Chuadanga",
  "BD-13": "Dhaka",
  "BD-14": "Dinajpur",
  "BD-15": "Faridpur",
  "BD-16": "Feni",
  "BD-17": "Gopalganj",
  "BD-18": "Gazipur",
  "BD-19": "Gaibandha",
  "BD-20": "Habiganj",
  "BD-21": "Jamalpur",
  "BD-22": "Jashore",
  "BD-23": "Jhenaidah",
  "BD-24": "Joypurhat",
  "BD-25": "Jhalokathi",
  "BD-26": "Kishoreganj",
  "BD-27": "Khulna",
  "BD-28": "Kurigram",
  "BD-29": "Khagrachhari",
  "BD-30": "Kushtia",
  "BD-31": "Lakshmipur",
  "BD-32": "Lalmonirhat",
  "BD-33": "Manikganj",
  "BD-34": "Mymensingh",
  "BD-35": "Munshiganj",
  "BD-36": "Madaripur",
  "BD-37": "Magura",
  "BD-38": "Moulvibazar",
  "BD-39": "Meherpur",
  "BD-40": "Narayanganj",
  "BD-41": "Netrokona",
  "BD-42": "Narsingdi",
  "BD-43": "Narail",
  "BD-44": "Natore",
  "BD-45": "Chapainawabganj",
  "BD-46": "Nilphamari",
  "BD-47": "Noakhali",
  "BD-48": "Naogaon",
  "BD-49": "Pabna",
  "BD-50": "Pirojpur",
  "BD-51": "Patuakhali",
  "BD-52": "Panchagarh",
  "BD-53": "Rajbari",
  "BD-54": "Rajshahi",
  "BD-55": "Rangpur",
  "BD-56": "Rangamati",
  "BD-57": "Sherpur",
  "BD-58": "Satkhira",
  "BD-59": "Sirajganj",
  "BD-60": "Sylhet",
  "BD-61": "Sunamganj",
  "BD-62": "Shariatpur",
  "BD-63": "Tangail",
  "BD-64": "Thakurgaon"
};

/**
 * Detect district name from ISO 3166-2:BD code (e.g. "BD-15" -> "Faridpur", "BD-18" -> "Gazipur")
 */
function detectDistrictFromISOCode(text) {
  if (!text || typeof text !== "string") return "";
  const match = text.match(/\bBD[-_\s]?([0-6]?\d)\b/i);
  if (!match) return "";
  const num = parseInt(match[1], 10);
  if (num >= 1 && num <= 64) {
    const code = "BD-" + String(num).padStart(2, "0");
    return BD_ISO_DISTRICTS[code] || "";
  }
  return "";
}

/**
 * Get ISO 3166-2:BD code for a district name (e.g. "Faridpur" -> "BD-15")
 */
function getISOCodeFromDistrict(name) {
  if (!name || typeof name !== "string") return "";
  const cleanName = name.trim().toLowerCase();
  for (const [code, dist] of Object.entries(BD_ISO_DISTRICTS)) {
    if (dist.toLowerCase() === cleanName) return code;
  }
  const dObj = BD_DISTRICTS.find(d => d.name.toLowerCase() === cleanName || d.aliases.some(a => a.toLowerCase() === cleanName));
  if (dObj) {
    for (const [code, dist] of Object.entries(BD_ISO_DISTRICTS)) {
      if (dist.toLowerCase() === dObj.name.toLowerCase()) return code;
    }
  }
  return "";
}

/**
 * Common Thanas / Zones in Dhaka City
 */
/**
 * Common Thanas / Zones in Dhaka City with aliases & Bengali transliterations
 */
const DHAKA_ZONES = [
  { name: "Uttara", aliases: ["uttara", "উত্তরা"] },
  { name: "Mirpur", aliases: ["mirpur", "মিরপুর"] },
  { name: "Dhanmondi", aliases: ["dhanmondi", "ধানমন্ডি", "ধানমণ্ডি"] },
  { name: "Gulshan", aliases: ["gulshan", "গুলশান"] },
  { name: "Banani", aliases: ["banani", "বনানী"] },
  { name: "Mohammadpur", aliases: ["mohammadpur", "মোহাম্মদপুর"] },
  { name: "Badda", aliases: ["badda", "বাড্ডা"] },
  { name: "Motijheel", aliases: ["motijheel", "মতিঝিল"] },
  { name: "Tejgaon", aliases: ["tejgaon", "তেজগাঁও"] },
  { name: "Khilgaon", aliases: ["khilgaon", "খিলগাঁও"] },
  { name: "Malibagh", aliases: ["malibagh", "মালিবাগ"] },
  { name: "Moghbazar", aliases: ["moghbazar", "মগবাজার"] },
  { name: "Rampura", aliases: ["rampura", "রামপুরা"] },
  { name: "Banasree", aliases: ["banasree", "বনশ্রী"] },
  { name: "Basabo", aliases: ["basabo", "বাসাবো"] },
  { name: "Jatrabari", aliases: ["jatrabari", "যাত্রাবাড়ী", "যাত্রাবাড়ি"] },
  { name: "Wari", aliases: ["wari", "ওয়ারী", "ওয়ারি"] },
  { name: "Lalbagh", aliases: ["lalbagh", "লালবাগ"] },
  { name: "Kotwali", aliases: ["kotwali", "কোতোয়ালী", "কোতোয়ালি"] },
  { name: "Chaukbazar", aliases: ["chaukbazar", "চকবাজার"] },
  { name: "Sutrapur", aliases: ["sutrapur", "সূত্রাপুর"] },
  { name: "Gandaria", aliases: ["gandaria", "গেন্ডারিয়া"] },
  { name: "Hazaribagh", aliases: ["hazaribagh", "হাজারীবাগ"] },
  { name: "Kamrangirchar", aliases: ["kamrangirchar", "কামরাঙ্গীরচর"] },
  { name: "New Market", aliases: ["new market", "নিউ মার্কেট"] },
  { name: "Shahbagh", aliases: ["shahbagh", "শাহবাগ"] },
  { name: "Paltan", aliases: ["paltan", "পল্টন"] },
  { name: "Ramna", aliases: ["ramna", "রমনা"] },
  { name: "Elephant Road", aliases: ["elephant road", "এলিফ্যান্ট রোড"] },
  { name: "Panthapath", aliases: ["panthapath", "পান্থপথ"] },
  { name: "Farmgate", aliases: ["farmgate", "ফার্মগেট"] },
  { name: "Agargaon", aliases: ["agargaon", "আগারগাঁও"] },
  { name: "Sherebangla Nagar", aliases: ["sherebangla nagar", "শেরেবাংলা নগর"] },
  { name: "Kafrul", aliases: ["kafrul", "কাফরুল"] },
  { name: "Cantonment", aliases: ["cantonment", "সেনানিবাস"] },
  { name: "Mohakhali", aliases: ["mohakhali", "মহাখালী"] },
  { name: "Baridhara", aliases: ["baridhara", "বারিধারা"] },
  { name: "Bashundhara", aliases: ["bashundhara", "বসুন্ধরা"] },
  { name: "Khilkhet", aliases: ["khilkhet", "খিলক্ষেত"] },
  { name: "Dakshinkhan", aliases: ["dakshinkhan", "দক্ষিণখান"] },
  { name: "Uttar Khan", aliases: ["uttar khan", "উত্তরখান"] },
  { name: "Turag", aliases: ["turag", "তুরাগ"] },
  { name: "Demra", aliases: ["demra", "ডেমরা"] },
  { name: "Shyampur", aliases: ["shyampur", "শ্যামপুর"] },
  { name: "Adabor", aliases: ["adabor", "আদাবর"] },
  { name: "Kalyanpur", aliases: ["kalyanpur", "কল্যাণপুর"] },
  { name: "Gabtoli", aliases: ["gabtoli", "গাবতলী"] },
  { name: "Savar", aliases: ["savar", "সাভার"] },
  { name: "Ashulia", aliases: ["ashulia", "আশুলিয়া"] },
  { name: "Dhamrai", aliases: ["dhamrai", "ধামরাই"] },
  { name: "Keraniganj", aliases: ["keraniganj", "কেরানীগঞ্জ"] },
  { name: "Tongi", aliases: ["tongi", "টঙ্গী", "টঙ্গি"] }
];

const DELIM_START = "(?:^|[\\s,;:\\/\\\\_\\-\\(\\)\\[\\]{}।ঃ|#])";
const DELIM_END = "(?:$|[\\s,;:\\/\\\\_\\-\\(\\)\\[\\]{}।ঃ|#0-9])";

/**
 * Unicode-aware word match with Bengali suffix/locative inflection support
 */
function matchWord(text, alias) {
  if (!text || !alias) return false;
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = `${DELIM_START}${escaped}(?:ে|ের|য়|য়)?${DELIM_END}`;
  return new RegExp(pattern, "i").test(text);
}

/**
 * Prominent Zones in Other Major Hubs across Bangladesh with English & Bengali aliases
 */
const OTHER_CITY_ZONES = {
  "Gazipur": [
    { name: "Sreepur", aliases: ["sreepur", "শ্রীপুর"] },
    { name: "Tongi", aliases: ["tongi", "টঙ্গী", "টঙ্গি"] },
    { name: "Kaliakair", aliases: ["kaliakair", "কালিয়াকৈর", "কালিয়াকৈর"] },
    { name: "Kapasia", aliases: ["kapasia", "কাপাসিয়া", "কাপাসিয়া"] },
    { name: "Kaliganj", aliases: ["kaliganj", "কালীগঞ্জ", "কালিগঞ্জ"] },
    { name: "Konabari", aliases: ["konabari", "কোনাবাড়ী", "কোনাবাড়ি"] },
    { name: "Board Bazar", aliases: ["board bazar", "বোর্ড বাজার"] },
    { name: "Chandona", aliases: ["chandona", "চান্দনা"] },
    { name: "Joydebpur", aliases: ["joydebpur", "joydevpur", "জয়দেবপুর", "জয়দেবপুর"] },
    { name: "Gazipur Sadar", aliases: ["gazipur sadar", "গাজীপুর সদর"] }
  ],
  "Narayanganj": [
    { name: "Fatullah", aliases: ["fatullah", "ফতুল্লা"] },
    { name: "Siddhirganj", aliases: ["siddhirganj", "সিদ্ধিরগঞ্জ"] },
    { name: "Bandar", aliases: ["bandar", "বন্দর"] },
    { name: "Rupganj", aliases: ["rupganj", "রূপগঞ্জ", "রুপগঞ্জ"] },
    { name: "Araihazar", aliases: ["araihazar", "আড়াইহাজার", "আড়াইহাজার"] },
    { name: "Sonargaon", aliases: ["sonargaon", "সোনারগাঁও", "সোনারগা"] },
    { name: "Kanchpur", aliases: ["kanchpur", "কাঁচপুর", "কাচপুর"] },
    { name: "Narayanganj Sadar", aliases: ["narayanganj sadar", "নারায়ণগঞ্জ সদর"] }
  ],
  "Faridpur": [
    { name: "Boalmari", aliases: ["boalmari", "বোয়ালমারী", "বোয়ালমারী"] },
    { name: "Bhanga", aliases: ["bhanga", "ভাঙ্গা"] },
    { name: "Alfadanga", aliases: ["alfadanga", "আলফাডাঙ্গা"] },
    { name: "Madhukhali", aliases: ["madhukhali", "মধুখালী"] },
    { name: "Nagarkanda", aliases: ["nagarkanda", "নগরকান্দা"] },
    { name: "Sadarpur", aliases: ["sadarpur", "সদরপুর"] },
    { name: "Charbhadrasan", aliases: ["charbhadrasan", "চরভদ্রাসন"] },
    { name: "Saltha", aliases: ["saltha", "সালথা"] },
    { name: "Faridpur Sadar", aliases: ["faridpur sadar", "ফরিদপুর সদর"] }
  ],
  "Chattogram": [
    { name: "Agrabad", aliases: ["agrabad", "আগ্রাবাদ"] },
    { name: "Nasirabad", aliases: ["nasirabad", "নাসিরাবাদ"] },
    { name: "Halishahar", aliases: ["halishahar", "হালিশহর"] },
    { name: "Panchlaish", aliases: ["panchlaish", "পাঁচলাইশ"] },
    { name: "Kotwali", aliases: ["kotwali", "কোতোয়ালী", "কোতোয়ালী", "কোতোয়ালি"] },
    { name: "Khulshi", aliases: ["khulshi", "খুলশী", "খুলশি"] },
    { name: "Chandgaon", aliases: ["chandgaon", "চান্দগাঁও", "চান্দগাও"] },
    { name: "Bakalia", aliases: ["bakalia", "বাকলিয়া", "বাকলিয়া"] },
    { name: "Pahartali", aliases: ["pahartali", "পাহাড়তলী", "পাহাড়তলী"] },
    { name: "Patenga", aliases: ["patenga", "পতেঙ্গা"] },
    { name: "Muradpur", aliases: ["muradpur", "মুরাদপুর"] },
    { name: "GEC", aliases: ["gec", "জিইসি"] },
    { name: "Bayazid", aliases: ["bayazid", "বায়েজিদ", "বায়েজিদ"] },
    { name: "Hathazari", aliases: ["hathazari", "হাটহাজারী", "হাটহাজারি"] },
    { name: "Sitakunda", aliases: ["sitakunda", "sitakund", "সীতাকুণ্ড", "সীতাকুন্ড"] },
    { name: "Chawkbazar", aliases: ["chawkbazar", "চকবাজার"] },
    { name: "Chattogram Sadar", aliases: ["chattogram sadar", "চট্টগ্রাম সদর"] }
  ],
  "Sylhet": [
    { name: "Zindabazar", aliases: ["zindabazar", "জিন্দাবাজার"] },
    { name: "Amberkhana", aliases: ["amberkhana", "আম্বরখানা"] },
    { name: "Shibganj", aliases: ["shibganj", "শিবগঞ্জ"] },
    { name: "Upashahar", aliases: ["upashahar", "উপশহর"] },
    { name: "Kadamtoli", aliases: ["kadamtoli", "কদমতলী", "কদমতলি"] },
    { name: "Subidbazar", aliases: ["subidbazar", "সুবিদবাজার"] },
    { name: "South Surma", aliases: ["south surma", "দক্ষিণ সুরমা"] },
    { name: "Kumarpara", aliases: ["kumarpara", "কুমারপাড়া", "কুমারপাড়া"] },
    { name: "Lamabazar", aliases: ["lamabazar", "লামাবাজার"] },
    { name: "Beanibazar", aliases: ["beanibazar", "বিয়ানীবাজার", "বিয়ানীবাজার"] },
    { name: "Golapganj", aliases: ["golapganj", "গোলাপগঞ্জ"] },
    { name: "Sylhet Sadar", aliases: ["sylhet sadar", "সিলেট সদর"] }
  ],
  "Cumilla": [
    { name: "Kandirpar", aliases: ["kandirpar", "কান্দিরপাড়", "কান্দিরপাড়", "কান্দিরপার"] },
    { name: "Badurtala", aliases: ["badurtala", "বাদুরতলা"] },
    { name: "Kotwali", aliases: ["kotwali", "কোতোয়ালী", "কোতোয়ালী"] },
    { name: "Tomsom Bridge", aliases: ["tomsom bridge", "টমছম ব্রিজ"] },
    { name: "Shashangachha", aliases: ["shashangachha", "শাসনগাছা"] },
    { name: "EPZ", aliases: ["epz", "ইপিজেড"] },
    { name: "Titas", aliases: ["titas", "তিতাস", "titas upazila", "তিতাস উপজেলা", "titas bazar", "তিতাস বাজার"] },
    { name: "Daudkandi", aliases: ["daudkandi", "দাউদকান্দি"] },
    { name: "Homna", aliases: ["homna", "হোমনা"] },
    { name: "Meghna", aliases: ["meghna", "মেঘনা"] },
    { name: "Muradnagar", aliases: ["muradnagar", "মুরাদনগর"] },
    { name: "Chandina", aliases: ["chandina", "চান্দিনা"] },
    { name: "Laksam", aliases: ["laksam", "লাকসাম"] },
    { name: "Chauddagram", aliases: ["chauddagram", "চৌদ্দগ্রাম"] },
    { name: "Debidwar", aliases: ["debidwar", "দেবীদ্বার", "দেবিদ্বার"] },
    { name: "Barura", aliases: ["barura", "বরুড়া", "বরুড়া"] },
    { name: "Burichang", aliases: ["burichang", "বুড়িচং", "বুড়িচং"] },
    { name: "Brahmanpara", aliases: ["brahmanpara", "ব্রাহ্মণপাড়া", "ব্রাহ্মণপাড়া"] },
    { name: "Monohargonj", aliases: ["monohargonj", "manoharganj", "মনোহরগঞ্জ"] },
    { name: "Lalmai", aliases: ["lalmai", "লালমাই"] },
    { name: "Cumilla Sadar", aliases: ["cumilla sadar", "কুমিল্লা সদর"] },
    { name: "Cumilla Sadar Dakshin", aliases: ["cumilla sadar dakshin", "কুমিল্লা সদর দক্ষিণ"] }
  ],
  "Khulna": [
    { name: "Sonadanga", aliases: ["sonadanga", "সোনাডাঙ্গা"] },
    { name: "Khalishpur", aliases: ["khalishpur", "খালিশপুর"] },
    { name: "Daulatpur", aliases: ["daulatpur", "দৌলতপুর"] },
    { name: "Khan Jahan Ali", aliases: ["khan jahan ali", "খান জাহান আলী"] },
    { name: "Boyra", aliases: ["boyra", "বয়রা", "বয়রা"] },
    { name: "Rupsha", aliases: ["rupsha", "রূপসা", "রুপসা"] },
    { name: "Phultala", aliases: ["phultala", "ফুলতলা"] },
    { name: "Dumuria", aliases: ["dumuria", "ডুমুরিয়া", "ডুমুরিয়া"] },
    { name: "Batiaghata", aliases: ["batiaghata", "বটিয়াঘাটা", "বটিয়াঘাটা"] },
    { name: "Khulna Sadar", aliases: ["khulna sadar", "খুলনা সদর"] }
  ],
  "Barishal": [
    { name: "Natullabad", aliases: ["natullabad", "নথুল্লাবাদ"] },
    { name: "Rupatali", aliases: ["rupatali", "রূপাতলী", "রুপাতলী", "রূপাতলি"] },
    { name: "Choumatha", aliases: ["choumatha", "chowmatha", "চৌমাথা"] },
    { name: "Band Road", aliases: ["band road", "ব্যান্ড রোড", "বান্দ রোড"] },
    { name: "Gournadi", aliases: ["gournadi", "গৌরনদী"] },
    { name: "Agailjhara", aliases: ["agailjhara", "আগৈলঝাড়া", "আগৈলঝাড়া"] },
    { name: "Babuganj", aliases: ["babuganj", "বাবুগঞ্জ"] },
    { name: "Bakerganj", aliases: ["bakerganj", "বাকেরগঞ্জ"] },
    { name: "Banaripara", aliases: ["banaripara", "বানারীপাড়া", "বানারীপাড়া"] },
    { name: "Mehendiganj", aliases: ["mehendiganj", "মেহেন্দীগঞ্জ", "মেহেন্দিগঞ্জ"] },
    { name: "Muladi", aliases: ["muladi", "মুলাদী", "মুলাদি"] },
    { name: "Wazirpur", aliases: ["wazirpur", "উজিরপুর"] },
    { name: "Barishal Sadar", aliases: ["barishal sadar", "বরিশাল সদর"] }
  ],
  "Bogura": [
    { name: "Bogura Sadar", aliases: ["bogura sadar", "bogra sadar", "বগুড়া সদর", "বগুড়া সদর"] },
    { name: "Sherpur", aliases: ["bogura sherpur", "বগুড়া শেরপুর", "শেরপুর, বগুড়া"] },
    { name: "Shajahanpur", aliases: ["shajahanpur", "শাজাহানপুর"] },
    { name: "Shibganj", aliases: ["shibganj", "শিবগঞ্জ"] },
    { name: "Gabtali", aliases: ["gabtali", "গাবতলী", "গাবতলি"] },
    { name: "Sonatola", aliases: ["sonatola", "সোনাতলা"] },
    { name: "Sariakandi", aliases: ["sariakandi", "সারিয়াকান্দি", "সারিয়াকান্দি"] },
    { name: "Dhunat", aliases: ["dhunat", "ধুনট"] },
    { name: "Nandigram", aliases: ["nandigram", "নন্দীগ্রাম", "নন্দিগ্রাম"] },
    { name: "Kahaloo", aliases: ["kahaloo", "কাহালু"] },
    { name: "Adamdighi", aliases: ["adamdighi", "আদমদীঘি", "আদমদিঘি"] },
    { name: "Dupchanchia", aliases: ["dupchanchia", "দুপচাঁচিয়া", "দুপচাচিয়া"] },
    { name: "Thanthania", aliases: ["thanthania", "ঠনঠনিয়া", "ঠনঠনিয়া"] },
    { name: "Joleshworitola", aliases: ["joleshworitola", "জলেশ্বরীতলা"] }
  ],
  "Rajshahi": [
    { name: "Boalia", aliases: ["boalia", "বোয়ালিয়া", "বোয়ালিয়া"] },
    { name: "Motihar", aliases: ["motihar", "মতিহার"] },
    { name: "Rajpara", aliases: ["rajpara", "রাজপাড়া", "রাজপাড়া"] },
    { name: "Shah Makhdum", aliases: ["shah makhdum", "শাহ মখদুম"] },
    { name: "Kazla", aliases: ["kazla", "কাজলা"] },
    { name: "Bagha", aliases: ["bagha", "বাঘা"] },
    { name: "Charghat", aliases: ["charghat", "চারঘাট"] },
    { name: "Puthia", aliases: ["puthia", "পুঠিয়া", "পুঠিয়া"] },
    { name: "Durgapur", aliases: ["durgapur", "দুর্গাপুর"] },
    { name: "Godagari", aliases: ["godagari", "গোদাগাড়ী", "গোদাগাড়ী"] },
    { name: "Tanore", aliases: ["tanore", "তানোর"] },
    { name: "Mohanpur", aliases: ["mohanpur", "মোহনপুর"] },
    { name: "Bagmara", aliases: ["bagmara", "বাগমারা"] },
    { name: "Rajshahi Sadar", aliases: ["rajshahi sadar", "রাজশাহী সদর"] }
  ],
  "Rangpur": [
    { name: "Jahaj Company", aliases: ["jahaj company", "জাহাজ কোম্পানী", "জাহাজ কোম্পানি"] },
    { name: "Modern More", aliases: ["modern more", "মডার্ন মোড়", "মডার্ন মোড়"] },
    { name: "Dhap", aliases: ["dhap", "ধাপ"] },
    { name: "Badarganj", aliases: ["badarganj", "বদরগঞ্জ"] },
    { name: "Mithapukur", aliases: ["mithapukur", "মিঠাপুকুর"] },
    { name: "Pirganj", aliases: ["pirganj", "পীরগঞ্জ"] },
    { name: "Pirgachha", aliases: ["pirgachha", "পীরগাছা"] },
    { name: "Kaunia", aliases: ["kaunia", "কাউনিয়া", "কাউনিয়া"] },
    { name: "Gangachhara", aliases: ["gangachhara", "গঙ্গাচড়া", "গঙ্গাচড়া"] },
    { name: "Taraganj", aliases: ["taraganj", "তারাগঞ্জ"] },
    { name: "Rangpur Sadar", aliases: ["rangpur sadar", "রংপুর সদর"] }
  ],
  "Mymensingh": [
    { name: "Ganginarpar", aliases: ["ganginarpar", "গাঙ্গিনারপাড়", "গাঙ্গিনারপাড়"] },
    { name: "Charpara", aliases: ["charpara", "চরপাড়া", "চরপাড়া"] },
    { name: "Town Hall", aliases: ["town hall", "টাউন হল"] },
    { name: "Trishal", aliases: ["trishal", "ত্রিশাল"] },
    { name: "Muktagachha", aliases: ["muktagachha", "মুক্তাগাছা"] },
    { name: "Bhaluka", aliases: ["bhaluka", "ভালুকা"] },
    { name: "Fulbaria", aliases: ["fulbaria", "ফুলবাড়িয়া", "ফুলবাড়িয়া"] },
    { name: "Gaffargaon", aliases: ["gaffargaon", "গফরগাঁও", "গফরগাও"] },
    { name: "Nandail", aliases: ["nandail", "নান্দাইল"] },
    { name: "Ishwarganj", aliases: ["ishwarganj", "ঈশ্বরগঞ্জ"] },
    { name: "Haluaghat", aliases: ["haluaghat", "হালুয়াঘাট", "হালুয়াঘাট"] },
    { name: "Dhobaura", aliases: ["dhobaura", "ধোবাউড়া", "ধোবাউড়া"] },
    { name: "Tara Khanda", aliases: ["tara khanda", "তারাকান্দা"] },
    { name: "Gouripur", aliases: ["gouripur", "গৌরীপুর", "গৌরিপুর"] },
    { name: "Mymensingh Sadar", aliases: ["mymensingh sadar", "ময়মনসিংহ সদর"] }
  ],
  "Bagerhat": [
    { name: "Bagerhat Sadar", aliases: ["bagerhat sadar", "বাগেরহাট সদর"] },
    { name: "Mongla", aliases: ["mongla", "মোংলা", "মংলা"] },
    { name: "Rampal", aliases: ["rampal", "রামপাল"] },
    { name: "Morrelganj", aliases: ["morrelganj", "মোরেলগঞ্জ"] },
    { name: "Fakirhat", aliases: ["fakirhat", "ফকিরহাট"] },
    { name: "Kachua", aliases: ["kachua", "কচুয়া", "কচুয়া"] },
    { name: "Chitalmari", aliases: ["chitalmari", "চিতলমারী", "চিতলমারি"] },
    { name: "Mollahat", aliases: ["mollahat", "মোল্লাহাট"] },
    { name: "Sarankhola", aliases: ["sarankhola", "শরণখোলা"] }
  ],
  "Cox's Bazar": [
    { name: "Cox's Bazar Sadar", aliases: ["cox's bazar sadar", "coxs bazar sadar", "কক্সবাজার সদর"] },
    { name: "Chakaria", aliases: ["chakaria", "চকোরিয়া", "চকোরিয়া", "চকরিয়া"] },
    { name: "Teknaf", aliases: ["teknaf", "টেকনাফ"] },
    { name: "Ukhiya", aliases: ["ukhiya", "উখিয়া", "উখিয়া"] },
    { name: "Ramu", aliases: ["ramu", "রামু"] },
    { name: "Maheshkhali", aliases: ["maheshkhali", "মহেশখালী"] },
    { name: "Kutubdia", aliases: ["kutubdia", "কুতুবদিয়া", "কুতুবদিয়া"] },
    { name: "Pekua", aliases: ["pekua", "পেকুয়া", "পেকুয়া"] }
  ],
  "Feni": [
    { name: "Feni Sadar", aliases: ["feni sadar", "ফেনী সদর"] },
    { name: "Daganbhuiyan", aliases: ["daganbhuiyan", "দাগনভূঞা", "দাগনভূঁইয়া"] },
    { name: "Chhagalnaiya", aliases: ["chhagalnaiya", "ছাগলনাইয়া", "ছাগলনাইয়া"] },
    { name: "Sonagazi", aliases: ["sonagazi", "সোনাগাজী", "সোনাগাজি"] },
    { name: "Parshuram", aliases: ["parshuram", "পরশুরাম"] },
    { name: "Fulgazi", aliases: ["fulgazi", "ফুলগাজী", "ফুলগাজি"] }
  ],
  "Tangail": [
    { name: "Tangail Sadar", aliases: ["tangail sadar", "টাঙ্গাইল সদর"] },
    { name: "Madhupur", aliases: ["madhupur", "মধুপুর"] },
    { name: "Gopalpur", aliases: ["gopalpur", "গোপালপুর"] },
    { name: "Ghatail", aliases: ["ghatail", "ঘাটাইল"] },
    { name: "Kalihati", aliases: ["kalihati", "কালিহাতী", "কালিহাতি"] },
    { name: "Sakhipur", aliases: ["sakhipur", "সখিপুর"] },
    { name: "Mirzapur", aliases: ["mirzapur", "মির্জাপুর"] },
    { name: "Basail", aliases: ["basail", "বাসাইল"] },
    { name: "Delduar", aliases: ["delduar", "দেলদুয়ার", "দেলদুয়ার"] },
    { name: "Nagarpur", aliases: ["nagarpur", "নাগরপুর"] },
    { name: "Dhanbari", aliases: ["dhanbari", "ধানবাড়ী", "ধানবাড়ি"] }
  ],
  "Narsingdi": [
    { name: "Narsingdi Sadar", aliases: ["narsingdi sadar", "নরসিংদী সদর"] },
    { name: "Belabo", aliases: ["belabo", "বেলাবো"] },
    { name: "Monohardi", aliases: ["monohardi", "মনোহরদী", "মনোহরদি"] },
    { name: "Shibpur", aliases: ["shibpur", "শিবপুর"] },
    { name: "Raipura", aliases: ["raipura", "রায়পুরা", "রায়পুরা"] },
    { name: "Palash", aliases: ["palash", "পলাশ"] },
    { name: "Madhabdi", aliases: ["madhabdi", "মাধবদী", "মাধবদি"] }
  ],
  "Brahmanbaria": [
    { name: "Brahmanbaria Sadar", aliases: ["brahmanbaria sadar", "ব্রাহ্মণবাড়িয়া সদর"] },
    { name: "Ashuganj", aliases: ["ashuganj", "আশুগঞ্জ"] },
    { name: "Bancharampur", aliases: ["bancharampur", "বাঞ্ছারামপুর"] },
    { name: "Kasba", aliases: ["kasba", "কসবা"] },
    { name: "Nabinagar", aliases: ["nabinagar", "নবীনগর"] },
    { name: "Nasirnagar", aliases: ["nasirnagar", "নাসিরনগর"] },
    { name: "Sarail", aliases: ["sarail", "সরাইল"] },
    { name: "Akhaura", aliases: ["akhaura", "আখাউড়া", "আখাউড়া"] },
    { name: "Bijoynagar", aliases: ["bijoynagar", "বিজয়নগর", "বিজয়নগর"] }
  ],
  "Noakhali": [
    { name: "Noakhali Sadar", aliases: ["noakhali sadar", "নোয়াখালী সদর"] },
    { name: "Begumganj", aliases: ["begumganj", "বেগমগঞ্জ"] },
    { name: "Chowmuhani", aliases: ["chowmuhani", "চৌমুহনী", "চৌমুহনি"] },
    { name: "Senbagh", aliases: ["senbagh", "সেনবাগ"] },
    { name: "Chatkhil", aliases: ["chatkhil", "চাটখিল"] },
    { name: "Companiganj", aliases: ["companiganj", "কোম্পানীগঞ্জ", "কোম্পানিগঞ্জ"] },
    { name: "Hatiya", aliases: ["hatiya", "হাতিয়া", "হাতিয়া"] },
    { name: "Kabirhat", aliases: ["kabirhat", "কবিরহাট"] },
    { name: "Subarnachar", aliases: ["subarnachar", "সুবর্ণচর"] }
  ],
  "Jashore": [
    { name: "Jashore Sadar", aliases: ["jashore sadar", "jessore sadar", "যশোর সদর"] },
    { name: "Abhaynagar", aliases: ["abhaynagar", "অভয়নগর", "অভয়নগর"] },
    { name: "Bagherpara", aliases: ["bagherpara", "বাঘারপাড়া", "বাঘারপাড়া"] },
    { name: "Chaugachha", aliases: ["chaugachha", "চৌগাছা"] },
    { name: "Jhikargachha", aliases: ["jhikargachha", "ঝিকরগাছা"] },
    { name: "Keshabpur", aliases: ["keshabpur", "কেশবপুর"] },
    { name: "Manirampur", aliases: ["manirampur", "মণিরামপুর", "মনিরামপুর"] },
    { name: "Sharsha", aliases: ["sharsha", "শার্শা"] },
    { name: "Benapole", aliases: ["benapole", "বেনাপোল"] }
  ],
  "Kushtia": [
    { name: "Kushtia Sadar", aliases: ["kushtia sadar", "কুষ্টিয়া সদর"] },
    { name: "Kumarkhali", aliases: ["kumarkhali", "কুমারখালী", "কুমারখালি"] },
    { name: "Daulatpur", aliases: ["daulatpur", "দৌলতপুর"] },
    { name: "Bheramara", aliases: ["bheramara", "ভেড়ামারা", "ভেড়ামারা"] },
    { name: "Khoksa", aliases: ["khoksa", "খোকসা"] },
    { name: "Kushtia Mirpur", aliases: ["kushtia mirpur", "মিরপুর, কুষ্টিয়া", "মিরপুর (কুষ্টিয়া)"] }
  ],
  "Pabna": [
    { name: "Pabna Sadar", aliases: ["pabna sadar", "পাবনা সদর"] },
    { name: "Ishwardi", aliases: ["ishwardi", "ঈশ্বরদী", "ঈশ্বরদি"] },
    { name: "Bera", aliases: ["bera", "বেড়া", "বেড়া"] },
    { name: "Santhia", aliases: ["santhia", "সাঁথিয়া", "সাথিয়া"] },
    { name: "Chatmohar", aliases: ["chatmohar", "চাটমোহর"] },
    { name: "Sujanagar", aliases: ["sujanagar", "সুজানগর"] },
    { name: "Atgharia", aliases: ["atgharia", "আটঘরিয়া", "আটঘরিয়া"] },
    { name: "Bhangura", aliases: ["bhangura", "ভাঙ্গুড়া", "ভাঙ্গুড়া"] }
  ],
  "Sirajganj": [
    { name: "Sirajganj Sadar", aliases: ["sirajganj sadar", "সিরাজগঞ্জ সদর"] },
    { name: "Shahjadpur", aliases: ["shahjadpur", "শাহজাদপুর"] },
    { name: "Ullapara", aliases: ["ullapara", "উল্লাপাড়া", "উল্লাপাড়া"] },
    { name: "Belkuchi", aliases: ["belkuchi", "বেলকুচি"] },
    { name: "Kazipur", aliases: ["kazipur", "কাজীপুর", "কাজিপুর"] },
    { name: "Raiganj", aliases: ["raiganj", "রায়গঞ্জ", "রায়গঞ্জ"] },
    { name: "Tarash", aliases: ["tarash", "তাড়াশ", "তাড়াশ"] }
  ],
  "Habiganj": [
    { name: "Habiganj Sadar", aliases: ["habiganj sadar", "হবিগঞ্জ সদর"] },
    { name: "Madhabpur", aliases: ["madhabpur", "মাধবপুর"] },
    { name: "Nabiganj", aliases: ["nabiganj", "নবীগঞ্জ"] },
    { name: "Chunarughat", aliases: ["chunarughat", "চুনারুঘাট"] },
    { name: "Bahubal", aliases: ["bahubal", "বাহুবল"] },
    { name: "Baniachong", aliases: ["baniachong", "বানিয়াচং", "বানিয়াচং"] },
    { name: "Shaistaganj", aliases: ["shaistaganj", "শায়েস্তাগঞ্জ", "শায়েস্তাগঞ্জ"] }
  ],
  "Moulvibazar": [
    { name: "Moulvibazar Sadar", aliases: ["moulvibazar sadar", "মৌলভীবাজার সদর"] },
    { name: "Sreemangal", aliases: ["sreemangal", "শ্রীমঙ্গল"] },
    { name: "Kulaura", aliases: ["kulaura", "কুলাউড়া", "কুলাউড়া"] },
    { name: "Kamalganj", aliases: ["kamalganj", "কমলগঞ্জ"] },
    { name: "Barlekha", aliases: ["barlekha", "বড়লেখা", "বড়লেখা"] },
    { name: "Rajnagar", aliases: ["rajnagar", "রাজনগর"] },
    { name: "Juri", aliases: ["juri", "জুড়ী", "জুড়ী"] }
  ],
  "Sunamganj": [
    { name: "Sunamganj Sadar", aliases: ["sunamganj sadar", "সুনামগঞ্জ সদর"] },
    { name: "Jagannathpur", aliases: ["jagannathpur", "জগন্নাথপুর"] },
    { name: "Chhatak", aliases: ["chhatak", "ছাতক"] },
    { name: "Derai", aliases: ["derai", "দিরাই"] },
    { name: "Dowarabazar", aliases: ["dowarabazar", "দোয়ারাবাজার", "দোয়ারা বাজার"] },
    { name: "Tahirpur", aliases: ["tahirpur", "তাহিরপুর"] }
  ],
  "Gopalganj": [
    { name: "Gopalganj Sadar", aliases: ["gopalganj sadar", "গোপালগঞ্জ সদর"] },
    { name: "Kashiani", aliases: ["kashiani", "কাশিয়ানী", "কাশিয়ানী"] },
    { name: "Kotalipara", aliases: ["kotalipara", "কোটালীপাড়া", "কোটালীপাড়া"] },
    { name: "Muksudpur", aliases: ["muksudpur", "মুকসুদপুর"] },
    { name: "Tungipara", aliases: ["tungipara", "টুঙ্গিপাড়া", "টুঙ্গিপাড়া"] }
  ],
  "Chandpur": [
    { name: "Chandpur Sadar", aliases: ["chandpur sadar", "চাঁদপুর সদর"] },
    { name: "Matlab", aliases: ["matlab", "মতলব"] },
    { name: "Hajiganj", aliases: ["hajiganj", "হাজীগঞ্জ", "হাজিগঞ্জ"] },
    { name: "Shahrasti", aliases: ["shahrasti", "শাহরাস্তি"] },
    { name: "Kachua", aliases: ["kachua", "কচুয়া", "কচুয়া"] },
    { name: "Faridganj", aliases: ["faridganj", "ফরিদগঞ্জ"] },
    { name: "Haimchar", aliases: ["haimchar", "হাইমচর"] }
  ],
  "Lakshmipur": [
    { name: "Lakshmipur Sadar", aliases: ["lakshmipur sadar", "লক্ষ্মীপুর সদর"] },
    { name: "Raipur", aliases: ["raipur", "রায়পুর", "রায়পুর"] },
    { name: "Ramganj", aliases: ["ramganj", "রামগঞ্জ"] },
    { name: "Ramgati", aliases: ["ramgati", "রামগতি"] },
    { name: "Kamalnagar", aliases: ["kamalnagar", "কমলনগর"] }
  ],
  "Patuakhali": [
    { name: "Patuakhali Sadar", aliases: ["patuakhali sadar", "পটুয়াখালী সদর"] },
    { name: "Kuakata", aliases: ["kuakata", "কুয়াকাটা", "কুয়াকাটা"] },
    { name: "Galachipa", aliases: ["galachipa", "গলাচিপা"] },
    { name: "Kalapara", aliases: ["kalapara", "কলাপাড়া", "কলাপাড়া"] },
    { name: "Bauphal", aliases: ["bauphal", "বাউফল"] }
  ],
  "Bhola": [
    { name: "Bhola Sadar", aliases: ["bhola sadar", "ভোলা সদর"] },
    { name: "Borhanuddin", aliases: ["borhanuddin", "বোরহানউদ্দিন"] },
    { name: "Char Fasson", aliases: ["char fasson", "চরফ্যাশন", "চরফ্যাসন"] },
    { name: "Daulatkhan", aliases: ["daulatkhan", "দৌলতখান"] },
    { name: "Lalmohan", aliases: ["lalmohan", "লালমোহন"] }
  ],
  "Kishoreganj": [
    { name: "Kishoreganj Sadar", aliases: ["kishoreganj sadar", "কিশোরগঞ্জ সদর"] },
    { name: "Bhairab", aliases: ["bhairab", "ভৈরব"] },
    { name: "Bajitpur", aliases: ["bajitpur", "বাজিতপুর"] },
    { name: "Kuliarchar", aliases: ["kuliarchar", "কুলিয়ারচর", "কুলিয়ারচর"] },
    { name: "Pakundia", aliases: ["pakundia", "পাকুন্দিয়া", "পাকুন্দিয়া"] },
    { name: "Katiadi", aliases: ["katiadi", "কটিয়াদী", "কটিয়াদি"] }
  ],
  "Jamalpur": [
    { name: "Jamalpur Sadar", aliases: ["jamalpur sadar", "জামালপুর সদর"] },
    { name: "Sarishabari", aliases: ["sarishabari", "সরিষাবাড়ী", "সরিষাবাড়ি"] },
    { name: "Melandaha", aliases: ["melandaha", "মেলান্দহ"] },
    { name: "Islampur", aliases: ["islampur", "ইসলামপুর"] },
    { name: "Dewanganj", aliases: ["dewanganj", "দেওয়ানগঞ্জ", "দেওয়ানগঞ্জ"] },
    { name: "Bakshiganj", aliases: ["bakshiganj", "বকশীগঞ্জ", "বকশিগঞ্জ"] }
  ],
  "Sherpur": [
    { name: "Sherpur Sadar", aliases: ["sherpur sadar", "শেরপুর সদর"] },
    { name: "Nakla", aliases: ["nakla", "নকলা"] },
    { name: "Nalitabari", aliases: ["nalitabari", "নালিতাবাড়ী", "নালিতাবাড়ি"] },
    { name: "Jhenaigati", aliases: ["jhenaigati", "ঝিনাইগাতী", "ঝিনাইগাতি"] },
    { name: "Sreebardi", aliases: ["sreebardi", "শ্রীবরদী", "শ্রীবরদি"] }
  ],
  "Netrokona": [
    { name: "Netrokona Sadar", aliases: ["netrokona sadar", "নেত্রকোণা সদর", "নেত্রকোনা সদর"] },
    { name: "Durgapur", aliases: ["durgapur", "দুর্গাপুর"] },
    { name: "Kendua", aliases: ["kendua", "কেন্দুয়া", "কেন্দুয়া"] },
    { name: "Mohanganj", aliases: ["mohanganj", "মোহনগঞ্জ"] },
    { name: "Kalmakanda", aliases: ["kalmakanda", "কলমাকান্দা"] }
  ],
  "Natore": [
    { name: "Natore Sadar", aliases: ["natore sadar", "নাটোর সদর"] },
    { name: "Singra", aliases: ["singra", "সিংড়া", "সিংড়া"] },
    { name: "Gurudaspur", aliases: ["gurudaspur", "গুরুদাসপুর"] },
    { name: "Baraigram", aliases: ["baraigram", "বড়াইগ্রাম", "বড়াইগ্রাম"] },
    { name: "Lalpur", aliases: ["lalpur", "লালপুর"] }
  ],
  "Naogaon": [
    { name: "Naogaon Sadar", aliases: ["naogaon sadar", "নওগাঁ সদর"] },
    { name: "Mohadevpur", aliases: ["mohadevpur", "মহাদেবপুর"] },
    { name: "Patnitala", aliases: ["patnitala", "পত্নীতলা"] },
    { name: "Dhamoirhat", aliases: ["dhamoirhat", "ধামইরহাট"] },
    { name: "Manda", aliases: ["manda", "মান্দা"] },
    { name: "Raninagar", aliases: ["raninagar", "রাণীনগর", "রানীনগর"] }
  ],
  "Satkhira": [
    { name: "Satkhira Sadar", aliases: ["satkhira sadar", "সাতক্ষীরা সদর"] },
    { name: "Kaliganj", aliases: ["kaliganj", "কালীগঞ্জ", "কালিগঞ্জ"] },
    { name: "Shyamnagar", aliases: ["shyamnagar", "শ্যামনগর"] },
    { name: "Tala", aliases: ["tala", "তালা"] },
    { name: "Kalaroa", aliases: ["kalaroa", "কলারোয়া", "কলারোয়া"] }
  ],
  "Jhenaidah": [
    { name: "Jhenaidah Sadar", aliases: ["jhenaidah sadar", "ঝিনাইদহ সদর"] },
    { name: "Kotchandpur", aliases: ["kotchandpur", "কোটচাঁদপুর", "কোটচাদপুর"] },
    { name: "Maheshpur", aliases: ["maheshpur", "মহেশপুর"] },
    { name: "Shailkupa", aliases: ["shailkupa", "শৈলকুপা"] },
    { name: "Harinakundu", aliases: ["harinakundu", "হরিণাকুণ্ডু", "হরিণাকুন্ডু"] }
  ],
  "Madaripur": [
    { name: "Madaripur Sadar", aliases: ["madaripur sadar", "মাদারীপুর সদর"] },
    { name: "Shibchar", aliases: ["shibchar", "শিবচর"] },
    { name: "Kalkini", aliases: ["kalkini", "কালকিনি"] },
    { name: "Rajoir", aliases: ["rajoir", "রাজৈর"] }
  ],
  "Rajbari": [
    { name: "Rajbari Sadar", aliases: ["rajbari sadar", "রাজবাড়ী সদর", "রাজবাড়ি সদর"] },
    { name: "Pangsha", aliases: ["pangsha", "পাংশা"] },
    { name: "Goalanda", aliases: ["goalanda", "গোয়ালন্দ", "গোয়ালন্দ"] },
    { name: "Baliakandi", aliases: ["baliakandi", "বালিয়াকান্দি", "বালিকান্দি"] }
  ],
  "Shariatpur": [
    { name: "Shariatpur Sadar", aliases: ["shariatpur sadar", "শরীয়তপুর সদর"] },
    { name: "Naria", aliases: ["naria", "নড়িয়া", "নড়িয়া"] },
    { name: "Zajira", aliases: ["zajira", "জাজিরা"] },
    { name: "Bhedarganj", aliases: ["bhedarganj", "ভেদরগঞ্জ"] }
  ],
  "Kurigram": [
    { name: "Kurigram Sadar", aliases: ["kurigram sadar", "কুড়িগ্রাম সদর"] },
    { name: "Nageshwari", aliases: ["nageshwari", "নাগেশ্বরী", "নাগেশ্বরি"] },
    { name: "Bhurungamari", aliases: ["bhurungamari", "ভুরুঙ্গামারী", "ভুরুঙ্গামারি"] },
    { name: "Ulipur", aliases: ["ulipur", "উলিপুর"] },
    { name: "Chilmari", aliases: ["chilmari", "চিলমারী", "চিলমারি"] }
  ],
  "Gaibandha": [
    { name: "Gaibandha Sadar", aliases: ["gaibandha sadar", "গাইবান্ধা সদর"] },
    { name: "Gobindaganj", aliases: ["gobindaganj", "গোবিন্দগঞ্জ"] },
    { name: "Sundarganj", aliases: ["sundarganj", "সুন্দরগঞ্জ"] },
    { name: "Sadullapur", aliases: ["sadullapur", "সাদুল্লাপুর"] },
    { name: "Palashbari", aliases: ["palashbari", "পলাশবাড়ী", "পলাশবাড়ি"] }
  ],
  "Nilphamari": [
    { name: "Nilphamari Sadar", aliases: ["nilphamari sadar", "নীলফামারী সদর"] },
    { name: "Saidpur", aliases: ["saidpur", "সৈয়দপুর", "সৈয়দপুর"] },
    { name: "Domar", aliases: ["domar", "ডোমার"] },
    { name: "Dimla", aliases: ["dimla", "ডিমলা"] },
    { name: "Jaldhaka", aliases: ["jaldhaka", "জলঢাকা"] }
  ],
  "Panchagarh": [
    { name: "Panchagarh Sadar", aliases: ["panchagarh sadar", "পঞ্চগড় সদর"] },
    { name: "Tetulia", aliases: ["tetulia", "তেঁতুলিয়া", "তেতুলিয়া"] },
    { name: "Boda", aliases: ["boda", "বোদা"] },
    { name: "Debiganj", aliases: ["debiganj", "দেবীগঞ্জ", "দেবিগঞ্জ"] }
  ],
  "Thakurgaon": [
    { name: "Thakurgaon Sadar", aliases: ["thakurgaon sadar", "ঠাকুরগাঁও সদর"] },
    { name: "Pirganj", aliases: ["pirganj", "পীরগঞ্জ"] },
    { name: "Ranisankail", aliases: ["ranisankail", "রাণীশংকৈল", "রানিশংকৈল"] },
    { name: "Baliadangi", aliases: ["baliadangi", "বালিয়াডাঙ্গী", "বালিয়াডাঙ্গি"] }
  ],
  "Dinajpur": [
    { name: "Dinajpur Sadar", aliases: ["dinajpur sadar", "দিনাজপুর সদর"] },
    { name: "Birganj", aliases: ["birganj", "বীরগঞ্জ"] },
    { name: "Bochaganj", aliases: ["bochaganj", "বোচাগঞ্জ"] },
    { name: "Setabganj", aliases: ["setabganj", "সেতাবগঞ্জ"] },
    { name: "Parbatipur", aliases: ["parbatipur", "পার্বতীপুর", "পারবতীপুর"] },
    { name: "Phulbari", aliases: ["phulbari", "ফুলবাড়ী", "ফুলবাড়ি"] },
    { name: "Hili", aliases: ["hili", "হিলি"] },
    { name: "Hakimpur", aliases: ["hakimpur", "হাকিমপুর"] },
    { name: "Chirirbandar", aliases: ["chirirbandar", "চিরিরবন্দর"] }
  ],
  "Pirojpur": [
    { name: "Pirojpur Sadar", aliases: ["pirojpur sadar", "পিরোজপুর সদর"] },
    { name: "Bhandaria", aliases: ["bhandaria", "ভাণ্ডারিয়া", "ভান্ডারিয়া"] },
    { name: "Mathbaria", aliases: ["mathbaria", "মঠবাড়িয়া", "মঠবাড়িয়া"] },
    { name: "Swarupkathi", aliases: ["swarupkathi", "nesarabad", "স্বরূপকাঠি", "নেছারাবাদ"] }
  ],
  "Barguna": [
    { name: "Barguna Sadar", aliases: ["barguna sadar", "বরগুনা সদর"] },
    { name: "Amtali", aliases: ["amtali", "আমতলী", "আমতলি"] },
    { name: "Patharghata", aliases: ["patharghata", "পাথরঘাটা"] },
    { name: "Betagi", aliases: ["betagi", "বেতাগী", "বেতাগি"] }
  ],
  "Jhalokathi": [
    { name: "Jhalokathi Sadar", aliases: ["jhalokathi sadar", "ঝালকাঠি সদর"] },
    { name: "Nalchhiti", aliases: ["nalchhiti", "নলছিটি"] },
    { name: "Rajapur", aliases: ["rajapur", "রাজাপুর"] }
  ],
  "Chuadanga": [
    { name: "Chuadanga Sadar", aliases: ["chuadanga sadar", "চুয়াডাঙ্গা সদর"] },
    { name: "Alamdanga", aliases: ["alamdanga", "আলমডাঙ্গা"] },
    { name: "Damurhuda", aliases: ["damurhuda", "দামুড়হুদা", "দামুড়হুদা"] },
    { name: "Jibannagar", aliases: ["jibannagar", "জীবননগর"] }
  ],
  "Meherpur": [
    { name: "Meherpur Sadar", aliases: ["meherpur sadar", "মেহেরপুর সদর"] },
    { name: "Gangni", aliases: ["gangni", "গাংনী", "গাংনি"] },
    { name: "Mujibnagar", aliases: ["mujibnagar", "মুজিবনগর"] }
  ],
  "Magura": [
    { name: "Magura Sadar", aliases: ["magura sadar", "মাগুরা সদর"] },
    { name: "Sreepur", aliases: ["sreepur", "শ্রীপুর"] },
    { name: "Magura Mohammadpur", aliases: ["magura mohammadpur", "মোহাম্মদপুর, মাগুরা"] },
    { name: "Shalikha", aliases: ["shalikha", "শালিখা"] }
  ],
  "Narail": [
    { name: "Narail Sadar", aliases: ["narail sadar", "নড়াইল সদর"] },
    { name: "Lohagara", aliases: ["lohagara", "লোহাগড়া", "লোহাগড়া"] },
    { name: "Kalia", aliases: ["kalia", "কালিয়া", "কালিয়া"] }
  ],
  "Joypurhat": [
    { name: "Joypurhat Sadar", aliases: ["joypurhat sadar", "জয়পুরহাট সদর"] },
    { name: "Panchbibi", aliases: ["panchbibi", "পাঁচবিবি"] },
    { name: "Kalai", aliases: ["kalai", "কালাই"] },
    { name: "Khetlal", aliases: ["khetlal", "ক্ষেতলাল"] }
  ],
  "Chapainawabganj": [
    { name: "Chapainawabganj Sadar", aliases: ["chapainawabganj sadar", "চাঁপাইনবাবগঞ্জ সদর"] },
    { name: "Shibganj", aliases: ["shibganj", "শিবগঞ্জ"] },
    { name: "Gomostapur", aliases: ["gomostapur", "গোমস্তাপুর"] },
    { name: "Nachole", aliases: ["nachole", "নাচোল"] }
  ],
  "Lalmonirhat": [
    { name: "Lalmonirhat Sadar", aliases: ["lalmonirhat sadar", "লালমনিরহাট সদর"] },
    { name: "Hatibandha", aliases: ["hatibandha", "হাতীবান্ধা", "হাতিবান্ধা"] },
    { name: "Patgram", aliases: ["patgram", "পাটগ্রাম"] }
  ],
  "Munshiganj": [
    { name: "Munshiganj Sadar", aliases: ["munshiganj sadar", "মুন্সীগঞ্জ সদর", "মুন্সিগঞ্জ সদর"] },
    { name: "Sreenagar", aliases: ["sreenagar", "শ্রীনগর"] },
    { name: "Sirajdikhan", aliases: ["sirajdikhan", "সিরাজদিখান"] },
    { name: "Louhajang", aliases: ["louhajang", "লৌহজং"] },
    { name: "Tongibari", aliases: ["tongibari", "টঙ্গীবাড়ী", "টঙ্গিবাড়ি"] },
    { name: "Gazaria", aliases: ["gazaria", "গজারিয়া", "গজারিয়া"] }
  ],
  "Manikganj": [
    { name: "Manikganj Sadar", aliases: ["manikganj sadar", "মানিকগঞ্জ সদর"] },
    { name: "Singair", aliases: ["singair", "সিংগাইর", "সিঙ্গাইর"] },
    { name: "Saturia", aliases: ["saturia", "সাটুরিয়া", "সাটুরিয়া"] },
    { name: "Shivalaya", aliases: ["shivalaya", "শিবালয়", "শিবালয়"] },
    { name: "Harirampur", aliases: ["harirampur", "হরিরামপুর"] },
    { name: "Ghior", aliases: ["ghior", "ঘিওর"] },
    { name: "Daulatpur", aliases: ["manikganj daulatpur", "দৌলতপুর, মানিকগঞ্জ"] }
  ],
  "Bandarban": [
    { name: "Bandarban Sadar", aliases: ["bandarban sadar", "বান্দরবান সদর"] },
    { name: "Ruma", aliases: ["ruma", "রুমা"] },
    { name: "Thanchi", aliases: ["thanchi", "থানচি"] },
    { name: "Lama", aliases: ["lama", "লামা"] },
    { name: "Alikadam", aliases: ["alikadam", "আলীকদম", "আলিকদম"] },
    { name: "Rowangchhari", aliases: ["rowangchhari", "রোয়াংছড়ি", "রোয়াংছড়ি"] },
    { name: "Naikhongchhari", aliases: ["naikhongchhari", "নাইক্ষ্যংছড়ি", "নাইক্ষ্যংছড়ি"] }
  ],
  "Khagrachhari": [
    { name: "Khagrachhari Sadar", aliases: ["khagrachhari sadar", "খাগড়াছড়ি সদর", "খাগড়াছড়ি সদর"] },
    { name: "Dighinala", aliases: ["dighinala", "দীঘিনালা"] },
    { name: "Panchhari", aliases: ["panchhari", "পানছড়ি", "পানছড়ি"] },
    { name: "Mahalchhari", aliases: ["mahalchhari", "মহালছড়ি", "মহালছড়ি"] },
    { name: "Matiranga", aliases: ["matiranga", "মাটিরাঙ্গা"] },
    { name: "Manikchhari", aliases: ["manikchhari", "মানিকছড়ি", "মানিকছড়ি"] },
    { name: "Ramgarh", aliases: ["ramgarh", "রামগড়", "রামগড়"] },
    { name: "Lakshmichhari", aliases: ["lakshmichhari", "লক্ষ্মীছড়ি", "লক্ষ্মীছড়ি"] },
    { name: "Guimara", aliases: ["guimara", "গুইমারা"] }
  ],
  "Rangamati": [
    { name: "Rangamati Sadar", aliases: ["rangamati sadar", "রাঙ্গামাটি সদর", "রাঙামাটি সদর"] },
    { name: "Baghaichhari", aliases: ["baghaichhari", "বাঘাইছড়ি", "বাঘাইছড়ি"] },
    { name: "Barkal", aliases: ["barkal", "বরকল"] },
    { name: "Kawkhali", aliases: ["kawkhali", "কাউখালী", "কাউখালি"] },
    { name: "Belaichhari", aliases: ["belaichhari", "বিলাইছড়ি", "বিলাইছড়ি"] },
    { name: "Kaptai", aliases: ["kaptai", "কাপ্তাই"] },
    { name: "Juraichhari", aliases: ["juraichhari", "জুরাইছড়ি", "জুরাইছড়ি"] },
    { name: "Langadu", aliases: ["langadu", "লংগদু"] },
    { name: "Naniarchar", aliases: ["naniarchar", "নানিয়ারচর", "নানিয়ারচর"] },
    { name: "Rajasthali", aliases: ["rajasthali", "রাজস্থলী", "রাজস্থলি"] }
  ]
};

/**
 * Smart Bangladesh Address Parser
 * Decomposes unstructured BD addresses into District, Zone, Area, Postcode, and Clean Street.
 * Supports English, Bengali script, transliterated names, and explicit labels.
 */
function parseBDAddress(rawAddress) {
  if (!rawAddress || typeof rawAddress !== "string") {
    return {
      raw: "",
      district: "Dhaka",
      zone: "Dhaka Sadar",
      area: "",
      postcode: "",
      streetAddress: "",
      cityType: "Inside Dhaka"
    };
  }

  const clean = rawAddress.trim().replace(/[\r\n\t]+/g, " ");

  // 1. Extract Postcode (4 digits: ASCII or Bengali numerals [০-৯])
  let postcode = "";
  const asciiClean = bengaliToAsciiDigits(clean);
  const pcMatch = asciiClean.match(/(?:postal\s*code|post\s*code|postcode|zip|পোস্ট\s*কোড|পোস্ট|ডাকঘর|পোঃ|পো:)?\s*[-:,=ঃ]?\s*\b([1-9]\d{3})\b/i);
  if (pcMatch) {
    const matchedVal = pcMatch[1];
    const fullMatchIdx = pcMatch.index;
    const prevChars = asciiClean.substring(Math.max(0, fullMatchIdx - 4), fullMatchIdx);
    if (!/01\d$/.test(prevChars)) {
      postcode = matchedVal;
    }
  }

  let matchedDistrict = "";
  let matchedZone = "";

  // 2A. Check for explicit district label (e.g. "জেলা: ফরিদপুর", "District: Gazipur", "জেলাঃ ঢাকা")
  const explicitDistMatch = clean.match(/(?:জেলা|District|Dist|Zilla|State|City)[\s:ঃ#\-]+([^\s,;।\n]+)/i);
  if (explicitDistMatch) {
    const rawDist = explicitDistMatch[1].trim().replace(/^[.,;:\s।–-]+|[.,;:\s।–-]+$/g, "");
    for (const d of BD_DISTRICTS) {
      if (d.name.toLowerCase() === rawDist.toLowerCase() || d.aliases.some(a => a.toLowerCase() === rawDist.toLowerCase() || matchWord(rawDist, a))) {
        matchedDistrict = d.name;
        break;
      }
    }
  }

  // 2B. Check for explicit thana/zone label (e.g. "থানা: শ্রীপুর", "উপজেলা: বোয়ালমারী", "Thana: Mirpur")
  const explicitThanaMatch = clean.match(/(?:থানা|উপজেলা|Thana|Upazila|Upozila|Police\s*Station|P\.?S\.?)[\s:ঃ#\-]+([^\s,;।\n]+)/i);
  if (explicitThanaMatch) {
    const rawThana = explicitThanaMatch[1].trim().replace(/^[.,;:\s।–-]+|[.,;:\s।–-]+$/g, "");
    for (const [distName, zones] of Object.entries(OTHER_CITY_ZONES)) {
      for (const z of zones) {
        const zName = typeof z === "string" ? z : z.name;
        const aliases = typeof z === "string" ? [z] : (z.aliases || [z.name]);
        if (zName.toLowerCase() === rawThana.toLowerCase() || aliases.some(a => a.toLowerCase() === rawThana.toLowerCase() || matchWord(rawThana, a))) {
          matchedZone = zName;
          if (!matchedDistrict) matchedDistrict = distName;
          break;
        }
      }
      if (matchedZone) break;
    }

    if (!matchedZone) {
      for (const z of DHAKA_ZONES) {
        const zName = typeof z === "string" ? z : z.name;
        const aliases = typeof z === "string" ? [z] : (z.aliases || [z.name]);
        if (zName.toLowerCase() === rawThana.toLowerCase() || aliases.some(a => a.toLowerCase() === rawThana.toLowerCase() || matchWord(rawThana, a))) {
          matchedZone = zName;
          if (!matchedDistrict) matchedDistrict = "Dhaka";
          break;
        }
      }
    }

    if (!matchedZone && rawThana.length >= 3) {
      matchedZone = rawThana.charAt(0).toUpperCase() + rawThana.slice(1);
    }
  }

  // 2C. Check all 63 NON-DHAKA districts FIRST (avoids Dhaka default when customer is outside Dhaka)
  if (!matchedDistrict) {
    const nonDhakaDistricts = BD_DISTRICTS.filter(d => d.name !== "Dhaka");
    for (const d of nonDhakaDistricts) {
      for (const alias of d.aliases) {
        if (matchWord(clean, alias)) {
          matchedDistrict = d.name;
          break;
        }
      }
      if (matchedDistrict) break;
    }
  }

  // 2D. If no non-Dhaka district was found, check if Dhaka city or Dhaka postcode (1000-1236) is present
  if (!matchedDistrict) {
    const isDhakaPc = postcode && parseInt(postcode, 10) >= 1000 && parseInt(postcode, 10) <= 1236;
    const dhakaObj = BD_DISTRICTS.find(d => d.name === "Dhaka");
    const hasDhakaWord = dhakaObj && dhakaObj.aliases.some(a => matchWord(clean, a));
    if (isDhakaPc || hasDhakaWord) {
      matchedDistrict = "Dhaka";
    }
  }

  // 2E. Check for ISO 3166-2:BD code (e.g. BD-15 -> Faridpur, BD-18 -> Gazipur)
  if (!matchedDistrict) {
    const isoDistrict = detectDistrictFromISOCode(clean);
    if (isoDistrict) {
      matchedDistrict = isoDistrict;
    }
  }

  // 2F. Check non-Dhaka postcode ranges
  if (!matchedDistrict && postcode) {
    const pcNum = parseInt(postcode, 10);
    if (pcNum >= 1700 && pcNum <= 1751) {
      matchedDistrict = "Gazipur";
    } else if (pcNum >= 1400 && pcNum <= 1432) {
      matchedDistrict = "Narayanganj";
    } else if (pcNum >= 1340 && pcNum <= 1349) {
      matchedDistrict = "Dhaka";
      matchedZone = "Savar";
    } else if (pcNum >= 9300 && pcNum <= 9399) {
      matchedDistrict = "Bagerhat";
    } else if (pcNum >= 7800 && pcNum <= 7899) {
      matchedDistrict = "Faridpur";
    }
  }

  // 2G. Check specific non-Dhaka zones from OTHER_CITY_ZONES with full Bengali alias matching
  if (!matchedZone) {
    for (const [distName, zones] of Object.entries(OTHER_CITY_ZONES)) {
      if (distName.toLowerCase() === "dhaka") continue;
      for (const z of zones) {
        const zName = typeof z === "string" ? z : z.name;
        const aliases = typeof z === "string" ? [z] : (z.aliases || [z.name]);
        let found = false;
        for (const alias of aliases) {
          if (matchWord(clean, alias)) {
            matchedZone = zName;
            if (!matchedDistrict) matchedDistrict = distName;
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (matchedZone && matchedDistrict) break;
    }
  }

  // 2H. Check Dhaka city or Dhaka zones ONLY if no non-Dhaka district was detected
  if (!matchedDistrict || matchedDistrict === "Dhaka") {
    for (const z of DHAKA_ZONES) {
      const zName = typeof z === "string" ? z : z.name;
      const aliases = typeof z === "string" ? [z] : z.aliases;
      let found = false;
      for (const alias of aliases) {
        if (matchWord(clean, alias)) {
          matchedZone = zName;
          found = true;
          if (!matchedDistrict) {
            if (["Savar", "Ashulia", "Dhamrai", "Keraniganj"].includes(zName)) {
              matchedDistrict = "Dhaka";
            } else if (zName === "Tongi") {
              matchedDistrict = "Gazipur";
            } else {
              matchedDistrict = "Dhaka";
            }
          }
          break;
        }
      }
      if (found) break;
    }
  }

  if (!matchedDistrict) {
    const dhakaObj = BD_DISTRICTS.find(d => d.name === "Dhaka");
    if (dhakaObj) {
      for (const alias of dhakaObj.aliases) {
        if (matchWord(clean, alias)) {
          matchedDistrict = "Dhaka";
          break;
        }
      }
    }
  }

  // 3. Zone / Thana Fallbacks
  // Check for "<Word> Sadar" or "<Word> সদর"
  if (!matchedZone) {
    const sadarMatch = clean.match(/([a-zA-Z\u0980-\u09FF]+)\s+(?:Sadar|সদর)\b/i);
    if (sadarMatch) {
      const rawSadar = sadarMatch[1];
      for (const d of BD_DISTRICTS) {
        if (d.name.toLowerCase() === rawSadar.toLowerCase() || d.aliases.some(a => a.toLowerCase() === rawSadar.toLowerCase() || matchWord(rawSadar, a))) {
          matchedZone = `${d.name} Sadar`;
          if (!matchedDistrict) matchedDistrict = d.name;
          break;
        }
      }
      if (!matchedZone) matchedZone = `${rawSadar} Sadar`;
    }
  }

  // Check token preceding district or ISO code (e.g. "Sreepur, Gazipur" or "বোয়ালমারী, ফরিদপুর")
  if (!matchedZone && matchedDistrict) {
    const parts = clean.split(/[,;\n।]+/).map(p => p.trim()).filter(Boolean);
    const dObj = BD_DISTRICTS.find(d => d.name === matchedDistrict);
    const dAliases = dObj ? [dObj.name, ...dObj.aliases] : [matchedDistrict];
    const dIdx = parts.findIndex(p =>
      dAliases.some(a => matchWord(p, a)) ||
      /\bBD[-_\s]?[0-6]?\d\b/i.test(p)
    );
    if (dIdx > 0) {
      const prev = parts[dIdx - 1];
      if (prev.length <= 30 && !/^(road|house|flat|plot|block|holding|বাসা|বাড়ি|বাড়ি|রোড|রাস্তা|গ্রাম|পোস্ট|ডাকঘর)/i.test(prev)) {
        if (OTHER_CITY_ZONES[matchedDistrict]) {
          for (const z of OTHER_CITY_ZONES[matchedDistrict]) {
            const zName = typeof z === "string" ? z : z.name;
            const aliases = typeof z === "string" ? [z] : (z.aliases || [z.name]);
            if (aliases.some(a => matchWord(prev, a))) {
              matchedZone = zName;
              break;
            }
          }
        }
        if (!matchedZone) matchedZone = prev;
      }
    }
  }

  // Final Defaults
  if (!matchedDistrict) {
    matchedDistrict = "Dhaka";
  }
  if (!matchedZone) {
    matchedZone = matchedDistrict === "Dhaka" ? "Dhaka Sadar" : `${matchedDistrict} Sadar`;
  }

  // 4. Identify Area / Sub-area (Sector, Block, Ward, Gram)
  let matchedArea = "";
  const priorityAreaMatch = clean.match(/\b(Sector\s*[-#]?\s*\d+|Block\s*[-#]?\s*[A-Z0-9]+|Ward\s*[-#]?\s*\d+)\b/i) ||
                            clean.match(/(সেক্টর\s*[-#নং]?\s*[০-৯\d]+|ব্লক\s*[-#নং]?\s*[a-zA-Z0-9\u0980-\u09FF]+|ওয়ার্ড\s*[-#নং]?\s*[০-৯\d]+)/i);
  if (priorityAreaMatch) {
    matchedArea = priorityAreaMatch[1];
  } else {
    const fallbackAreaMatch = clean.match(/\b(Road\s*[-#]?\s*\d+|Mirpur\s*[-#]?\s*\d+|Uttara\s*[-#]?\s*\d+|Dhanmondi\s*[-#]?\s*\d+)\b/i) ||
                              clean.match(/(রোড\s*[-#নং]?\s*[০-৯\d]+|রাস্তা\s*[-#নং]?\s*[০-৯\d]+|গ্রাম\s*[:ঃ#\-]?\s*[^\s,;।\n]+)/i);
    if (fallbackAreaMatch) {
      matchedArea = fallbackAreaMatch[1];
    }
  }

  // 5. Clean Street Address: Remove trailing district/postcode/zone repetitions and ISO codes
  let streetAddress = clean;
  if (postcode) {
    streetAddress = streetAddress.replace(new RegExp(`[-:,]?\\s*${postcode}\\b`, "g"), "");
    const bgDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
    const bgPc = postcode.split('').map(c => bgDigits[parseInt(c, 10)] || c).join('');
    streetAddress = streetAddress.replace(new RegExp(`[-:,]?\\s*${bgPc}`, "g"), "");
  }

  streetAddress = streetAddress.replace(/[-:,;\s।]+$/, "").trim();
  const distObjForClean = BD_DISTRICTS.find(d => d.name === matchedDistrict);
  const distAliasesForClean = distObjForClean ? [distObjForClean.name, ...distObjForClean.aliases] : [matchedDistrict];
  for (const a of distAliasesForClean) {
    const esc = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    streetAddress = streetAddress.replace(new RegExp(`(?:[-:,;\\s।]+(?:জেলা[:\\sঃ]*)?${esc})+[-:,;\\s।]*$`, "i"), "");
  }
  streetAddress = streetAddress.replace(/[,;\s]+\bBD[-_\s]?[0-6]?\d\b.*$/i, "").trim();

  // Also remove trailing zone if it is at the very end of streetAddress
  if (matchedZone) {
    const escapedZone = matchedZone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    streetAddress = streetAddress.replace(new RegExp(`[,;\\s]+${escapedZone}\\b$`, "i"), "").trim();
  }

  streetAddress = streetAddress.replace(/^[,;\\s।]+|[,;\\s।]+$/g, "");

  if (!streetAddress || streetAddress.length < 3) {
    streetAddress = clean;
  }

  // 6. Compute City Type (Inside Dhaka, Sub Dhaka, Outside Dhaka)
  let cityType = "Outside Dhaka";
  const subDhakaZones = ["Savar", "Ashulia", "Dhamrai", "Keraniganj", "Tongi"];
  if (matchedDistrict === "Dhaka") {
    if (subDhakaZones.some(s => matchedZone.toLowerCase().includes(s.toLowerCase()))) {
      cityType = "Sub Dhaka";
    } else {
      cityType = "Inside Dhaka";
    }
  } else if (matchedDistrict === "Gazipur" || matchedDistrict === "Narayanganj") {
    cityType = "Sub Dhaka";
  } else {
    cityType = "Outside Dhaka";
  }

  return {
    raw: clean,
    district: matchedDistrict,
    zone: matchedZone,
    area: matchedArea,
    postcode: postcode,
    streetAddress: streetAddress,
    cityType: cityType
  };
}

/**
 * Smart Address Normalizer for Pathao Courier
 * Cleans messy Bangladeshi customer checkout addresses into standard delivery format.
 */
function normalizeAddressForPathao(rawAddress) {
  if (!rawAddress || typeof rawAddress !== "string") return "";

  let addr = rawAddress.trim().replace(/[\r\n\t]+/g, ", ").replace(/\s{2,}/g, " ");

  // 1. Remove leading Address Type labels (e.g. "Home Benapole...", "Office: Road 12...", "Delivery Address: ...")
  addr = addr.replace(/^(?:Home|Office|Delivery(?:\s*Address)?|Shipping(?:\s*Address)?|Address)[\s:,-]+(?![0-9#]|no\b|num\b|number\b|holding\b)/i, "");
  addr = addr.replace(/^(?:Home|Office)\s+(?=[a-zA-Z\u0980-\u09FF])(?!(?:no|num|number|[0-9#]|holding)\b)/i, "");
  addr = addr.replace(/^(?:বাসা|হোম|অফিস|ঠিকানা)[\s:,-]+(?![০-৯0-9#]|নং|নাম্বার|হোল্ডিং)/i, "");
  addr = addr.replace(/^(?:বাসা|হোম|অফিস)\s+(?=[\u0980-\u09FFa-zA-Z])(?!(?:নং|নাম্বার|[০-৯0-9#]|হোল্ডিং))/i, "");

  // 2. Remove accidental phone numbers embedded in address (01XXXXXXXXX or +8801XXXXXXXXX or Bengali digits)
  addr = addr.replace(/(?:\+?88)?01[3-9]\d{8}\b/g, "").trim();
  addr = addr.replace(/(?:\+?৮৮)?০১[৩-৯][০-৯]{8}/g, "").trim();

  // 3. Remove accidental email addresses embedded in address
  addr = addr.replace(/[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "").trim();

  // 4. Standardize common abbreviations & labels in English (strict word boundaries \b)
  addr = addr.replace(/\b(?:House(?:\s*(?:no|num|number))?|Hse|Hous|Hs|H)[\s#.:/-]+([a-zA-Z0-9/-]+)\b/gi, "House $1");
  addr = addr.replace(/\b(?:Road(?:\s*(?:no|num|number))?|Rood|Rd|Ro|R)[\s#.:/-]+([a-zA-Z0-9/-]+)\b/gi, "Road $1");
  addr = addr.replace(/\b(?:Sector(?:\s*(?:no|num|number))?|Sect|Sec)[\s#.:/-]+([a-zA-Z0-9/-]+)\b/gi, "Sector $1");
  addr = addr.replace(/\b(?:Block(?:\s*(?:no|num|number))?|Blck|Blk)[\s#.:/-]+([a-zA-Z0-9/-]+)\b/gi, (m, val) => `Block ${val.toUpperCase()}`);
  addr = addr.replace(/\b(?:Apartment|Flat(?:\s*(?:no|num|number))?|Flt|Apt|Fl)[\s#.:/-]+([a-zA-Z0-9/-]+)\b/gi, (m, val) => `Flat ${val.toUpperCase()}`);

  // English location labels (strict word boundaries \b to prevent corrupting names like Benapole or Polash)
  addr = addr.replace(/\b(?:Village|Vill)\b[\s:,-]+([a-zA-Z0-9\u0980-\u09FF/-]+)/gi, "Village: $1");
  addr = addr.replace(/\b(?:Post\s*Office|P\.O\.?|Post)\b[\s:,-]+([a-zA-Z0-9\u0980-\u09FF/-]+)/gi, "Post: $1");
  addr = addr.replace(/\b(?:Thana|Upazila|Upozila|P\.?S\.?)\b[\s:,-]+([a-zA-Z0-9\u0980-\u09FF/-]+)/gi, "Thana: $1");
  addr = addr.replace(/\b(?:District|Dist|Zilla|Zila|Jilla|Jela)\b[\s:,-]+([a-zA-Z0-9\u0980-\u09FF/-]+)/gi, "District: $1");

  // Bengali common labels (cleanly including ঃ / : without corrupting)
  addr = addr.replace(/(?:^|[\s,;।])(?:গ্রাম)[\s:ঃ#\-]+([^\s,;।ঃ]+)/gi, " গ্রাম: $1");
  addr = addr.replace(/(?:^|[\s,;।])(?:ডাকঘর|পোস্ট|পোঃ|পো:)[\s:ঃ#\-]+([^\s,;।ঃ]+)/gi, " ডাকঘর: $1");
  addr = addr.replace(/(?:^|[\s,;।])(?:থানা|উপজেলা)[\s:ঃ#\-]+([^\s,;।ঃ]+)/gi, " থানা: $1");
  addr = addr.replace(/(?:^|[\s,;।])(?:জেলা)[\s:ঃ#\-]+([^\s,;।ঃ]+)/gi, " জেলা: $1");

  // 5. Remove redundant Division labels (e.g. "Division khulna" or "বিভাগ খুলনা")
  addr = addr.replace(/(?:^|[,;\s]+)(?:Division|বিভাগ)[\s:ঃ#\-]+(?:Dhaka|Chattogram|Chittagong|Rajshahi|Khulna|Barishal|Barisal|Sylhet|Rangpur|Mymensingh|ঢাকা|চট্টগ্রাম|রাজশাহী|খুলনা|বরিশাল|সিলেট|রংপুর|ময়মনসিংহ)(?=\b|[,;\s।–-]|$)/gi, "");
  addr = addr.replace(/(?:^|[,;\s]+)(?:Dhaka|Chattogram|Chittagong|Rajshahi|Khulna|Barishal|Barisal|Sylhet|Rangpur|Mymensingh|ঢাকা|চট্টগ্রাম|রাজশাহী|খুলনা|বরিশাল|সিলেট|রংপুর|ময়মনসিংহ)[\s:ঃ#\-]+(?:Division|বিভাগ)(?=\b|[,;\s।–-]|$)/gi, "");

  // 6. Clean punctuation & extra commas
  addr = addr
    .replace(/[;\\]+/g, ",")
    .replace(/\s*,\s*/g, ", ")
    .replace(/,\s*,+/g, ", ")
    .replace(/^[,.\s-]+|[,.\s-]+$/g, "");

  // 7. Deduplicate segments (label-aware deduplication)
  const segments = addr.split(/,\s*/);
  const deduplicated = [];
  function getSegLabel(s) {
    const m = s.match(/^(?:thana|district|village|vill|post(?:\s*office)?|p\.?o\.?|গ্রাম|ডাকঘর|পোস্ট|পোঃ|পো:|থানা|উপজেলা|জেলা)[\s:ঃ#\-]+/i);
    return m ? m[0].trim().toLowerCase().replace(/[:ঃ#\-]+$/, "") : "";
  }
  function getSegCore(s) {
    return s.replace(/^(?:thana|district|village|vill|post(?:\s*office)?|p\.?o\.?|গ্রাম|ডাকঘর|পোস্ট|পোঃ|পো:|থানা|উপজেলা|জেলা)[\s:ঃ#\-]+/i, "").trim();
  }
  function getSegWords(s) {
    return s.toLowerCase().split(/[\s,./#\-]+/).filter(w => w.length > 0);
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i].trim();
    if (!seg) continue;
    const segLabel = getSegLabel(seg);
    const segCore = getSegCore(seg);
    const segWords = getSegWords(segCore);
    if (segWords.length === 0) continue;
    let isDuplicate = false;

    for (let j = 0; j < deduplicated.length; j++) {
      const existing = deduplicated[j];
      const existingLabel = getSegLabel(existing);
      const existingCore = getSegCore(existing);
      const existingWords = getSegWords(existingCore);

      if (segLabel && existingLabel && segLabel !== existingLabel) {
        continue;
      }

      if (segCore.toLowerCase() === existingCore.toLowerCase()) {
        isDuplicate = true;
        break;
      }

      if (!segLabel && segWords.length === 1 && !/^\d+$/.test(segWords[0]) && segWords[0].length >= 3) {
        if (existingWords.includes(segWords[0])) {
          isDuplicate = true;
          break;
        }
      }

      if (!existingLabel && existingWords.length === 1 && !/^\d+$/.test(existingWords[0]) && existingWords[0].length >= 3) {
        if (segWords.includes(existingWords[0]) && segWords.length > 1) {
          deduplicated[j] = seg;
          isDuplicate = true;
          break;
        }
      }
    }
    if (!isDuplicate) {
      deduplicated.push(seg);
    }
  }
  addr = deduplicated.join(", ");

  // 8. Use parseBDAddress to identify district, zone, and postcode
  let parsed = null;
  if (typeof parseBDAddress === "function") {
    parsed = parseBDAddress(rawAddress);
  }

  // 9. Remove trailing redundant district/postcode/ISO repetitions from street address
  addr = addr.replace(/(?:[,;\s]+\bBD[-_\s]?[0-6]?\d\b)+/gi, "");
  if (parsed && parsed.district) {
    if (parsed.postcode) {
      addr = addr.replace(new RegExp(`[-:,]?\\s*\\b${parsed.postcode}\\b`, "g"), "");
      const bgDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
      const bgPc = parsed.postcode.split('').map(c => bgDigits[parseInt(c, 10)] || c).join('');
      addr = addr.replace(new RegExp(`[-:,]?\\s*${bgPc}`, "g"), "");
    }

    addr = addr.replace(/[-:,;\s।]+$/, "").trim();
    const distObj = BD_DISTRICTS.find(d => d.name === parsed.district);
    const aliases = distObj ? [distObj.name, ...distObj.aliases] : [parsed.district];
    for (const a of aliases) {
      const esc = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      addr = addr.replace(new RegExp(`(?:[-:,;\\s।]+(?:(?:জেলা|District|Dist|Zilla|Zila|Jilla|Jela)[:\\sঃ]*)?${esc})+[-:,;\\s।]*$`, "i"), "");
    }
  }

  // 10. Title Case English words in street address
  addr = addr.replace(/\b([a-z])([a-z0-9]*)\b/g, (match, first, rest) => {
    if (/^(?:and|of|in|at|to|near|opposite)$/i.test(match)) return match.toLowerCase();
    return first.toUpperCase() + rest;
  });

  // 11. Final tidy-up of leading/trailing commas and whitespace
  addr = addr
    .replace(/\s*,\s*/g, ", ")
    .replace(/,\s*,+/g, ", ")
    .replace(/^[,.\s-]+|[,.\s-]+$/g, "")
    .trim();

  return addr || rawAddress.trim();
}

/**
 * Build complete modified full address for delivery labels & courier input.
 * Combines cleaned street address with properly resolved City/District, Zone, and Postcode.
 * Unicode and alias-aware: avoids duplicating district or zone in either English or Bengali.
 */
function buildFullAddress(rawAddress, parsedData) {
  if (!rawAddress || typeof rawAddress !== "string" || !rawAddress.trim()) return "";

  // 1. Get base cleaned street address
  let base = normalizeAddressForPathao(rawAddress);

  // 2. Resolve location components
  let parsed = parsedData;
  if (!parsed && typeof parseBDAddress === "function") {
    parsed = parseBDAddress(rawAddress);
  }

  if (!parsed) return base;

  const district = (parsed.district || "").trim();
  const zone = (parsed.zone || "").trim();
  const postcode = (parsed.postcode || "").trim();

  if (!district && !zone) return base;

  let parts = [base];

  // Resolve zone aliases
  let zoneAliases = [zone];
  let foundZoneObj = null;
  if (district && OTHER_CITY_ZONES[district]) {
    foundZoneObj = OTHER_CITY_ZONES[district].find(z => (typeof z === "object" ? z.name : z).toLowerCase() === zone.toLowerCase());
  }
  if (!foundZoneObj) {
    foundZoneObj = DHAKA_ZONES.find(z => z.name.toLowerCase() === zone.toLowerCase());
  }
  if (foundZoneObj && typeof foundZoneObj === "object") {
    zoneAliases = [foundZoneObj.name, ...(foundZoneObj.aliases || [])];
  }

  // Resolve district aliases
  let distAliases = [district];
  const distObj = BD_DISTRICTS.find(d => d.name === district);
  if (distObj) distAliases = [distObj.name, ...distObj.aliases];

  // Include zone if specific and not already in base (checking all aliases)
  if (zone && !/^(?:all|sadar|zone)$/i.test(zone)) {
    const hasZone = zoneAliases.some(a => matchWord(base, a));
    if (!hasZone) {
      parts.push(zone);
    }
  }

  // Include district/city if not already in base (checking all aliases)
  if (district) {
    const hasDist = distAliases.some(a => matchWord(base, a));
    if (!hasDist) {
      parts.push(district);
    }
  }

  // Include postcode if present and not in base (checking ASCII & Bengali digits)
  if (postcode) {
    const bgDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
    const bgPc = postcode.split('').map(c => bgDigits[parseInt(c, 10)] || c).join('');
    const hasPc = base.includes(postcode) || base.includes(bgPc);
    if (!hasPc) {
      let last = parts.pop();
      parts.push(`${last} - ${postcode}`);
    }
  }

  let full = parts.filter(Boolean).join(", ");
  full = full.replace(/\s*,\s*/g, ", ").replace(/,\s*,+/g, ", ").trim();
  return full || base;
}

/**
 * Smart Display Address Normalizer
 * Standardizes messy customer checkout addresses, removes repeated tokens/place names
 * (e.g. Noyakandi Bazar, Titas, Cumilla \n Titas \n Cumilla \n 3519 -> Noyakandi Bazar, Titas, Cumilla),
 * strips checkout noise, removes standalone postcodes, and preserves authentic Bengali/English casing.
 */
function normalizeDisplayAddress(rawAddress, customerName) {
  if (!rawAddress || typeof rawAddress !== "string") return "";

  let text = rawAddress.trim()
    .replace(/&times;/gi, "×")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/<br\s*\/?>/gi, ", ");

  text = text.replace(/[\r\n\t]+/g, ", ");

  // 1. Strip checkout labels & noise
  text = text.replace(/^(?:Billing details|Shipping details|Billing|Shipping|Payment via|Phone|Email|Customer|Name|বিলিং|গ্রাহক|নাম)[:\s,-]*/gi, "");
  text = text.replace(/[,:\s]+(?:Payment via|Cash on delivery|COD|bKash|Nagad|Rocket|Phone|Email).*$/gi, "");
  text = text.replace(/^(?:Home|Office|Delivery(?:\s*Address)?|Shipping(?:\s*Address)?|Address)[\s:,-]+(?![0-9#]|no\b|num\b|number\b|holding\b)/gi, "");
  text = text.replace(/^(?:Home|Office)\s+(?=[a-zA-Z\u0980-\u09FF])(?!(?:no|num|number|[0-9#]|holding)\b)/gi, "");
  text = text.replace(/^(?:বাসা|হোম|অফিস|ঠিকানা)[\s:,-]+(?![০-৯0-9#]|নং|নাম্বার|হোল্ডিং)/gi, "");
  text = text.replace(/^(?:বাসা|হোম|অফিস)\s+(?=[\u0980-\u09FFa-zA-Z])(?!(?:নং|নাম্বার|[০-৯0-9#]|হোল্ডিং))/gi, "");

  // 2. Remove accidental phone numbers embedded in address
  text = text.replace(/(?:\+?88)?01[3-9]\d{8}\b/g, "").trim();
  text = text.replace(/(?:\+?৮৮)?০১[৩-৯][০-৯]{8}/g, "").trim();

  // 3. Remove accidental email addresses embedded in address
  text = text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "").trim();

  // 4. Standardize common abbreviations & labels in English (strict word boundaries \b)
  text = text.replace(/\b(?:House(?:\s*(?:no|num|number))?|Hse|Hous|Hs|H)[\s#.:/-]+([a-zA-Z0-9/-]+)\b/gi, "House $1");
  text = text.replace(/\b(?:Road(?:\s*(?:no|num|number))?|Rood|Rd|Ro|R)[\s#.:/-]+([a-zA-Z0-9/-]+)\b/gi, "Road $1");
  text = text.replace(/\b(?:Sector(?:\s*(?:no|num|number))?|Sect|Sec)[\s#.:/-]+([a-zA-Z0-9/-]+)\b/gi, "Sector $1");
  text = text.replace(/\b(?:Block(?:\s*(?:no|num|number))?|Blck|Blk)[\s#.:/-]+([a-zA-Z0-9/-]+)\b/gi, (m, val) => `Block ${val.toUpperCase()}`);
  text = text.replace(/\b(?:Apartment|Flat(?:\s*(?:no|num|number))?|Flt|Apt|Fl)[\s#.:/-]+([a-zA-Z0-9/-]+)\b/gi, (m, val) => `Flat ${val.toUpperCase()}`);

  text = text.replace(/\b(?:Village|Vill)\b[\s:,-]+([a-zA-Z0-9\u0980-\u09FF/-]+)/gi, "Village: $1");
  text = text.replace(/\b(?:Post\s*Office|P\.O\.?|Post)\b[\s:,-]+([a-zA-Z0-9\u0980-\u09FF/-]+)/gi, "Post: $1");
  text = text.replace(/\b(?:Thana|Upazila|Upozila|P\.?S\.?)\b[\s:,-]+([a-zA-Z0-9\u0980-\u09FF/-]+)/gi, "Thana: $1");
  text = text.replace(/\b(?:District|Dist|Zilla|Zila|Jilla|Jela)\b[\s:,-]+([a-zA-Z0-9\u0980-\u09FF/-]+)/gi, "District: $1");

  text = text.replace(/(?:^|[\s,;।])(?:গ্রাম)[\s:ঃ#\-]+([^\s,;।ঃ]+)/gi, " গ্রাম: $1");
  text = text.replace(/(?:^|[\s,;।])(?:ডাকঘর|পোস্ট|পোঃ|পো:)[\s:ঃ#\-]+([^\s,;।ঃ]+)/gi, " ডাকঘর: $1");
  text = text.replace(/(?:^|[\s,;।])(?:থানা|উপজেলা)[\s:ঃ#\-]+([^\s,;।ঃ]+)/gi, " থানা: $1");
  text = text.replace(/(?:^|[\s,;।])(?:জেলা)[\s:ঃ#\-]+([^\s,;।ঃ]+)/gi, " জেলা: $1");

  // 5. Remove redundant Division labels
  text = text.replace(/(?:^|[,;\s]+)(?:Division|বিভাগ)[\s:ঃ#\-]+(?:Dhaka|Chattogram|Chittagong|Rajshahi|Khulna|Barishal|Barisal|Sylhet|Rangpur|Mymensingh|ঢাকা|চট্টগ্রাম|রাজশাহী|খুলনা|বরিশাল|সিলেট|রংপুর|ময়মনসিংহ)(?=\b|[,;\s।–-]|$)/gi, "");
  text = text.replace(/(?:^|[,;\s]+)(?:Dhaka|Chattogram|Chittagong|Rajshahi|Khulna|Barishal|Barisal|Sylhet|Rangpur|Mymensingh|ঢাকা|চট্টগ্রাম|রাজশাহী|খুলনা|বরিশাল|সিলেট|রংপুর|ময়মনসিংহ)[\s:ঃ#\-]+(?:Division|বিভাগ)(?=\b|[,;\s।–-]|$)/gi, "");

  // 6. Split by commas/semicolons and process segments
  text = text.replace(/[;\\]+/g, ",").replace(/\s*,\s*/g, ", ");
  const rawParts = text.split(",").map(s => s.trim()).filter(Boolean);

  const result = [];

  function getSegLabel(s) {
    const m = s.match(/^(?:thana|district|village|vill|post(?:\s*office)?|p\.?o\.?|গ্রাম|ডাকঘর|পোস্ট|পোঃ|পো:|থানা|উপজেলা|জেলা)[\s:ঃ#\-]+/i);
    return m ? m[0].trim().toLowerCase().replace(/[:ঃ#\-]+$/, "") : "";
  }
  function getSegCore(s) {
    return s.replace(/^(?:thana|district|village|vill|post(?:\s*office)?|p\.?o\.?|গ্রাম|ডাকঘর|পোস্ট|পোঃ|পো:|থানা|উপজেলা|জেলা)[\s:ঃ#\-]+/i, "").trim();
  }
  function getSegWords(s) {
    return s.toLowerCase().replace(/[^\w\u0980-\u09FF\s]/g, " ").split(/\s+/).filter(w => w.length > 0);
  }

  // Check if customerName is passed, and build words to filter
  const custWords = customerName && typeof customerName === "string"
    ? customerName.toLowerCase().replace(/[^\w\u0980-\u09FF\s]/g, " ").split(/\s+/).filter(w => w.length > 1)
    : [];

  for (let i = 0; i < rawParts.length; i++) {
    let seg = rawParts[i].trim();
    if (!seg) continue;

    // Check if seg is an ISO code like BD-08, BD-15
    if (/^bd[-_\s]?[0-6]?\d$/i.test(seg)) {
      if (typeof detectDistrictFromISOCode === "function") {
        const resolved = detectDistrictFromISOCode(seg);
        if (resolved) {
          seg = resolved;
        } else {
          continue;
        }
      } else {
        continue;
      }
    }

    // Check if seg is a standalone 4-digit postcode (e.g. 3519, 1216)
    if (/^\d{4,5}$/.test(seg) || /^[০-৯]{4,5}$/.test(seg) || /^(?:postcode|postal\s*code|পোস্টকোড)[:\s-]*\d{4,5}$/i.test(seg)) {
      // If we already have at least 1 address token, omit standalone postcode
      if (result.length > 0) {
        continue;
      }
    }

    // Skip if seg exactly matches customer name
    if (customerName && seg.toLowerCase() === customerName.trim().toLowerCase()) {
      continue;
    }
    // Skip if seg is a customer name word when name was provided
    if (custWords.length > 0 && custWords.length <= 3 && seg.toLowerCase().split(/\s+/).every(w => custWords.includes(w))) {
      continue;
    }

    const segLabel = getSegLabel(seg);
    const segCore = getSegCore(seg);
    const segWords = getSegWords(segCore);
    if (segWords.length === 0) continue;

    let isDuplicate = false;

    for (let j = 0; j < result.length; j++) {
      const existing = result[j];
      const existingLabel = getSegLabel(existing);
      const existingCore = getSegCore(existing);
      const existingWords = getSegWords(existingCore);

      if (segLabel && existingLabel && segLabel !== existingLabel) {
        continue;
      }

      // Exact match
      if (segCore.toLowerCase() === existingCore.toLowerCase()) {
        isDuplicate = true;
        break;
      }

      // Single word token already contained in an existing token
      if (!segLabel && segWords.length === 1 && !/^\d+$/.test(segWords[0]) && segWords[0].length >= 3) {
        if (existingWords.includes(segWords[0])) {
          isDuplicate = true;
          break;
        }
      }

      // If existing was single word without label, and new token is richer (multi-word) containing that word
      if (!existingLabel && existingWords.length === 1 && !/^\d+$/.test(existingWords[0]) && existingWords[0].length >= 3) {
        if (segWords.includes(existingWords[0]) && segWords.length > 1) {
          result[j] = seg;
          isDuplicate = true;
          break;
        }
      }

      // Labeled match: e.g. existing is "Thana: Sharsha" and seg is "Sharsha"
      if (existingLabel && !segLabel && segWords.length === 1 && existingWords.includes(segWords[0])) {
        isDuplicate = true;
        break;
      }
      // Or existing was "Sharsha" and seg is "Thana: Sharsha"
      if (!existingLabel && segLabel && existingWords.length === 1 && segWords.includes(existingWords[0])) {
        result[j] = seg;
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      result.push(seg);
    }
  }

  let full = result.join(", ");

  // Title case English words (preserve Bengali)
  full = full.replace(/\b([a-z])([a-z0-9]*)\b/g, (match, first, rest) => {
    if (/^(?:and|of|in|at|to|near|opposite)$/i.test(match)) return match.toLowerCase();
    return first.toUpperCase() + rest;
  });

  // Final clean
  full = full
    .replace(/\s*,\s*/g, ", ")
    .replace(/,\s*,+/g, ", ")
    .replace(/^[,.\s-]+|[,.\s-]+$/g, "")
    .trim();

  return full;
}

/**
 * Generate Pathao Bulk Upload CSV string
 */
function generatePathaoBatchCSV(orders) {
  if (!orders || !Array.isArray(orders) || orders.length === 0) {
    return "";
  }

  const headers = [
    "Merchant Order ID",
    "Recipient Name",
    "Recipient Phone",
    "Recipient Address",
    "Recipient City",
    "Recipient Zone",
    "Recipient Area",
    "Amount to Collect",
    "Item Type",
    "Item Quantity",
    "Special Instruction"
  ];

  const escapeCSV = (val) => {
    if (val === undefined || val === null) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  };

  const rows = [headers.join(",")];

  for (const order of orders) {
    const rawAddr = order.address || order["Address"] || "";
    const parsed = parseBDAddress(rawAddr);

    const orderId = order.orderId || order["Order ID"] || "";
    const name = order.name || order["Recipient Name"] || "";
    const phone = order.phone || order["Phone"] || "";
    const street = parsed.streetAddress || rawAddr;
    const city = order.city || parsed.district;
    const zone = order.zone || parsed.zone;
    const area = order.area || parsed.area || "";
    const cod = order.cod !== undefined && order.cod !== "" ? order.cod : (order["COD Amount"] !== undefined ? order["COD Amount"] : 0);
    const itemType = order.type || order["Type"] === "Exchange" ? "Exchange" : "Parcel";
    const quantity = 1;
    const instruction = orderId ? `Order #${orderId}` : "";

    rows.push([
      escapeCSV(orderId),
      escapeCSV(name),
      escapeCSV(phone),
      escapeCSV(street),
      escapeCSV(city),
      escapeCSV(zone),
      escapeCSV(area),
      escapeCSV(cod),
      escapeCSV(itemType),
      escapeCSV(quantity),
      escapeCSV(instruction)
    ].join(","));
  }

  return rows.join("\r\n");
}

/**
 * Export Pathao Bulk CSV with 1-click download trigger
 */
function exportPathaoBatchCSV(orders, filename) {
  const csvContent = generatePathaoBatchCSV(orders);
  if (!csvContent) return "";

  const fname = filename || `Pathao_Bulk_Orders_${new Date().toISOString().slice(0, 10)}.csv`;

  if (typeof document !== "undefined" && typeof URL !== "undefined") {
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", fname);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return csvContent;
}

/**
 * --------------------------------------------------------------------------
 * WhatsApp Advance COD Quick Reply Engine & Templates
 * --------------------------------------------------------------------------
 */
const DEFAULT_QUICK_REPLY_CONFIG = {
  storeName: "DEEN Commerce",
  bkashNumber: "01XXXXXXXXX",
  bkashType: "Personal", // Personal | Merchant
  nagadNumber: "",
  nagadType: "Personal", // Personal | Merchant
  insideDhakaFee: 50,
  outsideDhakaFee: 90,
  customNote: ""
};

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
         (trimmed.startsWith("bd-") && /^bd[-_\s]?[0-6]?\d$/i.test(trimmed)) ||
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

  let phone = "";
  let digits = rawText.match(/(?:(?:\+?880)|880|0)?(1[3-9]\d{8})\b/);
  if (digits && digits[1]) {
    phone = "0" + digits[1];
  }

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

    if (line.match(/(?:(?:\+?880)|880|0)?(1[3-9]\d{8})\b/) && line.replace(/[^\d+]/g, "").length >= 10) {
      continue;
    }

    // Strip inline prefix/suffix noise
    line = line.replace(/^(?:Billing details|Shipping details|Payment via|Phone|Email)[:\s,]*/gi, "").trim();
    line = line.replace(/[,:\s]+(?:Payment via|Cash on delivery|Phone|Email).*$/gi, "").trim();
    if (!line) continue;

    const isAddressKeyword = /^(?:Road|House|Block|Sector|Village|Holding|Flat|Apt|Post|PO|Thana|District|Dist|বাসস্ট্যান্ড|স্টেশন|পোস্ট|পোঃ|সদর|থানা|উপজেলা|জেলা|গ্রাম|রোড|বাসা|বাড়ি)/i.test(line);
    const isDistrictOrZone = /^(?:Dhaka|Chattogram|Chittagong|Sylhet|Khulna|Rajshahi|Barishal|Rangpur|Mymensingh|Gazipur|Narayanganj|Bagerhat|Cumilla|Comilla|Bogura|Bogra|Faridpur|Uttara|Mirpur|Banani|Gulshan|Dhanmondi|Mohammadpur)/i.test(line);
    const isIsoStateCode = /^BD[-_\s]?[0-6]?\d$/i.test(line);
    const hasNumberDigits = /\d{3,}/.test(line) || /^\d+$/.test(line);

    if (isAddressKeyword || isDistrictOrZone || isIsoStateCode || hasNumberDigits) {
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

  const displayAddress = normalizeDisplayAddress(cleanTokens.join(", "), name);

  return {
    name: name,
    phone: phone,
    address: displayAddress,
    paymentMethod: paymentMethod
  };
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

/**
 * Extract item name combined with size / variation attributes
 * Never strips size, color, or variation from product descriptions
 */
function extractItemNameWithSize(nameEl, context) {
  if (!nameEl) return "";

  // If passed a plain string or primitive
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

  // If nameEl is a DOM Element or context is a DOM Element
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
    // 1. Meta list: .wc-order-item-meta li
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

    // 2. dl.variation
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

    // 3. .wc-order-item-variation
    const varNodes = ctx.querySelectorAll(".wc-order-item-variation, .variation, .order-item-variation");
    varNodes.forEach(vn => {
      const vt = (vn.textContent || vn.innerText || "").trim();
      if (vt && !/^(?:SKU|ID):/i.test(vt) && !vars.some(v => v.includes(vt))) {
        vars.push(vt.replace(/^[:\s-]+/, "").trim());
      }
    });

    // 4. WooCommerce Order Preview meta tables (e.g. table.wc-order-item-meta, table.display_meta)
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

  // 5. Secondary text lines in el
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

  // Filter variations already included in title
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

/**
 * Normalize and clean customer, delivery, and ordered product details
 */
function normalizeCustomerAndOrderData(rawDetails) {
  const d = Object.assign({}, rawDetails || {});
  
  // Check if d.address has noise like "Billing details" or if name is invalid
  let rawAddr = (d.address || "").trim();
  let parsedBlock = null;
  if (isInvalidCustomerName(d.name) || /Billing details|Payment via|Cash on delivery/i.test(rawAddr)) {
    parsedBlock = parseWooCommerceAddressBlock(rawAddr);
  }

  // 1. Phone number
  let cleanPhone = normalizeBDPhone(d.phone || "");
  if (!cleanPhone && parsedBlock && parsedBlock.phone) {
    cleanPhone = normalizeBDPhone(parsedBlock.phone || "");
  }

  // 2. Customer Name (proper casing and clean)
  let name = (d.name || "").trim().replace(/\s+/g, " ");
  if (isInvalidCustomerName(name) && parsedBlock && parsedBlock.name) {
    name = parsedBlock.name;
  }
  name = name.replace(/^(?:Customer|Name|বিলিং|গ্রাহক|নাম)[:\s-]*/i, "").trim();
  name = name.replace(/(?:\+?880|0)?1[3-9]\d{8}/g, "").replace(/\S+@\S+\.\S+/g, "").trim();
  if (name) {
    if (name === name.toUpperCase() || name === name.toLowerCase()) {
      name = name.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
    }
  }

  // 3. Address
  let address = parsedBlock && parsedBlock.address ? parsedBlock.address : rawAddr;
  address = normalizeDisplayAddress(address, name);
  let parsed = { district: "", zone: "", streetAddress: address };
  if (address && typeof parseBDAddress === "function") {
    parsed = parseBDAddress(address);
  }
  const district = parsed.district || d.district || "";
  const zone = parsed.zone || d.zone || "";

  // 4. Products & Unit Prices
  const items = [];
  let subtotalCalc = 0;
  if (Array.isArray(d.items) && d.items.length > 0) {
    d.items.forEach(it => {
      let rawName = extractItemNameWithSize(it.name || it.title || "", it);
      if (!rawName) return;
      rawName = rawName.replace(/\s*\((?:Size|সাইজ|Color|কালার|রঙ|Fit|Variation|ভেরিয়েশন)[:\s]*\)/gi, "").trim();
      if (isExcludedMetaOrButtonRow(null, rawName)) return;

      const qtyVal = parseInt(bengaliToAsciiDigits(String(it.qty || it.quantity || "1")), 10) || 1;
      let totalNum = 0;
      if (it.total !== undefined && it.total !== null && it.total !== "") {
        const numMatch = bengaliToAsciiDigits(String(it.total)).replace(/,/g, "").match(/[\d.]+/);
        if (numMatch) totalNum = Math.round(parseFloat(numMatch[0]));
      }

      let unitPrice = 0;
      if (it.unitPrice || it.price) {
        const upMatch = bengaliToAsciiDigits(String(it.unitPrice || it.price)).replace(/,/g, "").match(/[\d.]+/);
        if (upMatch) unitPrice = Math.round(parseFloat(upMatch[0]));
      }
      if (!unitPrice && totalNum > 0 && qtyVal > 0) {
        unitPrice = Math.round(totalNum / qtyVal);
      }
      if (!totalNum && unitPrice > 0 && qtyVal > 0) {
        totalNum = unitPrice * qtyVal;
      }

      subtotalCalc += totalNum;

      items.push({
        name: rawName,
        qty: qtyVal,
        unitPrice: unitPrice > 0 ? unitPrice.toString() : "",
        total: totalNum > 0 ? totalNum.toString() : ""
      });
    });
  }

  // 5. Total COD
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
                    (parsed.cityType && parsed.cityType !== "Inside Dhaka") ||
                    (address && !address.toLowerCase().includes("dhaka"));

  const insideFee = Number(DEFAULT_QUICK_REPLY_CONFIG.insideDhakaFee) || 50;
  const outsideFee = Number(DEFAULT_QUICK_REPLY_CONFIG.outsideDhakaFee) || 90;
  const realDeliveryFee = isOutside ? outsideFee : insideFee;

  // Auto-resolve single item price if total was missing but COD is known
  if (items.length === 1 && (!items[0].total || items[0].total === "0" || !items[0].unitPrice)) {
    const codNum = Number(cod);
    if (codNum > 0) {
      const resolvedTotal = (codNum > realDeliveryFee && realDeliveryFee > 0) ? (codNum - realDeliveryFee) : codNum;
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

  // Intelligent Delivery Fee & Falsely Inside Dhaka Detection:
  // If customer is outside Dhaka, but WooCommerce charged ৳50 (or subtotal was ৳1500 and COD was ৳1550),
  // correct COD to Subtotal + ৳90 (1500 + 90 = 1590) so the merchant is never underpaid!
  let wasFalselyInside = false;
  let finalCod = cod && cod !== "0" ? cod : "";

  if (finalSubtotal && Number(finalSubtotal) > 0) {
    const subNum = Number(finalSubtotal);
    const codNum = Number(finalCod || 0);

    if (isOutside) {
      // Detected outside Dhaka: if COD matches subtotal + 50 (or legacy 70) or equals subtotal (0 shipping)
      if (codNum === subNum + 50 || codNum === subNum + 70 || codNum === subNum) {
        wasFalselyInside = (codNum === subNum + 50 || codNum === subNum + 70);
        finalCod = (subNum + outsideFee).toString();
      } else if (!finalCod || codNum === 0) {
        finalCod = (subNum + outsideFee).toString();
      }
    } else {
      // Inside Dhaka: only fill if COD was missing
      if (!finalCod || codNum === 0) {
        finalCod = (subNum + insideFee).toString();
      }
    }
  }

  if (!finalCod || finalCod === "0") {
    finalCod = finalSubtotal !== "0" ? (Number(finalSubtotal) + realDeliveryFee).toString() : "0";
  }

  return Object.assign({}, d, {
    orderId: (d.orderId || "").toString().trim().replace(/^#/, ""),
    name: name || (d.name ? d.name.trim() : "Customer"),
    phone: cleanPhone || d.phone || "",
    address: address,
    district: district,
    zone: zone,
    items: items,
    subtotal: finalSubtotal,
    deliveryFee: realDeliveryFee,
    cod: finalCod,
    isOutsideDhaka: isOutside,
    wasFalselyInsideDhaka: wasFalselyInside
  });
}

/**
 * Calculate appropriate delivery fee based on address, district, or explicit parameters
 */
function calculateDeliveryFee(params, config) {
  if (params && params.fee !== undefined && params.fee !== null && params.fee !== "") {
    const num = Number(params.fee);
    if (!isNaN(num) && num > 0) return num;
  }
  const cfg = config || DEFAULT_QUICK_REPLY_CONFIG;
  const insideFee = Number(cfg.insideDhakaFee) || 50;
  const outsideFee = Number(cfg.outsideDhakaFee) || 90;

  if (params && typeof params.isOutsideDhaka === "boolean") {
    return params.isOutsideDhaka ? outsideFee : insideFee;
  }

  const addr = (params && (params.address || params.district || params.city || "")).toLowerCase();
  if (!addr) {
    return outsideFee; // Default to outside Dhaka standard for merchant financial security
  }

  let parseBD = typeof parseBDAddress === "function" ? parseBDAddress : null;
  if (!parseBD && typeof require !== "undefined") {
    try { parseBD = require("./parser.js").parseBDAddress; } catch (e) {}
  }
  if (parseBD) {
    const parsed = parseBD(addr);
    if (parsed.cityType === "Inside Dhaka") {
      return insideFee;
    }
    return outsideFee;
  }

  // Fallback checks
  const isSubDhaka = addr.includes("savar") || addr.includes("সাভার") ||
                     addr.includes("gazipur") || addr.includes("গাজীপুর") ||
                     addr.includes("narayanganj") || addr.includes("নারায়ণগঞ্জ") ||
                     addr.includes("keraniganj") || addr.includes("কেরানীগঞ্জ");
  const isDhaka = (addr.includes("dhaka") || addr.includes("ঢাকা") ||
                   addr.includes("uttara") || addr.includes("mirpur") ||
                   addr.includes("dhanmondi") || addr.includes("gulshan") ||
                   addr.includes("banani") || addr.includes("mohammadpur") ||
                   addr.includes("motijheel") || addr.includes("badda")) && !isSubDhaka;

  if (isDhaka) {
    return insideFee;
  }
  return outsideFee;
}

/**
 * Build a valid WhatsApp wa.me deep link with country code 880
 */
function buildWhatsAppDeepLink(phone, messageText) {
  if (!phone) return "";
  let digits = String(phone).replace(/\D/g, "");
  let cleanPhone = digits;
  if (digits.startsWith("01") && digits.length === 11) {
    cleanPhone = "88" + digits;
  } else if (digits.startsWith("1") && digits.length === 10) {
    cleanPhone = "880" + digits;
  } else if (!digits.startsWith("88") && digits.length === 11) {
    cleanPhone = "88" + digits;
  }
  const encodedText = encodeURIComponent(messageText || "");
  return `https://wa.me/${cleanPhone}?text=${encodedText}`;
}

/**
 * Generate formatted WhatsApp message based on template key
 * Supported templates:
 * - 'advance_fee': Request advance delivery charge via bKash/Nagad before dispatching COD
 * - 'confirm_order': Friendly order confirmation with COD total & order reference
 * - 'high_risk_notice': Strict advance requirement for high return risk or low delivery rate customer
 * - 'tracking_info': Parcel dispatch and courier tracking notice
 */
function generateQuickReply(templateKey, params, customConfig) {
  const p = normalizeCustomerAndOrderData(params);
  const cfg = Object.assign({}, DEFAULT_QUICK_REPLY_CONFIG, customConfig || {});
  const store = cfg.storeName || "DEEN Commerce";
  const fee = calculateDeliveryFee(p, cfg);
  const nameGreeting = p.name && p.name.trim() ? ` ${p.name.trim()}` : "";
  const orderNum = p.orderId ? String(p.orderId).trim().replace(/^#/, "") : "";
  const orderRef = orderNum ? ` (অর্ডার #${orderNum})` : "";
  const codVal = p.cod !== undefined && p.cod !== null && p.cod !== "" ? String(p.cod).trim() : "";

  // Payment methods breakdown
  let paymentLines = [];
  if (cfg.bkashNumber) {
    paymentLines.push(`• বিকাশ (${cfg.bkashType || "Personal"}): ${cfg.bkashNumber}`);
  }
  if (cfg.nagadNumber) {
    paymentLines.push(`• নগদ (${cfg.nagadType || "Personal"}): ${cfg.nagadNumber}`);
  }
  if (paymentLines.length === 0) {
    paymentLines.push(`• বিকাশ/নগদ: ${cfg.bkashNumber || "01XXXXXXXXX"}`);
  }
  const paymentBlock = paymentLines.join("\n");

  switch (templateKey) {
    case "order_details_confirm":
    case "ask_confirm": {
      let itemsListText = "";
      if (p.items && Array.isArray(p.items) && p.items.length > 0) {
        itemsListText = "\n🛍️ অর্ডারকৃত পণ্য:\n" + p.items.map(it => {
          const itName = it.name || it.title || "পণ্য";
          const itQty = it.qty || it.quantity || 1;
          const up = it.unitPrice ? ` (প্রতি পিস ৳${it.unitPrice})` : "";
          const itPrice = it.total ? ` - ৳${it.total}` : (it.price ? ` - ৳${it.price}` : "");
          return `• ${itName} (পরিমাণ: ${itQty})${up}${itPrice}`;
        }).join("\n");
      }
      const addrText = p.address ? `\n📍 ডেলিভারি ঠিকানা: ${p.address}` : "";
      const phoneText = p.phone ? `\n📞 ফোন নম্বর: ${p.phone}` : "";
      const codText = codVal ? `\n💰 মোট প্রদেয় ক্যাশ-অন-ডেলিভারি (COD): ৳${codVal}` : "";
      let advText = "";
      if (p.requestAdvance || p.isOutsideDhaka) {
        advText = `\n\nকুরিয়ার সার্ভিস শর্ত অনুযায়ী ডেলিভারি চার্জ ৳${fee} অগ্রিম প্রযোজ্য। বিকাশ (${cfg.bkashType || "Personal"}): ${cfg.bkashNumber || ""}`;
      }

      return `আসসালামু আলাইকুম${nameGreeting}!
${store} থেকে আপনার অর্ডারটি${orderRef} কনফার্ম করার জন্য বিস্তারিত নিচে দেওয়া হলো:${itemsListText}${addrText}${phoneText}${codText}${advText}

অর্ডারটি কনফার্ম করার জন্য অনুগ্রহ করে 'হ্যাঁ' বা 'কনফার্ম' লিখে রিপ্লাই দিন। কোনো পরিবর্তন থাকলে আমাদের জানান। ধন্যবাদ!
— ${store} (deencommerce.com)`;
    }

    case "confirm_order": {
      const codLine = codVal ? `\nমোট প্রদেয় ক্যাশ-অন-ডেলিভারি (COD): ৳${codVal}` : "";
      return `আসসালামু আলাইকুম${nameGreeting}!
${store} থেকে আপনার অর্ডারটি${orderRef} সফলভাবে কনফার্ম করা হয়েছে।${codLine}

পার্সেলটি দ্রুত প্রস্তুত করে কুরিয়ারে হস্তান্তর করা হবে। কোনো জিজ্ঞাসা থাকলে আমাদের জানাতে পারেন। আপনার অর্ডারের জন্য ধন্যবাদ!`;
    }

    case "high_risk_notice": {
      return `আসসালামু আলাইকুম${nameGreeting}!
কুরিয়ার সার্ভিস পলিসি অনুযায়ী${orderRef} ক্যাশ-অন-ডেলিভারিতে পার্সেল পাঠানোর পূর্বে ডেলিভারি চার্জ ৳${fee} অগ্রিম প্রদান করা বাধ্যতামূলক।

পেমেন্ট মাধ্যম:
${paymentBlock}

টাকা পাঠিয়ে অনুগ্রহ করে TrxID বা লাস্ট ২ ডিজিট মেসেজ করুন। অগ্রিম ডেলিভারি চার্জ প্রাপ্তির পর পার্সেল বুকিং কনফার্ম করা হবে। ধন্যবাদ! - ${store}`;
    }

    case "tracking_info": {
      const tracking = p.trackingId || orderNum || "";
      const codLine = codVal ? `\nক্যাশ-অন-ডেলিভারি (COD): ৳${codVal}` : "";
      return `আসসালামু আলাইকুম${nameGreeting}!
${store} থেকে আপনার পার্সেলটি কুরিয়ার সার্ভিসে হস্তান্তর করা হয়েছে।
${tracking ? `ট্র্যাকিং আইডি: ${tracking}` : ""}${codLine}

কুরিয়ার রাইডারের কল রিসিভ করে পার্সেলটি গ্রহণ করার জন্য অনুরোধ করা হলো। ধন্যবাদ!`;
    }

    case "advance_fee":
    default: {
      return `আসসালামু আলাইকুম${nameGreeting}!
${store} থেকে আপনার অর্ডারটি${orderRef} কনফার্ম করার জন্য কুরিয়ার ডেলিভারি চার্জ ৳${fee} অগ্রিম প্রদান করতে হবে। অবশিষ্ট মূল্য (COD) পার্সেল রিসিভ করার সময় পরিশোধ করবেন।

পেমেন্ট মাধ্যম:
${paymentBlock}

টাকা পাঠিয়ে অনুগ্রহ করে লাস্ট ২ ডিজিট বা ট্রানজেকশন আইডি (TrxID) জানান। পেমেন্ট কনফার্ম হলেই পার্সেলটি দ্রুত পাঠিয়ে দেওয়া হবে। ধন্যবাদ!`;
    }
  }
}

// Make functions accessible in content scripts, background worker, popup, and tests
const PARSER_EXPORTS = {
  cleanLines,
  isConsignmentId,
  getConsignmentId,
  bengaliToAsciiDigits,
  parseAmount,
  parseDate,
  parseStandardRecords,
  extractFieldsFuzzy,
  parseFuzzyRecords,
  computeMetrics,
  parseDeliveryData,
  isWooCommerceText,
  parseWooCommerceOrders,
  exportToCSV,
  exportToExcelXML,
  exportToXLSX,
  BD_DISTRICTS,
  DHAKA_ZONES,
  OTHER_CITY_ZONES,
  parseBDAddress,
  normalizeAddressForPathao,
  generatePathaoBatchCSV,
  exportPathaoBatchCSV,
  normalizeBDPhone,
  escapeHTML,
  DEFAULT_QUICK_REPLY_CONFIG,
  calculateDeliveryFee,
  buildWhatsAppDeepLink,
  generateQuickReply,
  normalizeCustomerAndOrderData,
  parseWooCommerceAddressBlock,
  isInvalidCustomerName,
  extractItemNameWithSize,
  cleanHtmlEntities,
  isExcludedMetaOrButtonRow,
  BD_ISO_DISTRICTS,
  detectDistrictFromISOCode,
  getISOCodeFromDistrict,
  matchWord,
  buildFullAddress,
  normalizeDisplayAddress
};

if (typeof window !== "undefined") {
  Object.assign(window, PARSER_EXPORTS);
}
if (typeof self !== "undefined") {
  Object.assign(self, PARSER_EXPORTS);
}
if (typeof globalThis !== "undefined") {
  Object.assign(globalThis, PARSER_EXPORTS);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = PARSER_EXPORTS;
}
