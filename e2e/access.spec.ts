import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { rpc, samples } from './fixtures';
import { actor, fixture, otherPage, signIn, snapshot } from './session';

test('E2E-02a · смешанный объект, редактирование, отмена и подтверждение каскада', async ({
  page,
  browser,
}, info) => {
  const { accounts, run } = fixture();
  const manager = await actor(accounts[0]);
  const first = await actor(accounts[1]);
  const executor = await otherPage(browser, info);
  try {
    const object = { name: `${run} ${info.project.name} · новый цех` };
    await signIn(page, accounts[0]);
    await page.getByRole('button', { name: 'Создать объект' }).click();
    const creation = page.getByRole('dialog');
    await creation.getByLabel('Название').fill(object.name);
    await creation.getByLabel('Адрес').fill('Лесная улица, 1');
    await creation.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByRole('heading', { name: object.name })).toBeVisible();
    const url = new URL(page.url()).pathname;
    const id = url.split('/').at(-1);
    const rows = [];
    for (const i of [1, 2]) {
      const result = await rpc(manager, 'create_task', {
        p_id: randomUUID(),
        p_title: `Осмотр участка ${i}`,
        p_object_id: id,
        p_assignee_id: accounts[i].id,
        p_description: 'Проверить крепления',
        p_comment: null,
      });
      rows.push(result.task);
    }
    await page.reload();
    await signIn(executor, accounts[1], '/objects');
    const restricted = executor.locator(`a[href="${url}"]`);
    await expect(restricted).toContainText(object.name);
    await expect(restricted).toContainText(/1 задача/);
    await restricted.click();
    await expect(executor.getByRole('link', { name: new RegExp(rows[0].title) })).toBeVisible();
    await expect(executor.getByText(rows[1].title, { exact: true })).toHaveCount(0);
    await expect(executor.getByRole('button', { name: 'Редактировать' })).toHaveCount(0);
    await snapshot(executor, info, 'restricted-object');
    await snapshot(page, info, 'mixed-object');
    await page.getByRole('button', { name: /Редактировать/ }).click();
    const dialog = page.getByRole('dialog');
    const changed = `${run} · изменённая мастерская`;
    await dialog.getByLabel('Название').fill(changed);
    await dialog.getByLabel('Адрес').fill('Лесная улица, 32');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByRole('heading', { name: changed })).toBeVisible();
    const remove = page.getByRole('button', { name: 'Удалить объект', exact: true });
    await remove.click();
    await expect(dialog).toContainText(changed);
    await dialog.getByRole('button', { name: /Отмен/ }).click();
    await expect(remove).toBeFocused();
    await expect(page.getByRole('link', { name: new RegExp(rows[1].title) })).toBeVisible();
    await remove.click();
    await dialog.getByRole('button', { name: 'Удалить объект' }).click();
    await expect(page.getByRole('heading', { name: 'Объекты', exact: true })).toBeFocused();
    await expect(page.getByText(changed, { exact: true })).toHaveCount(0);
    for (const p of [executor, page]) {
      await p.goto(url);
      await expect(p.getByText('Запись недоступна', { exact: true })).toBeVisible();
      await p.goto('/objects');
      await expect(p.locator(`a[href="${url}"]`)).toHaveCount(0);
    }
    for (const client of [manager, first]) {
      const after = await client
        .from('tasks')
        .select('id')
        .in(
          'id',
          rows.map((t) => t.id),
        );
      expect(after.error).toBe(null);
      expect(after.data).toEqual([]);
    }
  } finally {
    await executor.context().close();
  }
});

test('E2E-02b · правка в пяти статусах, передача принятой задачи и удаление', async ({
  page,
  browser,
}, info) => {
  const { accounts } = fixture();
  const { rows, destination } = await samples(`${info.project.name} правки`, [
    'new',
    'in_progress',
    'in_review',
    'rework',
    'accepted',
  ]);
  const old = await otherPage(browser, info);
  const next = await otherPage(browser, info);
  try {
    const accepted = rows[4];
    const url = `/tasks/${accepted.id}`;
    await signIn(old, accounts[1], '/my-tasks');
    await old.getByRole('link', { name: new RegExp(accepted.title) }).click();
    const events = old.getByRole('list', { name: 'История статусов' }).getByRole('listitem');
    await expect(events).toHaveCount(4);
    const history = await events.allTextContents();
    await signIn(page, accounts[0]);
    for (const row of rows) {
      await page.goto(`/tasks/${row.id}`);
      await page.getByRole('button', { name: /Редактировать/ }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Описание').fill('Проверено после осмотра.');
      if (row.id === accepted.id) {
        await dialog.getByLabel('Исполнитель').selectOption({ label: accounts[2].name });
        await dialog.getByLabel('Объект').selectOption({ label: destination.name });
      }
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText('Проверено после осмотра.', { exact: true })).toBeVisible();
    }
    await old.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(old.getByText('Запись недоступна', { exact: true })).toBeVisible();
    await expect(old.getByText(accepted.title, { exact: true })).toHaveCount(0);
    await old.goto('/my-tasks');
    await expect(old.getByRole('link', { name: new RegExp(accepted.title) })).toHaveCount(0);
    await signIn(next, accounts[2], '/my-tasks');
    await next.getByRole('link', { name: new RegExp(accepted.title) }).click();
    await expect(
      next.getByRole('list', { name: 'История статусов' }).getByRole('listitem'),
    ).toHaveText(history);
    await snapshot(next, info, 'transferred-accepted-task');
    await page.getByRole('button', { name: 'Удалить задачу', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(accepted.title);
    await dialog.getByRole('button', { name: 'Удалить задачу' }).click();
    await expect(dialog).toHaveCount(0);
    for (const p of [page, next]) {
      await p.goto(url);
      await expect(p.getByText('Запись недоступна', { exact: true })).toBeVisible();
    }
  } finally {
    await old.context().close();
    await next.context().close();
  }
});
