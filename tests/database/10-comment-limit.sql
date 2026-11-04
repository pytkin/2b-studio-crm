-- Both public writes share the same transactional history writer.
set local role authenticated;
select pg_temp.claim(2);
select is(pg_temp.failure($q$select public.create_task(pg_temp.uid(28),'Limit',pg_temp.uid(11),pg_temp.uid(3),'',repeat('a',4001))$q$),
 'INVALID_INPUT','creation with an oversized comment is refused');
select is((select count(*)::int from public.tasks where id=pg_temp.uid(28)),0,'refused create leaves no task');
select is(char_length(public.create_task(pg_temp.uid(29),'Limit',pg_temp.uid(11),pg_temp.uid(3),'',repeat('я',3999))->'event'->>'comment'),
 3999,'creation below the limit keeps the initial comment');
select pg_temp.claim(3);
select is(pg_temp.failure($q$select public.transition_task(pg_temp.uid(21),1,'in_progress',repeat('🟢',4001))$q$),
 'INVALID_INPUT','an oversized transition comment is refused');
select is((select row(status,version,(select count(*) from public.task_status_history where task_id=t.id))::text
 from public.tasks t where id=pg_temp.uid(21)),'(new,1,1)','oversized transition leaves status, version and history untouched');
select is(char_length(public.transition_task(pg_temp.uid(21),1,'in_progress',repeat('🟢',4000))->'event'->>'comment'),
 4000,'an assigned executor can submit exactly 4000 Unicode code points');
