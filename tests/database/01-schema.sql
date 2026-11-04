select has_table('public', 'profiles', 'profiles exist');
select fk_ok('public','profiles','id','auth','users','id','profile belongs to Auth user');
select has_enum('public', 'profile_role', 'role is a constrained type');
select enum_has_labels('public','profile_role',array['manager','executor'],'exactly two roles');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname='public' and c.relname in ('profiles','objects','tasks','task_status_history')
    and c.relrowsecurity), 4, 'four protected tables');
