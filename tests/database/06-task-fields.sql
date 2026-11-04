-- Use pre-existing statuses, independently of the transition RPC.
create temporary table original as select * from public.tasks where false;
insert into public.tasks(id,title,status,object_id,author_id,author_name,assignee_id)
select pg_temp.uid(30+ord::int),'Old',status,pg_temp.uid(11),pg_temp.uid(1),'M1',pg_temp.uid(3)
from unnest(enum_range(null::public.task_status)) with ordinality as s(status,ord);
insert into original select * from public.tasks where title='Old';
insert into public.task_status_history(task_id,actor_id,actor_name,to_status)
select id,author_id,author_name,status from original;
grant select on original to authenticated;
set local role authenticated;
select pg_temp.claim(2);
select is(public.update_task(id,1,' Updated ',pg_temp.uid(13),pg_temp.uid(4),'Details')->'task'->>'version','2','update ' || status::text) from original;
select is((select count(*)::int from public.tasks t join original o using(id)
 where t.status=o.status and t.author_id=o.author_id and t.author_name=o.author_name and t.created_at=o.created_at
 and t.assignee_id=pg_temp.uid(4) and t.object_id=pg_temp.uid(13) and t.title='Updated'),5,'immutable fields preserved in all statuses');
select is(pg_temp.failure($q$select public.update_task(pg_temp.uid(31),2,'Changed',pg_temp.uid(14),pg_temp.uid(3),'')$q$),'UNAVAILABLE','cannot move to tombstone');
select is(pg_temp.failure($q$select public.update_task(pg_temp.uid(31),1,'Changed',pg_temp.uid(12),pg_temp.uid(3),'')$q$),'CONFLICT','stale edit refused');
select pg_temp.claim(3);
select is((select count(*)::int from public.task_status_history where task_id in (select id from original)),0,'old assignee loses all histories');
select pg_temp.claim(4);
select is((select count(*)::int from public.task_status_history where task_id in (select id from original)),5,'new assignee sees unchanged events');
select pg_temp.claim(2);
select is(pg_temp.failure($q$select public.delete_task(pg_temp.uid(31),1)$q$),'CONFLICT','stale deletion refused');
select is(public.delete_task(id,2)->>'version','3','soft delete ' || status::text) from original;
select is(pg_temp.failure($q$select public.delete_task(pg_temp.uid(31),3)$q$),'UNAVAILABLE','repeat delete unavailable');
select is((select count(*)::int from public.tasks where id in (select id from original)),0,'manager loses deleted tasks');
reset role;
select is((select count(*)::int from public.task_status_history where task_id in (select id from original)),5,'event rows retained on deletion');
select is((select count(*)::int from public.tasks where id in (select id from original) and version=3 and deleted_at is not null),5,'five tombstones');
