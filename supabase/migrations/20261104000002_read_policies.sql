create function private.current_role() returns public.profile_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid()) and active
$$;
-- Break the object → tasks → object RLS dependency, scoped to the current user.
create function private.assigned_here(parent uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks t
    where t.object_id = parent and t.assignee_id = (select auth.uid()) and t.deleted_at is null
  ) and private.current_role() = 'executor'
$$;
grant execute on function private.current_role(), private.assigned_here(uuid) to authenticated;

create policy profiles_read on public.profiles for select to authenticated using (
  active and (id = (select auth.uid()) or
    ((select private.current_role()) = 'manager' and role = 'executor'))
);
create policy objects_read on public.objects for select to authenticated using (
  deleted_at is null and ((select private.current_role()) = 'manager' or private.assigned_here(id))
);
create policy tasks_read on public.tasks for select to authenticated using (
  deleted_at is null and ((select private.current_role()) = 'manager' or assignee_id = (select auth.uid()))
  and exists (select 1 from public.objects o where o.id = object_id)
);
create policy history_read on public.task_status_history for select to authenticated using (
  exists (select 1 from public.tasks t where t.id = task_id)
);
