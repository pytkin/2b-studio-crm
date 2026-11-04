# Мини CRM Объекты и задачи

SPA для строительной компании: постановщик управляет объектами и задачами,
исполнитель выполняет назначенные задачи, постановщик принимает результат или
возвращает его на доработку.

Текущий результат — Agent Platform Kit, документация и локальная среда S1-01:
один пакет с закреплёнными инструментами и два изолированных Docker Supabase.
Код SPA, бизнес-схема, миграции CRM и облачное демо ещё не созданы.
Статус и свидетельства находятся в [плане разработки](docs/implementation-plan.md).

## Начать работу

- [Карта документов и их владельцы](docs/README.md).
- [Требования и терминология](docs/business-requirements.md).
- [Пользовательские сценарии](docs/scenarios.md).
- [Архитектура и безопасность](docs/technical-specification.md).
- [Матрица приёмки](docs/acceptance-plan.md).
- [Принятые решения и допущения](docs/decisions.md).
- [Подключение Kit и свидетельства текущего этапа](docs/agent-platform-onboarding.md).
- [Исходное задание](docs/source/README.md).
- [Точка входа для агента](AGENTS.md).

## Предпосылки текущего этапа

Нужны Git, SSH-доступ к приватному Kit в GitLab, Python 3.9+, POSIX shell и
`rtk`. Все команды ниже запускаются из корня проекта. Launcher не устанавливает
глобальные инструменты и не подключается к облачной базе.

При получении репозитория инициализируйте зафиксированный submodule:

```sh
rtk proxy ./bin/project setup
rtk proxy ./bin/project verify
```

Доступ к Kit нужен для агентских маршрутов и текущих проверок документации.
При отсутствии SSH-доступа `setup` завершится ошибкой. Не заменяйте Kit ссылкой
на соседний checkout. Инструкции восстановления и источник pin описаны в
[таблице подключения](docs/agent-platform-onboarding.md).

## Команды

| Команда | Реальный результат сейчас |
|---|---|
| `rtk proxy ./bin/project setup` | Получить submodule по gitlink и проверить его доступность, чистоту и навык ревью |
| `rtk proxy ./bin/project lint` | Проверить ссылки локальных Markdown-документов и инструкций |
| `rtk proxy ./bin/project verify` | Дополнительно проверить binding, контрольную сумму исходника и Git whitespace |
| `rtk proxy ./bin/project help` | Показать справку |

`dev`, `test` и `build` объявлены неприменимыми в [binding](agent-platform.json).
При прямом вызове launcher возвращает код 2 и объяснение. Успех `verify`
подтверждает только текущую поверхность Kit и документов.

## Локальная среда

Версии закреплены в [package.json](package.json), [.nvmrc](.nvmrc) и
[lockfile](pnpm-lock.yaml): Node **26.12.1**, pnpm **12.15.0**, Supabase CLI
**3.0.0**. CLI устанавливается в пакет; глобальный Supabase не нужен.
Сначала переключите текущую оболочку на Node из `.nvmrc` (например, через
`nvm install` и `nvm use`) и установите указанную версию pnpm.
`.npmrc` отклоняет неподходящую версию Node/pnpm. Нужны доступ в интернет
для пакетов и первых Docker-образов и работающий Docker Engine. Проверенная
машина: macOS arm64, Docker Desktop/Engine 29.9.2, 4 CPU, около 6 ГБ RAM
у Docker. Глобальные настройки Docker проект не меняет.

Из чистого clone, без инициализации приватного Kit:

```sh
rtk proxy node --version
rtk proxy pnpm --version
rtk proxy docker info --format '{{.ServerVersion}}'
rtk proxy pnpm install --frozen-lockfile
rtk proxy pnpm exec supabase --version
rtk proxy pnpm test:infra
rtk proxy pnpm db:dev start
rtk proxy pnpm db:test start
```

Используется обычный Docker `start` из закреплённого CLI; экспериментальный
`stack` отключён в конфигурации и команде запуска. Версии образов задаёт CLI.

| Среда | CLI workdir / конфигурация | project_id | API / PostgreSQL | Shadow DB |
|---|---|---|---|---|
| Разработка | корень / [supabase/config.toml](supabase/config.toml) | `2b-studio-crm-dev` | `127.0.0.1:56321` / `127.0.0.1:56322` | `56320` |
| Тесты | `local/test` / [local/test/supabase/config.toml](local/test/supabase/config.toml) | `2b-studio-crm-test` | `127.0.0.1:56421` / `127.0.0.1:56422` | `56420` |

