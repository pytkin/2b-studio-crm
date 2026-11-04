create function private.check_transition(previous public.task_status,target text,caller public.profile_role,note text)
returns void language plpgsql set search_path = '' as $$
begin
  if target is null or (previous::text,target) not in (
    ('new','in_progress'),('rework','in_progress'),('in_progress','in_review')
  ) then raise exception 'INVALID_TRANSITION'; end if;
  if caller <> 'executor' then raise exception 'FORBIDDEN'; end if;
end $$;

create function public.transition_task(p_id uuid,p_expected_version integer,p_to_status text,p_comment text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  person public.profiles;
  item public.tasks;
  previous public.task_status;
  event public.task_status_history;
begin
  person := private.actor(false);
  item := private.lock_task(p_id,null,person,p_expected_version);
  previous := item.status;
  perform private.check_transition(previous,p_to_status,person.role,p_comment);
  update public.tasks set status=p_to_status::public.task_status,version=version+1
    where id=p_id returning * into item;
  event := private.add_event(item,person,previous,p_comment);
  return jsonb_build_object('task',to_jsonb(item),'event',to_jsonb(event));
exception when raise_exception then raise;
  when others then raise sqlstate 'PT500' using message = 'REQUEST_FAILED';
end $$;
grant execute on function public.transition_task(uuid,integer,text,text) to authenticated;
