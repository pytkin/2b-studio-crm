import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { inspectArtifacts } from './artifact-secrets.mjs';

export default class SafeReporter {
  lines = [];
  screenshots = [];
  constructor() {
    try {
      const { accounts } = JSON.parse(readFileSync(process.env.CRM_E2E_ACCOUNTS, 'utf8'));
      this.passwords = accounts.map(({ password }) => password);
      if (!this.passwords.length || !this.passwords.every((p) => typeof p === 'string' && p)) throw Error();
    } catch {
      throw Error('Не удалось загрузить пароли для проверки отчёта.');
    }
  }

  printsToStdio() {
    return true;
  }

  record(message) {
    for (const password of this.passwords) message = message.replaceAll(password, '[скрыто]');
    if (inspectArtifacts([['диагностика', Buffer.from(message)]], this.passwords).length)
      message = 'Диагностика содержит закрытые значения.';
    this.lines.push(message);
    console.log(message);
  }

  onError(error) {
    this.record(error.message ?? 'Ошибка запуска Playwright.');
  }

  onTestEnd(test, result) {
    this.record(`${result.status} · ${test.parent.project()?.name} · ${relative(process.cwd(), test.location.file)}:${test.location.line} · ${test.title}`);
    for (const error of result.errors) this.onError(error);
    // Only screenshots explicitly attached by the project's snapshot helper are shared.
    for (const { name, contentType, body } of result.attachments) {
      const match = /^crm-snapshot-([a-z0-9-]+)$/.exec(name);
      if (match && contentType === 'image/png' && body)
        this.screenshots.push([`${this.screenshots.length + 1}-${match[1]}.png`, body]);
    }
  }

  onEnd(result) {
    let directory;
    try {
      this.record(`Playwright · ${result.status}`);
      const files = [...this.screenshots, ['report.txt', Buffer.from(this.lines.join('\n') + '\n')]];
      if (inspectArtifacts(files, this.passwords).length ||
          files.some(([name]) => this.passwords.some((p) => name.includes(p)))) throw Error();
      const destination = 'test-results';
      mkdirSync(destination, { recursive: true });
      if (!lstatSync(destination).isDirectory()) throw Error();
      directory = mkdtempSync(join(destination, 'run-'));
      for (const [name, body] of files) writeFileSync(join(directory, name), body, { flag: 'wx' });
      console.log(`Проверенный отчёт: ${directory}`);
    } catch {
      if (directory) rmSync(directory, { recursive: true, force: true });
      console.error('Не удалось проверить и сохранить отчёт Playwright.');
      return { status: 'failed' };
    }
  }
}
