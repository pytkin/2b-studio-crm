set local role authenticated;
select pg_temp.claim(3);
select is(public.transition_task(pg_temp.uid(21),1,'in_progress',' Started ')->'task'->>'version','2','executor starts own task');
select is((select row(from_status,to_status,actor_id,actor_name,comment)::text from public.task_status_history where task_id=pg_temp.uid(21) order by id desc limit 1),
 row('new','in_progress',pg_temp.uid(3),'E1','Started')::text,'actor and edge snapshot');
select pg_temp.claim(4);
select is(pg_temp.failure($q$select public.transition_task(pg_temp.uid(21),1,'accepted')$q$),'UNAVAILABLE','access before version or transition');
select pg_temp.claim(3);
select is(pg_temp.failure($q$select public.transition_task(pg_temp.uid(21),1,'accepted')$q$),'CONFLICT','version before transition');
select is(pg_temp.failure($q$select public.transition_task(pg_temp.uid(21),2,'accepted')$q$),'INVALID_TRANSITION','no skipped edge');
reset role;
alter table public.task_status_history add constraint test_reject_review check (to_status <> 'in_review');
set local role authenticated;
select isnt(pg_temp.failure($q$select public.transition_task(pg_temp.uid(21),2,'in_review')$q$),'OK','injected history failure');
select is((select row(status,version)::text from public.tasks where id=pg_temp.uid(21)),'(in_progress,2)','history failure rolls back task');
select is((select count(*)::int from public.task_status_history where task_id=pg_temp.uid(21)),2,'exact history count');
