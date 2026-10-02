import { defineConfig, devices } from '@playwright/test';

const PORT = 5199;
const WS_PORT = 8787;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `npx vite --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      // authoritative game server for the online suite; globalSetup built its dist
      command: 'npm run start --workspace @boulder-maze/server --silent',
      port: WS_PORT,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
