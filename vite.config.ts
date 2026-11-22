import { defineConfig } from 'vite';
import { rendererConfig } from './tooling/renderer';

export default defineConfig(({ command }) => rendererConfig(command === 'serve'));
