update public.tasks set status='in_review' where id=pg_temp.uid(21);
set local role authenticated;
select pg_temp.claim(2);
select is(pg_temp.failure($q$select public.transition_task(pg_temp.uid(21),1,'rework','  ')$q$),'INVALID_INPUT','blank reason refused');
select is((select row(status,version)::text from public.tasks where id=pg_temp.uid(21)), '(in_review,1)','unchanged after blank reason');
select is((select count(*)::int from public.task_status_history where task_id=pg_temp.uid(21)),1,'no event after blank reason');
select is(public.transition_task(pg_temp.uid(21),1,'rework',' Fix ')->'event'->>'comment','Fix','other manager requests changes');
select is((select row(status,version)::text from public.tasks where id=pg_temp.uid(21)), '(rework,2)','status and version persisted');
select is((select count(*)::int from public.task_status_history where task_id=pg_temp.uid(21)),2,'one event added');
