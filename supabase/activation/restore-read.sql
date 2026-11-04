-- Execute only after a real GET with Prefer: count=planned returns the
-- guard's PT400 / UNSUPPORTED_READ_PREFERENCE response on the target gateway.
grant select on public.profiles, public.objects, public.tasks, public.task_status_history
  to authenticated;
