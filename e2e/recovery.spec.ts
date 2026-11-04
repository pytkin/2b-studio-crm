import { expect, test, type Route } from '@playwright/test';
import { samples, rpc } from './fixtures';
import { actor, fixture, otherPage, signIn, snapshot } from './session';

test('E2E-03/04 · пустой список, ожидающий запрос, отказ чтения и ручной повтор', async ({
  page,
}, info) => {
  const { accounts } = fixture();
  await signIn(page, accounts[3]);
  await expect(page.getByRole('heading', { name: 'Мои задачи' })).toBeVisible();
  await expect(
    page.getByText(
      /нет назначенных задач|задач пока нет|пока нет задач|пока нет назначенных|пока не назнач/i,
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Создать задачу' })).toHaveCount(0);
  if (info.project.use.isMobile) {
    const header = await page.getByRole('complementary').boundingBox();
    expect(header?.height).toBeLessThan(150);
  }
  await snapshot(page, info, 'empty-executor');
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const match = '**/rest/v1/tasks?*';
  await page.route(match, async (route) => {
    await pending;
    await route.abort('failed');
  });
  await page.reload();
  await expect(page.getByText(/загружа|загрузк/i).first()).toBeVisible();
  release();
  const retry = page.getByRole('button', { name: /Повторить|Попробовать снова/ });
  await expect(retry).toBeVisible();
  await page.unroute(match);
  await retry.click();
  await expect(
    page.getByText(
      /нет назначенных задач|задач пока нет|пока нет задач|пока нет назначенных|пока не назнач/i,
    ),
  ).toBeVisible();
});

test('E2E-04 · конфликт сохраняет черновик, потерянный ответ проверяется чтением', async ({
  page,
}, info) => {
  const { accounts } = fixture();
  const { manager, object } = await samples(`${info.project.name} конфликт`, []);
  await signIn(page, accounts[0], `/objects/${object.id}`);
  await page.getByRole('button', { name: /Редактировать/ }).click();
  const dialog = page.getByRole('dialog');
  const address = dialog.getByLabel('Адрес');
  await address.fill('Мой незавершённый адрес');
  await rpc(manager, 'update_object', {
    p_id: object.id,
    p_expected_version: object.version,
    p_name: object.name,
    p_address: 'Изменение второй вкладки',
  });
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(address).toHaveValue('Мой незавершённый адрес');
  await expect(
    dialog.getByText(/изменил|изменен|изменён|конфликт|новая версия|устаре/i).first(),
  ).toBeVisible();
  await snapshot(page, info, 'conflict-draft');
  const match = '**/rest/v1/rpc/update_object';
  let writes = 0;
  await page.route(match, async (route) => {
    writes++;
    const actual = await route.fetch();
    expect(actual.ok()).toBe(true);
    // Commit in the real database, then lose the HTTP response to the browser.
    await route.abort('timedout');
  });
  await dialog.getByRole('button', { name: /Сохранить|Подтвердить|Применить/ }).click();
  await expect(page.getByText('Мой незавершённый адрес', { exact: true })).toBeVisible();
  expect(writes).toBe(1);
  const { data, error } = await manager
    .from('objects')
    .select('address,version')
    .eq('id', object.id)
    .single();
  expect(error).toBe(null);
  expect(data).toEqual({ address: 'Мой незавершённый адрес', version: object.version + 2 });
});

test('E2E-04 · истечение сессии очищает открытый черновик и защищённые данные', async ({
  page,
}, info) => {
  const { accounts } = fixture();
  const { object } = await samples(`${info.project.name} сеанс`, []);
  await signIn(page, accounts[0], `/objects/${object.id}`);
  await page.getByRole('button', { name: /Редактировать/ }).click();
  const secret = 'Закрытая заметка предыдущего сотрудника';
  await page.getByRole('dialog').getByLabel('Адрес').fill(secret);
  // Revoke only this real GoTrue session. Its 60s access token stays valid until
  // expiry; the browser SDK must discard it when refresh is refused.
  const token = await page.evaluate(() => {
    const storageKey = Object.keys(localStorage).find((key) => key.endsWith('-auth-token'));
    return storageKey ? JSON.parse(localStorage.getItem(storageKey) || '{}').access_token : null;
  });
  if (typeof token !== 'string') throw Error('Нет действующей тестовой сессии.');
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!key) throw Error('Нет публичного ключа test API.');
  const signedOut = await fetch('http://127.0.0.1:56421/auth/v1/logout?scope=local', {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${token}` },
  });
  expect(signedOut.ok).toBe(true);
  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible({
    timeout: 75_000,
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    await page
      .locator('input,textarea')
      .evaluateAll((fields) => fields.map((f) => (f as HTMLInputElement).value)),
  ).not.toContain(secret);
  await signIn(page, accounts[3]);
  await expect(page.getByText(object.name, { exact: true })).toHaveCount(0);
  expect(await page.locator('body').textContent()).not.toContain(secret);
});

test('E2E-04 · потери ответов на создание, переход и удаление не дублируют запись', async ({
  page,
  browser,
}, info) => {
  const { accounts, run } = fixture();
  const { manager, object } = await samples(`${info.project.name} потеря ответа`, []);
  const executor = await otherPage(browser, info);
  let transitions = 0;
  let created = 0;
  let deleted = 0;
  const loseAfterCommit = (increment: () => void) => async (route: Route) => {
    increment();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort('timedout');
  };
  try {
    await signIn(page, accounts[0], `/objects/${object.id}`);
    await page.getByRole('button', { name: 'Создать задачу' }).click();
    let dialog = page.getByRole('dialog');
    const title = `${run} · открепившаяся планка`;
    await dialog.getByLabel('Название').fill(title);
    await dialog.getByLabel('Исполнитель').selectOption({ label: accounts[1].name });
    await dialog.getByLabel('Комментарий к созданию').fill('Исходное событие');
    await page.route(
      '**/rest/v1/rpc/create_task',
      loseAfterCommit(() => created++),
    );
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    const taskUrl = new URL(page.url()).pathname;
    const id = taskUrl.split('/').at(-1);
    await signIn(executor, accounts[1], taskUrl);
    await executor.route(
      '**/rest/v1/rpc/transition_task',
      loseAfterCommit(() => transitions++),
    );
    await executor.getByRole('button', { name: 'Взять в работу' }).click();
    const history = executor.getByRole('list', { name: 'История статусов' }).getByRole('listitem');
    await expect(history).toHaveCount(2);
    await expect(history.last()).toContainText('В работе');
    await page.reload();
    await page.getByRole('button', { name: 'Удалить задачу', exact: true }).click();
    dialog = page.getByRole('dialog');
    await page.route(
      '**/rest/v1/rpc/delete_task',
      loseAfterCommit(() => deleted++),
    );
    await dialog.getByRole('button', { name: 'Удалить задачу' }).click();
    await expect(page.getByText(/запись недоступна|задача недоступна/i).first()).toBeVisible();
    await expect(page.getByText(/успешно удалена|задача удалена/i)).toHaveCount(0);
    expect([created, transitions, deleted]).toEqual([1, 1, 1]);
    const result = await manager.from('tasks').select('id').eq('id', id);
    expect(result.error).toBe(null);
    expect(result.data).toEqual([]);
  } finally {
    await executor.context().close();
  }
});

test('E2E-04 · зависший запрос создания завершается по таймауту, явный повтор использует тот же UUID', async ({
  page,
}, info) => {
  const { accounts, run } = fixture();
  await signIn(page, accounts[0]);
  await page.getByRole('button', { name: 'Создать объект' }).click();
  const dialog = page.getByRole('dialog');
  const name = `${run} ${info.project.name} · павильон`;
  await dialog.getByLabel('Название').fill(name);
  await dialog.getByLabel('Адрес').fill('Театральная улица, 4');
  const requests: Record<string, string>[] = [];
  let held: Route | undefined;
  await page.route('**/rest/v1/rpc/create_object', async (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) held = route;
    else await route.continue();
    // Only the application's real timer can release the form while the first route is held.
  });
  try {
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    const retry = dialog.getByRole('button', { name: 'Повторить создание' });
    await expect(retry).toBeEnabled({ timeout: 15_000 });
    expect(requests).toHaveLength(1);
    await expect(dialog.getByLabel('Название')).toHaveValue(name);
    await retry.click();
    await expect(page.getByRole('heading', { name })).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    const manager = await actor(accounts[0]);
    const { data, error } = await manager.from('objects').select('id').eq('name', name);
    expect(error).toBe(null);
    expect(data).toEqual([{ id: requests[0].p_id }]);
  } finally {
    await held?.abort().catch(() => {
      /* The browser may already have cancelled this route. */
    });
  }
});
