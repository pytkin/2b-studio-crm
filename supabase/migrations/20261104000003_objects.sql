create function private.actor(manager_only boolean) returns public.profiles
language plpgsql set search_path = '' as $$
declare person public.profiles;
begin
  select * into person from public.profiles where id = auth.uid() and active for share;
  if not found or (manager_only and person.role <> 'manager') then
    raise exception 'FORBIDDEN';
  end if;
  return person;
end $$;

create function private.check_version(actual integer, expected integer) returns void
language plpgsql set search_path = '' as $$
begin
  if expected is null or expected < 1 then raise exception 'INVALID_INPUT'; end if;
  if expected <> actual then raise exception 'CONFLICT'; end if;
end $$;

create function private.lock_object(target uuid) returns public.objects
language plpgsql set search_path = '' as $$
declare item public.objects;
begin
  select * into item from public.objects where id = target and deleted_at is null for update;
  if not found then raise exception 'UNAVAILABLE'; end if;
  return item;
end $$;

create function public.create_object(p_id uuid, p_name text, p_address text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare item public.objects;
begin
  perform private.actor(true);
  if p_id is null or coalesce(private.clean_text(p_name),'') = '' or coalesce(private.clean_text(p_address),'') = '' then
    raise exception 'INVALID_INPUT';
  end if;
  insert into public.objects(id,name,address)
  values (p_id,private.clean_text(p_name),private.clean_text(p_address))
  on conflict (id) do nothing returning * into item;
  if not found then raise exception 'ID_UNAVAILABLE'; end if;
  return jsonb_build_object('object',to_jsonb(item));
exception when raise_exception then raise;
  when others then raise sqlstate 'PT500' using message = 'REQUEST_FAILED';
end $$;

create function public.update_object(p_id uuid, p_expected_version integer, p_name text, p_address text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare item public.objects;
begin
  perform private.actor(true);
  item := private.lock_object(p_id);
  perform private.check_version(item.version,p_expected_version);
  if coalesce(private.clean_text(p_name),'') = '' or coalesce(private.clean_text(p_address),'') = '' then
    raise exception 'INVALID_INPUT';
  end if;
  update public.objects set name=private.clean_text(p_name), address=private.clean_text(p_address),
    version=version+1 where id=p_id returning * into item;
  return jsonb_build_object('object',to_jsonb(item));
exception when raise_exception then raise;
  when others then raise sqlstate 'PT500' using message = 'REQUEST_FAILED';
end $$;

create function public.delete_object(p_id uuid, p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare item public.objects;
begin
  perform private.actor(true);
  item := private.lock_object(p_id);
  perform private.check_version(item.version,p_expected_version);
  perform 1 from public.tasks where object_id=p_id and deleted_at is null order by id for update;
  update public.tasks set deleted_at=now(), version=version+1 where object_id=p_id and deleted_at is null;
  update public.objects set deleted_at=now(), version=version+1 where id=p_id returning * into item;
  return jsonb_build_object('id',item.id,'version',item.version);
exception when raise_exception then raise;
  when others then raise sqlstate 'PT500' using message = 'REQUEST_FAILED';
end $$;

grant execute on function public.create_object(uuid,text,text),
 public.update_object(uuid,integer,text,text),public.delete_object(uuid,integer) to authenticated;
