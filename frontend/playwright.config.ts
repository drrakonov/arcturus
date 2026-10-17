import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', workers: 1, timeout: 90000,
  outputDir: process.env.TEST_ARTIFACT_DIR ? `${process.env.TEST_ARTIFACT_DIR}/browser-results` : './test-results',
  use: { baseURL: process.env.TEST_FRONTEND_URL || 'http://127.0.0.1:15173', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure' },
});
