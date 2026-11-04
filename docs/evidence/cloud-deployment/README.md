# Приёмка облачной поставки S8

Дата: 2026-11-04. Проверенная ревизия кода:
`58792965e03bc4184f42ee0a5344dfa9f394e7d8`.

- [Приложение](https://2b-studio-crm.vercel.app) — production Vercel Hobby.
- [Публичный репозиторий](https://github.com/pytkin/2b-studio-crm) — ветка main.
- Supabase Cloud Free: `slgwsnfjxapsjpdzezui`, Frankfurt (`eu-central-1`).
- Deployment: `dpl_76QiR4vnFa9dkiU4StkdEDAh88xw`, READY, автоматический Git deployment, build около 8 секунд.

## Реальные границы проверки

| Проверка | Свидетельство и результат |
|---|---|
| Создание бесплатных ресурсов | MCP get_cost: $0/month; организация Supabase Free; Vercel account/team Hobby. Платные расширения не включались |
| Миграции | `supabase db push --remote=slgwsnfjxapsjpdzezui --skip-vault --yes`; удалённая история содержит ровно версии 20261104000001–20261104000010 |
| Закрытая регистрация | Dashboard off, прямой signup → 422/signup_disabled; Site URL считан обратно как публичный HTTPS URL |
| Активация чтения | До SELECT: planned Prefer → 400/PT400/UNSUPPORTED_READ_PREFERENCE; EXPLAIN → 406/PGRST107. Затем восстановлены grants под RLS |
| Реальные роли/API | [157/157 наблюдений](security-smoke.json): чтения, история, счётчики, запрет прямого DML, управляющих RPC исполнителям, подделки роли и истории, отзыв со старым JWT. Временный Auth user удалён |
| GitHub readback | `git ls-remote origin refs/heads/main` вернул проверенную ревизию кода; публичность подтверждена GitHub API |
| Свежий HTTPS clone | Без Kit: `pnpm install --frozen-lockfile`, `pnpm verify` — 58 infra + 99 Vitest, lint/typecheck/build/scan прошли. Рабочее дерево чистое |
| Сборка Vercel | Фактический log: Corepack/pnpm 12.15.0, frozen install, build successful; Node project setting 26.x, точный patch не логировался |
| Приватный Kit | Vercel получил warning при fetch submodule; сборка без него прошла. .vercelignore исключил 289 файлов |
| HTTPS и SPA | Без Vercel login: `/`, `/login`, `/objects`, `/tasks`, прямая карточка → 200/index.html; CSP точного Cloud origin, frame DENY, nosniff |
| Публичные артефакты | [Реальные JS/CSS](public-assets-check.json) содержат нужный Cloud URL; привилегированные ключи, JWT сессий и известные Cloud-пароли отсутствуют. Приватные пути возвращают оболочку, не файлы |
| Браузер | [39/39 наблюдений](browser-smoke.json) на desktop 1440×900 и mobile 360×800; три аккаунта, полный цикл и история, отказ чужой карточки, UI cleanup |

## Независимые проверки

До публикации проверены 19 коммитов, 461 blob и 151 прежний снимок: подтверждённых
P0–P2 по раскрытию секретов нет. Отдельно проверены миграции/Cloud hook и diff
конфигурации Vercel. Автор конфигурации не выступал её независимым рецензентом.
Итоговая независимая сверка свидетельств, кода и публичной границы завершена:
passed, открытых P0–P2 нет. Две неточности документации P3 исправлены.

## Пределы

Cloud-проверки дополняют локальную матрицу, а не повторяют разрушительный reset,
pgTAP и все гонки в облачной демо-базе. Модель PostgreSQL проверена локально;
здесь проверены фактический шлюз, миграции, роли и UI. Внутренний env managed
PostgREST недоступен: происхождение нового проекта и DB/role settings проверены,
эффективная защита подтверждена HTTP-отказами. Полный restore, физические
мобильные устройства и screen reader не проверялись.

Supabase Advisor оставил семь предупреждений о намеренно доступных authenticated
SECURITY DEFINER RPC и одно о выключенной leaked password protection. Семь RPC
имеют серверные проверки ролей/состояний, пустой search_path и отрицательные
контроли. Password protection доступна только на Pro; платный план не включался.
Используются сильные случайные пароли и закрытая регистрация. Подробнее —
[эксплуатационный порядок и границы Free](../../deployment.md).

## Исправление, выявленное в публичном браузере

На первой выкладке ef6ac9a обнаружен enforced script-src/eval violation
при открытии /login. Источник — Zod canEval probe Function: исключение
перехватывается библиотекой, но браузер всё равно сообщает нарушение CSP.
После наблюдаемого RED добавлен первый side-effect import с jitless: true.
Startup-тест проверяет реальный entrypoint с запретом Function, рабочую
валидацию и небезопасный контроль после основного утверждения. RED: 1 попытка
вместо 0; GREEN: 0. Строгая CSP сохранена. Отдельный независимый code gate
прошёл до push. Новый deployment из main подтверждён Vercel readback;
финальные браузерные наблюдения относятся к нему.

## Снимки и сетевые состояния

[Desktop: объект](desktop-object.png) · [Desktop: принятая задача и история](desktop-accepted-history.png)

[Mobile: объект](mobile-object.png) · [Mobile: принятая задача и история](mobile-accepted-history.png)

В финальном прогоне CSP violations, page errors и неожиданные сетевые отказы — 0.
На каждом размере один GET списка objects отменён при переходе к созданному
объекту; зафиксирован net::ERR_ABORTED, запрос создания завершён успешно, карточка
и дальнейший цикл приняты. Это не отказ операции записи. Демонстрационные данные
не изменены; все QA-объекты мягко удалены через UI. Локальные сервисы после
приёмки остановлены с сохранением томов; публичное приложение остаётся доступным.

Последующая фиксация отчёта меняет только документацию и свидетельства.
Принимающая ревизия приложения остаётся 5879296; GitHub ref и состояние нового
автоматического deployment после публикации отчёта сверяются отдельно.
