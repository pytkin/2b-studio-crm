import { expect, type Route, test } from '@playwright/test';
import { fixture, snapshot } from './session';

test('SC-01 · зависший вход завершается без автоматической отправки пароля и допускает повтор', async ({
  page,
}, info) => {
  const account = fixture().accounts[0];
  const endpoint = '**/auth/v1/token?grant_type=password';
  let first: Route | undefined;
  let attempts = 0;
  await page.route(endpoint, async (route) => {
    attempts += 1;
    if (attempts === 1) first = route;
    else await route.continue();
  });
  try {
    await page.goto('/login');
    await page.getByLabel('Электронная почта').fill(account.email);
    await page.getByLabel('Пароль', { exact: true }).fill(account.password);
    const submit = page.getByRole('button', { name: 'Войти', exact: true });
    await submit.click();
    await expect(page.getByRole('button', { name: 'Входим…' })).toBeDisabled();
    await snapshot(page, info, 'login-pending');
    await expect(page.getByRole('alert')).toContainText('Проверьте соединение', {
      timeout: 15_000,
    });
    expect(attempts).toBe(1);
    await expect(submit).toBeEnabled();
    await snapshot(page, info, 'login-timeout');
    await submit.click();
    await expect(page.getByRole('heading', { name: 'Объекты', exact: true })).toBeVisible();
    expect(attempts).toBe(2);
  } finally {
    await first?.abort().catch(() => undefined);
  }
});
