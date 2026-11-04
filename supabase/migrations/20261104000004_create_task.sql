create function private.check_task_fields(title text, description text, assignee uuid) returns void
language plpgsql set search_path = '' as $$
begin
  if coalesce(private.clean_text(title),'') = '' or description is null then raise exception 'INVALID_INPUT'; end if;
  perform 1 from public.profiles where id=assignee and role='executor' and active for share;
  if not found then raise exception 'INVALID_INPUT'; end if;
end $$;

create function private.add_event(
  item public.tasks, person public.profiles, previous public.task_status, note text
) returns public.task_status_history
language plpgsql set search_path = '' as $$
declare event public.task_status_history;
begin
  insert into public.task_status_history(task_id,actor_id,actor_name,from_status,to_status,comment)
  values(item.id,person.id,person.display_name,previous,item.status,nullif(private.clean_text(note),''))
  returning * into event;
  return event;
end $$;

create function public.create_task(
  p_id uuid,p_title text,p_object_id uuid,p_assignee_id uuid,p_description text,p_comment text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  person public.profiles;
  item public.tasks;
  event public.task_status_history;
begin
  person := private.actor(true);
  if p_id is null or p_object_id is null then raise exception 'INVALID_INPUT'; end if;
  perform private.lock_object(p_object_id);
  perform private.check_task_fields(p_title,p_description,p_assignee_id);
  insert into public.tasks(id,title,description,object_id,assignee_id,author_id,author_name)
  values(p_id,private.clean_text(p_title),p_description,p_object_id,p_assignee_id,person.id,person.display_name)
  on conflict (id) do nothing returning * into item;
  if not found then raise exception 'ID_UNAVAILABLE'; end if;
  event := private.add_event(item,person,null,p_comment);
  return jsonb_build_object('task',to_jsonb(item),'event',to_jsonb(event));
exception when raise_exception then raise;
  when others then raise sqlstate 'PT500' using message = 'REQUEST_FAILED';
end $$;
grant execute on function public.create_task(uuid,text,uuid,uuid,text,text) to authenticated;
