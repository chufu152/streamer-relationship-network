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
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.artifacts/shell-${testInfo.project.name}.png` });
  expect(errors).toEqual([]);
});

test('adds people with Enter and keeps duplicate names independent', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: '人物姓名', exact: true });
  await input.fill(' 测试人物 ');
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(page.getByLabel('画布统计')).toHaveText('1 人物0 关系');
  await input.fill('测试人物');
  await page.getByRole('button', { name: '添加人物' }).click();
  await expect(page.getByRole('button', { name: '人物 测试人物', exact: true })).toHaveCount(2);
  await input.fill('  '); await input.press('Enter');
  await expect(page.getByRole('alert')).toContainText('姓名不能为空');
  await expect(page.getByLabel('画布统计')).toHaveText('2 人物0 关系');
});
