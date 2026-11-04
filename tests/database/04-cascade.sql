set local role authenticated;
select pg_temp.claim(2);
select is(pg_temp.failure($q$select public.delete_object(pg_temp.uid(11),99)$q$),'CONFLICT','stale cascade rejected');
select is((select array_agg(id order by id) from public.tasks where object_id=pg_temp.uid(11) and version=1),
 array[pg_temp.uid(21),pg_temp.uid(22)],'stale cascade leaves both live children at their original versions');
select is(public.delete_object(pg_temp.uid(11),1)->>'version','2','soft deleted parent v2');
select is((select count(*)::int from public.tasks where object_id=pg_temp.uid(11)),0,'manager loses child access');
select pg_temp.claim(3);
select is((select count(*)::int from public.task_status_history),0,'executor loses history');
reset role;
select is((select array_agg(version order by id) from public.tasks where object_id=pg_temp.uid(11)),array[2,2,1],'active children increment once; old tombstone preserved');
select is((select count(*)::int from public.tasks where object_id=pg_temp.uid(11) and deleted_at is null),0,'no active child');
select is((select count(*)::int from public.task_status_history where task_id in (pg_temp.uid(21),pg_temp.uid(22),pg_temp.uid(24))),3,'history physically retained');
select is((select row(version,deleted_at)::text from public.tasks where id=pg_temp.uid(23)),
 '(1,)','cascade leaves the active task in the other object untouched');
