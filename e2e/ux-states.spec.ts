import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { samples } from './fixtures';
import { fixture, signIn, snapshot } from './session';

test('SC-01/02 · ошибки входа и неизвестные прямые ссылки не раскрывают данные', async ({
  page,
}, info) => {
  const account = fixture().accounts[0];
  await page.goto(`/tasks/${randomUUID()}`);
  const email = page.getByLabel('Электронная почта');
  const password = page.getByLabel('Пароль', { exact: true });
  const submit = page.getByRole('button', { name: 'Войти', exact: true });
  await submit.click();
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(password).toHaveAttribute('aria-invalid', 'true');
  await expect(email).toBeFocused();
  await snapshot(page, info, 'login-validation');
  await email.fill(account.email);
  await password.fill('Intentionally-wrong-password');
  await submit.click();
  await expect(page.getByRole('alert')).toHaveText('Проверьте электронную почту и пароль.');
  await snapshot(page, info, 'login-invalid-credentials');
  await password.fill(account.password);
  await submit.click();
  await expect(page.getByText('Запись недоступна', { exact: true })).toBeVisible();
  await snapshot(page, info, 'unknown-task');
  await page.goto(`/objects/${randomUUID()}`);
  await expect(page.getByText('Запись недоступна', { exact: true })).toBeVisible();
  await snapshot(page, info, 'unknown-object');
});

test('SC-01 · отказ проверки профиля в открытом диалоге сохраняет клавиатурный фокус', async ({
  page,
}, info) => {
  const { accounts } = fixture();
  const { object } = await samples(`${info.project.name} фокус проверки доступа`, []);
  await signIn(page, accounts[0], `/objects/${object.id}`);
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  const address = page.getByRole('dialog').getByLabel('Адрес');
  await address.fill('Незавершённый адрес');
  await expect(address).toBeFocused();
  const match = '**/rest/v1/profiles?*';
  await page.route(match, (route) => route.abort('failed'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const dialog = page.getByRole('dialog', { name: 'Проверка доступа', exact: true });
  await expect(dialog.getByRole('heading', { name: 'Не удалось проверить доступ' })).toBeVisible();
  const retry = dialog.getByRole('button', { name: 'Проверить снова' });
  await snapshot(page, info, 'profile-outage-dialog');
  await expect
    .soft(
      page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        id: document.activeElement?.id,
      })),
    )
    .resolves.toEqual({ tag: 'BUTTON', id: '' });
  await expect.soft(retry).toBeFocused();
  await page.keyboard.press('Tab');
  await expect.soft(dialog.getByRole('button', { name: 'Выйти', exact: true })).toBeFocused();
  await page.unroute(match);
  await retry.click();
  await expect(page.getByRole('dialog', { name: 'Редактировать объект' })).toBeVisible();
  await expect(address).toHaveValue('Незавершённый адрес');
  await snapshot(page, info, 'profile-restored-dialog');
  await expect
    .soft(
      page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        id: document.activeElement?.id,
      })),
    )
    .resolves.toEqual({ tag: 'INPUT', id: 'object-address' });
  await expect.soft(address).toBeFocused();
});

test('SC-05 · действия формы задачи видимы без прокрутки', async ({ page }, info) => {
  const { accounts } = fixture();
  const { object } = await samples(`${info.project.name} нижние действия формы`, []);
  await signIn(page, accounts[0], `/objects/${object.id}`);
  await page.getByRole('button', { name: 'Создать задачу', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const save = dialog.getByRole('button', { name: 'Сохранить', exact: true });
  await expect(save).toBeEnabled();
  const initialViewport = page.viewportSize();
  if (!initialViewport) throw Error('Для проверки формы нужен заданный viewport.');
  for (const height of info.project.use.isMobile ? [800, 500, 400] : [initialViewport.height]) {
    await page.setViewportSize({ width: initialViewport.width, height });
    await dialog.getByLabel('Название').focus();
    await dialog.evaluate((el) => {
      el.scrollTop = 0;
    });
    await snapshot(page, info, `task-form-actions-at-top-${height}`);
    const bounds = await save.boundingBox();
    if (!bounds) throw Error('Кнопка сохранения отсутствует в раскладке.');
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
    expect(
      await save.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
        );
      }),
    ).toBe(true);
    const comment = dialog.getByLabel('Комментарий к созданию');
    await comment.fill('Нижнее поле остаётся доступным.');
    const fieldBounds = await comment.boundingBox();
    const actionsBounds = await dialog.locator('.form-actions').boundingBox();
    if (!fieldBounds || !actionsBounds)
      throw Error('Нижнее поле или действия отсутствуют в раскладке.');
    await snapshot(page, info, `task-form-last-field-${height}`);
    expect(
      fieldBounds.y + fieldBounds.height,
      `textarea is above footer at height ${height}`,
    ).toBeLessThanOrEqual(actionsBounds.y);
    const hintBounds = await dialog.locator('#task-comment-hint').boundingBox();
    if (!hintBounds) throw Error('Подсказка ограничения комментария отсутствует в раскладке.');
    expect(
      hintBounds.y + hintBounds.height,
      `field hint is above footer at height ${height}`,
    ).toBeLessThanOrEqual(actionsBounds.y);
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(save).toBeFocused();
  }
});

