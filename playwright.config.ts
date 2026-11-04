import { dirname, join } from 'node:path';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  ...(process.env.CRM_E2E_ACCOUNTS && {
    outputDir: join(dirname(process.env.CRM_E2E_ACCOUNTS), 'raw-results'),
    reporter: './scripts/e2e-reporter.mjs',
  }),
  testDir: './e2e',
  workers: 1,
  retries: 0,
  timeout: 90_000,
  use: { baseURL: 'http://127.0.0.1:5174', locale: 'ru-RU', trace: 'off' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'pnpm exec vite build --outDir .local/e2e-dist --emptyOutDir && pnpm exec vite preview --outDir .local/e2e-dist --host 127.0.0.1 --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
  },
});
