-- A fresh task per role and edge avoids one success changing the next precondition.
create temporary table matrix as
select row_number() over(order by n,old_status,new_status)::int + 100 as seq,
 n as actor,old_status,new_status,
 case when n=0 then 'DENIED' when n in (5,6) then 'FORBIDDEN' when n=4 then 'UNAVAILABLE'
   when old_status in ('new','rework') and new_status='in_progress' or old_status='in_progress' and new_status='in_review'
     then case when n=3 then 'OK' else 'FORBIDDEN' end
   when old_status='in_review' and new_status in ('rework','accepted')
     then case when n=1 then 'OK' else 'FORBIDDEN' end
   else 'INVALID_TRANSITION' end as expected
from unnest(enum_range(null::public.task_status)) old_status,
     unnest(enum_range(null::public.task_status)) new_status,
     unnest(array[0,1,3,4,5,6]) n;
insert into public.tasks(id,title,status,object_id,author_id,author_name,assignee_id)
select pg_temp.uid(seq),'Matrix',old_status,pg_temp.uid(11),pg_temp.uid(1),'M1',pg_temp.uid(3) from matrix;
create temporary table observed(seq int, result text);
grant select on matrix to authenticated,anon;
grant insert on observed to authenticated,anon;
do $$
declare actor_num int;
begin
  foreach actor_num in array array[0,1,3,4,5,6] loop
    perform pg_temp.claim(actor_num);
    if actor_num=0 then set local role anon; else set local role authenticated; end if;
    insert into observed
    select seq,pg_temp.failure(format('select public.transition_task(%L,1,%L,%L)',pg_temp.uid(seq),new_status,'Fix'))
    from matrix where actor=actor_num;
    reset role;
  end loop;
end $$;
select is(case when result='permission denied for function transition_task' then 'DENIED' else result end, expected,
 format('actor %s %s → %s',actor,old_status,new_status))
from matrix join observed using(seq) order by seq;
select is((select count(*)::int from matrix m join public.tasks t on t.id=pg_temp.uid(seq)
 where t.status=case when expected='OK' then new_status else old_status end
 and t.version=case when expected='OK' then 2 else 1 end
 and (select count(*)::int from public.task_status_history h where t.id=h.task_id)=case when expected='OK' then 1 else 0 end),150,
 'all 150 RPC outcomes agree with stored versions, statuses and event counts');

select ok(not has_table_privilege('anon',format('public.%I',name),'SELECT')
 and has_table_privilege('authenticated',format('public.%I',name),'SELECT'),format('%s restricted SELECT',name))
from unnest(array['profiles','objects','tasks','task_status_history']) name;
select ok(not has_table_privilege(role,format('public.%I',name),op),format('%s %s denied on %s',role,op,name))
from unnest(array['anon','authenticated']) role,
 unnest(array['profiles','objects','tasks','task_status_history']) name,
 unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) op;
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prosecdef and p.proconfig @> array['search_path=""']
 and has_function_privilege('authenticated',p.oid,'EXECUTE')
 and not has_function_privilege('anon',p.oid,'EXECUTE')),7,'seven protected RPC, empty search_path');
select ok(not has_schema_privilege('authenticated','private','USAGE'),'helpers not accessible by name');
select ok(not has_schema_privilege('anon','private','USAGE'),'guest cannot access private schema');
create function public.future_probe() returns void language sql as $$ select $$;
select ok(not has_function_privilege('authenticated','public.future_probe()','EXECUTE')
 and not has_function_privilege('anon','public.future_probe()','EXECUTE'),'future RPC defaults closed');
