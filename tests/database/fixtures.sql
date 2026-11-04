-- Reset the fixture view inside this rollback-only, isolated test transaction.
truncate public.task_status_history,public.tasks,public.objects,public.profiles;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('deadc0de-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.claim(n int) returns void language sql as $$
  select set_config('request.jwt.claims',json_build_object('sub',pg_temp.uid(n),'role','authenticated')::text,true)::text is not null
$$;
create function pg_temp.failure(statement text) returns text language plpgsql as $$
begin
  execute statement;
  return 'OK';
exception when others then
  return sqlerrm;
end $$;

insert into auth.users(id) select pg_temp.uid(n) from generate_series(1,6) n;
insert into public.profiles(id,display_name,role,active) values
 (pg_temp.uid(1),'M1','manager',true), (pg_temp.uid(2),'M2','manager',true),
 (pg_temp.uid(3),'E1','executor',true), (pg_temp.uid(4),'E2','executor',true),
 (pg_temp.uid(5),'Inactive','manager',false);
insert into public.objects(id,name,address,deleted_at) values
 (pg_temp.uid(11),'A','Address A',null), (pg_temp.uid(12),'B','Address B',null),
 (pg_temp.uid(13),'C','Address C',null), (pg_temp.uid(14),'D','Address D',now());
insert into public.tasks(id,title,object_id,assignee_id,author_id,author_name,deleted_at) values
 (pg_temp.uid(21),'A-E1',pg_temp.uid(11),pg_temp.uid(3),pg_temp.uid(1),'M1',null),
 (pg_temp.uid(22),'A-E2',pg_temp.uid(11),pg_temp.uid(4),pg_temp.uid(1),'M1',null),
 (pg_temp.uid(23),'B-E2',pg_temp.uid(12),pg_temp.uid(4),pg_temp.uid(1),'M1',null),
 (pg_temp.uid(24),'Deleted',pg_temp.uid(11),pg_temp.uid(3),pg_temp.uid(1),'M1',now());
insert into public.task_status_history(task_id, actor_id,actor_name,to_status)
select id, pg_temp.uid(1),'M1','new' from public.tasks where id in
  (pg_temp.uid(21),pg_temp.uid(22),pg_temp.uid(23),pg_temp.uid(24));

grant execute on function pg_temp.uid(int), pg_temp.claim(int), pg_temp.failure(text) to authenticated, anon;
