create or replace function private.check_transition(previous public.task_status,target text,caller public.profile_role,note text)
returns void language plpgsql set search_path = '' as $$
declare required_role public.profile_role;
begin
  if (previous::text,target) in (('new','in_progress'),('rework','in_progress'),('in_progress','in_review')) then
    required_role := 'executor';
  elsif previous='in_review' and target in ('accepted','rework') then
    required_role := 'manager';
  else
    raise exception 'INVALID_TRANSITION';
  end if;
  if caller <> required_role then raise exception 'FORBIDDEN'; end if;
  if target='rework' and coalesce(private.clean_text(note),'')='' then raise exception 'INVALID_INPUT'; end if;
end $$;
