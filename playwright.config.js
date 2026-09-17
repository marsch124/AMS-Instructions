// UI tests — Martin's standing rule (2026-09-16): they run in CI on every push,
// every control is found by its data-testid (never by its words), and the suite
// grows ONE test at a time, each one seen to FAIL before it is trusted.
// Local: `npm run test:ui`. The app is plain static files, so the web server is
// Python's built-in one — present on every machine and every GitHub runner.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/ui',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,   // one at a time: every test drives the same app in its own browser, and
                // a loaded machine is the main source of false failures.
  // A test that passes on a retry is a flaky test, not a green one.
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    // Retries are 0 on purpose, so 'on-first-retry' would never record anything.
    // A red run has to be diagnosable from what it left behind — that is how the
    // one CI failure this suite has had was solved.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // 🚨 Service workers OFF. This app installs one, and it serves its cached copy
    // on every load after the first — so a test that reloads would be testing the
    // CACHE, not the code just changed. (Learned the hard way in AMS Packing.)
    serviceWorkers: 'block',
  },
  // The phone is where he lives; test at its size.
  projects: [{ name: 'iphone-chromium', use: { ...devices['iPhone 13'], browserName: 'chromium' } }],
  webServer: {
    command: 'python3 -m http.server 4174 --bind 127.0.0.1',
    url: 'http://127.0.0.1:4174/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
