import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.acceptance.spec.ts',
  workers: 1,
  reporter: 'list',
  timeout: 240_000,
});
