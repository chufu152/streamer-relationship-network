import { test, expect } from '@playwright/test';

test('renames, imports and removes photos, and confirms deletion', async ({ page }, testInfo) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: '人物姓名', exact: true });
  await input.fill('人物甲'); await input.press('Enter');
  await page.getByRole('button', { name: '人物 人物甲', exact: true }).click({ button: 'right' });
  await page.getByLabel('人物姓名', { exact: true }).last().fill('人物乙');
  await page.getByRole('button', { name: '应用姓名' }).click();
  const person = page.getByRole('button', { name: '人物 人物乙', exact: true });
  await expect(person).toBeVisible();
  await person.click({ button: 'right' });
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 60;
    const context = canvas.getContext('2d')!; context.fillStyle = '#456078'; context.fillRect(0, 0, 80, 60);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('选择人物照片').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.getByRole('button', { name: '移除照片' })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(person.locator('img')).toBeVisible();
  await expect(person.locator('img')).toHaveCSS('border-radius', '50%');
  await page.screenshot({ path: `.artifacts/m2-photo-${testInfo.project.name}.png` });
  await person.click({ button: 'right' });
  await page.getByLabel('选择人物照片').setInputFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(page.locator('.dialog-message')).not.toHaveText('正在处理照片…');
  await expect(page.getByRole('button', { name: '移除照片' })).toBeVisible();
  await page.getByRole('button', { name: '移除照片' }).click();
  await page.getByRole('button', { name: '删除人物', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByLabel('画布统计')).toHaveText('0 人物0 关系');
});

test('composition Enter does not create a person', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: '人物姓名', exact: true });
  await input.fill('中文');
  await input.dispatchEvent('compositionstart');
  await input.press('Enter');
  await expect(page.getByLabel('画布统计')).toHaveText('0 人物0 关系');
  await input.dispatchEvent('compositionend');
  await input.press('Enter');
  await expect(page.getByLabel('画布统计')).toHaveText('1 人物0 关系');
});
