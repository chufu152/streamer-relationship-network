import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';
import { rendererConfig } from './tooling/renderer';

export default defineConfig(({ command }) => ({
  main: {
    build: {
      rollupOptions: {
        input: resolve('src/main/index.ts'),
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: rendererConfig(command === 'serve'),
}));
