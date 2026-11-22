import { test, expect } from '@playwright/test';

test('renders a white workspace with visible toolbars', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page).toHaveTitle('人物交际网');
  await expect(page.getByRole('main')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.getByRole('heading', { name: '从第一个人物开始' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('浏览器预览');
  for (const name of ['新建', '打开', '另存为', '保存', '添加人物', '缩小', '放大', '适应全部']) {
    const button = page.getByRole('button', { name, exact: name !== '保存' });
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.artifacts/m1-${testInfo.project.name}.png` });
  expect(errors).toEqual([]);
});

test('input can be focused but Enter does not fake adding or saving', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: '人物姓名' });
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
  await input.fill('测试人物');
  await input.press('Enter');
  await expect(input).toHaveValue('测试人物');
  await expect(page.getByLabel('画布统计')).toHaveText('0 人物0 关系');
  await expect(page.getByText('M1 工程预览 · 尚未开放编辑与保存')).toBeVisible();
  expect(await page.evaluate(() => typeof window.desktop)).toBe('undefined');
});
