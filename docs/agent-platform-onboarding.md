# Подключение Agent Platform

Этот маршрут нужен для работы агента и дополнительных проверок документации.
Приложение устанавливается, запускается и проверяется из публичного checkout
по [локальному руководству](local-development.md) без Kit, RTK, Python или MCP.
Текущее состояние продукта находится в [плане разработки](implementation-plan.md),
результаты поставки — в [свидетельствах S8](evidence/cloud-deployment/README.md).

## Предпосылки и действующие операции

Для этого отдельного маршрута нужны Git, POSIX shell, Python 3 и SSH-доступ
к приватному GitLab-репозиторию `git@gitlab.com:pytkin/agent-platform.git`.
Для операций приложения нужны закреплённые Node/pnpm и установленные зависимости
(`pnpm install --frozen-lockfile`). Docker требуется при запуске локального демо
и DB/API/E2E, но не для статических проверок и сборки.

С доступом к Kit выполните из корня:

```sh
./bin/project setup
```

Команда получает закреплённый submodule и проверяет его состояние. Она не
устанавливает зависимости приложения. Без SSH-доступа этот шаг недоступен;
он не нужен получателю для запуска и проверки CRM.

Шесть операций из [binding](../agent-platform.json) выполняют:

| Операция | Фактическая команда и результат |
|---|---|
| `setup` | `./bin/project setup`: инициализация закреплённого Kit, проверка pin, чистоты и ссылки навыка |
| `dev` | `./bin/project dev`: `pnpm dev`; локальные API и `.env.local` готовятся по руководству разработки |
| `lint` | `./bin/project lint`: lint приложения и проверка локальных Markdown-ссылок через Kit |
| `test` | `./bin/project test`: `pnpm test`, тесты команд и компонентов |
| `build` | `./bin/project build`: `pnpm build`, типизация и сборка SPA |
| `verify` | `./bin/project verify`: Kit, ссылки, binding, SHA-256 исходного задания, Git whitespace и `pnpm verify` |

Сам wrapper не требует RTK. В агентском workspace префикс `rtk proxy`
задаётся [AGENTS.md](../AGENTS.md); человеческий запуск использует команды выше.
Правила и ссылки внутри Kit доступны только после его получения. Они остаются
отдельным агентским контекстом и не являются инструкцией установки приложения.

## Pin и история

Kit подключён как Git submodule `.agent-platform`. Текущую ревизию
определяет gitlink коммита проекта. Его значение можно прочитать из корня:

```sh
git rev-parse HEAD:.agent-platform
```

При первичном подключении S0 gitlink указывал на
`fe7e6a6ff14d1a49738f595abb771af942375a43`.
При изменении pin применяется маршрут Kit после его получения:
`.agent-platform/docs/agent-platform-kit.md`.

[Исторический отчёт подключения S0](https://github.com/pytkin/2b-studio-crm/blob/b627915d57297ca4ee5fbdc878c21b483295c1b7/docs/agent-platform-onboarding.md)
сохранён в Git. Он описывает прежний срез до реализации CRM;
[этап S0 в плане](implementation-plan.md#s0-kit-и-документы) сохраняет его результат.
