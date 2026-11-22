import { _electron as electron, test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('production desktop starts with sandboxed renderer and minimal bridge', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'relationship-network-test-'));
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], env });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.getByRole('status')).toHaveText('桌面环境已连接');
    await expect(page.getByRole('main')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    const bridge = await page.evaluate(async () => ({
      keys: Object.keys(window.desktop ?? {}),
      info: await window.desktop?.getAppInfo(),
      node: typeof Reflect.get(window, 'require'),
      process: typeof Reflect.get(window, 'process'),
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content'),
    }));
    expect(bridge.keys).toEqual(['getAppInfo']);
    expect(bridge.info?.name).toBe('人物交际网');
    expect(bridge.node).toBe('undefined');
    expect(bridge.process).toBe('undefined');
    expect(bridge.csp).not.toContain('unsafe-inline');
    expect(bridge.csp).not.toContain('unsafe-eval');
    const security = await app.evaluate(({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const rendererPid = window.webContents.getOSProcessId();
      return {
        minimumSize: window.getMinimumSize(),
        sandboxed: app.getAppMetrics().find((metric) => metric.pid === rendererPid)?.sandboxed,
      };
    });
    expect(security).toEqual({ minimumSize: [960, 640], sandboxed: true });
    for (const size of [{ width: 960, height: 640 }, { width: 1920, height: 1080 }]) {
      await app.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height);
      }, size);
      await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual(size);
      const input = await page.getByRole('textbox', { name: '人物姓名' }).boundingBox();
      expect(input).not.toBeNull();
      expect(input!.y + input!.height).toBeLessThanOrEqual(size.height);
      expect(input!.x + input!.width).toBeLessThanOrEqual(size.width);
      await page.screenshot({ path: `.artifacts/m1-electron-${size.width}.png` });
    }
    await page.getByRole('textbox', { name: '人物姓名' }).fill('桌面测试人物');
    await expect(page.getByRole('button', { name: '添加人物' })).toBeDisabled();
    const original = page.url();
    await page.evaluate(() => { window.open('https://example.com/'); });
    await expect.poll(() => app.windows().length).toBe(1);
    await page.evaluate(() => { window.location.href = 'https://example.com/'; });
    const navigation = await app.evaluate(async ({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      return { url: contents.getURL(), documentUrl: await contents.executeJavaScript('document.URL') as string };
    });
    expect(navigation).toEqual({ url: original, documentUrl: original });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
