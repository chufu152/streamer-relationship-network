import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import type { UserConfig } from 'vite';

export function rendererConfig(development: boolean): UserConfig {
  const csp = [
    "default-src 'self'",
    `script-src 'self'${development ? " 'unsafe-inline'" : ''}`,
    `style-src 'self'${development ? " 'unsafe-inline'" : ''}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${development ? ' ws://127.0.0.1:5173' : ''}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return {
    root: resolve('src/renderer'),
    base: './',
    plugins: [react(), {
      name: 'app-content-security-policy',
      transformIndexHtml: (html) => html.replace('__APP_CSP__', csp),
    }],
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    build: { outDir: resolve('out/renderer'), emptyOutDir: true },
  };
}
