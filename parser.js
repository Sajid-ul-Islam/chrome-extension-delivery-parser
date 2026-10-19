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
  for (let line of rawLines) {
    const val = line.trim();
    if (!val) continue;
    if (val === "---" || /^[-=_*]{3,}$/.test(val)) continue;
    if (HEADER_TOKENS.has(val)) continue;
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

/**
 * Prominent Zones in Other Major Hubs
 */
const OTHER_CITY_ZONES = {
  "Chattogram": ["Agrabad", "Nasirabad", "Halishahar", "Panchlaish", "Kotwali", "Khulshi", "Chandgaon", "Bakalia", "Pahartali", "Patenga", "Muradpur", "GEC", "Bayazid", "Hathazari", "Sitakunda", "Chawkbazar"],
  "Gazipur": ["Tongi", "Gazipur Sadar", "Sreepur", "Kaliakair", "Kapasia", "Kaliganj", "Konabari", "Board Bazar", "Chandona"],
  "Narayanganj": ["Narayanganj Sadar", "Fatullah", "Siddhirganj", "Bandar", "Rupganj", "Araihazar", "Sonargaon", "Kanchpur"],
  "Sylhet": ["Zindabazar", "Amberkhana", "Shibganj", "Upashahar", "Kadamtoli", "Subidbazar", "Sylhet Sadar", "South Surma", "Kumarpara", "Lamabazar"],
  "Rajshahi": ["Boalia", "Motihar", "Rajpara", "Shah Makhdum", "Rajshahi Sadar", "Kazla"],
  "Bogura": ["Bogura Sadar", "Sherpur", "Shajahanpur", "Thanthania", "Joleshworitola"],
  "Khulna": ["Khulna Sadar", "Sonadanga", "Khalishpur", "Daulatpur", "Khan Jahan Ali", "Boyra"],
  "Cumilla": ["Cumilla Sadar", "Kandirpar", "Badurtala", "Kotwali", "Tomsom Bridge", "Shashangachha", "EPZ"],
  "Barishal": ["Barishal Sadar", "Natullabad", "Rupatali", "Band Road"],
  "Rangpur": ["Rangpur Sadar", "Jahaj Company", "Modern More", "Dhap"],
  "Mymensingh": ["Mymensingh Sadar", "Ganginarpar", "Charpara", "Town Hall"],
  "Faridpur": ["Faridpur Sadar", "Boalmari", "Bhanga", "Alfadanga", "Madhukhali", "Nagarkanda", "Sadarpur", "Charbhadrasan", "Saltha"]
};

/**
 * Smart Bangladesh Address Parser
 * Decomposes unstructured BD addresses into District, Zone, Area, Postcode, and Clean Street.
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

  // 1. Extract Postcode (4 digits, e.g. "1216", "1740", "1230")
  let postcode = "";
  const pcMatch = clean.match(/(?:postal\s*code|post\s*code|postcode|zip)?\s*[-:,]?\s*\b([1-9]\d{3})\b/i);
  if (pcMatch) {
    const matchedVal = pcMatch[1];
    const fullMatchIdx = pcMatch.index;
    const prevChars = clean.substring(Math.max(0, fullMatchIdx - 4), fullMatchIdx);
    if (!/01\d$/.test(prevChars)) {
      postcode = matchedVal;
    }
  }

  // 2. Identify District & Zone Intelligently
  let matchedDistrict = "";
  let matchedZone = "";

  // A. Check for ISO 3166-2:BD code first (e.g. BD-15 -> Faridpur, BD-18 -> Gazipur)
  const isoDistrict = detectDistrictFromISOCode(clean);
  if (isoDistrict) {
    matchedDistrict = isoDistrict;
  }

  // B. Check specific non-Dhaka zones from OTHER_CITY_ZONES
  // E.g. "Kandirpar" (Cumilla), "Sreepur" (Gazipur), "Agrabad" (Chattogram), "Boalmari" (Faridpur)
  if (!matchedDistrict) {
    for (const [distName, zones] of Object.entries(OTHER_CITY_ZONES)) {
      if (distName.toLowerCase() === "dhaka") continue;
      for (const z of zones) {
        const zName = typeof z === "string" ? z : z.name;
        const aliases = typeof z === "string" ? [z] : (z.aliases || [z.name]);
        let found = false;
        for (const alias of aliases) {
          const zRegex = new RegExp(`(?:^|[\\s,;\\/\\-\\(\\[])${alias.replace(".", "\\.")}(?:$|[\\s,;\\/\\-\\)\\]0-9])`, "i");
          if (zRegex.test(clean)) {
            matchedZone = zName;
            matchedDistrict = distName;
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (matchedDistrict) break;
    }
  }

  // C. Check all 63 NON-DHAKA districts FIRST
  // Crucial: Bangladeshi customers often select "Dhaka" on checkout to pay ৳50 instead of ৳90,
  // or WooCommerce defaults the state to "Dhaka". By checking non-Dhaka districts first,
  // we catch their real outside-Dhaka district even if "Dhaka" is present in the address block!
  if (!matchedDistrict) {
    const nonDhakaDistricts = BD_DISTRICTS.filter(d => d.name !== "Dhaka");
    for (const d of nonDhakaDistricts) {
      for (const alias of d.aliases) {
        const regex = new RegExp(`(?:^|[\\s,;\\/\\-\\(\\[])${alias.replace(".", "\\.")}(?:$|[\\s,;\\/\\-\\)\\]0-9])`, "i");
        if (regex.test(clean)) {
          matchedDistrict = d.name;
          break;
        }
      }
      if (matchedDistrict) break;
    }
  }

  // D. Check non-Dhaka postcode: Dhaka city postcodes are 1000-1236.
  // Postcodes >= 1300 firmly belong outside Dhaka or in Sub-Dhaka districts
  if (!matchedDistrict && postcode) {
    const pcNum = parseInt(postcode, 10);
    if (pcNum >= 1700 && pcNum <= 1751) {
      matchedDistrict = "Gazipur";
    } else if (pcNum >= 1400 && pcNum <= 1432) {
      matchedDistrict = "Narayanganj";
    } else if (pcNum >= 1340 && pcNum <= 1349) {
      matchedDistrict = "Dhaka";
      matchedZone = "Savar";
    }
  }

  // E. Finally, check Dhaka city or Dhaka zones ONLY if no non-Dhaka district was detected
  if (!matchedDistrict) {
    const dhakaObj = BD_DISTRICTS.find(d => d.name === "Dhaka");
    if (dhakaObj) {
      for (const alias of dhakaObj.aliases) {
        const regex = new RegExp(`(?:^|[\\s,;\\/\\-\\(\\[])${alias.replace(".", "\\.")}(?:$|[\\s,;\\/\\-\\)\\]0-9])`, "i");
        if (regex.test(clean)) {
          matchedDistrict = "Dhaka";
          break;
        }
      }
    }
  }

  // 3. Identify Zone / Thana

  // If district is Dhaka or unknown, check Dhaka zones
  if (!matchedDistrict || matchedDistrict === "Dhaka") {
    for (const z of DHAKA_ZONES) {
      const zName = typeof z === "string" ? z : z.name;
      const aliases = typeof z === "string" ? [z] : z.aliases;
      let found = false;
      for (const alias of aliases) {
        const zRegex = new RegExp(`(?:^|[\\s,;\\/\\-\\(\\[])${alias.replace(".", "\\.")}(?:$|[\\s,;\\/\\-\\)\\]0-9])`, "i");
        if (zRegex.test(clean)) {
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

  // Check specific zones for known districts or other cities
  if (!matchedZone) {
    const targetDist = matchedDistrict || "";
    if (OTHER_CITY_ZONES[targetDist]) {
      for (const z of OTHER_CITY_ZONES[targetDist]) {
        const zName = typeof z === "string" ? z : z.name;
        const aliases = typeof z === "string" ? [z] : (z.aliases || [z.name]);
        let found = false;
        for (const alias of aliases) {
          const zRegex = new RegExp(`(?:^|[\\s,;\\/\\-\\(\\[])${alias.replace(".", "\\.")}(?:$|[\\s,;\\/\\-\\)\\]0-9])`, "i");
          if (zRegex.test(clean)) {
            matchedZone = zName;
            found = true;
            break;
          }
        }
        if (found) break;
      }
    } else {
      // Scan all other city zones if district was not matched yet
      for (const [distName, zones] of Object.entries(OTHER_CITY_ZONES)) {
        for (const z of zones) {
          const zName = typeof z === "string" ? z : z.name;
          const aliases = typeof z === "string" ? [z] : (z.aliases || [z.name]);
          let found = false;
          for (const alias of aliases) {
            const zRegex = new RegExp(`(?:^|[\\s,;\\/\\-\\(\\[])${alias.replace(".", "\\.")}(?:$|[\\s,;\\/\\-\\)\\]0-9])`, "i");
            if (zRegex.test(clean)) {
              matchedZone = zName;
              if (!matchedDistrict) matchedDistrict = distName;
              found = true;
              break;
            }
          }
          if (found) break;
        }
        if (matchedZone) break;
      }
    }
  }

  // Check for "<Word> Sadar"
  if (!matchedZone) {
    const sadarMatch = clean.match(/([a-zA-Z]+)\s+Sadar\b/i);
    if (sadarMatch) {
      matchedZone = `${sadarMatch[1]} Sadar`;
      if (!matchedDistrict) {
        const dObj = BD_DISTRICTS.find(d => d.name.toLowerCase() === sadarMatch[1].toLowerCase());
        if (dObj) matchedDistrict = dObj.name;
      }
    }
  }

  // Check token preceding district or ISO code (e.g. "Sreepur, Gazipur" or "Boalmari, BD-15")
  if (!matchedZone && matchedDistrict) {
    const parts = clean.split(/[,;\n]+/).map(p => p.trim()).filter(Boolean);
    const dIdx = parts.findIndex(p =>
      new RegExp(`\\b${matchedDistrict}\\b`, "i").test(p) ||
      /\bBD[-_\s]?[0-6]?\d\b/i.test(p)
    );
    if (dIdx > 0) {
      const prev = parts[dIdx - 1];
      if (prev.length <= 30 && !/^(road|house|flat|plot|block|holding)/i.test(prev)) {
        matchedZone = prev;
      }
    }
  }

  // Fallbacks
  if (!matchedDistrict) {
    matchedDistrict = "Dhaka";
  }
  if (!matchedZone) {
    matchedZone = matchedDistrict === "Dhaka" ? "Dhaka Sadar" : `${matchedDistrict} Sadar`;
  }

  // 4. Identify Area / Sub-area (Sector, Block, Ward have highest priority)
  let matchedArea = "";
  const priorityAreaMatch = clean.match(/\b(Sector\s*[-#]?\s*\d+|Block\s*[-#]?\s*[A-Z0-9]+|Ward\s*[-#]?\s*\d+)\b/i);
  if (priorityAreaMatch) {
    matchedArea = priorityAreaMatch[1];
  } else {
    const fallbackAreaMatch = clean.match(/\b(Road\s*[-#]?\s*\d+|Mirpur\s*[-#]?\s*\d+|Uttara\s*[-#]?\s*\d+|Dhanmondi\s*[-#]?\s*\d+)\b/i);
    if (fallbackAreaMatch) {
      matchedArea = fallbackAreaMatch[1];
    }
  }

  // 5. Clean Street Address: Remove trailing district/postcode/zone repetitions and ISO codes
  let streetAddress = clean;
  if (postcode) {
    streetAddress = streetAddress.replace(new RegExp(`[-:,]?\\s*${postcode}\\b`, "g"), "");
  }
  streetAddress = streetAddress
    .replace(new RegExp(`[,;\\s]+${matchedDistrict}\\b.*$`, "i"), "")
    .replace(/[,;\s]+\bBD[-_\s]?[0-6]?\d\b.*$/i, "")
    .trim();

  // Also remove trailing zone if it is at the very end of streetAddress
  if (matchedZone) {
    const escapedZone = matchedZone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    streetAddress = streetAddress
      .replace(new RegExp(`[,;\\s]+${escapedZone}\\b$`, "i"), "")
      .trim();
  }

  streetAddress = streetAddress.replace(/^[,;\\s]+|[,;\\s]+$/g, "");

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

  let addr = rawAddress.trim();
  // 1. Remove carriage returns / line breaks and multiple spaces
  addr = addr.replace(/[\r\n\t]+/g, ", ").replace(/\s{2,}/g, " ");

  // 2. Remove accidental phone numbers embedded in address (01XXXXXXXXX or +8801XXXXXXXXX)
  addr = addr.replace(/(?:\+?88)?01[3-9]\d{8}\b/g, "").trim();

  // 3. Remove accidental email addresses embedded in address
  addr = addr.replace(/[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "").trim();

  // 4. Standardize common abbreviations & labels in English
  // House: "House # 5", "House 5", "H# 5", "H-5", "House no. 5" -> "House 5"
  addr = addr.replace(/\b(?:House(?:\s*(?:no|num|number))?|Hse|Hous|Hs|H)[\s#.:/-]+([a-zA-Z0-9/-]+)\b/gi, "House $1");

  // Road: "Road # 11", "Road 11", "R# 11", "R-11", "Road no. 11" -> "Road 11"
  addr = addr.replace(/\b(?:Road(?:\s*(?:no|num|number))?|Rood|Rd|Ro|R)[\s#.:/-]+([a-zA-Z0-9/-]+)\b/gi, "Road $1");

  // Sector: "Sector # 4", "Sector 4", "Sec-4", "Sec# 4" -> "Sector 4"
  addr = addr.replace(/\b(?:Sector(?:\s*(?:no|num|number))?|Sect|Sec)[\s#.:/-]+([a-zA-Z0-9/-]+)\b/gi, "Sector $1");

  // Block: "Block # C", "Block-C", "Blk C", "Block C" -> "Block C"
  addr = addr.replace(/\b(?:Block(?:\s*(?:no|num|number))?|Blck|Blk)[\s#.:/-]+([a-zA-Z0-9/-]+)\b/gi, (m, val) => `Block ${val.toUpperCase()}`);

  // Flat / Apartment: "Flat # 4A", "Flat-4A", "Apt# 3B", "Apartment 3B", "Flat 4A" -> "Flat 4A"
  addr = addr.replace(/\b(?:Apartment|Flat(?:\s*(?:no|num|number))?|Flt|Apt|Fl)[\s#.:/-]+([a-zA-Z0-9/-]+)\b/gi, (m, val) => `Flat ${val.toUpperCase()}`);

  // Bengali common labels
  addr = addr.replace(/(?:গ্রাম|Vill|Village)[\s:]*([^\s,;]+)/gi, "গ্রাম: $1");
  addr = addr.replace(/(?:ডাকঘর|পোস্ট|পোঃ|Post|P\.?O\.?)[\s:]*([^\s,;]+)/gi, "ডাকঘর: $1");
  addr = addr.replace(/(?:থানা|উপজেলা|Thana|Upazila)[\s:]*([^\s,;]+)/gi, "থানা: $1");
  addr = addr.replace(/(?:জেলা|District|Dist)[\s:]*([^\s,;]+)/gi, "জেলা: $1");

  // 5. Clean punctuation & extra commas
  addr = addr
    .replace(/[;\\]+/g, ",")
    .replace(/\s*,\s*/g, ", ")
    .replace(/,\s*,+/g, ", ")
    .replace(/^[,.\s-]+|[,.\s-]+$/g, "");

  // 6. Use parseBDAddress to identify district, zone, and postcode
  let parsed = null;
  if (typeof parseBDAddress === "function") {
    parsed = parseBDAddress(rawAddress);
  }

  // 7. Remove trailing redundant district/postcode/ISO repetitions from street address
  addr = addr.replace(/(?:[,;\s]+\bBD[-_\s]?[0-6]?\d\b)+/gi, "");
  if (parsed && parsed.district) {
    const distEscaped = parsed.district.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (parsed.postcode) {
      addr = addr.replace(new RegExp(`[-:,]?\\s*\\b${parsed.postcode}\\b`, "g"), "");
    }
    // Remove repeated district name at the very end
    addr = addr.replace(new RegExp(`(?:[,\\s]+${distEscaped})+$`, "i"), "");
  }

  // 8. Title Case English words in street address (e.g. mirpur 10 -> Mirpur 10)
  addr = addr.replace(/\b([a-z])([a-z0-9]*)\b/g, (match, first, rest) => {
    if (/^(?:and|of|in|at|to|near|opposite)$/i.test(match)) return match.toLowerCase();
    return first.toUpperCase() + rest;
  });

  // 9. Final tidy-up of leading/trailing commas and whitespace
  addr = addr
    .replace(/\s*,\s*/g, ", ")
    .replace(/,\s*,+/g, ", ")
    .replace(/^[,.\s-]+|[,.\s-]+$/g, "")
    .trim();

  return addr || rawAddress.trim();
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

  return {
    name: name,
    phone: phone,
    address: cleanTokens.join(", "),
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
  let digits = String(d.phone || "").replace(/\D/g, "");
  let cleanPhone = "";
  if (digits.length === 11 && digits.startsWith("01")) {
    cleanPhone = digits;
  } else if (digits.length === 13 && digits.startsWith("8801")) {
    cleanPhone = digits.slice(2);
  } else if (digits.length === 10 && digits.startsWith("1")) {
    cleanPhone = "0" + digits;
  } else if (d.phone) {
    const m = String(d.phone).match(/0?1[3-9]\d{8}/);
    if (m) cleanPhone = m[0].startsWith("0") ? m[0] : "0" + m[0];
  }
  if (!cleanPhone && parsedBlock && parsedBlock.phone) {
    cleanPhone = parsedBlock.phone;
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
  address = address.replace(/^(?:Billing details|Shipping details|Payment via|Phone|Email)[:\s,]*/gi, "")
                   .replace(/[,:\s]+(?:Payment via|Cash on delivery|Phone|Email).*$/gi, "")
                   .replace(/\s+/g, " ")
                   .replace(/^,\s*|,\s*$/g, "")
                   .trim();
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

// Make functions accessible in content script and popup
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    cleanLines,
    isConsignmentId,
    getConsignmentId,
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
    getISOCodeFromDistrict
  };
}
