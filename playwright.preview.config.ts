import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: /preview.spec.ts/,
  timeout: 90_000,
  use: {
    baseURL: 'http://127.0.0.1:5191',
    trace: 'retain-on-failure',
    ...devices['Pixel 5'],
  },
  webServer: {
    command: 'pnpm preview -- --port 5191 --strictPort',
    url: 'http://127.0.0.1:5191',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
