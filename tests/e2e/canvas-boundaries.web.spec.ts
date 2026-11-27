import { test, expect, type Locator, type Page } from '@playwright/test';

type Point = { x: number; y: number };
type Box = Point & { width: number; height: number };
type Footprint = { width: number; height: number; offsetX: number; offsetY: number };

async function bounds(locator: Locator): Promise<Box> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

function center(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function expectPosition(node: Locator, expected: Point) {
  await expect.poll(async () => {
    const actual = await bounds(node);
    return Math.max(Math.abs(actual.x - expected.x), Math.abs(actual.y - expected.y));
  }, { message: 'node screen position must match the expected position (within half a pixel)' })
    .toBeLessThanOrEqual(0.5);
}

async function blankPoint(page: Page, footprint?: Footprint): Promise<Point> {
  const surface = page.getByTestId('graph-surface');
  const box = await bounds(surface);
  // Hit-test candidates so neither a person nor an overlaid tool receives the press/drop.
  // When dropping a person, also keep its complete bounding box inside the surface.
  return surface.evaluate((element, { box, footprint }) => {
    for (const yRatio of [0.75, 0.25, 0.5, 0.875, 0.125]) {
      for (const xRatio of [0.75, 0.25, 0.5, 0.875, 0.125]) {
        const x = box.x + box.width * xRatio;
        const y = box.y + box.height * yRatio;
        if (footprint && (x - footprint.offsetX <= box.x || y - footprint.offsetY <= box.y
          || x + footprint.width - footprint.offsetX >= box.x + box.width
          || y + footprint.height - footprint.offsetY >= box.y + box.height)) continue;
        if (document.elementFromPoint(x, y) === element) return { x, y };
      }
    }
    throw new Error('No unobstructed canvas point fits the requested drop');
  }, { box, footprint });
}

async function addPerson(page: Page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '人物姓名', exact: true }).fill('边界人物');
  await page.getByRole('button', { name: '添加人物', exact: true }).click();
  const node = page.getByRole('button', { name: '人物 边界人物', exact: true });
  await expect(node).toBeVisible();
  // Record the browser's actual pointer id instead of assuming that a mouse always uses 1.
  await page.getByTestId('graph-surface').evaluate((element) => {
    element.addEventListener('pointerdown', (event) => {
      element.setAttribute('data-test-pointer-id', String((event as PointerEvent).pointerId));
    });
  });
  return node;
}

async function hasCapture(page: Page, pointerId: number) {
  return page.getByTestId('graph-surface').evaluate((element, id) => element.hasPointerCapture(id), pointerId);
}

async function longPress(page: Page, node: Locator) {
  const start = await bounds(node);
  // Deliberately grab off-center: snapping the node center to the pointer must fail.
  const offsetX = start.width * 0.65;
  const offsetY = start.height * 0.4;
  const grab = { x: start.x + offsetX, y: start.y + offsetY };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  const pointerId = Number(await page.getByTestId('graph-surface').getAttribute('data-test-pointer-id'));
  await expect.poll(() => hasCapture(page, pointerId), { intervals: [50] }).toBe(true);
  await expectPosition(node, start);
  return { start, grab, pointerId, footprint: { width: start.width, height: start.height, offsetX, offsetY } };
}

function droppedPosition(start: Point, grab: Point, drop: Point): Point {
  return { x: start.x + drop.x - grab.x, y: start.y + drop.y - grab.y };
}

async function previewOnBlank(page: Page, node: Locator) {
  const press = await longPress(page, node);
  const drop = await blankPoint(page, press.footprint);
  const expected = droppedPosition(press.start, press.grab, drop);
  await page.mouse.move(drop.x, drop.y, { steps: 6 });
  await expectPosition(node, expected);
  return { ...press, drop, expected };
}

test('a quick release neither moves the person nor leaves a delayed long-press; holding through early movement still drags', async ({ page }) => {
  const node = await addPerson(page);
  const start = await bounds(node);
  const grab = center(start);
  const drop = await blankPoint(page);
  // Freeze browser time so runner load cannot accidentally turn this into a 300 ms press.
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.clock.runFor(50);
  await page.mouse.move(drop.x, drop.y);
  await page.clock.runFor(50);
  await page.mouse.up();
  await expectPosition(node, start);
  await page.clock.runFor(400);
  await page.mouse.move(grab.x, grab.y);
  await page.clock.runFor(20);
  await expectPosition(node, start);

  // Early movement no longer cancels the hold (gesture decision, 2026-11-27): after the 300 ms hold
  // the drag activates with the original grab offset, and the release commits the move.
  await page.mouse.down();
  await page.clock.runFor(50);
  await page.mouse.move(drop.x, drop.y);
  await page.clock.runFor(400);
  const pointerId = Number(await page.getByTestId('graph-surface').getAttribute('data-test-pointer-id'));
  expect(await hasCapture(page, pointerId)).toBe(true);
  await expectPosition(node, droppedPosition(start, grab, drop));
  await page.mouse.up();
  await expectPosition(node, droppedPosition(start, grab, drop));
});

