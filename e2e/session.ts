import { readFileSync } from 'node:fs';
import { type Browser, type Page, type TestInfo, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

interface Account {
  id: string;
  email: string;
  password: string;
  name: string;
}
export function fixture(): { accounts: Account[]; run: string } {
  const file = process.env.CRM_E2E_ACCOUNTS;
  if (!file) throw Error('Запустите через pnpm test:e2e.');
  return JSON.parse(readFileSync(file, 'utf8'));
}
export async function signIn(page: Page, account: Account, path = '/') {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible();
  await page.getByLabel('Электронная почта').fill(account.email);
  await page.getByLabel('Пароль', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
}
export async function otherPage(browser: Browser, info: TestInfo) {
  const { viewport, isMobile, hasTouch } = info.project.use;
  return browser.newPage({
    baseURL: 'http://127.0.0.1:5174',
    viewport,
    isMobile,
    hasTouch,
    locale: 'ru-RU',
  });
}
const clients = new Map<string, SupabaseClient>();
export async function actor(account: Account) {
  const existing = clients.get(account.id);
  if (existing) return existing;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!key) throw Error('Тестовая конфигурация отсутствует.');
  const client = createClient('http://127.0.0.1:56421', key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });
  if (error) throw Error('Не удалось открыть сессию тестового пользователя.');
  clients.set(account.id, client);
  return client;
}
export async function snapshot(page: Page, info: TestInfo, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await info.attach(`crm-snapshot-${name}`, {
    body: await page.screenshot({ path: info.outputPath(`${name}.png`) }),
    contentType: 'image/png',
  });
}
