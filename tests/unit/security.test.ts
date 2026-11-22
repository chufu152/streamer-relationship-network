import { describe, expect, it } from 'vitest';
import { isAllowedResource, validateDevelopmentUrl } from '../../src/main/security';

const production = 'file:///D:/NETWORK/out/renderer/index.html';
const development = 'http://127.0.0.1:5173/';

describe('desktop resource policy', () => {
  it('allows only packaged renderer files in production', () => {
    expect(isAllowedResource('file:///D:/NETWORK/out/renderer/assets/index.js', production, false)).toBe(true);
    expect(isAllowedResource('file:///D:/NETWORK/out/main/index.cjs', production, false)).toBe(false);
    expect(isAllowedResource('file:///D:/NETWORK/out/renderer/../main/index.cjs', production, false)).toBe(false);
    expect(isAllowedResource('file:///D:/NETWORK/out/renderer-evil/code.js', production, false)).toBe(false);
    expect(isAllowedResource('file:///D:/NETWORK/out/renderer/%2e%2e%2fmain/index.cjs', production, false)).toBe(false);
  });

  it.each(['https://example.com/data', 'http://127.0.0.1:5173/', 'javascript:alert(1)', 'not a url'])('blocks nonlocal production requests: %s', (url) => {
    expect(isAllowedResource(url, production, false)).toBe(false);
  });

  it('allows local development HTTP and HMR but no foreign origin', () => {
    expect(isAllowedResource('http://127.0.0.1:5173/main.tsx', development, true)).toBe(true);
    expect(isAllowedResource('ws://127.0.0.1:5173/', development, true)).toBe(true);
    expect(isAllowedResource('http://localhost:5173/', development, true)).toBe(false);
    expect(isAllowedResource('http://127.0.0.1:5174/', development, true)).toBe(false);
    expect(isAllowedResource('https://example.com/', development, true)).toBe(false);
  });

  it('supports in-memory images without enabling filesystem access', () => {
    expect(isAllowedResource('data:image/webp;base64,AAAA', production, false)).toBe(true);
    expect(isAllowedResource('blob:file:///local-image', production, false)).toBe(true);
  });

  it('validates the exact development entry', () => {
    expect(validateDevelopmentUrl(development)).toBe(development);
    for (const url of ['https://example.com/', 'http://127.0.0.1:5174/', development + 'other', development + '?url=remote']) {
      expect(() => validateDevelopmentUrl(url)).toThrow();
    }
  });
});
