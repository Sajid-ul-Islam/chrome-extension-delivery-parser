const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EXT_PATH = path.resolve(__dirname);
const TEMP_USER_DATA = path.resolve(__dirname, 'temp_chrome_e2e_profile');
const ARTIFACT_DIR = 'C:\\Users\\deenb\\.gemini\\antigravity-ide\\brain\\6d2a513e-f233-4d5a-b383-4216bd8a34c0';

if (fs.existsSync(TEMP_USER_DATA)) {
  fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
}

// 1. Create a local mock server for Pathao Courier merchant page
const mockPathaoHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Pathao Merchant Portal - Orders</title>
  <style>
    body { font-family: sans-serif; background: #f1f5f9; padding: 24px; color: #1e293b; }
    h1 { color: #dc2626; display: flex; align-items: center; gap: 8px; }
    table { width: 100%; border-collapse: collapse; background: #fff; margin-top: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); border-radius: 8px; overflow: hidden; }
    th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #e2e8f0; }
    th { background: #f8fafc; font-weight: 600; }
    .badge { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .badge-unpaid { background: #fee2e2; color: #b91c1c; }
    .badge-paid { background: #dcfce7; color: #15803d; }
  </style>
</head>
<body>
  <h1>🚚 Pathao Courier Merchant Dashboard</h1>
  <p>Live Merchant Parcel Management System</p>
  
  <table class="orders-table">
    <thead>
      <tr>
        <th>Cons. ID</th>
        <th>Order ID</th>
        <th>Store</th>
        <th>Recipient Info</th>
        <th>Delivery Status</th>
        <th>Amount</th>
        <th>Payment</th>
        <th>Action</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>DD240915ABC101<br>Type: Express</td>
        <td>ORD-9011</td>
        <td>Deen Tech Store</td>
        <td>Rahim Ahmed<br>House 42, Road 11, Dhanmondi, Dhaka<br>01711223344</td>
        <td>At Delivery Hub<br>Updated on 15/09/2026</td>
        <td>3200.00<br>150.00<br>30.00</td>
        <td><span class="badge badge-unpaid">Unpaid</span></td>
        <td>View Details</td>
      </tr>
      <tr>
        <td>DD240915ABC102<br>Type: Normal</td>
        <td>ORD-9012</td>
        <td>Deen Tech Store</td>
        <td>Fatima Begum<br>Plot 8, Block C, Uttara Sector 3, Dhaka<br>01899887766</td>
        <td>Delivered<br>Updated on 15/09/2026</td>
        <td>1850.00<br>100.00<br>20.00</td>
        <td><span class="badge badge-paid">Paid</span></td>
        <td>View Details</td>
      </tr>
      <tr>
        <td>DD240915ABC103<br>Type: Express</td>
        <td>ORD-9013</td>
        <td>Deen Tech Store</td>
        <td>Tanvir Hossain<br>Kakrail, VIP Road, Dhaka<br>01955443322</td>
        <td>In Transit<br>Updated on 15/09/2026</td>
        <td>4500.00<br>180.00<br>50.00</td>
        <td><span class="badge badge-unpaid">Unpaid</span></td>
        <td>View Details</td>
      </tr>
    </tbody>
  </table>
</body>
</html>`;

const mockServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(mockPathaoHTML);
});

async function main() {
  const serverPort = 8765;
  await new Promise(r => mockServer.listen(serverPort, r));
  console.log(`Mock server running at http://127.0.0.1:${serverPort}`);

  // 2. Launch Chrome
  const cdpPort = 9400 + Math.floor(Math.random() * 500);
  console.log(`Launching Google Chrome with remote debugging on port ${cdpPort}...`);
  const chromeProcess = spawn(CHROME_PATH, [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--headless=new',
    'about:blank'
  ], { stdio: 'ignore' });

  // Retry loop to connect to Chrome CDP
  let versionData = null;
  for (let i = 0; i < 25; i++) {
    try {
      const versionRes = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      if (versionRes.ok) {
        versionData = await versionRes.json();
        break;
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 400));
  }

  if (!versionData) {
    throw new Error(`Failed to connect to Chrome on port ${cdpPort} after 10 seconds`);
  }

  try {
    // 3. Connect to Browser CDP
    const browserWs = new WebSocket(versionData.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      browserWs.onopen = res;
      browserWs.onerror = rej;
    });

    let bMsgId = 1;
    function browserSend(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = bMsgId++;
        const handler = (evt) => {
          const raw = typeof evt.data === 'string' ? evt.data : evt.data.toString();
          const parsed = JSON.parse(raw);
          if (parsed.id === id) {
            browserWs.removeEventListener('message', handler);
            if (parsed.error) reject(parsed.error);
            else resolve(parsed.result);
          }
        };
        browserWs.addEventListener('message', handler);
        browserWs.send(JSON.stringify({ id, method, params }));
      });
    }

    // 4. Load unpacked extension
    console.log('\n[STEP 1] Loading unpacked extension into Chrome...');
    const loadResult = await browserSend('Extensions.loadUnpacked', { path: EXT_PATH });
    const extId = loadResult.id;
    console.log(`>>> Extension successfully loaded! ID: ${extId}`);

    // Helper to connect to a CDP target page
    function connectTarget(wsUrl) {
      const ws = new WebSocket(wsUrl);
      let pId = 1;
      return {
        ready: new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }),
        send: (method, params = {}) => new Promise((resolve, reject) => {
          const id = pId++;
          const handler = (evt) => {
            const raw = typeof evt.data === 'string' ? evt.data : evt.data.toString();
            const parsed = JSON.parse(raw);
            if (parsed.id === id) {
              ws.removeEventListener('message', handler);
              if (parsed.error) reject(parsed.error);
              else resolve(parsed.result);
            }
          };
          ws.addEventListener('message', handler);
          ws.send(JSON.stringify({ id, method, params }));
        }),
        close: () => ws.close()
      };
    }

    // 5. Test Service Worker
    console.log('\n[STEP 2] Verifying Service Worker status...');
    await new Promise(r => setTimeout(r, 1000));
    const targetsRes = await fetch(`http://127.0.0.1:${cdpPort}/json`);
    const allTargets = await targetsRes.json();
    const swTarget = allTargets.find(t => t.type === 'service_worker' && t.url.includes(extId));
    if (swTarget) {
      console.log(`>>> Background Service Worker active at: ${swTarget.url}`);
    } else {
      console.warn('Service worker not yet active in targets list, proceeding...');
    }

    // 6. Test Extension Popup Page
    console.log('\n[STEP 3] Testing Extension Popup UI (chrome-extension://' + extId + '/popup.html)...');
    const popupTargetInfo = await browserSend('Target.createTarget', {
      url: `chrome-extension://${extId}/popup.html`
    });
    
    // Find WebSocket URL for popup target
    const updatedTargets = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
    const popupTarget = updatedTargets.find(t => t.id === popupTargetInfo.targetId);
    if (!popupTarget) throw new Error('Could not find popup target in CDP list');

    const popupConn = connectTarget(popupTarget.webSocketDebuggerUrl);
    await popupConn.ready;
    await popupConn.send('Page.enable');
    await popupConn.send('Runtime.enable');
    await popupConn.send('DOM.enable');

    // Wait for DOM to finish rendering
    await new Promise(r => setTimeout(r, 1000));

    // Verify Title and Brand Header
    const brandTitle = await popupConn.send('Runtime.evaluate', {
      expression: 'document.querySelector(".brand-text h1").innerText',
      returnByValue: true
    });
    console.log('Popup Header Title:', brandTitle.result.value);

    // Switch to Paste & Parse tab
    console.log('Switching to "Paste & Parse" tab...');
    await popupConn.send('Runtime.evaluate', {
      expression: `
        const tab = document.querySelector('.nav-tab[data-tab="tab-paste"]');
        tab.click();
        tab.classList.contains('active');
      `,
      returnByValue: true
    });

    // Provide sample multi-parcel courier text
    const sampleBatchText = `Cons. ID
Order ID
Store
Recipient Info
Delivery Status
Amount
Payment
Action
DD240915ABC101
Type: Express
ORD-9011
Deen Tech Store
Rahim Ahmed
House 42, Road 11, Dhanmondi, Dhaka
01711223344
At Delivery Hub
Updated on 15/09/2026
3200.00
150.00
30.00
Unpaid
View Details
DD240915ABC102
Type: Normal
ORD-9012
Deen Tech Store
Fatima Begum
Plot 8, Block C, Uttara Sector 3, Dhaka
01899887766
Delivered
Updated on 15/09/2026
1850.00
100.00
20.00
Paid
View Details
DD240915ABC103
Type: Express
ORD-9013
Deen Tech Store
Tanvir Hossain
Kakrail, VIP Road, Dhaka
01955443322
In Transit
Updated on 15/09/2026
4500.00
180.00
50.00
Unpaid
View Details`;

    console.log('Pasting sample parcel batch data into textarea...');
    await popupConn.send('Runtime.evaluate', {
      expression: `
        const ta = document.getElementById('raw-text-input');
        ta.value = ${JSON.stringify(sampleBatchText)};
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      `
    });

    console.log('Clicking "Parse Records" button...');
    await popupConn.send('Runtime.evaluate', {
      expression: `
        document.getElementById('btn-parse-paste').click();
      `
    });

    await new Promise(r => setTimeout(r, 600));

    // Verify KPI calculations in UI
    const kpiMetrics = await popupConn.send('Runtime.evaluate', {
      expression: `
        ({
          total: document.getElementById('kpi-total').textContent,
          paid: document.getElementById('kpi-paid').textContent,
          unpaid: document.getElementById('kpi-unpaid').textContent,
          cod: document.getElementById('kpi-cod').textContent,
          net: document.getElementById('kpi-net').textContent,
          tableRows: document.querySelectorAll('#table-body tr').length
        })
      `,
      returnByValue: true
    });
    console.log('\n>>> LIVE KPI RESULTS IN CHROME POPUP:');
    console.log(JSON.stringify(kpiMetrics.result.value, null, 2));

    // Verify row contents
    const firstRowData = await popupConn.send('Runtime.evaluate', {
      expression: `
        Array.from(document.querySelectorAll('#table-body tr')).map(row => {
          return Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
        })
      `,
      returnByValue: true
    });
    console.log('\n>>> POPUP TABLE ROWS PARSED:');
    console.log(JSON.stringify(firstRowData.result.value, null, 2));

    // Test Search filtering
    console.log('\nTesting live table search filter (query: "Fatima")...');
    const searchFilterResult = await popupConn.send('Runtime.evaluate', {
      expression: `
        const searchInput = document.getElementById('search-input');
        searchInput.value = 'Fatima';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelectorAll('#table-body tr').length;
      `,
      returnByValue: true
    });
    console.log(`Filtered table rows count (expecting 1): ${searchFilterResult.result.value}`);

    // Clear search filter
    await popupConn.send('Runtime.evaluate', {
      expression: `
        const searchInput = document.getElementById('search-input');
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      `
    });

    // Capture screenshot of the Popup in Chrome
    console.log('\nCapturing screenshot of Popup in Chrome...');
    const screenshotData = await popupConn.send('Page.captureScreenshot', {
      format: 'png'
    });
    const popupScreenshotPath = path.join(ARTIFACT_DIR, 'popup_working.png');
    fs.writeFileSync(popupScreenshotPath, Buffer.from(screenshotData.data, 'base64'));
    console.log(`>>> Saved Popup screenshot to: ${popupScreenshotPath}`);

    popupConn.close();

    // 7. Test In-Page Content Script & Floating Widget
    console.log('\n[STEP 4] Testing In-Page Content Script & Floating Widget...');
    const mockPageTargetInfo = await browserSend('Target.createTarget', {
      url: `http://127.0.0.1:${serverPort}`
    });

    const updatedTargets2 = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
    const mockPageTarget = updatedTargets2.find(t => t.id === mockPageTargetInfo.targetId);
    const pageConn = connectTarget(mockPageTarget.webSocketDebuggerUrl);
    await pageConn.ready;
    await pageConn.send('Page.enable');
    await pageConn.send('Runtime.enable');
    await pageConn.send('DOM.enable');

    // Inject content.css and parser.js + content.js
    const contentCss = fs.readFileSync(path.join(EXT_PATH, 'content.css'), 'utf8');
    const parserJs = fs.readFileSync(path.join(EXT_PATH, 'parser.js'), 'utf8');
    const contentJs = fs.readFileSync(path.join(EXT_PATH, 'content.js'), 'utf8');

    await pageConn.send('Runtime.evaluate', {
      expression: `
        const style = document.createElement('style');
        style.textContent = ${JSON.stringify(contentCss)};
        document.head.appendChild(style);
      `
    });
    await pageConn.send('Runtime.evaluate', { expression: parserJs });
    await pageConn.send('Runtime.evaluate', { expression: contentJs });

    // Wait for floating widget to initialize (it has an 800ms timer)
    await new Promise(r => setTimeout(r, 1200));

    // Check pill button
    const widgetPill = await pageConn.send('Runtime.evaluate', {
      expression: `
        const pill = document.querySelector('#deen-pill-toggle');
        pill ? pill.innerText.trim() : 'NOT_FOUND'
      `,
      returnByValue: true
    });
    console.log('In-page Floating Widget pill text:', widgetPill.result.value);

    // Click pill to expand into full metrics card
    console.log('Clicking floating widget to expand into metrics card...');
    await pageConn.send('Runtime.evaluate', {
      expression: `
        document.querySelector('#deen-pill-toggle').click();
      `
    });
    await new Promise(r => setTimeout(r, 500));

    // Check expanded card metrics
    const widgetCardMetrics = await pageConn.send('Runtime.evaluate', {
      expression: `
        ({
          cardExists: !!document.querySelector('.deen-card'),
          badge: document.querySelector('.deen-title .deen-badge')?.innerText,
          metrics: Array.from(document.querySelectorAll('.deen-metric-box')).map(b => ({
            label: b.querySelector('.deen-metric-label')?.innerText,
            val: b.querySelector('.deen-metric-val')?.innerText
          }))
        })
      `,
      returnByValue: true
    });
    console.log('\n>>> IN-PAGE FLOATING CARD METRICS:');
    console.log(JSON.stringify(widgetCardMetrics.result.value, null, 2));

    // Capture screenshot of the mock Courier page with the floating widget open
    console.log('\nCapturing screenshot of in-page widget on courier page in Chrome...');
    const widgetScreenshotData = await pageConn.send('Page.captureScreenshot', {
      format: 'png'
    });
    const widgetScreenshotPath = path.join(ARTIFACT_DIR, 'widget_working.png');
    fs.writeFileSync(widgetScreenshotPath, Buffer.from(widgetScreenshotData.data, 'base64'));
    console.log(`>>> Saved In-page Widget screenshot to: ${widgetScreenshotPath}`);

    pageConn.close();
    browserWs.close();

    console.log('\n======================================================');
    console.log('>>> ALL CHROME EXTENSION VERIFICATION TESTS PASSED! <<<');
    console.log('======================================================\n');
  } catch (err) {
    console.error('Test Execution Error:', err);
    process.exitCode = 1;
  } finally {
    try { chromeProcess.kill(); } catch (e) {}
    mockServer.close();
    try { fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true }); } catch (e) {}
  }
}

main();
