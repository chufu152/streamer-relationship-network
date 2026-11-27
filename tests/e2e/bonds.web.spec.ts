import { test, expect } from '@playwright/test';

test('creates a bond, gathers members on canvas, renames, recolours and cascades deletion', async ({ page }) => {
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
  await expect(page.locator('.bond-regions rect')).toHaveCount(0);
  // Toggle two members inside the dialog: they gather into one row inside a dashed bond region.
  await dialog.getByRole('button', { name: '人物甲', exact: true }).click();
  await dialog.getByRole('button', { name: '人物乙', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '人物甲', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(chip.locator('.bond-chip-count')).toHaveText('2');
  const boxA = (await page.getByRole('button', { name: '人物 人物甲', exact: true }).boundingBox())!;
  const boxB = (await page.getByRole('button', { name: '人物 人物乙', exact: true }).boundingBox())!;
  expect(Math.abs(boxA.y - boxB.y)).toBeLessThan(1.5);
  expect(Math.abs((boxB.x - boxA.x) - 150)).toBeLessThan(1.5);
  await expect(page.locator('.bond-regions rect')).toHaveCount(1);
  await expect(page.locator('.bond-regions rect')).toHaveAttribute('stroke', '#293e50');
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  // Reopen from the chip: pure edit mode (no create), rename and recolour the current bond.
  await chip.click();
  const reopened = page.getByRole('dialog', { name: '羁绊' });
  await expect(reopened.getByRole('button', { name: '新建羁绊' })).toHaveCount(0);
  await expect(reopened.getByLabel('羁绊名', { exact: true })).toHaveValue('家人');
  await reopened.getByLabel('羁绊名', { exact: true }).fill('亲友');
  await reopened.getByRole('button', { name: '修改名称', exact: true }).click();
  await expect(chip).toContainText('亲友');
  await reopened.locator('.bond-color').nth(1).click();
  await expect(page.locator('.bond-regions rect')).toHaveAttribute('stroke', '#b03a2e');
  await expect(chip).toHaveCSS('border-left-color', 'rgb(176, 58, 46)');
  await reopened.getByRole('button', { name: '人物丙', exact: true }).click();
  await expect(reopened.locator('.bond-current-count')).toHaveText('3 名成员');
  await reopened.getByRole('button', { name: '完成', exact: true }).click();
  // Deleting a person clears them from the bond; deleting the bond removes the chip and keeps people.
  await page.getByRole('button', { name: '人物 人物乙', exact: true }).click({ button: 'right' });
  await page.getByRole('button', { name: '删除人物', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.locator('.bond-chip-count')).toHaveText('2');
  await chip.click();
  await page.getByRole('button', { name: '删除羁绊', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.locator('.bond-chip')).toHaveCount(0);
  await expect(page.getByLabel('画布统计')).toHaveText('2 人物0 关系');
  await expect(page.locator('.person-node')).toHaveCount(2);
});
