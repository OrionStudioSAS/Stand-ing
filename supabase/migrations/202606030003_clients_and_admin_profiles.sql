create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  client_key text not null unique,
  display_name text not null,
  company_name text,
  email text,
  phone text,
  commercial_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.scenes
  add column if not exists client_id uuid references public.clients(id) on delete set null;

alter table public.admin_users
  add column if not exists full_name text,
  add column if not exists role_label text not null default 'Admin',
  add column if not exists avatar_url text,
  add column if not exists profile_metadata jsonb not null default '{}'::jsonb;

create index if not exists scenes_client_id_idx on public.scenes (client_id);

alter table public.clients enable row level security;
revoke all on table public.clients from anon;
grant select, insert, update, delete on table public.clients to authenticated;

drop policy if exists "admin access clients" on public.clients;
create policy "admin access clients"
  on public.clients
  for all
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

with scene_clients as (
  select
    id as scene_id,
    case
      when nullif(trim(client_email), '') is not null then 'email:' || lower(trim(client_email))
      when nullif(trim(client_name), '') is not null then 'name:' || lower(regexp_replace(trim(client_name), '\s+', ' ', 'g'))
      else null
    end as client_key,
    coalesce(nullif(trim(client_name), ''), nullif(trim(client_email), ''), project_name, 'Client sans nom') as display_name,
    nullif(trim(client_name), '') as company_name,
    lower(nullif(trim(client_email), '')) as email,
    source_payload,
    created_at,
    updated_at
  from public.scenes
), distinct_clients as (
  select distinct on (client_key)
    client_key,
    display_name,
    company_name,
    email,
    jsonb_build_object('source', 'scene_backfill') as metadata,
    created_at,
    updated_at
  from scene_clients
  where client_key is not null
  order by client_key, updated_at desc nulls last, created_at desc nulls last
)
insert into public.clients (client_key, display_name, company_name, email, metadata, created_at, updated_at)
select client_key, display_name, company_name, email, metadata, created_at, updated_at
from distinct_clients
on conflict (client_key) do update set
  display_name = excluded.display_name,
  company_name = coalesce(excluded.company_name, public.clients.company_name),
  email = coalesce(excluded.email, public.clients.email),
  updated_at = now();

update public.scenes scene
set client_id = client.id
from public.clients client
where scene.client_id is null
  and client.client_key = case
    when nullif(trim(scene.client_email), '') is not null then 'email:' || lower(trim(scene.client_email))
    when nullif(trim(scene.client_name), '') is not null then 'name:' || lower(regexp_replace(trim(scene.client_name), '\s+', ' ', 'g'))
    else null
  end;
