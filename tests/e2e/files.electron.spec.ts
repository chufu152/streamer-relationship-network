import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test';
import type { BaseWindow, MessageBoxOptions } from 'electron';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSchema, type NetworkProject } from '../../src/shared/project';
import type { Viewport } from '../../src/shared/geometry';

// Exercise the integrated production build, never a renderer/file-API replacement.
// The only mocked APIs are these three native dialogs in this isolated main process.
type DialogAnswer =
  | { kind: 'save'; path: string | null }
  | { kind: 'open'; path: string | null }
  | { kind: 'confirm'; choice: 'save' | 'discard' | 'cancel' };
type DialogState = { pending: DialogAnswer[]; errors: string[] };
type TestMainGlobal = typeof globalThis & { __m5FileDialogs: DialogState };
type Desktop = { app: ElectronApplication; page: Page; files: string };
// resolve() strips the trailing path separator: projectRoot is passed as an argv entry, and on Windows
// a trailing "\" in front of the closing quote ("...\"") merges it with the next argument.
const projectRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));

function fileButton(page: Page, name: '新建' | '打开' | '另存为' | '保存') {
  return page.getByRole('navigation', { name: '项目文件' }).getByRole('button', { name, exact: true });
}

async function installDialogs(app: ElectronApplication) {
  await app.evaluate(({ dialog }) => {
    const state: DialogState = { pending: [], errors: [] };
    (globalThis as TestMainGlobal).__m5FileDialogs = state;
    function take(kind: DialogAnswer['kind']) {
      const next = state.pending.shift();
      if (!next || next.kind !== kind) {
        state.errors.push(`Unexpected ${kind} dialog; next answer: ${JSON.stringify(next)}`);
        return undefined;
      }
      return next;
    }
    dialog.showSaveDialog = async () => {
      const next = take('save');
      return next?.kind === 'save' && next.path !== null
        ? { canceled: false, filePath: next.path }
        : { canceled: true, filePath: '' };
    };
    dialog.showOpenDialog = async () => {
      const next = take('open');
      return next?.kind === 'open' && next.path !== null
        ? { canceled: false, filePaths: [next.path] }
        : { canceled: true, filePaths: [] };
    };
    dialog.showMessageBox = async (windowOrOptions: BaseWindow | MessageBoxOptions, options?: MessageBoxOptions) => {
      const configuration = options ?? windowOrOptions as MessageBoxOptions;
      if (JSON.stringify(configuration.buttons) !== JSON.stringify(['保存', '不保存', '取消'])
        || configuration.defaultId !== 0 || configuration.cancelId !== 2) {
        state.errors.push('Unsaved confirmation must offer 保存 / 不保存 / 取消, with cancelId 2');
        return { response: 2, checkboxChecked: false };
      }
      const next = take('confirm');
      const response = next?.kind === 'confirm' ? { save: 0, discard: 1, cancel: 2 }[next.choice] : 2;
      return { response, checkboxChecked: false };
    };
  });
}

async function queueDialogs(app: ElectronApplication, ...answers: DialogAnswer[]) {
  await app.evaluate((_electron, answers) => {
    const state = (globalThis as TestMainGlobal).__m5FileDialogs;
    if (state.pending.length || state.errors.length) throw new Error(`Unfinished dialog script: ${JSON.stringify(state)}`);
    state.pending.push(...answers);
  }, answers);
}

async function expectDialogsConsumed(app: ElectronApplication) {
  await expect.poll(() => app.evaluate(() => (globalThis as TestMainGlobal).__m5FileDialogs))
    .toEqual({ pending: [], errors: [] });
}