test('SC-01 · загрузка, ошибка и недоступный профиль допускают явную проверку', async ({
  page,
}, info) => {
  const account = fixture().accounts[0];
  const match = '**/rest/v1/profiles?*';
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(match, async (route) => {
    await pending;
    await route.abort('failed');
  });
  try {
    await page.goto('/login');
    await page.getByLabel('Электронная почта').fill(account.email);
    await page.getByLabel('Пароль', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Проверяем доступ');
    await snapshot(page, info, 'profile-loading');
    release();
    await expect(page.getByRole('heading', { name: 'Не удалось проверить доступ' })).toBeVisible();
    await snapshot(page, info, 'profile-read-error');
    await page.unroute(match);
    await page.route(match, (route) =>
      route.fulfill({ contentType: 'application/json', body: '[]' }),
    );
    await page.getByRole('button', { name: 'Проверить снова' }).click();
    await expect(page.getByRole('heading', { name: 'Профиль недоступен' })).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await snapshot(page, info, 'profile-unavailable');
    await page.unroute(match);
    await page.getByRole('button', { name: 'Проверить снова' }).click();
    await expect(page.getByRole('heading', { name: 'Объекты', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible();
  } finally {
    release();
  }
});

test('SC-05 · ожидание, отказ и пустой справочник сохраняют форму задачи', async ({
  page,
}, info) => {
  const { accounts } = fixture();
  const { object } = await samples(`${info.project.name} справочник`, []);
  await signIn(page, accounts[0], `/objects/${object.id}`);
  const match = '**/rest/v1/profiles?*';
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const isDirectory = (url: string) => new URL(url).searchParams.get('role') === 'eq.executor';
  await page.route(match, async (route) => {
    if (!isDirectory(route.request().url())) return route.continue();
    await pending;
    await route.abort('failed');
  });
  try {
    await page.getByRole('button', { name: 'Создать задачу', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Название').fill('Черновик при сбое справочника');
    const save = dialog.getByRole('button', { name: 'Сохранить', exact: true });
    await expect(dialog.getByRole('status')).toContainText('Загружаем объекты и исполнителей');
    await expect(save).toBeDisabled();
    await snapshot(page, info, 'task-choices-loading');
    release();
    await expect(dialog.getByRole('alert')).toContainText(
      'Не удалось загрузить объекты и исполнителей',
    );
    await expect(save).toBeDisabled();
    await snapshot(page, info, 'task-choices-read-error');
    await page.unroute(match);
    await page.route(match, (route) =>
      isDirectory(route.request().url())
        ? route.fulfill({ contentType: 'application/json', body: '[]' })
        : route.continue(),
    );
    await dialog.getByRole('button', { name: 'Повторить чтение' }).click();
    await expect(dialog.getByRole('status')).toContainText('Нет доступных исполнителей');
    await expect(save).toBeDisabled();
    await expect(dialog.getByLabel('Название')).toHaveValue('Черновик при сбое справочника');
    await snapshot(page, info, 'task-choices-empty');
    await page.unroute(match);
    await dialog.getByRole('button', { name: 'Обновить список' }).click();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(dialog.getByText('Выберите исполнителя', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Исполнитель')).toBeFocused();
    await snapshot(page, info, 'task-assignee-validation');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Создать задачу', exact: true })).toBeFocused();
  } finally {
    release();
  }
});
