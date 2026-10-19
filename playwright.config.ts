import { defineConfig, devices } from '@playwright/test';
import { baseline, devServer } from './e2e/shared';

export default defineConfig({
  ...baseline,
  timeout: 90_000,
  retries: process.env.CI ? 2 : 0,
  use: { ...baseline.use, baseURL: 'http://127.0.0.1:5190', ...devices['Pixel 5'] },
  webServer: devServer,
});