async function withDesktop(run: (desktop: Desktop) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'network-m5-electron-')));
  const userData = join(root, 'user-data');
  const files = join(root, 'files');
  let app: ElectronApplication | undefined;
  const errors: string[] = [];
  try {
    await mkdir(userData);
    await mkdir(files);
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    app = await electron.launch({ cwd: projectRoot, args: [projectRoot, `--user-data-dir=${userData}`], env });
    const actualUserData = await app.evaluate(({ app }) => app.getPath('userData'));
    expect(await realpath(actualUserData)).toBe(await realpath(userData));
    await installDialogs(app);
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.context().setOffline(true); // file: and synthetic data: images must still work.
    expect(page.url()).toMatch(/^file:/u);
    await expect(page.getByRole('status').filter({ hasText: '桌面环境已连接' })).toBeVisible();
    for (const name of ['新建', '打开', '另存为', '保存'] as const) await expect(fileButton(page, name)).toBeEnabled();
    await run({ app, page, files });
    if (!page.isClosed()) await expectDialogsConsumed(app);
    expect(errors).toEqual([]);
  } finally {
    try {
      if (app) {
        const child = app.process();
        if (child.exitCode === null && child.signalCode === null) {
          // Fixture destruction ONLY. Behavioral close tests below use BrowserWindow.close().
          // app.exit destroys the evaluate context, so transport rejection is expected.
          await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
        }
        await app.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
}

async function readProject(path: string): Promise<NetworkProject> {
  return projectSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

async function expectSaved(desktop: Desktop, path: string, check: (project: NetworkProject) => void) {
  try {
    await expect(async () => check(await readProject(path))).toPass({ timeout: 15_000 });
  } catch (error) {
    // Distinguish "the app never saved" from "the file content is wrong".
    const alert = (await desktop.page.getByRole('alert').allTextContents()).join(' | ');
    const state = await desktop.page.locator('.project-state').textContent();
    throw new Error(`Saved file did not reach the expected state. UI alert: "${alert}"; project state: "${state}".\n${(error as Error).message}`, { cause: error });
  }
  await expect(desktop.page.getByRole('alert')).toHaveText('已保存到本地文件');
  await expect(desktop.page.locator('.project-state')).not.toContainText('未保存');
  await expect(fileButton(desktop.page, '新建')).toBeEnabled();
  await expectDialogsConsumed(desktop.app);
  return readProject(path);
}

async function addPerson(page: Page, name: string) {
  await page.getByRole('textbox', { name: '人物姓名', exact: true }).fill(name);
  await page.getByRole('button', { name: '添加人物', exact: true }).click();
  const node = page.getByRole('button', { name: `人物 ${name}`, exact: true });
  await expect(node).toBeVisible();
  const id = await node.getAttribute('data-person-id');
  expect(id).not.toBeNull();
  return id!;
}

async function addSyntheticPhoto(desktop: Desktop, name: string) {
  const { page, files } = desktop;
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 96; canvas.height = 64;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#315a86'; context.fillRect(0, 0, 96, 64);
    context.fillStyle = '#e3ae48'; context.fillRect(24, 16, 48, 32);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const path = join(files, 'synthetic-only.png');
  await writeFile(path, Buffer.from(png, 'base64'));
  const person = page.getByRole('button', { name: `人物 ${name}`, exact: true });
  await person.click({ button: 'right' });
  const editor = page.getByRole('dialog', { name: '编辑人物', exact: true });
  await editor.getByLabel('选择人物照片').setInputFiles(path);
  await expect(editor.getByRole('button', { name: '移除照片', exact: true })).toBeEnabled();
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  await expect.poll(() => person.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  return person.locator('img').getAttribute('src');
}

async function canvasSnapshot(page: Page) {
  return page.locator('.graph-world').evaluate((world) => ({
    transform: (world as HTMLElement).style.transform,
    people: Array.from(world.querySelectorAll<HTMLButtonElement>('[data-person-id]'), (node) => ({
      id: node.dataset.personId,
      name: node.getAttribute('aria-label'),
      x: Number.parseFloat(node.style.left),
      y: Number.parseFloat(node.style.top),
      photo: node.querySelector('img')?.getAttribute('src') ?? null,
    })),
    relationships: Array.from(world.querySelectorAll('[data-relationship-id]'), (edge) => ({
      id: edge.getAttribute('data-relationship-id'),
      name: edge.getAttribute('aria-label'),
      start: edge.querySelector('path')?.getAttribute('marker-start'),
      end: edge.querySelector('path')?.getAttribute('marker-end'),
    })),
  }));
}

// Same hit test as the browser boundary suite: only a point whose top element is the canvas itself
// receives canvas wheel events.
async function blankCanvasPoint(page: Page) {
  const surface = page.getByTestId('graph-surface');
  const box = (await surface.boundingBox())!;
  return surface.evaluate((element, box) => {
    for (const yRatio of [0.75, 0.25, 0.5, 0.875, 0.125]) {
      for (const xRatio of [0.75, 0.25, 0.5, 0.875, 0.125]) {
        const x = box.x + box.width * xRatio; const y = box.y + box.height * yRatio;
        if (document.elementFromPoint(x, y) === element) return { x, y };
      }
    }
    throw new Error('No unobstructed canvas point for the wheel gesture');
  }, box);
}

// Chromium keeps layout lengths as 32-bit floats and prints computed styles with six significant digits,
// so under fractional display scaling a DOM read-back (633.2 for 633.2000122070309) never equals the value
// the app holds and saves. DOM-to-file comparisons use this bound; file-to-file ones stay exact.
function near(actual: number, expected: number) {
  return Math.abs(actual - expected) <= 1e-5 * Math.max(1, Math.abs(actual), Math.abs(expected));
}

function expectNear(actual: number, expected: number) {
  expect(Math.abs(actual - expected), `${actual} must equal ${expected} within DOM precision`)
    .toBeLessThanOrEqual(1e-5 * Math.max(1, Math.abs(actual), Math.abs(expected)));
}

function nearViewport(actual: Viewport, expected: Viewport) {
  return near(actual.panX, expected.panX) && near(actual.panY, expected.panY) && near(actual.zoom, expected.zoom);
}

function expectViewportNear(actual: Viewport, expected: Viewport) {
  expectNear(actual.panX, expected.panX); expectNear(actual.panY, expected.panY); expectNear(actual.zoom, expected.zoom);
}

function expectPointNear(actual: { x: number; y: number }, expected: { x: number; y: number }) {
  expectNear(actual.x, expected.x); expectNear(actual.y, expected.y);
}

async function expectCanvasProject(page: Page, project: NetworkProject) {
  await expect(page.getByLabel('画布统计')).toHaveText(`${project.people.length} 人物${project.relationships.length} 关系`);
  await expect(page.locator('.person-node')).toHaveCount(project.people.length);
  await expect(page.locator('[data-relationship-id]')).toHaveCount(project.relationships.length);
  await expect(page.locator('.project-title')).toHaveAttribute('title', /\.srn(?:\.bak)?$/u);
  const { panX, panY, zoom } = project.viewport;
  await expect.poll(async () => nearViewport(await page.locator('.graph-world').evaluate((world) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(world).transform);
    return { panX: matrix.e, panY: matrix.f, zoom: matrix.a };
  }), { panX, panY, zoom })).toBe(true);
  await expect(page.locator('.zoom-value')).toHaveText(`${Math.round(zoom * 100)}%`);
  for (const person of project.people) {
    const node = page.locator(`[data-person-id="${person.id}"]`);
    await expect(node).toHaveAccessibleName(`人物 ${person.name}`);
    expectPointNear(await node.evaluate((node: HTMLElement) => ({ x: Number.parseFloat(node.style.left), y: Number.parseFloat(node.style.top) })), person);
    if (person.photoAssetId) {
      const asset = project.assets.find((asset) => asset.id === person.photoAssetId)!;
      expect(asset).toBeDefined();
      await expect(node.locator('img')).toHaveAttribute('src', `data:${asset.mimeType};base64,${asset.dataBase64}`);
      await expect.poll(() => node.locator('img').evaluate((image: HTMLImageElement) => ({ width: image.naturalWidth, height: image.naturalHeight })))
        .toEqual({ width: asset.width, height: asset.height });
    } else await expect(node.locator('img')).toHaveCount(0);
  }
  for (const relation of project.relationships) {
    const source = project.people.find((person) => person.id === relation.sourceId)!;
    const target = project.people.find((person) => person.id === relation.targetId)!;
    const arrow = { forward: '→', reverse: '←', both: '↔' }[relation.direction];
    const edge = page.locator(`[data-relationship-id="${relation.id}"]`);
    await expect(edge).toHaveAccessibleName(`关系 ${source.name} ${arrow} ${target.name}${relation.label ? `：${relation.label}` : ''}`);
    const path = edge.locator('path').first();
    if (relation.direction !== 'forward') await expect(path).toHaveAttribute('marker-start', 'url(#arrow-end)');
    else await expect(path).not.toHaveAttribute('marker-start');
    if (relation.direction !== 'reverse') await expect(path).toHaveAttribute('marker-end', 'url(#arrow-end)');
    else await expect(path).not.toHaveAttribute('marker-end');
    if (relation.label) await expect(edge.locator('text')).toHaveText(relation.label);
  }
}

async function expectUnchangedDirty(desktop: Desktop, snapshot: Awaited<ReturnType<typeof canvasSnapshot>>) {
  await expectDialogsConsumed(desktop.app);
  await expect(fileButton(desktop.page, '新建')).toBeEnabled();
  expect(desktop.page.isClosed()).toBe(false);
  expect(await desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  await expect(desktop.page.locator('.project-state')).toContainText('未保存');
  expect(await canvasSnapshot(desktop.page)).toEqual(snapshot);
}

async function requestNormalClose(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
}

async function expectNormalClose(desktop: Desktop) {
  // Subscribe first: the actual OS-window close must pass through renderer confirmation.
  await Promise.all([
    desktop.page.waitForEvent('close'),
    requestNormalClose(desktop.app),
  ]);
  expect(desktop.page.isClosed()).toBe(true);
}

test('offline local save restores photos, all relationship directions and viewport; Ctrl+S, Save As and backup recovery', async () => {
  test.setTimeout(300_000);
  await withDesktop(async (desktop) => {
    const { app, page, files } = desktop;
    const primary = join(files, '本地项目.srn');
    const ids: string[] = [];
    for (const name of ['合成人物甲', '合成人物乙', '合成人物丙']) ids.push(await addPerson(page, name));
    const photo = await addSyntheticPhoto(desktop, '合成人物甲');
    expect(photo).toMatch(/^data:image\/webp;base64,/u);
    await rm(join(files, 'synthetic-only.png'));
    await page.getByRole('button', { name: '放大', exact: true }).click();
    await expect(page.locator('.zoom-value')).toHaveText('120%');
    const beforePan = await canvasSnapshot(page);
    // Wheel over blank canvas: the selection tools of the selected person and the person nodes are
    // overlays, so a wheel event above them never reaches the canvas.
    const blank = await blankCanvasPoint(page);
    await page.mouse.move(blank.x, blank.y);
    await page.mouse.wheel(40, 70);
    await expect.poll(async () => (await canvasSnapshot(page)).transform).not.toBe(beforePan.transform);
    const beforeSave = await canvasSnapshot(page);
    const expectedViewport = await page.locator('.graph-world').evaluate((world) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(world).transform);
      return { panX: matrix.e, panY: matrix.f, zoom: matrix.a };
    });
    expect(expectedViewport.zoom).toBe(1.2);
    expect(expectedViewport.panX).not.toBe(0);
    expect(expectedViewport.panY).not.toBe(0);

    const relations = [
      { from: 0, to: 1, direction: 'forward', radio: 'A → B', label: '合成同事' },
      { from: 1, to: 2, direction: 'reverse', radio: 'A ← B', label: '合成朋友' },
      { from: 2, to: 0, direction: 'both', radio: 'A ↔ B', label: '合成伙伴' },
    ] as const;
    for (const [index, relation] of relations.entries()) {
      await page.locator(`[data-person-id="${ids[relation.from]}"]`).click({ button: 'right' });
      const personEditor = page.getByRole('dialog', { name: '编辑人物', exact: true });
      await personEditor.getByLabel('连接到人物', { exact: true }).selectOption(ids[relation.to]);
      await personEditor.getByRole('button', { name: '创建关系', exact: true }).click();
      await expect(personEditor).not.toBeVisible();
      const edge = page.locator('[data-relationship-id]').nth(index);
      await edge.focus();
      await page.keyboard.press('Enter');
      const relationEditor = page.getByRole('dialog', { name: '编辑关系', exact: true });
      await relationEditor.getByLabel(relation.radio, { exact: true }).check();
      await relationEditor.getByLabel('关系名称', { exact: true }).fill(relation.label);
      if (index === 0) await queueDialogs(app, { kind: 'save', path: primary });
      // Desktop 保存 must write the WHOLE project, not merely apply a relation to memory.
      await relationEditor.getByRole('button', { name: '保存', exact: true }).click();
      await expect(relationEditor).not.toBeVisible();
      await expectSaved(desktop, primary, (project) => {
        expect(project.people).toHaveLength(3);
        expect(project.assets).toHaveLength(1);
        expectViewportNear(project.viewport, expectedViewport);
        expect(project.relationships).toHaveLength(index + 1);
        expect(project.relationships[index]).toMatchObject({
          sourceId: ids[relation.from], targetId: ids[relation.to], direction: relation.direction, label: relation.label,
        });
      });
    }
    expect(await page.title()).toBe('本地项目.srn — 人物交际网');
    const saved = await readProject(primary);
    expect(saved.people.map(({ id, name }) => ({ id, name: `人物 ${name}` }))).toEqual(beforeSave.people.map(({ id, name }) => ({ id, name })));
    for (const [index, person] of saved.people.entries()) expectPointNear(person, beforeSave.people[index]);
    expect(saved.people.map((person) => person.photoAssetId)).toEqual([saved.assets[0].id, null, null]);
    expect(`data:${saved.assets[0].mimeType};base64,${saved.assets[0].dataBase64}`).toBe(photo);
    expect(saved.relationships.map(({ direction, label }) => ({ direction, label })))
      .toEqual(relations.map(({ direction, label }) => ({ direction, label })));
    await expectCanvasProject(page, saved);
    const savedCanvas = await canvasSnapshot(page);
    await page.screenshot({ path: '.artifacts/m5-saved-desktop.png' });
    const savedBytes = await readFile(primary);

    await fileButton(page, '新建').click();
    await expect(page.getByLabel('画布统计')).toHaveText('0 人物0 关系');
    await expect(page.locator('.zoom-value')).toHaveText('100%');
    await expect(page.locator('.person-node img')).toHaveCount(0);
    expect(await page.title()).toBe('人物交际网');
    await queueDialogs(app, { kind: 'open', path: primary });
    await fileButton(page, '打开').click();
    await expect(page.getByRole('alert')).toHaveText('项目已打开');
    await expectCanvasProject(page, saved);
    expect(await canvasSnapshot(page)).toEqual(savedCanvas);
    await expectDialogsConsumed(app);

    await addPerson(page, '快捷键新增人物');
    expect(await page.title()).toBe('● 本地项目.srn — 人物交际网');
    await page.keyboard.press('Control+s');
    await expectSaved(desktop, primary, (project) => {
      expect(project.people.map((person) => person.name)).toEqual([...saved.people.map((person) => person.name), '快捷键新增人物']);
      expect(project.assets).toEqual(saved.assets);
      expect(project.relationships).toEqual(saved.relationships);
      expect(project.viewport).toEqual(saved.viewport);
    });
    expect(await readFile(`${primary}.bak`)).toEqual(savedBytes);
    const primaryBytes = await readFile(primary);

    const copy = join(files, '另存项目.srn');
    await addPerson(page, '另存新增人物');
    await queueDialogs(app, { kind: 'save', path: copy });
    await fileButton(page, '另存为').click();
    const copied = await expectSaved(desktop, copy, (project) => {
      expect(project.people).toHaveLength(5);
      expect(project.people.at(-1)?.name).toBe('另存新增人物');
    });
    expect(await readFile(primary)).toEqual(primaryBytes);
    const copiedBytes = await readFile(copy);
    await addPerson(page, '另存后继续人物');
    await page.keyboard.press('Control+s');
    await expectSaved(desktop, copy, (project) => {
      expect(project.people).toHaveLength(6);
      expect(project.id).toBe(copied.id);
      expect(project.people.at(-1)?.name).toBe('另存后继续人物');
    });
    expect(await readFile(primary)).toEqual(primaryBytes);
    expect(await readFile(`${copy}.bak`)).toEqual(copiedBytes);

    await queueDialogs(app, { kind: 'open', path: `${primary}.bak` });
    await fileButton(page, '打开').click();
    await expect(page.getByRole('alert')).toContainText('已打开备份');
    await expectCanvasProject(page, saved);
    expect(await canvasSnapshot(page)).toEqual(savedCanvas);
    await expectDialogsConsumed(app);
    await addPerson(page, '备份恢复人物');
    const recovered = join(files, '恢复项目.srn');
    await queueDialogs(app, { kind: 'save', path: recovered });
    await fileButton(page, '保存').click();
    await expectSaved(desktop, recovered, (project) => {
      expect(project.people.map((person) => person.name)).toEqual([...saved.people.map((person) => person.name), '备份恢复人物']);
      expect(project.assets).toEqual(saved.assets);
      expect(project.relationships).toEqual(saved.relationships);
      expect(project.viewport).toEqual(saved.viewport);
    });
    expect(await readFile(`${primary}.bak`)).toEqual(savedBytes);
    expect(await readFile(primary)).toEqual(primaryBytes);
  });
});

test('cancelled first save, cancelled new and cancelled open preserve the unsaved canvas', async () => {
  await withDesktop(async (desktop) => {
    const { app, page, files } = desktop;
    await addPerson(page, '未保存的合成人物');
    const snapshot = await canvasSnapshot(page);
    await queueDialogs(app, { kind: 'save', path: null });
    await fileButton(page, '保存').click();
    await expect(page.getByRole('alert')).toContainText('已取消保存');
    await expectUnchangedDirty(desktop, snapshot);
    expect(await readdir(files)).toEqual([]);

    await queueDialogs(app, { kind: 'confirm', choice: 'cancel' });
    await fileButton(page, '新建').click();
    await expectUnchangedDirty(desktop, snapshot);
    await queueDialogs(app, { kind: 'confirm', choice: 'save' }, { kind: 'save', path: null });
    await fileButton(page, '新建').click();
    await expectUnchangedDirty(desktop, snapshot);
    await expect(page.getByRole('alert')).toContainText('已取消保存');
    expect(await readdir(files)).toEqual([]);

    await queueDialogs(app, { kind: 'confirm', choice: 'cancel' });
    await fileButton(page, '打开').click();
    await expectUnchangedDirty(desktop, snapshot);
    await queueDialogs(app, { kind: 'confirm', choice: 'discard' }, { kind: 'open', path: null });
    await fileButton(page, '打开').click();
    await expectUnchangedDirty(desktop, snapshot);
    await queueDialogs(app, { kind: 'confirm', choice: 'discard' });
    await fileButton(page, '新建').click();
    await expect(page.getByLabel('画布统计')).toHaveText('0 人物0 关系');
    await expect(page.locator('.project-state')).not.toContainText('未保存');
    expect(await readdir(files)).toEqual([]);
  });
});

test('a future-version open keeps the dirty canvas and current save path; new saves then resets that path', async () => {
  await withDesktop(async (desktop) => {
    const { app, page, files } = desktop;
    const current = join(files, '当前项目.srn');
    await addPerson(page, '当前合成人物');
    await queueDialogs(app, { kind: 'save', path: current });
    await fileButton(page, '保存').click();
    const saved = await expectSaved(desktop, current, (project) => expect(project.people[0].name).toBe('当前合成人物'));
    const originalBytes = await readFile(current);
    const future = join(files, '未来版本.srn');
    const futureBytes = JSON.stringify({ ...saved, schemaVersion: saved.schemaVersion + 1, title: '绝不能替换当前画布' });
    await writeFile(future, futureBytes);
    await addPerson(page, '仍需保存人物');
    const snapshot = await canvasSnapshot(page);
    await queueDialogs(app, { kind: 'confirm', choice: 'discard' }, { kind: 'open', path: future });
    await fileButton(page, '打开').click();
    await expect(page.getByRole('alert')).toHaveText(/无法打开项目：.*更新版本.*不支持.*升级/u);
    await expectUnchangedDirty(desktop, snapshot);
    await expect(page.locator('.project-title')).toHaveAttribute('title', current);
    expect(await readFile(current)).toEqual(originalBytes);
    expect(await readFile(future, 'utf8')).toBe(futureBytes);
    await page.keyboard.press('Control+s');
    await expectSaved(desktop, current, (project) => expect(project.people.map((person) => person.name)).toEqual(['当前合成人物', '仍需保存人物']));
    expect(await readFile(`${current}.bak`)).toEqual(originalBytes);

    await queueDialogs(app, { kind: 'open', path: null });
    await fileButton(page, '打开').click();
    await expectDialogsConsumed(app);
    await expect(fileButton(page, '新建')).toBeEnabled();
    expect(await canvasSnapshot(page)).toEqual(snapshot);
    await addPerson(page, '切换前保存人物');
    await queueDialogs(app, { kind: 'confirm', choice: 'save' });
    await fileButton(page, '新建').click();
    await expect(page.getByLabel('画布统计')).toHaveText('0 人物0 关系');
    const beforeNew = await readFile(current);
    expect((await readProject(current)).people.at(-1)?.name).toBe('切换前保存人物');
    await expectDialogsConsumed(app);
    await addPerson(page, '全新项目人物');
    const fresh = join(files, '全新项目.srn');
    await queueDialogs(app, { kind: 'save', path: fresh });
    await fileButton(page, '保存').click();
    await expectSaved(desktop, fresh, (project) => {
      expect(project.id).not.toBe(saved.id);
      expect(project.people.map((person) => person.name)).toEqual(['全新项目人物']);
    });
    expect(await readFile(current)).toEqual(beforeNew);
    expect(await readFile(future, 'utf8')).toBe(futureBytes);
  });
});

test('normal window close is cancelled by 取消 or a cancelled save, and 不保存 closes without writing', async () => {
  await withDesktop(async (desktop) => {
    const { app, page, files } = desktop;
    await addPerson(page, '关闭前合成人物');
    const snapshot = await canvasSnapshot(page);
    await queueDialogs(app, { kind: 'confirm', choice: 'cancel' });
    await requestNormalClose(app);
    await expectUnchangedDirty(desktop, snapshot);
    await queueDialogs(app, { kind: 'confirm', choice: 'save' }, { kind: 'save', path: null });
    await requestNormalClose(app);
    await expectUnchangedDirty(desktop, snapshot);
    await expect(page.getByRole('alert')).toContainText('已取消保存');
    expect(await readdir(files)).toEqual([]);
    await queueDialogs(app, { kind: 'confirm', choice: 'discard' });
    await expectNormalClose(desktop);
    expect(await readdir(files)).toEqual([]);
  });
});

test('normal window close with 保存 writes the first real file before closing', async () => {
  await withDesktop(async (desktop) => {
    const { app, page, files } = desktop;
    const path = join(files, '关闭时保存.srn');
    const id = await addPerson(page, '保存后关闭人物');
    await queueDialogs(app, { kind: 'confirm', choice: 'save' }, { kind: 'save', path });
    await expectNormalClose(desktop);
    const saved = await readProject(path);
    expect(saved.people).toHaveLength(1);
    expect(saved.people[0]).toMatchObject({ id, name: '保存后关闭人物', photoAssetId: null });
    expect(await readdir(files)).toEqual(['关闭时保存.srn']);
  });
});

test('failed Save As refuses an existing invalid target without changing either file or the active save path', async () => {
  await withDesktop(async (desktop) => {
    const { app, page, files } = desktop;
    const current = join(files, '安全原项目.srn');
    const invalid = join(files, '已有非项目.srn');
    const invalidBytes = Buffer.from('synthetic unrelated contents\r\n{not valid JSON}\r\n', 'utf8');
    await writeFile(invalid, invalidBytes);
    await addPerson(page, '原项目人物');
    await queueDialogs(app, { kind: 'save', path: current });
    await fileButton(page, '保存').click();
    await expectSaved(desktop, current, (project) => expect(project.people).toHaveLength(1));
    const originalBytes = await readFile(current);
    await addPerson(page, '失败后保留人物');
    const snapshot = await canvasSnapshot(page);
    await queueDialogs(app, { kind: 'save', path: invalid });
    await fileButton(page, '另存为').click();
    await expect(page.getByRole('alert')).toHaveText(/无法保存项目：.*拒绝覆盖.*另存为/u);
    await expectUnchangedDirty(desktop, snapshot);
    expect(await readFile(invalid)).toEqual(invalidBytes);
    expect(await readFile(current)).toEqual(originalBytes);
    expect((await readdir(files)).sort()).toEqual(['安全原项目.srn', '已有非项目.srn'].sort());
    await page.keyboard.press('Control+s');
    await expectSaved(desktop, current, (project) => expect(project.people.map((person) => person.name)).toEqual(['原项目人物', '失败后保留人物']));
    expect(await readFile(`${current}.bak`)).toEqual(originalBytes);
    expect(await readFile(invalid)).toEqual(invalidBytes);
    // A clean close must not need any scripted confirmation.
    await expectNormalClose(desktop);
  });
});

test('Windows read-only replacement keeps the exact original, remains dirty and can be retried', async () => {
  test.skip(process.platform !== 'win32', 'Windows read-only attributes are needed; POSIX rename may replace a read-only file');
  await withDesktop(async (desktop) => {
    const { app, page, files } = desktop;
    const path = join(files, '只读原项目.srn');
    await addPerson(page, '只读前人物');
    await queueDialogs(app, { kind: 'save', path });
    await fileButton(page, '保存').click();
    await expectSaved(desktop, path, (project) => expect(project.people).toHaveLength(1));
    const originalBytes = await readFile(path);
    await addPerson(page, '内存中新增人物');
    const snapshot = await canvasSnapshot(page);
    try {
      // On Windows chmod(0444) sets the real FILE_ATTRIBUTE_READONLY bit.
      // No filesystem, IPC, preload or renderer implementation is mocked.
      await chmod(path, 0o444);
      await fileButton(page, '保存').click();
      await expect(page.getByRole('alert')).toHaveText(/无法保存项目：.*(?:访问权限|占用)/u);
      await expectUnchangedDirty(desktop, snapshot);
      expect(await readFile(path)).toEqual(originalBytes);
      expect(await readFile(`${path}.bak`)).toEqual(originalBytes);
      expect((await readdir(files)).sort()).toEqual(['只读原项目.srn', '只读原项目.srn.bak'].sort());
    } finally {
      await chmod(path, 0o666);
    }
    await page.keyboard.press('Control+s');
    await expectSaved(desktop, path, (project) => expect(project.people.map((person) => person.name)).toEqual(['只读前人物', '内存中新增人物']));
    expect(await readFile(`${path}.bak`)).toEqual(originalBytes);
    await expectNormalClose(desktop);
  });
});
