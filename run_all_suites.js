const { execSync } = require('child_process');

const suites = [
  'test_parser.js',
  'test_autofill_flow.js',
  'test_popup_pathao_check.js',
  'test_live_pathao_rating_parsing.js',
  'test_universal_phone_e2e.js',
  'test_whatsapp_quick_reply.js',
  'test_webmcp_integration.js',
  'test_full_fetch_improvements.js',
  'test_wordpress_login_sync.js',
  'test_icons_verification.js',
  'test_deen_assistant.js',
  'test_whatsapp_active_chat.js',
  'test_floating_chat.js',
  'test_ndr_rescue_listener.js',
  'test_cache_eviction.js',
  'test_local_rating_cache_reuse.js'
];

let failed = 0;
console.log('🚀 Running Complete Automated Test Suite...\n');

for (const suite of suites) {
  process.stdout.write(`Testing ${suite}... `);
  try {
    const output = execSync(`node ${suite}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    console.log('✅ PASSED');
  } catch (err) {
    console.log('❌ FAILED');
    console.error(err.stderr || err.stdout || err.message);
    failed++;
  }
}

console.log('\n==================================================');
if (failed === 0) {
  console.log(`🎉 ALL ${suites.length} TEST SUITES PASSED 100%!`);
  process.exit(0);
} else {
  console.error(`⚠️ ${failed} of ${suites.length} test suites failed!`);
  process.exit(1);
}
