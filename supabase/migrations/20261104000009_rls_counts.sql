-- PostgREST can estimate counts from statistics for rows that RLS hides.
-- Its SQL request.headers contains only the last of repeated Prefer fields,
-- even when the HTTP count parser uses the first. Inspect header presence.
create schema api_guard;
revoke all on schema api_guard from public;
grant usage on schema api_guard to anon, authenticated, service_role;

create function api_guard.check_read_preferences() returns void
language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated')
    and current_setting('request.method', true) in ('HEAD', 'GET')
    and current_setting('request.headers', true)::jsonb ? 'prefer' then
    raise sqlstate 'PT400' using message = 'UNSUPPORTED_READ_PREFERENCE';
  end if;
end $$;
revoke all on function api_guard.check_read_preferences() from public;
grant execute on function api_guard.check_read_preferences() to anon, authenticated, service_role;

-- Keep the migration safe even when a gateway uses a pre-request hook configured
-- outside PostgreSQL. Restore API reads only after its guard answers a real probe.
revoke select on public.profiles, public.objects, public.tasks, public.task_status_history
  from public, anon, authenticated;