for (const zoom of [25, 200]) {
  test(`long-press preserves the screen drop and grab offset at ${zoom}% after panning`, async ({ page }) => {
    const node = await addPerson(page);
    const zoomButton = page.getByRole('button', { name: zoom === 25 ? '缩小' : '放大', exact: true });
    for (let attempts = 0; attempts < 20 && await zoomButton.isEnabled(); attempts++) await zoomButton.click();
    await expect(page.locator('.zoom-value')).toHaveText(`${zoom}%`);
    await expect(zoomButton).toBeDisabled();

    const surface = await bounds(page.getByTestId('graph-surface'));
    const beforePan = await bounds(node);
    const pan = { x: surface.width * 0.04, y: -surface.height * 0.06 };
    const blank = await blankPoint(page);
    await page.mouse.move(blank.x, blank.y);
    await page.mouse.wheel(-pan.x, -pan.y);
    await expectPosition(node, { x: beforePan.x + pan.x, y: beforePan.y + pan.y });
    const viewport = await page.locator('.graph-world').getAttribute('style');

    const { expected, pointerId } = await previewOnBlank(page, node);
    await page.mouse.up();
    await expectPosition(node, expected);
    expect(await hasCapture(page, pointerId)).toBe(false);
    await expect(page.locator('.graph-world')).toHaveAttribute('style', viewport!);
    await expect(page.locator('.zoom-value')).toHaveText(`${zoom}%`);
    // A subsequent press must start at the committed world position, not an old preview.
    const next = await longPress(page, node);
    await expectPosition(node, expected);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expectPosition(node, next.start);
  });
}

test('pointercancel restores a moved preview and permits a new drag', async ({ page }) => {
  const node = await addPerson(page);
  const { start, drop, pointerId } = await previewOnBlank(page, node);
  // A real mouse has no OS cancel command; dispatch cancel with its captured pointer id.
  await page.getByTestId('graph-surface').dispatchEvent('pointercancel', {
    pointerId, pointerType: 'mouse', isPrimary: true, clientX: drop.x, clientY: drop.y,
    button: -1, buttons: 0, bubbles: true,
  });
  await expectPosition(node, start);
  expect(await hasCapture(page, pointerId)).toBe(false);
  const blank = await blankPoint(page);
  await page.mouse.move(blank.x, blank.y);
  await page.mouse.up();
  await expectPosition(node, start);
  const next = await previewOnBlank(page, node);
  await page.mouse.up();
  await expectPosition(node, next.expected);
});

const toolAreas = [
  { name: 'top toolbar', locate: (page: Page) => page.locator('.toolbar') },
  { name: 'zoom controls', locate: (page: Page) => page.getByRole('group', { name: '画布视图' }) },
  { name: 'name input', locate: (page: Page) => page.getByRole('textbox', { name: '人物姓名', exact: true }) },
  { name: 'overlaid person tools', locate: (page: Page) => page.getByRole('button', { name: '编辑人物', exact: true }) },
];

for (const tool of toolAreas) {
  test(`releasing a long-press over ${tool.name} restores the original position`, async ({ page }) => {
    const node = await addPerson(page);
    const { start, pointerId } = await previewOnBlank(page, node);
    const release = center(await bounds(tool.locate(page)));
    await page.mouse.move(release.x, release.y, { steps: 6 });
    await page.mouse.up();
    await expectPosition(node, start);
    expect(await hasCapture(page, pointerId)).toBe(false);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.zoom-value')).toHaveText('100%');
    await page.mouse.move(center(start).x, center(start).y);
    await expectPosition(node, start);
  });
}

test('Space plus a blank drag pans, and releasing Space disables blank dragging', async ({ page }) => {
  const node = await addPerson(page);
  const surface = page.getByTestId('graph-surface');
  const surfaceBox = await bounds(surface);
  const blank = await blankPoint(page);
  await page.mouse.click(blank.x, blank.y);
  await expect(page.getByRole('textbox', { name: '人物姓名', exact: true })).not.toBeFocused();
  const start = await bounds(node);
  const delta = { x: surfaceBox.width * 0.08, y: surfaceBox.height * 0.08 };
  await page.keyboard.down('Space');
  await page.mouse.down();
  await expect(surface).toHaveClass(/is-panning/);
  await page.mouse.move(blank.x + delta.x, blank.y + delta.y, { steps: 6 });
  const expected = { x: start.x + delta.x, y: start.y + delta.y };
  await expectPosition(node, expected);
  await page.mouse.up();
  await page.keyboard.up('Space');
  await expect(surface).not.toHaveClass(/is-panning/);
  await expectPosition(node, expected);

  const nextBlank = await blankPoint(page);
  await page.mouse.move(nextBlank.x, nextBlank.y);
  await page.mouse.down();
  await page.mouse.move(nextBlank.x - delta.x, nextBlank.y - delta.y, { steps: 6 });
  await page.mouse.up();
  await expectPosition(node, expected);
});

test('Space typed in the name input does not arm canvas panning', async ({ page }) => {
  const node = await addPerson(page);
  const input = page.getByRole('textbox', { name: '人物姓名', exact: true });
  const surface = page.getByTestId('graph-surface');
  const surfaceBox = await bounds(surface);
  const start = await bounds(node);
  const viewport = await page.locator('.graph-world').getAttribute('style');
  await input.fill('含');
  await input.press('Space');
  await page.keyboard.insertText('空格');
  await expect(input).toHaveValue('含 空格');
  await expectPosition(node, start);

  const blank = await blankPoint(page);
  await page.keyboard.down('Space');
  await expect(input).toHaveValue('含 空格 ');
  await page.mouse.move(blank.x, blank.y);
  await page.mouse.down();
  await expect(surface).not.toHaveClass(/is-panning/);
  await page.mouse.move(blank.x + surfaceBox.width * 0.08, blank.y + surfaceBox.height * 0.08, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await expectPosition(node, start);
  await expect(page.locator('.graph-world')).toHaveAttribute('style', viewport!);
  await expect(surface).not.toHaveClass(/is-panning/);
  await expect(input).toHaveValue('含 空格 ');
});
