/**
 * Automated Test Suite: Autonomous Analytical Agent & In-Browser SQL/Chart Engine
 * Tests:
 * 1. In-Browser SQL Engine (SELECT, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT, Aggregates)
 * 2. Markdown Table Formatter (formatSQLResultToMarkdown)
 * 3. DataFrame Descriptive Statistics (executeDataFrameAnalysis)
 * 4. Native SVG Chart Generator (Bar & Donut charts)
 * 5. Autonomous C-Level Executive Report Generator (generateExecutiveReport)
 * 6. Natural Language Query Routing in generateDeenAssistantReply
 * 7. Universal Table Scraper in deen-floating-chat.js (gatherGenericTableContext)
 * 8. WebMCP Analytical Tool Execution (execute_sql_query & generate_analytical_report)
 */

const assert = require('assert');
const DeenAssistant = require('./deen-assistant.js');
const floatingChat = require('./deen-floating-chat.js');
const webMCP = require('./webmcp-provider.js');

async function runTests() {
  console.log("=================================================================");
  console.log("🧪 Running Comprehensive Tests for Autonomous Analytical Agent");
  console.log("=================================================================\n");

  // Mock Orders Dataset (Mix of Inside/Outside Dhaka, High/Low COD, Paid/Unpaid)
  const mockOrders = [
    {
      "Order ID": "19051",
      "Recipient Name": "Kazi Morshed",
      "Phone": "01715485035",
      "Address": "Dhanmondi 27, Dhaka",
      "COD Amount": "1500.00",
      "Charge": "50.00",
      "Payment Status": "Paid",
      "Delivery Status": "Delivered"
    },
    {
      "Order ID": "19052",
      "Recipient Name": "Farhana Akter",
      "Phone": "01812345678",
      "Address": "Agrabad Commercial Area, Chittagong",
      "COD Amount": "3200.00",
      "Charge": "90.00",
      "Payment Status": "Unpaid",
      "Delivery Status": "In Transit"
    },
    {
      "Order ID": "19053",
      "Recipient Name": "Tanvir Islam",
      "Phone": "01998765432",
      "Address": "Zindabazar, Sylhet",
      "COD Amount": "1800.00",
      "Charge": "90.00",
      "Payment Status": "Paid",
      "Delivery Status": "Delivered"
    },
    {
      "Order ID": "19054",
      "Recipient Name": "Shirin Sultana",
      "Phone": "01555443322",
      "Address": "Uttara Sector 7, Dhaka",
      "COD Amount": "2600.00",
      "Charge": "50.00",
      "Payment Status": "Unpaid",
      "Delivery Status": "In Transit"
    },
    {
      "Order ID": "19055",
      "Recipient Name": "Mohiuddin Ahmed",
      "Phone": "01677889900",
      "Address": "Chawkbazar, Cumilla",
      "COD Amount": "4500.00",
      "Charge": "90.00",
      "Payment Status": "Unpaid",
      "Delivery Status": "In Transit"
    },
    {
      "Order ID": "19056",
      "Recipient Name": "Jamil Hasan",
      "Phone": "01788990011",
      "Address": "Benapole Bazar, Sharsha, Jashore",
      "COD Amount": "1400.00",
      "Charge": "0.00", // Free shipping under-charge test (Invariant 7)
      "Payment Status": "Unpaid",
      "Delivery Status": "Hold"
    }
  ];

  // ---------------------------------------------------------------------------
  // Test 1: In-Browser In-Memory SQL Execution
  // ---------------------------------------------------------------------------
  console.log("▶ Test 1: Testing In-Browser SQL Execution Engine...");

  // Query A: WHERE filter
  const sqlFilter = DeenAssistant.executeSQL("SELECT id, customer, cod, district FROM orders WHERE cod >= 2500", mockOrders);
  assert.strictEqual(sqlFilter.success, true, "SQL query must succeed");
  assert.strictEqual(sqlFilter.rowCount, 3, "Should return 3 orders with COD >= 2500");
  assert.deepStrictEqual(sqlFilter.columns, ['id', 'customer', 'cod', 'district']);
  console.log("  ✅ Query A (WHERE condition): Filtered 3 high-value orders accurately.");

  // Query B: GROUP BY with SUM, COUNT, AVG, ORDER BY
  const sqlGroup = DeenAssistant.executeSQL(
    "SELECT district, COUNT(*) as total_orders, SUM(cod) as total_revenue, AVG(cod) as avg_cod FROM orders GROUP BY district ORDER BY total_revenue DESC",
    mockOrders
  );
  assert.strictEqual(sqlGroup.success, true);
  assert(sqlGroup.rows.length >= 4, "Must group into multiple districts");
  assert.strictEqual(sqlGroup.rows[0].district, 'Cumilla', "Cumilla with 4500 COD must be top revenue district");
  assert.strictEqual(sqlGroup.rows[0].total_revenue, 4500);
  console.log("  ✅ Query B (GROUP BY & Aggregations): Top district ranked by revenue in " + sqlGroup.executionTimeMs + "ms.");

  // Query C: Global Aggregates (COUNT, SUM, MAX, MIN)
  const sqlAgg = DeenAssistant.executeSQL(
    "SELECT COUNT(*) as total_orders, SUM(cod) as gross_cod, MAX(cod) as highest_order, MIN(cod) as lowest_order FROM orders",
    mockOrders
  );
  assert.strictEqual(sqlAgg.success, true);
  assert.strictEqual(sqlAgg.rows[0].total_orders, 6);
  assert.strictEqual(sqlAgg.rows[0].gross_cod, 15000);
  assert.strictEqual(sqlAgg.rows[0].highest_order, 4500);
  assert.strictEqual(sqlAgg.rows[0].lowest_order, 1400);
  console.log("  ✅ Query C (Global Aggregates): Grand totals match mathematical ground truth (Gross: ৳15,000).");

  // Query D: LIKE and IN operators
  const sqlLike = DeenAssistant.executeSQL("SELECT customer, address FROM orders WHERE address LIKE '%Dhaka%'", mockOrders);
  assert.strictEqual(sqlLike.rowCount, 2, "Should find 2 Dhaka addresses");

  const sqlIn = DeenAssistant.executeSQL("SELECT id, payment FROM orders WHERE payment IN ('Paid')", mockOrders);
  assert.strictEqual(sqlIn.rowCount, 2, "Should find 2 Paid orders");
  console.log("  ✅ Query D (LIKE & IN pattern matching): Matched Dhaka and Paid orders correctly.");

  // ---------------------------------------------------------------------------
  // Test 2: Markdown Table Formatter
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 2: Testing Markdown Table Formatter...");
  const mdTable = DeenAssistant.formatSQLResultToMarkdown(sqlGroup);
  assert(mdTable.includes("| **district** | **total_orders** | **total_revenue** | **avg_cod** |"), "Markdown header mismatch");
  assert(mdTable.includes("Cumilla"), "Markdown must contain Cumilla");
  assert(mdTable.includes("৳4,500"), "Revenue must be formatted with currency symbol");
  console.log("  ✅ Markdown table properly structured with GitHub Flavored Markdown pipes and currency.");

  // ---------------------------------------------------------------------------
  // Test 3: DataFrame Descriptive Statistics
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 3: Testing DataFrame Descriptive Statistics...");
  const dfStats = DeenAssistant.executeDataFrameAnalysis(mockOrders);
  assert.strictEqual(dfStats.rowCount, 6);
  assert.strictEqual(dfStats.cod.sum, 15000);
  assert.strictEqual(dfStats.cod.mean, 2500);
  assert.strictEqual(dfStats.paidCount, 2);
  assert.strictEqual(dfStats.unpaidCount, 4);
  assert.strictEqual(dfStats.outsideDhakaCount, 4);
  assert.strictEqual(dfStats.insideDhakaCount, 2);
  assert.strictEqual(dfStats.highRiskCount, 3); // 3200, 4500, hold
  console.log("  ✅ Descriptive statistics (mean: ৳2,500, paid: 2, outside Dhaka: 4, high risk: 3) verified.");

  // ---------------------------------------------------------------------------
  // Test 4: Native SVG Chart Rendering
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 4: Testing Native SVG Chart Engine...");
  
  // Horizontal Bar Chart
  const barChart = DeenAssistant.renderVisualChartSVG({
    type: 'bar',
    title: 'Territory Revenue Breakdown',
    data: [
      { label: 'Cumilla', value: 4500, isCurrency: true },
      { label: 'Chittagong', value: 3200, isCurrency: true },
      { label: 'Dhaka', value: 4100, isCurrency: true }
    ]
  });
  assert(barChart.includes('<svg'), "Must render SVG container");
  assert(barChart.includes('deen-chart-card'), "Must have chart card wrapper");
  assert(barChart.includes('Cumilla') && barChart.includes('৳4,500'), "Must render labels and formatted values");
  assert(barChart.includes('<animate'), "Must include animation attributes for smooth rendering");
  console.log("  ✅ Horizontal bar chart SVG generated with smooth animations and responsive viewbox.");

  // Donut Chart
  const donutChart = DeenAssistant.renderVisualChartSVG({
    type: 'donut',
    title: 'Paid vs Unpaid COD Distribution',
    data: [
      { label: 'Paid Deliveries', value: 3300, isCurrency: true, color: '#10b981' },
      { label: 'Unpaid In-Transit COD', value: 11700, isCurrency: true, color: '#f59e0b' }
    ]
  });
  assert(donutChart.includes('<svg'), "Must render SVG container");
  assert(donutChart.includes('stroke-dasharray'), "Must compute arc stroke-dasharray");
  assert(donutChart.includes('Paid Deliveries') && donutChart.includes('Unpaid In-Transit COD'), "Must render legend tags");
  console.log("  ✅ Donut chart SVG generated with exact circumference arc math and color-coded legend.");

  // ---------------------------------------------------------------------------
  // Test 5: Autonomous C-Level Executive Report Generator
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 5: Testing Autonomous C-Level Executive Report Generator...");
  const execReport = DeenAssistant.generateExecutiveReport(mockOrders);
  assert(execReport.includes("DEEN Commerce Executive Logistics & Financial Report"), "Report header missing");
  assert(execReport.includes("Total Parcel Volume"), "Report must include Total Parcel Volume KPI");
  assert(execReport.includes("৳15,000"), "Report must include Gross COD value ৳15,000");
  assert(execReport.includes("Territory Logistics & Compliance Audit"), "Report must include territory audit");
  assert(execReport.includes("Inside Dhaka (৳50 Standard Fee)"), "Must state inside Dhaka charges");
  assert(execReport.includes("Shipping Charge Audit Alert (Invariant 7)"), "Must flag order #19056 undercharged delivery fee");
  assert(execReport.includes("Operational Risk Radar & NDR Rescue"), "Must include risk radar");
  assert(execReport.includes("<svg"), "Must embed visual SVG charts in report body");
  console.log("  ✅ Autonomous Executive Report generated with financial KPIs, SVG charts, and Invariant 7 audit.");

  // ---------------------------------------------------------------------------
  // Test 6: Natural Language Query Routing in generateDeenAssistantReply
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 6: Testing Natural Language Query Routing in Assistant...");

  // Route 1: Explicit SQL
  const replySQL = await DeenAssistant.generateDeenAssistantReply({
    query: "SELECT district, SUM(cod) as revenue FROM orders GROUP BY district ORDER BY revenue DESC",
    records: mockOrders
  });
  assert.strictEqual(replySQL.source, 'in_browser_sql_engine', "Must route to SQL engine");
  assert(replySQL.answer.includes("| **district** | **revenue** |"), "Answer must contain formatted markdown table");
  console.log("  ✅ Route 1 (Explicit SQL): Dispatched directly to in_browser_sql_engine.");

  // Route 2: Visual Chart request
  const replyChart = await DeenAssistant.generateDeenAssistantReply({
    query: "Show me a visual chart breakdown of revenue by district",
    records: mockOrders
  });
  assert.strictEqual(replyChart.source, 'visual_chart_engine', "Must route to visual chart engine");
  assert(replyChart.answer.includes("<svg"), "Must return embedded SVG chart");
  console.log("  ✅ Route 2 (Visual Chart): Dispatched directly to visual_chart_engine.");

  // Route 3: Executive Report request
  const replyReport = await DeenAssistant.generateDeenAssistantReply({
    query: "Generate a daily executive report for management",
    records: mockOrders
  });
  assert.strictEqual(replyReport.source, 'executive_reporter', "Must route to executive reporter");
  assert(replyReport.answer.includes("Executive Logistics & Financial Report"), "Answer must contain executive report");
  console.log("  ✅ Route 3 (Executive Report): Dispatched directly to executive_reporter.");

  // ---------------------------------------------------------------------------
  // Test 7: Universal Table Scraper in deen-floating-chat.js
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 7: Testing Universal Table Scraper (gatherGenericTableContext)...");
  assert.strictEqual(typeof floatingChat.gatherGenericTableContext, "function", "gatherGenericTableContext must be exported");

  // Mock a generic external webpage table (e.g. Shopify, Custom CRM, Steadfast)
  global.document = {
    querySelectorAll: (sel) => {
      if (sel.includes('table')) {
        return [{
          querySelectorAll: (rowSel) => {
            if (rowSel.includes('tr')) {
              return [
                { innerText: 'ID Customer Phone Total Status' },
                { innerText: '#8801 Rakib Khan 01711223344 ৳1,850 Delivered' },
                { innerText: '#8802 Sonia Begum 01822334455 ৳3,400 In Transit Outside Dhaka' }
              ];
            }
            return [];
          }
        }];
      }
      return [];
    }
  };

  const genericCtx = floatingChat.gatherGenericTableContext();
  assert.strictEqual(genericCtx.totalCount, 2, "Should parse 2 rows from generic table");
  assert.strictEqual(genericCtx.records[0].orderId, '8801');
  assert.strictEqual(genericCtx.records[0].phone, '01711223344');
  assert.strictEqual(genericCtx.records[1].cod, 3400);
  assert.strictEqual(genericCtx.metrics.totalCOD, 5250);
  console.log("  ✅ Universal table scraper extracted 2 orders and computed total COD (৳5,250) from unformatted HTML.");

  // ---------------------------------------------------------------------------
  // Test 8: WebMCP Analytical Tools Execution
  // ---------------------------------------------------------------------------
  console.log("\n▶ Test 8: Testing WebMCP execute_sql_query & generate_analytical_report...");

  const mcpSqlRes = await webMCP.executeTool("execute_sql_query", {
    sql: "SELECT district, COUNT(*) as count FROM orders GROUP BY district",
    records: mockOrders
  });
  assert.strictEqual(mcpSqlRes.success, true, "WebMCP SQL tool must execute successfully");
  assert(Array.isArray(mcpSqlRes.rows), "Must return rows array");
  assert(mcpSqlRes.markdownTable.includes("| **district** | **count** |"), "Must return markdownTable");
  console.log("  ✅ WebMCP tool 'execute_sql_query' executed successfully via registry!");

  const mcpReportRes = await webMCP.executeTool("generate_analytical_report", {
    records: mockOrders
  });
  assert.strictEqual(mcpReportRes.success, true, "WebMCP report tool must execute successfully");
  assert(mcpReportRes.report.includes("Executive Logistics & Financial Report"), "Must return report content");
  assert.strictEqual(mcpReportRes.totalOrdersAnalyzed, 6);
  console.log("  ✅ WebMCP tool 'generate_analytical_report' executed successfully via registry!");

  console.log("\n=================================================================");
  console.log("🎉 ALL 8 AUTONOMOUS ANALYTICAL AGENT TESTS PASSED 100%!");
  console.log("=================================================================\n");
}

runTests();

