import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests', testMatch: 'free-review.spec.ts', timeout: 30_000, workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4174', viewport: { width: 402, height: 700 }, hasTouch: true,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: 'npm run build:review && npx vite preview --mode review --port 4174 --strictPort',
    url: 'http://localhost:4174', reuseExistingServer: false, timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
