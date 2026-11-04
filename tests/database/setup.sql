begin;
create extension if not exists pgtap with schema extensions;
-- Test-only grants disappear at rollback, including the pgTAP installation.
do $$
declare fn regprocedure;
begin
  for fn in select p.oid::regprocedure from pg_proc p
    join pg_depend d on d.objid=p.oid and d.classid='pg_proc'::regclass and d.deptype='e'
    join pg_extension e on e.oid=d.refobjid and e.extname='pgtap'
  loop
    execute format('grant execute on function %s to authenticated,anon',fn);
  end loop;
end $$;
set local search_path = public, extensions;
select no_plan();
