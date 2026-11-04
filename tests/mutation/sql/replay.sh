#!/bin/sh
# Run one recorded SQL mutation against the project's normal pgTAP runner.
# A killed mutant produces its original "not ok" assertion and a nonzero exit.
set -eu

case "${1:-}" in
  version)
    routine='private.check_version(integer,integer)'
    original='expected is null or expected < 1'
    replacement='expected < 1' ;;
  cascade)
    routine='public.delete_object(uuid,integer)'
    original='version=version+1 where object_id=p_id and deleted_at is null;'
    replacement='version=version+1 where deleted_at is null;' ;;
  rls)
    routine='private.assigned_here(uuid)'
    original='and t.assignee_id = (select auth.uid()) '
    replacement='' ;;
  create-error|transition-error)
    if [ "$1" = create-error ]; then
      routine='public.create_task(uuid,text,uuid,uuid,text,text)'
    else
      routine='public.transition_task(uuid,integer,text,text)'
    fi
    original="when others then raise sqlstate 'PT500' using message = 'REQUEST_FAILED';"
    replacement='when others then raise;' ;;
  column) ;;
  *) echo 'Choose version, cascade, rls, create-error, transition-error or column.' >&2; exit 2 ;;
esac

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/scripts" "$scratch/tests"
cp scripts/test-database.mjs scripts/supabase-local.mjs "$scratch/scripts/"
cp -R tests/database "$scratch/tests/"
setup="$scratch/tests/database/setup.sql"
# Refuse to add a definition or grant outside the rollback-only fixture setup.
[ "$(head -n 1 "$setup")" = 'begin;' ]
if [ "$1" = column ]; then
  echo 'grant update(role) on public.profiles to authenticated;' >> "$setup"
else
  cat >> "$setup" <<SQL
do \$pilot\$
declare
  definition text := pg_get_functiondef('$routine'::regprocedure);
  original text := \$old\$$original\$old\$;
begin
  if strpos(definition,original)=0 then raise exception 'Mutation target changed'; end if;
  execute replace(definition,original,\$new\$$replacement\$new\$);
end \$pilot\$;
SQL
fi

# The unchanged runner pins the local Docker socket and the test container.
# Each test file ends with ROLLBACK; a failed psql session also aborts its transaction.
node "$scratch/scripts/test-database.mjs"
