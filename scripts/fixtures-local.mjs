import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const objects = [
  ['d1523064-b61b-4b8d-91c3-16a3d1732451', 'Мастерская на Садовой', 'ул. Садовая, 18'],
  ['974591c0-3ba0-49bc-9b64-6d6574bb5ae8', 'Павильон на набережной', 'Набережная, 10'],
  ['ff9a46d0-9733-449a-be10-65142a6f1468', 'Дом у парка', 'Парковый переулок, 7'],
];
const tasks = [
  [
    '12dfe680-d01e-44f3-9ca9-eeacc835b817',
    'Сверить схему освещения',
    'Проверить расположение светильников в коридоре.',
    0,
    1,
    ['new'],
  ],
  [
    'cc313000-aef5-488e-953d-ba08db713b41',
    'Снять размеры окон',
    'Записать ширину и высоту каждого проёма.',
    0,
    2,
    ['new', 'in_progress'],
  ],
  [
    '91e54928-916a-4bd4-8703-f33e5fae27b6',
    'Проверить раскладку плитки',
    'Согласовать рисунок и направление укладки.',
    2,
    1,
    ['new', 'in_progress', 'in_review'],
  ],
];

export async function seedRows(db, accounts, withExamples) {
  for (const { id, name, role } of accounts) {
    await db.query(
      'insert into public.profiles (id,display_name,role) values ($1,$2,$3) on conflict (id) do nothing',
      [id, name, role],
    );
  }
  if (!withExamples) return;
  for (const row of objects) {
    await db.query(
      'insert into public.objects(id,name,address) values ($1,$2,$3) on conflict (id) do nothing',
      row,
    );
  }
  for (const [id, title, description, parent, assignee, statuses] of tasks) {
    const result = await db.query(
      `
      insert into public.tasks(id,title,description,object_id,assignee_id,status,author_id,author_name,version)
      select $1,$2,$3,o.id,e.id,$6,m.id,m.display_name,$8 from public.objects o, public.profiles m, public.profiles e
      where o.id=$4 and o.deleted_at is null and e.id=$5 and e.active and e.role='executor'
        and m.id=$7 and m.active and m.role='manager' on conflict(id) do nothing`,
      [
        id,
        title,
        description,
        objects[parent][0],
        accounts[assignee].id,
        statuses.at(-1),
        accounts[0].id,
        statuses.length,
      ],
    );
    if (!result.rowCount) continue;
    for (const [index, status] of statuses.entries()) {
      await db.query(
        `
        insert into public.task_status_history(task_id,actor_id,actor_name,from_status,to_status)
        select $1,id,display_name,$3,$4 from public.profiles where id=$2`,
        [id, accounts[index === 0 ? 0 : assignee].id, statuses[index - 1] ?? null, status],
      );
    }
  }
}

export async function provision(config, accounts, withExamples) {
  const admin = createClient(config.url, config.adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const db = new pg.Client({ connectionString: config.db });
  await db.connect();
  try {
    await db.query('begin');
    await db.query("select pg_advisory_xact_lock(hashtext('crm-local-provision'))");
    for (const { id, email, password } of accounts) {
      const existing = await db.query('select id from auth.users where email=$1', [email]);
      if (existing.rowCount) {
        if (existing.rows[0].id !== id)
          throw Error('Существующий аккаунт принадлежит другому набору доступов.');
        continue;
      }
      const { error } = await admin.auth.admin.createUser({
        id,
        email,
        password,
        email_confirm: true,
      });
      if (error) throw Error('Не удалось создать локального пользователя.');
    }
    await seedRows(db, accounts, withExamples);
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  } finally {
    await db.end();
  }
}
