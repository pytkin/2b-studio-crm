import { expect, test } from '@playwright/test';
import { fixture, otherPage, signIn, snapshot } from './session';

test('E2E-01/03 · две роли проходят полный цикл, включая возврат и принятие', async ({
  page,
  browser,
}, info) => {
  const { accounts, run } = fixture();
  const executor = await otherPage(browser, info);
  try {
    await signIn(executor, accounts[1]);
    await expect(executor.getByRole('heading', { name: 'Мои задачи' })).toBeVisible();
    await signIn(page, accounts[0]);
    const create = page.getByRole('button', { name: 'Создать объект' });
    await create.focus();
    await page.keyboard.press('Enter');
    let dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(create).toBeFocused();
    await page.keyboard.press('Enter');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog.getByLabel('Название')).toHaveAttribute('aria-invalid', 'true');
    const object = `${run} ${info.project.name} · учебная мастерская`;
    await dialog.getByLabel('Название').fill(object);
    await dialog.getByLabel('Адрес').fill('Садовая улица, 14');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByRole('heading', { name: object })).toBeVisible();
    await page.getByRole('button', { name: 'Создать задачу' }).click();
    dialog = page.getByRole('dialog');
    const title = `Осмотреть мастерскую · ${info.project.name}`;
    await dialog.getByLabel('Название').fill(title);
    await dialog.getByLabel('Описание').fill('Проверить крепление полок.');
    await dialog.getByLabel('Исполнитель').selectOption({ label: accounts[1].name });
    await dialog.getByLabel('Комментарий к созданию').fill('До завершения отделочных работ');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    const url = new URL(page.url()).pathname;
    await executor.goto('/my-tasks');
    await executor.getByRole('link', { name: new RegExp(title) }).click();
    const history = (p: typeof page) =>
      p.getByRole('list', { name: 'История статусов' }).getByRole('listitem');
    const transition = async (p: typeof page, button: string, status: string, index: number) => {
      await p.getByRole('button', { name: button, exact: true }).click();
      await expect(history(p)).toHaveCount(index);
      await expect(history(p).last()).toContainText(status);
    };
    await transition(executor, 'Взять в работу', 'В работе', 2);
    await transition(executor, 'Отправить на проверку', 'На проверке', 3);
    await page.goto(url);
    await page.getByRole('button', { name: 'Вернуть на доработку', exact: true }).click();
    const reason = page.getByLabel('Причина возврата');
    await reason.fill('   ');
    await page.getByRole('dialog').getByRole('button', { name: 'Вернуть на доработку' }).click();
    await expect(reason).toBeVisible();
    await reason.fill('Измерить высоту верхней полки');
    await page.getByRole('dialog').getByRole('button', { name: 'Вернуть на доработку' }).click();
    await expect(history(page)).toHaveCount(4);
    await executor.reload();
    await expect(history(executor).last()).toContainText('Измерить высоту верхней полки');
    await transition(executor, 'Взять в работу', 'В работе', 5);
    await transition(executor, 'Отправить на проверку', 'На проверке', 6);
    await page.reload();
    await transition(page, 'Принять', 'Принята', 7);
    await snapshot(page, info, 'accepted-manager');
    const events = await history(page).allTextContents();
    await history(page).last().scrollIntoViewIfNeeded();
    await snapshot(page, info, 'accepted-history');
    await executor.reload();
    await expect(history(executor)).toHaveText(events);
    await expect(executor.getByRole('button', { name: 'Принять', exact: true })).toHaveCount(0);
    await snapshot(executor, info, 'accepted-executor');
    await executor.getByRole('button', { name: 'Выйти' }).click();
    await expect(executor.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible();
  } finally {
    await executor.context().close();
  }
});
