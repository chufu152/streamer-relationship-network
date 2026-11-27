import { test, expect } from '@playwright/test';

test('long-press moves a person and Escape cancels the preview', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: '人物姓名', exact: true }).fill('人物甲');
  await page.getByRole('button', { name: '添加人物' }).click();
  const node = page.getByRole('button', { name: '人物 人物甲', exact: true });
  const start = (await node.boundingBox())!;
  const x = start.x + start.width / 2; const y = start.y + start.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(350);
  await page.mouse.move(x + 100, y + 60, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => Math.round((await node.boundingBox())!.x - start.x)).toBe(100);
  const moved = (await node.boundingBox())!;
  await page.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2); await page.mouse.down(); await page.waitForTimeout(350);
  await page.mouse.move(x + 180, y + 90); await page.keyboard.press('Escape'); await page.mouse.up();
  await expect.poll(async () => Math.round((await node.boundingBox())!.x)).toBe(Math.round(moved.x));
});

test('zooms, pans, and fits while keeping the node usable', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: '人物姓名', exact: true }).fill('人物乙');
  await page.getByRole('button', { name: '添加人物' }).click();
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect(page.locator('.zoom-value')).toHaveText('120%');
  await page.getByRole('button', { name: '缩小', exact: true }).click();
  await expect(page.locator('.zoom-value')).toHaveText('100%');
  const node = page.getByRole('button', { name: '人物 人物乙', exact: true });
  const before = (await node.boundingBox())!;
  await page.mouse.move(100, 170); await page.mouse.wheel(0, 70);
  await expect.poll(async () => Math.round((await node.boundingBox())!.y - before.y)).toBe(-70);
  await page.getByRole('button', { name: '适应全部', exact: true }).click();
  await expect(node).toBeVisible();
  await page.getByRole('textbox', { name: '人物姓名', exact: true }).fill('含 空格');
  await expect(page.getByRole('textbox', { name: '人物姓名', exact: true })).toHaveValue('含 空格');
  await page.screenshot({ path: `.artifacts/m3-canvas-${testInfo.project.name}.png` });
});

test('arrow keys nudge the selected person, but not while typing in the name input', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: '人物姓名', exact: true });
  await input.fill('微调人物');
  await page.getByRole('button', { name: '添加人物' }).click();
  const node = page.getByRole('button', { name: '人物 微调人物', exact: true });
  await node.click();
  const start = (await node.boundingBox())!;
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Math.round((await node.boundingBox())!.x - start.x)).toBe(10);
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(async () => Math.round((await node.boundingBox())!.x - start.x)).toBe(9);
  await input.click();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  expect(Math.round((await node.boundingBox())!.x - start.x)).toBe(9);
});
