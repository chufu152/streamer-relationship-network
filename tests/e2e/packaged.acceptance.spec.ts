import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir, cpus, totalmem } from 'node:os';
import sharp from 'sharp';
import { createEmptyProject } from '../../src/shared/project';

const executablePath = process.env.NETWORK_EXECUTABLE_PATH ?? resolve('release/win-unpacked/relationship-network.exe');

async function launch(directory: string, scale = 1) {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  const app = await electron.launch({ executablePath, args: [`--user-data-dir=${join(directory, 'user-data')}`, `--force-device-scale-factor=${scale}`], env });
  const page = await app.firstWindow();
  // A13: recorded from the first frame; the offline app may only load its own files and embedded photos.
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await expect(page.getByRole('status')).toHaveText('桌面环境已连接');
  await page.context().setOffline(true);
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, join(directory, 'acceptance.srn'));
  return { app, page, requests };
}

function expectOnlyLocalRequests(...logs: string[][]): void {
  expect(logs.flat().filter((url) => !/^(?:file|data):/u.test(url))).toEqual([]);
}

async function shutdown(app: ElectronApplication) {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app.close();
}

for (const scale of [1, 1.25, 1.5]) {
  test(`installed build restarts with local photos at ${scale * 100}% display scale`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'network-installed-'));
    let desktop = await launch(directory, scale);
    const requests = [desktop.requests];
    try {
      const { app, page } = desktop;
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(960, 640));
      const input = page.getByRole('textbox', { name: '人物姓名', exact: true });
      const box = (await input.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(640);
      await input.fill('安装版人物'); await input.press('Enter');
      const person = page.getByRole('button', { name: '人物 安装版人物', exact: true });
      await person.click({ button: 'right' });
      const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64; canvas.getContext('2d')!.fillRect(0, 0, 64, 64); return canvas.toDataURL().split(',')[1]; });
      await page.getByLabel('选择人物照片').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
      await expect(page.getByRole('button', { name: '移除照片' })).toBeEnabled();
      await page.getByRole('button', { name: '取消', exact: true }).click();
      await page.locator('.save-button').click(); await expect(page.locator('.project-state')).toHaveText('已保存');
      const saved = JSON.parse(await readFile(join(directory, 'acceptance.srn'), 'utf8'));
      expect(saved.assets).toHaveLength(1);
      await page.screenshot({ path: `.artifacts/m6-installed-${scale}.png` });
      await shutdown(app);
      desktop = await launch(directory, scale);
      requests.push(desktop.requests);
      await desktop.page.getByRole('button', { name: '打开', exact: true }).click();
      await expect(desktop.page.getByRole('button', { name: '人物 安装版人物', exact: true })).toBeVisible();
      await expect.poll(() => desktop.page.locator('.person-node img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(64);
      expect(JSON.parse(await readFile(join(directory, 'acceptance.srn'), 'utf8'))).toEqual(saved);
      expectOnlyLocalRequests(...requests);
    } finally { await shutdown(desktop.app); await rm(directory, { recursive: true, force: true }); }
  });
}

