import { test, expect, type Page } from '@playwright/test';

async function dragOnto(page: Page, from: string, to: string) {
  const a = (await page.getByRole('button', { name: `人物 ${from}`, exact: true }).boundingBox())!;
  const b = (await page.getByRole('button', { name: `人物 ${to}`, exact: true }).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down(); await page.waitForTimeout(350);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 }); await page.mouse.up();
}

test('connects by dragging, restores source, edits directions, and deduplicates', async ({ page }, testInfo) => {
  await page.goto('/');
  for (const name of ['人物甲', '人物乙']) {
    await page.getByRole('textbox', { name: '人物姓名', exact: true }).fill(name);
    await page.getByRole('button', { name: '添加人物' }).click();
  }
  const original = await page.getByRole('button', { name: '人物 人物甲', exact: true }).boundingBox();
  await dragOnto(page, '人物甲', '人物乙');
  await expect(page.getByLabel('画布统计')).toHaveText('2 人物1 关系');
  expect(await page.getByRole('button', { name: '人物 人物甲', exact: true }).boundingBox()).toEqual(original);
  const edge = page.locator('[data-relationship-id]');
  await edge.dispatchEvent('contextmenu');
  await page.getByLabel('A → B', { exact: true }).check();
  await page.getByLabel('关系名称', { exact: true }).fill('同事');
  await page.getByRole('dialog', { name: '编辑关系' }).getByRole('button', { name: '保存', exact: true }).click();
  await expect(edge).toHaveAccessibleName('关系 人物甲 → 人物乙：同事');
  await expect(edge.locator('path').first()).toHaveAttribute('marker-end', 'url(#arrow-end)');
  await expect(edge.locator('path').first()).not.toHaveAttribute('marker-start');
  await dragOnto(page, '人物乙', '人物甲');
  await expect(page.getByRole('dialog', { name: '编辑关系' })).toBeVisible();
  await page.getByLabel('A ← B', { exact: true }).check();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(edge).toHaveAccessibleName('关系 人物甲 → 人物乙：同事');
  await expect(page.getByLabel('画布统计')).toHaveText('2 人物1 关系');
  await edge.dispatchEvent('contextmenu');
  await page.getByLabel('A ← B', { exact: true }).check();
  await page.getByRole('dialog', { name: '编辑关系' }).getByRole('button', { name: '保存', exact: true }).click();
  await expect(edge).toHaveAccessibleName('关系 人物甲 ← 人物乙：同事');
  await page.screenshot({ path: `.artifacts/m4-relationships-${testInfo.project.name}.png` });
  await edge.focus(); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '删除关系', exact: true }).click();
  await page.getByRole('button', { name: '确认删除关系', exact: true }).click();
  await expect(page.getByLabel('画布统计')).toHaveText('2 人物0 关系');
});

test('connects through the person editor and cascades deletion', async ({ page }) => {
  await page.goto('/');
  for (const name of ['重名', '重名']) {
    await page.getByRole('textbox', { name: '人物姓名', exact: true }).fill(name); await page.getByRole('button', { name: '添加人物' }).click();
  }
  await page.getByRole('button', { name: '人物 重名', exact: true }).first().click({ button: 'right' });
  await page.getByLabel('连接到人物').selectOption({ index: 1 });
  await page.getByRole('button', { name: '创建关系', exact: true }).click();
  await expect(page.getByLabel('画布统计')).toHaveText('2 人物1 关系');
  await page.getByRole('button', { name: '人物 重名', exact: true }).first().click({ button: 'right' });
  await page.getByRole('button', { name: '删除人物', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByLabel('画布统计')).toHaveText('1 人物0 关系');
});
