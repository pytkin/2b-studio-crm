-- For a dedicated PostgREST instance whose service-level configuration has
-- been checked by the operator. This operation does not grant table access.
do $$
declare
  guard constant text := 'api_guard.check_read_preferences';
begin
  if coalesce(current_setting('pgrst.db_pre_request', true), '') not in ('', guard) or exists (
    select from pg_db_role_setting s, unnest(s.setconfig) setting
    where s.setrole in (0, 'authenticator'::regrole::oid)
      and s.setdatabase in (0, (select oid from pg_database where datname = current_database()))
      and split_part(setting, '=', 1) = 'pgrst.db_pre_request'
      and split_part(setting, '=', 2) not in ('', guard)
  ) then
    raise exception 'An existing PostgREST pre-request hook requires explicit integration';
  end if;
  execute format('alter role authenticator in database %I set pgrst.db_pre_request = %L',
    current_database(), guard);
  perform pg_notify('pgrst', 'reload config');
end $$;
