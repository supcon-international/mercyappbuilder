import { test, expect } from '@playwright/test';

const shouldSkipBackend = process.env.E2E_SKIP_BACKEND === '1';

test.describe('appbuilder e2e', () => {
  test('session create and basic chat input', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('new-session').click();
    await page.getByTestId('create-session-submit').click();

    const sessionItem = page.locator('[data-testid^="session-item-"]').first();
    await expect(sessionItem).toBeVisible();
    await sessionItem.click();

    const message = `e2e hello ${Date.now()}`;
    await page.getByTestId('chat-input').fill(message);
    await page.getByTestId('chat-send').click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
  });

  test('view panel and status page render', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('toggle-view').click();

    await expect(page.getByTestId('tab-preview')).toBeVisible();
    await page.getByTestId('tab-production').click();
    await expect(page.getByTestId('start-production')).toBeVisible();

    if (!shouldSkipBackend) {
      await page.getByTestId('tab-preview').click();
      await page.getByTestId('start-preview').click();
    }

    await page.goto('/status');
    await expect(page.getByTestId('status-page')).toBeVisible();
  });
});
