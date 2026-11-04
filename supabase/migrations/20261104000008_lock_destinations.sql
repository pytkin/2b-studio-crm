-- Validate the destination against this operation’s lock set, including concurrent creation.
-- Discover parents, lock them in UUID order, then re-read assignment and version
-- on the locked task. A move while waiting invalidates the observed source.
create or replace function private.lock_task(
  target uuid, destination uuid, person public.profiles, expected integer
) returns public.tasks language plpgsql set search_path = '' as $$
declare
  source_id uuid;
  locked_parents uuid[];
  item public.tasks;
begin
  select object_id into source_id from public.tasks
    where id=target and deleted_at is null and (person.role='manager' or assignee_id=person.id);
  if not found then raise exception 'UNAVAILABLE'; end if;
  select array_agg(locked.id) into locked_parents from (
    select id from public.objects where id in (source_id,destination) and deleted_at is null order by id for update
  ) locked;
  select * into item from public.tasks where id=target and deleted_at is null
    and (person.role='manager' or assignee_id=person.id) for update;
  if not found or not exists (select 1 from public.objects where id=item.object_id and deleted_at is null) then
    raise exception 'UNAVAILABLE';
  end if;
  perform private.check_version(item.version,expected);
  if source_id <> item.object_id then raise exception 'CONFLICT'; end if;
  if destination is not null and not (destination = any(coalesce(locked_parents, array[]::uuid[]))) then
    raise exception 'UNAVAILABLE';
  end if;
  return item;
end $$;
