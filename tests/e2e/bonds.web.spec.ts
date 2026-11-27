import { test, expect } from '@playwright/test';

test('creates a bond, assigns people, edits it from the panel and cascades deletion', async ({ page }) => {
  await page.goto('/');
  for (const name of ['人物甲', '人物乙', '人物丙']) {
    await page.getByRole('textbox', { name: '人物姓名', exact: true }).fill(name);
    await page.getByRole('button', { name: '添加人物' }).click();
  }
  await page.getByRole('button', { name: '增加羁绊', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '羁绊' });
  await expect(dialog).toBeVisible();
  // An empty bond name is rejected with a visible reason, and the dialog stays open.
  await dialog.getByRole('button', { name: '新建羁绊', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('羁绊名');
  await dialog.getByLabel('羁绊名', { exact: true }).fill('家人');
  await dialog.getByRole('button', { name: '新建羁绊', exact: true }).click();
  const chip = page.locator('.bond-chip').first();
  await expect(chip).toContainText('家人');
  await expect(chip.locator('.bond-chip-count')).toHaveText('0');
  // Toggle two members inside the dialog; the panel count follows.
  await dialog.getByRole('button', { name: '人物甲', exact: true }).click();
  await dialog.getByRole('button', { name: '人物乙', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '人物甲', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(chip.locator('.bond-chip-count')).toHaveText('2');
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  // Reopen from the panel chip: members are shown and more can join.
  await chip.click();
  const reopened = page.getByRole('dialog', { name: '羁绊' });
  await expect(reopened.getByRole('button', { name: '人物甲', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(reopened.getByRole('button', { name: '人物丙', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await reopened.getByRole('button', { name: '人物丙', exact: true }).click();
  await expect(reopened.locator('.bond-current-count')).toHaveText('3 名成员');
  await reopened.getByRole('button', { name: '完成', exact: true }).click();
  // Deleting a person clears them from the bond.
  await page.getByRole('button', { name: '人物 人物乙', exact: true }).click({ button: 'right' });
  await page.getByRole('button', { name: '删除人物', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.locator('.bond-chip-count')).toHaveText('2');
  // Deleting the bond removes the chip and keeps the people.
  await chip.click();
  await page.getByRole('button', { name: '删除羁绊', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.locator('.bond-chip')).toHaveCount(0);
  await expect(page.getByLabel('画布统计')).toHaveText('2 人物0 关系');
  await expect(page.locator('.person-node')).toHaveCount(2);
});
