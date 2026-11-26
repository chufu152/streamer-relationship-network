import { test, expect } from '@playwright/test';

test('saving an older snapshot never clears newer edits or permits an unconfirmed close', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'desktop', { value: {
      getAppInfo: async () => ({ name: 'test', version: 'test', platform: 'win32' }),
      saveProject: () => new Promise((resolve) => window.addEventListener('finish-save', () => resolve({ status: 'ok', value: { path: 'C:\\test.srn' } }), { once: true })),
      confirmUnsaved: async () => 'cancel',
      openProject: async () => ({ status: 'cancelled' }), resetProject: async () => ({ status: 'ok', value: null }),
      approveClose: async () => { document.documentElement.setAttribute('data-closed', 'true'); },
      onCloseRequested: (callback: () => void) => { window.addEventListener('test-close', callback); return () => window.removeEventListener('test-close', callback); },
    } });
  });
  await page.goto('/');
  const input = page.getByRole('textbox', { name: '人物姓名', exact: true });
  await input.fill('已提交的快照'); await input.press('Enter');
  await page.locator('.save-button').click();
  await expect(page.locator('.save-button')).toBeDisabled();
  await input.fill('保存期间新增'); await input.press('Enter');
  await page.evaluate(() => window.dispatchEvent(new Event('finish-save')));
  await expect(page.locator('.project-state')).toHaveText('未保存');
  await expect(page.getByRole('alert')).toContainText('较新的未保存修改');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.getByLabel('画布统计')).toHaveText('2 人物0 关系');
  await page.evaluate(() => window.dispatchEvent(new Event('test-close')));
  await expect(page.locator('.save-button')).toBeEnabled();
  await expect(page.locator('html')).not.toHaveAttribute('data-closed');
});

test('a failed save keeps the graph and dirty status', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'desktop', { value: {
      getAppInfo: async () => ({ name: 'test', version: 'test', platform: 'win32' }),
      saveProject: async () => ({ status: 'error', message: '磁盘空间不足，请释放空间后重试' }),
      confirmUnsaved: async () => 'save', resetProject: async () => ({ status: 'ok', value: null }),
      onCloseRequested: () => () => {},
    } });
  });
  await page.goto('/');
  await page.getByRole('textbox', { name: '人物姓名', exact: true }).fill('不能丢失');
  await page.getByRole('button', { name: '添加人物' }).click();
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('alert')).toContainText('磁盘空间不足');
  await expect(page.locator('.project-state')).toHaveText('未保存');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.getByRole('button', { name: '人物 不能丢失', exact: true })).toBeVisible();
  await expect(page.locator('.project-state')).toHaveText('未保存');
});
