set local role authenticated;
select pg_temp.claim(1);
select is(public.create_task(pg_temp.uid(25),' Title ',pg_temp.uid(11),pg_temp.uid(3),'',' Note ')->'task'->>'id',pg_temp.uid(25)::text,'create returns task');
select is((select row(title,status,version,author_id,author_name)::text from public.tasks where id=pg_temp.uid(25)),row('Title','new',1,pg_temp.uid(1),'M1')::text,'server owns task origin');
select is((select row(from_status,to_status,actor_id,actor_name,comment)::text from public.task_status_history where task_id=pg_temp.uid(25)),row(null,'new',pg_temp.uid(1),'M1','Note')::text,'one initial event with submitted comment');
select is(public.create_task(pg_temp.uid(26),'Title',pg_temp.uid(11),pg_temp.uid(3),'')->'event'->'comment','null'::jsonb,'optional comment is null');
select is(pg_temp.failure($q$select public.create_task(pg_temp.uid(25),'Dup',pg_temp.uid(11),pg_temp.uid(3),'')$q$),'ID_UNAVAILABLE','duplicate refused');
select is(pg_temp.failure($q$select public.create_task(pg_temp.uid(27),'Bad',pg_temp.uid(14),pg_temp.uid(3),'')$q$),'UNAVAILABLE','deleted parent refused');
select is(pg_temp.failure($q$select public.create_task(pg_temp.uid(27),'Bad',pg_temp.uid(11),pg_temp.uid(5),'')$q$),'INVALID_INPUT','inactive assignee refused');
select is(pg_temp.failure($q$select public.create_task(pg_temp.uid(27),'Bad',pg_temp.uid(11),pg_temp.uid(1),'')$q$),'INVALID_INPUT','manager assignee refused');
select is((select count(*)::int from public.task_status_history where task_id in (pg_temp.uid(25),pg_temp.uid(26),pg_temp.uid(27))),2,'no duplicate or partial history');
reset role;
alter table public.task_status_history add constraint test_reject_event check (task_id <> pg_temp.uid(28));
set local role authenticated;
select throws_ok($q$select public.create_task(pg_temp.uid(28),'Roll back',pg_temp.uid(11),pg_temp.uid(3),'')$q$,
 'PT500','REQUEST_FAILED','initial history failure returns a safe technical error');
select is((select count(*)::int from public.tasks where id=pg_temp.uid(28)),0,'failed initial history rolls back task');
