import { defineConfig, devices } from '@playwright/test';

// Runs against the built docs site (`npm run docs:build` first).
const port = 4174;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  reporter: 'list',
  timeout: 90_000,
  // each page starts Monaco's TypeScript worker; parallel pages starve each other
  workers: 1,
  use: { baseURL: `http://localhost:${port}/injecute/` },
  webServer: {
    command: `npx vitepress preview docs --port ${port}`,
    cwd: '../..',
    url: `http://localhost:${port}/injecute/`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
});
