/**
 * Test Suite for TinyFish Web Agent Integration
 * Validates manifest permissions, BYOK configuration, SSE streaming parser,
 * automation execution with mocked ReadableStream, cancellation, WebMCP tool
 * registration, and Popup UI wiring.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const mockStorageData = {};
global.chrome = {
  runtime: {
    lastError: null,
    getURL: (p) => `chrome-extension://mock-id/${p}`,
    onMessage: { addListener: () => {} },
    onConnect: { addListener: () => {} },
    sendMessage: null
  },
  storage: {
    local: {
      get: (keys, cb) => {
        const res = {};
        if (Array.isArray(keys)) {
          keys.forEach((k) => {
            if (mockStorageData[k] !== undefined) res[k] = mockStorageData[k];
          });
        }
        if (cb) cb(res);
      },
      set: (obj, cb) => {
        Object.assign(mockStorageData, obj);
        if (cb) cb();
      }
    }
  }
};

const parser = require("./parser.js");
Object.assign(global, parser);

const bg = require("./background.js");
const webMCP = require("./webmcp-provider.js");

(async () => {
  console.log("==================================================");
  console.log("🐟 Running TinyFish Web Agent Integration Tests");
  console.log("==================================================");

  // Test 1: Manifest Host Permission
  console.log("\n▶ Test 1: Checking manifest.json host_permissions...");
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8"));
  assert(
    Array.isArray(manifest.host_permissions) && manifest.host_permissions.includes("https://agent.tinyfish.ai/*"),
    "manifest.json host_permissions must include https://agent.tinyfish.ai/*"
  );
  console.log("  ✅ manifest.json authorizes https://agent.tinyfish.ai/* cleanly.");

  // Test 2: SSE Line Parser
  console.log("\n▶ Test 2: Validating parseTinyFishSSELine()...");
  assert.strictEqual(bg.parseTinyFishSSELine(""), null);
  assert.strictEqual(bg.parseTinyFishSSELine(": keepalive"), null);
  assert.strictEqual(bg.parseTinyFishSSELine("data: [DONE]"), null);
  assert.strictEqual(bg.parseTinyFishSSELine("data: {bad json"), null);

  const parsedProgress = bg.parseTinyFishSSELine('data: {"type":"PROGRESS","run_id":"run_99","purpose":"Clicking Submit"}\r');
  assert.strictEqual(parsedProgress.type, "PROGRESS");
  assert.strictEqual(parsedProgress.run_id, "run_99");
  assert.strictEqual(parsedProgress.purpose, "Clicking Submit");
  console.log("  ✅ SSE line parser handles valid JSON events, CR endings, keepalives, and [DONE].");

  // Test 3: Input & Key Validation (fully offline/isolated)
  console.log("\n▶ Test 3: Validating URL, Goal, Schema & Missing API Key guards...");
  const originalFetch = global.fetch;
  const savedEnvTinyFishKey = process.env.TINYFISH_API_KEY;
  delete process.env.TINYFISH_API_KEY;
  global.fetch = async (url) => {
    throw new Error(`Unexpected unmocked fetch in Test 3: ${url}`);
  };

  const noUrlRes = await bg.runTinyFishAutomation({ url: "ftp://bad.com", goal: "test" });
  assert.strictEqual(noUrlRes.success, false);
  assert(noUrlRes.error.includes("URL"));

  const noGoalRes = await bg.runTinyFishAutomation({ url: "https://example.com", goal: "" });
  assert.strictEqual(noGoalRes.success, false);
  assert(noGoalRes.error.includes("goal"));

  const missingKeyRes = await bg.runTinyFishAutomation({ url: "https://example.com", goal: "Extract price", apiKey: "" });
  assert.strictEqual(missingKeyRes.success, false);
  assert(missingKeyRes.error.toLowerCase().includes("api key"));

  await bg.saveTinyFishConfig({ apiKey: "tf_test_secret_123456", browserProfile: "stealth" });
  const loadedCfg = await bg.getTinyFishConfig();
  assert.strictEqual(loadedCfg.apiKey, "tf_test_secret_123456");
  assert.strictEqual(loadedCfg.browserProfile, "stealth");

  const badSchemaRes = await bg.runTinyFishAutomation({
    url: "https://example.com",
    goal: "Extract price",
    outputSchema: "{invalid"
  });
  assert.strictEqual(badSchemaRes.success, false);
  assert(badSchemaRes.error.includes("Invalid output_schema"));
  console.log("  ✅ Input validation and BYOK config storage verified.");

  // Test 4: Streaming Execution via Mocked fetch ReadableStream
  console.log("\n▶ Test 4: Testing SSE Streaming Automation & Event Ordering...");
  let capturedFetchUrl = null;
  let capturedFetchOpts = null;

  const chunk1 = Buffer.from(
    'data: {"type":"STREAMING_URL","run_id":"run_tf_777","streaming_url":"https://stream.tinyfish.ai/live/777"}\n\n' +
    'data: {"type":"PROGRESS","run_id":"run_tf_777","purpose":"Opening Steadfast tracking page"}\n'
  );
  const chunk2 = Buffer.from(
    '\ndata: {"type":"COMPLETE","run_id":"run_tf_777","status":"COMPLETED","result":{"status":"Delivered","cod":1544}}\n\n'
  );

  global.fetch = async (url, opts) => {
    capturedFetchUrl = url;
    capturedFetchOpts = opts;
    if (url.includes("/cancel")) {
      return { ok: true, status: 200, text: async () => "{}" };
    }
    let idx = 0;
    const chunks = [chunk1, chunk2];
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (idx < chunks.length) {
              return { value: chunks[idx++], done: false };
            }
            return { value: undefined, done: true };
          }
        })
      }
    };
  };

  const streamedEvents = [];
  const runResult = await bg.runTinyFishAutomation(
    {
      url: "https://steadfast.com.bd/t/12345",
      goal: "Extract delivery status and COD amount as JSON",
      outputSchema: { type: "object", properties: { status: { type: "string" }, cod: { type: "number" } } }
    },
    (evt) => streamedEvents.push(evt)
  );

  assert.strictEqual(capturedFetchUrl, "https://agent.tinyfish.ai/v1/automation/run-sse");
  assert.strictEqual(capturedFetchOpts.method, "POST");
  assert.strictEqual(capturedFetchOpts.headers["X-API-Key"], "tf_test_secret_123456");
  const sentBody = JSON.parse(capturedFetchOpts.body);
  assert.strictEqual(sentBody.browser_profile, "stealth");
  assert.strictEqual(sentBody.output_schema.type, "object");

  assert.strictEqual(streamedEvents.length, 3, "Must emit all 3 SSE events in real time");
  assert.strictEqual(streamedEvents[0].type, "STREAMING_URL");
  assert.strictEqual(streamedEvents[1].type, "PROGRESS");
  assert.strictEqual(streamedEvents[2].type, "COMPLETE");

  assert.strictEqual(runResult.success, true);
  assert.strictEqual(runResult.runId, "run_tf_777");
  assert.strictEqual(runResult.streamingUrl, "https://stream.tinyfish.ai/live/777");
  assert.strictEqual(runResult.status, "COMPLETED");
  assert.deepStrictEqual(runResult.result, { status: "Delivered", cod: 1544 });
  console.log("  ✅ SSE chunk reassembly, headers, event callback, and structured JSON output verified.");

  // Test 5: Cancellation Endpoint
  console.log("\n▶ Test 5: Testing cancelTinyFishRun()...");
  const cancelRes = await bg.cancelTinyFishRun("run_tf_777");
  assert.strictEqual(cancelRes.success, true);
  assert.strictEqual(capturedFetchUrl, "https://agent.tinyfish.ai/v1/runs/run_tf_777/cancel");
  assert.strictEqual(capturedFetchOpts.headers["X-API-Key"], "tf_test_secret_123456");
  console.log("  ✅ Run cancellation endpoint called cleanly with X-API-Key.");

  global.fetch = originalFetch;
  if (savedEnvTinyFishKey !== undefined) process.env.TINYFISH_API_KEY = savedEnvTinyFishKey;

  // Test 6: WebMCP Tool Registration & Delegation
  console.log("\n▶ Test 6: Verifying WebMCP run_tinyfish_web_agent tool...");
  const tools = await webMCP.getTools();
  const tfTool = tools.find((t) => t.name === "run_tinyfish_web_agent");
  assert(tfTool, "WebMCP registry must include run_tinyfish_web_agent");
  assert.strictEqual(tfTool.consequentialHint, true, "TinyFish agent tool must set consequentialHint: true");
  assert.strictEqual(tfTool.readOnlyHint, false);
  assert.deepStrictEqual(tfTool.inputSchema.required, ["url", "goal"]);

  let delegatedMsg = null;
  global.chrome.runtime.sendMessage = (msg, cb) => {
    delegatedMsg = msg;
    cb({ success: true, runId: "run_mcp_1", result: { ok: true } });
  };
  const mcpExec = await webMCP.executeTool("run_tinyfish_web_agent", {
    url: "https://example.com",
    goal: "Get page title"
  });
  assert.strictEqual(delegatedMsg.action, "run_tinyfish_agent");
  assert.strictEqual(delegatedMsg.payload.url, "https://example.com");
  assert.strictEqual(mcpExec.success, true);
  assert.strictEqual(mcpExec.runId, "run_mcp_1");
  console.log("  ✅ WebMCP tool run_tinyfish_web_agent registered and delegates to background.");

  // Test 7: Popup UI Wiring
  console.log("\n▶ Test 7: Verifying Popup UI elements and stream wiring...");
  const popupHtml = fs.readFileSync(path.join(__dirname, "popup.html"), "utf8");
  const popupJs = fs.readFileSync(path.join(__dirname, "popup.js"), "utf8");
  for (const id of [
    "tinyfish-api-key",
    "tinyfish-browser-profile",
    "btn-save-tinyfish-key",
    "tinyfish-target-url",
    "tinyfish-goal-input",
    "tinyfish-schema-input",
    "btn-run-tinyfish",
    "btn-stop-tinyfish",
    "tinyfish-stream-link",
    "tinyfish-progress-log"
  ]) {
    assert(popupHtml.includes(`id="${id}"`), `popup.html must define #${id}`);
  }
  assert(popupHtml.includes('value="run_tinyfish_web_agent"'), "popup.html must include WebMCP dropdown option");
  assert(popupJs.includes('name: "tinyfish_stream"'), "popup.js must connect to tinyfish_stream port");
  console.log("  ✅ Popup HTML & JS TinyFish wiring verified.");

  console.log("\n==================================================");
  console.log("🎉 ALL 7 TINYFISH WEB AGENT TESTS PASSED 100%!");
  console.log("==================================================");
})();
