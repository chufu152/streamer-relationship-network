import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.electron.spec.ts',
  workers: 1,
  reporter: 'list',
  timeout: 30_000,
});
