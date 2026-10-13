const path = require('node:path');
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: /display-compat\.spec\.cjs/,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 45_000,
  use: {
    headless: true,
    baseURL: 'http://127.0.0.1:4173'
  },
  webServer: {
    command: 'python3 -m http.server 4173 --bind 127.0.0.1',
    cwd: path.resolve(__dirname, '../..'),
    url: 'http://127.0.0.1:4173/openko-web/index.html',
    reuseExistingServer: true,
    timeout: 15_000
  },
  reporter: [['line']]
});
