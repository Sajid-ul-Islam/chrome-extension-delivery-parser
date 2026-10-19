/**
 * Syncs credentials from .env to env.js for the Chrome Extension runtime.
 * Usage: node sync_env.js
 */
const fs = require('fs');
const path = require('path');

const envFile = path.resolve(__dirname, '.env');
const targetFile = path.resolve(__dirname, 'env.js');

if (!fs.existsSync(envFile)) {
  console.log('⚠️ No .env file found. Creating from .env.example...');
  fs.copyFileSync(path.resolve(__dirname, '.env.example'), envFile);
}

const envContent = fs.readFileSync(envFile, 'utf-8');
const parsed = {
  PATHAO_BASE_URL: 'https://api-hermes.pathao.com',
  PATHAO_CLIENT_ID: '',
  PATHAO_CLIENT_SECRET: '',
  PATHAO_USERNAME: '',
  PATHAO_PASSWORD: '',
  PATHAO_BEARER_TOKEN: '',
  WOOCOMMERCE_STORE_URL: '',
  WOOCOMMERCE_CONSUMER_KEY: '',
  WOOCOMMERCE_CONSUMER_SECRET: ''
};

envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (match) {
    const k = match[1];
    const v = match[2].replace(/^['"](.*)['"]$/, '$1').trim();
    if (parsed.hasOwnProperty(k)) {
      parsed[k] = v;
    }
  }
});

const code = `/**
 * DEEN Delivery Parser - Environment & Credentials Configuration
 * Auto-synced from .env for Chrome Extension runtime.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DEEN_ENV = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {
  return ${JSON.stringify(parsed, null, 2)};
}));
`;

fs.writeFileSync(targetFile, code, 'utf-8');
console.log('✅ Successfully synced .env credentials into env.js for Chrome extension!');
