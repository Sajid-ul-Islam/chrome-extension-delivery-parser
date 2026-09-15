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
      "Payment Status": "",
      "Action": ""
    };
    i++;

    // 1. Optional Type
    if (i < lines.length && /^(?:Type:?|Express|Normal)/i.test(lines[i])) {
      rec["Type"] = lines[i].replace(/^Type:\s*/i, "").trim();
      i++;
      if (rec["Type"] === "" && i < lines.length && /^(?:Express|Normal)$/i.test(lines[i])) {
        rec["Type"] = lines[i].trim();
        i++;
      }
    }

    // 2. Scan ahead for Phone number anchor (avoids column shifting)
    let phoneIdx = -1;
    for (let p = i; p < Math.min(i + 8, lines.length); p++) {
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

      let tIdx = 0;
      if (tIdx < preTokens.length && (/^ORD[-\d]+/i.test(preTokens[tIdx]) || /^\d{4,8}$/.test(preTokens[tIdx]))) {
        rec["Order ID"] = preTokens[tIdx];
        tIdx++;
      }
      if (tIdx < preTokens.length && (/store|commerce|deen|outlet/i.test(preTokens[tIdx]) || (preTokens.length - tIdx >= 3))) {
        rec["Store"] = preTokens[tIdx];
        tIdx++;
      }
      if (tIdx < preTokens.length) {
        rec["Recipient Name"] = preTokens[tIdx];
        tIdx++;
      }
      if (tIdx < preTokens.length) {
        rec["Address"] = preTokens.slice(tIdx).join(", ");
      }
    } else {
      // Sequential fallback
      if (i < lines.length && !isConsignmentId(lines[i]) && !/^[\d,]+(?:\.\d+)?$/.test(lines[i])) { rec["Order ID"] = lines[i]; i++; }
      if (i < lines.length && !isConsignmentId(lines[i]) && !/^[\d,]+(?:\.\d+)?$/.test(lines[i])) { rec["Store"] = lines[i]; i++; }
      if (i < lines.length && !isConsignmentId(lines[i]) && !/^[\d,]+(?:\.\d+)?$/.test(lines[i])) { rec["Recipient Name"] = lines[i]; i++; }
      if (i < lines.length && !isConsignmentId(lines[i]) && !/^[\d,]+(?:\.\d+)?$/.test(lines[i])) { rec["Address"] = lines[i]; i++; }
      if (i < lines.length && !isConsignmentId(lines[i]) && !/^[\d,]+(?:\.\d+)?$/.test(lines[i])) { rec["Phone"] = lines[i]; i++; }
    }

    // 3. Delivery Status & Date (stops at numbers, updated on, or next consignment)
    const statusParts = [];
    while (i < lines.length && !isConsignmentId(lines[i]) && !/^[\d,]+(?:\.\d+)?$/.test(lines[i])) {
      if (lines[i].toLowerCase().startsWith("updated on")) {
        rec["Status Updated On"] = parseDate(lines[i]);
        i++;
        break;
      }
      statusParts.push(lines[i]);
      i++;
    }
    rec["Delivery Status"] = statusParts.join("; ");
    if (i < lines.length && lines[i].toLowerCase().startsWith("updated on")) {
      rec["Status Updated On"] = parseDate(lines[i]);
      i++;
    }

    // 4. Amounts (COD Amount, Charge, Discount)
    if (i < lines.length && /^[\d,]+(?:\.\d+)?$/.test(lines[i])) {
      rec["COD Amount"] = parseAmount(lines[i]);
      i++;
    }
    if (i < lines.length && /^[\d,]+(?:\.\d+)?$/.test(lines[i])) {
      rec["Charge"] = parseAmount(lines[i]);
      i++;
    }
    if (i < lines.length && /^[\d,]+(?:\.\d+)?$/.test(lines[i])) {
      rec["Discount"] = parseAmount(lines[i]);
      i++;
    }

    // 5. Payment Status
    if (i < lines.length && /^(?:Paid|Unpaid)$/i.test(lines[i])) {
      rec["Payment Status"] = lines[i];
      i++;
    }

    // 6. Action
    const actionLines = [];
    while (i < lines.length && !isConsignmentId(lines[i])) {
      actionLines.push(lines[i]);
      i++;
    }
    rec["Action"] = actionLines.join(", ");

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
  const orderIdMatch = textBlock.match(/\b(\d{6})\b/);
  const orderId = orderIdMatch ? orderIdMatch[1] : "";

  const storeMatch = textBlock.match(/(Deen Commerce|w DEEN WARI OUTLET|c DEEN CUMILLA OUTLET)/i);
  const store = storeMatch ? storeMatch[1] : "";

  const phoneMatch = textBlock.match(/(01\d{9})/);
  const phone = phoneMatch ? phoneMatch[1] : "";

  const codMatch = textBlock.match(/COD\s*[\u09f3৳]?\s*([\d,]+)/i);
  const cod = codMatch ? parseFloat(codMatch[1].replace(/,/g, "")) : 0.0;

  const chargeMatch = textBlock.match(/Charge\s*[\u09f3৳]?\s*([\d,.]+)/i);
  const charge = chargeMatch ? parseFloat(chargeMatch[1].replace(/,/g, "")) : 0.0;

  const discountMatch = textBlock.match(/Discount\s*[\u09f3৳]?\s*([\d,]+)/i);
  const discount = discountMatch ? parseFloat(discountMatch[1].replace(/,/g, "")) : 0.0;

  let status = "Unpaid";
  if (textBlock.includes("Paid") && !textBlock.includes("Unpaid")) {
    status = "Paid";
  }

  const deliveryMatch = textBlock.match(/(At Delivery Hub|Paid Return|Urgent Delivery Requested|Returned|Delivered|In Transit)/i);
  const deliveryStatus = deliveryMatch ? deliveryMatch[1] : "";

  const updatedMatch = textBlock.match(/Updated on\s*([\d/]+)/i);
  const statusUpdatedOn = updatedMatch ? updatedMatch[1] : "";

  const lines = textBlock.split(/\r?\n/);
  const infoLines = [];
  const ignoreKeywords = [
    "Type:",
    "Parcel",
    "COD",
    "Charge",
    "Discount",
    "Paid",
    "Unpaid",
    "View POD",
    "Action",
    "Updated on",
    "Paid At:",
    store,
    orderId,
    consId
  ];

  for (let line of lines) {
    const cleanLine = line.trim();
    if (!cleanLine) continue;
    if (/01\d{9}/.test(cleanLine)) continue;

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
    "Type": "",
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
 * Compute KPI metrics for parsed delivery records
 */
function computeMetrics(records) {
  const totalParcels = records.length;
  let paidCount = 0;
  let unpaidCount = 0;
  let totalCOD = 0;
  let totalCharge = 0;
  let totalDiscount = 0;

  for (let rec of records) {
    const pStatus = (rec["Payment Status"] || "").toString().toLowerCase();
    if (pStatus === "paid") {
      paidCount++;
    } else {
      unpaidCount++;
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

  if (!forceFuzzy) {
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
    exportToCSV,
    exportToExcelXML,
    exportToXLSX
  };
}
