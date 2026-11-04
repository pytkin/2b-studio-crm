-- Discover parents, lock them in UUID order, then re-read assignment and version
-- on the locked task. A move while waiting invalidates the observed source.
create function private.lock_task(
  target uuid, destination uuid, person public.profiles, expected integer
) returns public.tasks language plpgsql set search_path = '' as $$
declare
  source_id uuid;
  item public.tasks;
begin
  select object_id into source_id from public.tasks
    where id=target and deleted_at is null and (person.role='manager' or assignee_id=person.id);
  if not found then raise exception 'UNAVAILABLE'; end if;
  perform 1 from public.objects where id in (source_id,destination) order by id for update;
  select * into item from public.tasks where id=target and deleted_at is null
    and (person.role='manager' or assignee_id=person.id) for update;
  if not found or not exists (select 1 from public.objects where id=item.object_id and deleted_at is null) then
    raise exception 'UNAVAILABLE';
  end if;
  perform private.check_version(item.version,expected);
  if source_id <> item.object_id then raise exception 'CONFLICT'; end if;
  if destination is not null and not exists (select 1 from public.objects where id=destination and deleted_at is null) then
    raise exception 'UNAVAILABLE';
  end if;
  return item;
end $$;

create function public.update_task(
  p_id uuid,p_expected_version integer,p_title text,p_object_id uuid,p_assignee_id uuid,p_description text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  person public.profiles;
  item public.tasks;
begin
  person := private.actor(true);
  perform private.lock_task(p_id,p_object_id,person,p_expected_version);
  if p_object_id is null then raise exception 'INVALID_INPUT'; end if;
  perform private.check_task_fields(p_title,p_description,p_assignee_id);
  update public.tasks set title=private.clean_text(p_title),description=p_description,
    object_id=p_object_id,assignee_id=p_assignee_id,version=version+1 where id=p_id returning * into item;
  return jsonb_build_object('task',to_jsonb(item));
exception when raise_exception then raise;
  when others then raise sqlstate 'PT500' using message = 'REQUEST_FAILED';
end $$;

create function public.delete_task(p_id uuid,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  person public.profiles;
  item public.tasks;
begin
  person := private.actor(true);
  perform private.lock_task(p_id,null,person,p_expected_version);
  update public.tasks set deleted_at=now(),version=version+1 where id=p_id returning * into item;
  return jsonb_build_object('id',item.id,'version',item.version);
exception when raise_exception then raise;
  when others then raise sqlstate 'PT500' using message = 'REQUEST_FAILED';
end $$;
grant execute on function public.update_task(uuid,integer,text,uuid,uuid,text),
 public.delete_task(uuid,integer) to authenticated;
