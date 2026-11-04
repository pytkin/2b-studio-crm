-- Default EXECUTE on new functions is global in PostgreSQL. Per-schema ACLs are additive.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke all on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from public, anon, authenticated;

create schema private;
revoke all on schema private from public, anon, authenticated;

create type public.profile_role as enum ('manager','executor');
create type public.task_status as enum ('new','in_progress','in_review','accepted','rework');

create function private.clean_text(value text) returns text
language sql immutable strict set search_path = '' as $$
  select btrim(value, E' \t\n\r\f' || chr(11) || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;

create table public.profiles (
  id uuid primary key references auth.users(id),
  display_name text not null check (private.clean_text(display_name) <> ''),
  role public.profile_role not null,
  active boolean not null default true
);
create table public.objects (
  id uuid primary key,
  name text not null check (private.clean_text(name) <> ''),
  address text not null check (private.clean_text(address) <> ''),
  version integer not null default 1 check (version > 0),
  deleted_at timestamptz
);
create table public.tasks (
  id uuid primary key,
  title text not null check (private.clean_text(title) <> ''),
  description text not null default '',
  object_id uuid not null references public.objects(id),
  assignee_id uuid not null references public.profiles(id),
  status public.task_status not null default 'new',
  author_id uuid not null references public.profiles(id),
  author_name text not null,
  created_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  deleted_at timestamptz
);
create table public.task_status_history (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks(id),
  actor_id uuid not null references public.profiles(id),
  actor_name text not null,
  occurred_at timestamptz not null default now(),
  from_status public.task_status,
  to_status public.task_status not null,
  comment text
);
create index tasks_live_parent_idx on public.tasks(object_id,id) where deleted_at is null;
create index tasks_live_assignee_idx on public.tasks(assignee_id,object_id) where deleted_at is null;
create index task_history_order_idx on public.task_status_history(task_id,id);
alter table public.profiles enable row level security;
alter table public.objects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_status_history enable row level security;
revoke all on public.profiles,public.objects,public.tasks,public.task_status_history from public,anon,authenticated;
grant select on public.profiles,public.objects,public.tasks,public.task_status_history to authenticated;
