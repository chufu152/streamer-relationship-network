import { dirname, isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export function isAllowedResource(url: string, rendererUrl: string, development: boolean): boolean {
  try {
    const request = new URL(url);
    const renderer = new URL(rendererUrl);
    if (request.protocol === 'data:' || request.protocol === 'blob:') return true;
    if (development) {
      return ['http:', 'ws:'].includes(request.protocol)
        && request.hostname === renderer.hostname
        && request.port === renderer.port;
    }
    if (request.protocol !== 'file:') return false;
    const path = relative(dirname(fileURLToPath(renderer)), fileURLToPath(request));
    return !path.startsWith('..') && !isAbsolute(path);
  } catch {
    return false;
  }
}

export function validateDevelopmentUrl(value: string): string {
  const url = new URL(value);
  if (url.origin !== 'http://127.0.0.1:5173' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('Invalid development renderer URL');
  }
  return url.href;
}
