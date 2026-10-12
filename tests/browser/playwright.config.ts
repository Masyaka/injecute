import { defineConfig, devices } from '@playwright/test';

const port = 4173;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  reporter: 'list',
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: `node tests/browser/server.mjs`,
    cwd: '../..',
    env: { PORT: String(port) },
    url: `http://localhost:${port}/lib/index.js`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
