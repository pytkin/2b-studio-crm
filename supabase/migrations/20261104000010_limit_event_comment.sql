-- Both task RPCs call this function in the same transaction as the task write.
-- Historical comments remain readable; only new events are subject to the limit.
create or replace function private.add_event(
  item public.tasks, person public.profiles, previous public.task_status, note text
) returns public.task_status_history
language plpgsql set search_path = '' as $$
declare event public.task_status_history;
begin
  if char_length(note) > 4000 then raise exception 'INVALID_INPUT'; end if;
  insert into public.task_status_history(task_id,actor_id,actor_name,from_status,to_status,comment)
  values(item.id,person.id,person.display_name,previous,item.status,nullif(private.clean_text(note),''))
  returning * into event;
  return event;
end $$;