Обе среды запускаются одновременно. Их контейнеры и данные разделены по
project ID; тестовые команды используют фиксированный workdir. Одна среда
с тем же project ID общая для checkout этого проекта: перед переключением
checkout остановите соответствующую среду. Не запускайте параллельные тесты
на одном test ID. Запущены PostgreSQL 17, Auth,
REST API и шлюз. Studio, почта, Storage, Realtime, Edge Functions, аналитика
и pooler отключены: они не нужны текущему объёму. Бизнес-таблиц, миграций
и seed пока нет. В S2 тестовая конфигурация должна использовать те же
миграции, что и разработка; отдельная копия бизнес-схемы не создаётся.

Проверки и управление:

```sh
rtk proxy pnpm db:dev status
rtk proxy pnpm db:test status
rtk proxy curl --fail --silent --show-error http://127.0.0.1:56321/auth/v1/health
rtk proxy curl --fail --silent --show-error http://127.0.0.1:56421/auth/v1/health
rtk proxy pnpm db:test reset
rtk proxy pnpm db:test stop
rtk proxy pnpm db:dev stop
```

Health должен вернуть HTTP 200, имя GoTrue и версию. `status` подтверждает
состояние контейнеров по CLI; здоровье Auth проверяется отдельным запросом.
Повторный `start` безопасен для данных. После `stop` новый `start` поднимает
прежний локальный том. `db:test reset` уничтожает **все данные тестовой среды**
и пересоздаёт её из текущей конфигурации; reset разработки команда запрещает.
Пользовательские аккаунты и защиту данных CRM будет принимать S2.

[Локальная команда](scripts/supabase-local.mjs) принимает только `start`,
`stop`, `status` и тестовый `reset`; произвольные флаги не передаются.
Она не наследует `SUPABASE_*` из оболочки и не печатает сырой вывод CLI,
поскольку тот содержит ключи. При отказе проверьте Docker и доступность
портов, затем контейнеры: `rtk proxy docker ps -a --filter
'name=2b-studio-crm' --format '{{.Names}} {{.Status}} {{.Ports}}'`.
Не сохраняйте сырой `supabase status` или `--debug` в отчёты.
Облачный ref, login/link и облачные ключи для этих команд не нужны.

Ограничение проверенного Docker Desktop: порты публикуются на `0.0.0.0` и `::`,
хотя для обращения с этой машины используются URL `127.0.0.1` из таблицы.
Они доступны через сетевой интерфейс машины. Документированный loopback network
workaround не ограничил публикацию в этом окружении; поэтому ограничение
доступа только localhost здесь не заявляется. Используйте среду в доверенной
локальной сети и останавливайте её после работы. Проверки S1-01 завершены
с остановленными сервисами. Обновление CLI/Docker требует повторной проверки
публикуемых адресов. Облачная публикация не выполнена.

Установка CLI основана на [официальном руководстве Supabase](https://supabase.com/docs/guides/local-development/cli/getting-started).
Поведение Docker Desktop сверено с [upstream issue](https://github.com/supabase/cli/issues/1397).

## Целевая реализация

Один пакет React + TypeScript strict + Vite; TanStack Router и Query,
React Hook Form, Zod, Tailwind и shadcn/Radix. Supabase предоставляет Auth,
PostgreSQL, RLS и database RPC. Разработка — локально через CLI и Docker;
демо — в отдельном Supabase Cloud.

Manifest, lockfile и команды среды уже созданы в S1-01. На S1-02 появятся
каркас SPA, проверки frontend и инструкции запуска приложения.
Сборка и тесты приложения должны работать без приватного Kit; агентские и
документационные проверки остаются отдельной поверхностью. Секреты и доступы
демо в репозиторий не помещаются.

## Что потребуется для сдачи

Работающее демо с одним постановщиком, двумя исполнителями, 2–3 объектами и
задачами в разных статусах; GitHub-репозиторий с миграциями и инструкциями;
объяснение для руководителя на полстраницы; перечень решений и ограничений.
Проверки и границы сдачи заданы в [плане приёмки](docs/acceptance-plan.md#сдача).
