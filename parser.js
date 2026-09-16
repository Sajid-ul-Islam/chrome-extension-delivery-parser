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

function parseAmount(line) {
  if (!line) return 0.0;
  const m = line.match(/([\d,]+(?:\.\d+)?)/);
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
    exportToXLSX
  };
}
