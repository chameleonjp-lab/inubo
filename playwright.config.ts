import { defineConfig } from '@playwright/test';

/**
 * 画面の一連の流れを確かめる通し試験。本番用にまとめたもの（dist）を配信して確かめる。
 * 端末の操作感と聞こえ方の合否は、ここではなく iPhone 17 Pro の Safari で取る（docs/acceptance-record.md）。
 */
export default defineConfig({
  testDir: 'tests',
  testMatch: /.*\.spec\.ts$/,
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 402, height: 700 },
    hasTouch: true,
    trace: 'off',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