test('measures 200 people, 400 relationships and 200 compressed photo assets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'network-performance-'));
  let desktop = await launch(directory);
  try {
    const { app, page, requests } = desktop;
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1920, 1080));
    const project = createEmptyProject();
    const pixels = Buffer.alloc(512 * 512 * 3);
    let seed = 123456;
    for (let index = 0; index < pixels.length; index++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels[index] = seed >>> 24; }
    const photo = await sharp(pixels, { raw: { width: 512, height: 512, channels: 3 } }).webp({ quality: 70 }).toBuffer();
    project.assets = Array.from({ length: 200 }, () => ({ id: crypto.randomUUID(), mimeType: 'image/webp' as const, width: 512, height: 512, dataBase64: photo.toString('base64') }));
    project.people = project.assets.map((asset, index) => ({ id: crypto.randomUUID(), name: `合成人物${index + 1}`, x: 100 + index % 20 * 170, y: 100 + Math.floor(index / 20) * 150, photoAssetId: asset.id }));
    project.relationships = project.people.flatMap((person, index) => [1, 20].map((offset) => ({ id: crypto.randomUUID(), sourceId: person.id, targetId: project.people[(index + offset) % 200].id, direction: 'both' as const, label: '合成关系' })));
    project.viewport = { panX: 30, panY: 30, zoom: 0.45 };
    const save = await page.evaluate(async (project) => { const start = performance.now(); const result = await window.desktop!.saveProject(project, false); return { ms: performance.now() - start, result }; }, project);
    expect(save.result.status).toBe('ok');
    const openStart = Date.now();
    await page.getByRole('button', { name: '打开', exact: true }).click();
    // Opening a 200-photo project legitimately takes seconds; under desktop load even longer.
    await expect(page.getByLabel('画布统计')).toHaveText('200 人物400 关系', { timeout: 30_000 });
    await expect.poll(() => page.locator('.person-node img').evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth === 512)), { timeout: 30_000 }).toBe(true);
    const openMs = Date.now() - openStart;
    const node = page.locator('.person-node').nth(100);
    const box = (await node.boundingBox())!;
    const x = box.x + box.width / 2; const y = box.y + box.height / 2;
    await page.getByTestId('graph-surface').evaluate((surface) => surface.addEventListener('pointerdown', (event) => surface.setAttribute('data-pointer-id', String((event as PointerEvent).pointerId))));
    await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(350);
    const frames = await page.evaluate(async ({ x, y }) => {
      const surface = document.querySelector('[data-testid="graph-surface"]')!;
      const pointerId = Number(surface.getAttribute('data-pointer-id'));
      const intervals: number[] = []; const start = performance.now(); let previous = start;
      await new Promise<void>((resolve) => {
        const frame = (now: number) => {
          intervals.push(now - previous); previous = now;
          surface.dispatchEvent(new PointerEvent('pointermove', { pointerId, pointerType: 'mouse', buttons: 1, bubbles: true, clientX: x + Math.sin(now / 200) * 20, clientY: y + Math.cos(now / 200) * 20 }));
          if (now - start >= 2000) resolve(); else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      return { fps: intervals.length * 1000 / (previous - start), p95FrameMs: [...intervals].sort((a, b) => a - b)[Math.floor(intervals.length * 0.95)], frames: intervals.length };
    }, { x, y });
    await page.keyboard.press('Escape'); await page.mouse.up();
    // Best effort only: under heavy desktop load Chromium can exceed the default screenshot timeout,
    // and this diagnostic artifact is not worth failing the whole sampling run.
    await page.screenshot({ path: '.artifacts/m6-loaded-network.png', timeout: 60_000 }).catch(() => undefined);
    // A new process starts without any validated photo in memory, like a user opening a saved project.
    await shutdown(app);
    desktop = await launch(directory);
    const coldStart = Date.now();
    await desktop.page.getByRole('button', { name: '打开', exact: true }).click();
    await expect(desktop.page.getByLabel('画布统计')).toHaveText('200 人物400 关系', { timeout: 30_000 });
    await expect.poll(() => desktop.page.locator('.person-node img').evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth === 512)), { timeout: 30_000 }).toBe(true);
    const coldOpenMs = Date.now() - coldStart;
    const metrics = { executablePath, cpu: cpus()[0].model, logicalCpus: cpus().length, ramGiB: totalmem() / 1024 ** 3, people: 200, relationships: 400, assets: 200, projectBytes: Buffer.byteLength(JSON.stringify(project)), saveMs: save.ms, warmOpenMs: openMs, coldOpenMs, ...frames };
    await writeFile('.artifacts/m6-performance.json', JSON.stringify(metrics, null, 2));
    console.log(JSON.stringify(metrics));
    expect(frames.fps).toBeGreaterThanOrEqual(30);
    expectOnlyLocalRequests(requests, desktop.requests);
  } finally { await shutdown(desktop.app); await rm(directory, { recursive: true, force: true }); }
});
