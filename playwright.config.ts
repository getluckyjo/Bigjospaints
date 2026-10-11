import { defineConfig, devices } from '@playwright/test';

const port = 4522;
const mockPort = 4599;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 2,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // OpenAI is replaced by a local mock of the Responses API (tests/e2e/mock-openai.mjs).
      command: `node tests/e2e/mock-openai.mjs ${mockPort}`,
      url: `http://127.0.0.1:${mockPort}/`,
      reuseExistingServer: !process.env.CI,
    },
    {
      // In-memory orders and the PayFast sandbox; PayFast itself is stubbed in the tests.
      command: `npx astro dev --port ${port} --host 127.0.0.1 --ignore-lock`,
      env: {
        ORDER_STORE: 'memory',
        COMMERCE_MODE: 'sandbox',
        PUBLIC_SITE_URL: '',
        OPENAI_API_KEY: 'test-key',
        OPENAI_BASE_URL: `http://127.0.0.1:${mockPort}/v1`,
      },
      url: `http://127.0.0.1:${port}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
