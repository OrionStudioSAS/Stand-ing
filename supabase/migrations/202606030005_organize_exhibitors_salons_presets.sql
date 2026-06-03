create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_key text not null unique,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text,
  role text not null default 'exposant' check (role in ('admin', 'exposant')),
  full_name text,
  company_name text,
  phone text,
  avatar_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.salons (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  year integer,
  status text not null default 'draft' check (status in ('active', 'upcoming', 'draft', 'archived')),
  starts_on date,
  ends_on date,
  location text,
  cover_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.salon_offers (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  slug text not null,
  name text not null,
  base_price numeric(10,2),
  included_description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, slug)
);

alter table public.clients
  add column if not exists user_profile_id uuid references public.user_profiles(id) on delete set null;

alter table public.monday_sources
  add column if not exists salon_id uuid references public.salons(id) on delete set null,
  add column if not exists offer_id uuid references public.salon_offers(id) on delete set null;

alter table public.scenes
  add column if not exists salon_id uuid references public.salons(id) on delete set null,
  add column if not exists offer_id uuid references public.salon_offers(id) on delete set null,
  add column if not exists exhibitor_user_id uuid references public.user_profiles(id) on delete set null,
  add column if not exists base_preset_id uuid,
  add column if not exists base_items_applied_at timestamptz;

create table if not exists public.exhibitor_salon_memberships (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  salon_id uuid not null references public.salons(id) on delete cascade,
  role text not null default 'exposant',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_profile_id, client_id, salon_id)
);

create table if not exists public.stand_presets (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  offer_id uuid references public.salon_offers(id) on delete cascade,
  name text not null,
  description text,
  width_m numeric(8,2),
  depth_m numeric(8,2),
  height_m numeric(8,2),
  layout text check (layout in ('back', 'left', 'right', 'u')),
  base_config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.scenes
  drop constraint if exists scenes_base_preset_id_fkey;
alter table public.scenes
  add constraint scenes_base_preset_id_fkey foreign key (base_preset_id) references public.stand_presets(id) on delete set null;

create table if not exists public.stand_preset_items (
  id uuid primary key default gen_random_uuid(),
  preset_id uuid not null references public.stand_presets(id) on delete cascade,
  item_uid text not null,
  type text not null,
  label text,
  x numeric(8,3) not null default 0,
  y numeric(8,3) not null default 0,
  z numeric(8,3) not null default 0,
  rotation numeric(8,3) not null default 0,
  wall text,
  config jsonb not null default '{}'::jsonb,
  included boolean not null default true,
  price_mode text not null default 'included' check (price_mode in ('included', 'billable')),
  created_at timestamptz not null default now(),
  unique (preset_id, item_uid)
);

create index if not exists clients_user_profile_idx on public.clients (user_profile_id);
create index if not exists monday_sources_salon_offer_id_idx on public.monday_sources (salon_id, offer_id);
create index if not exists monday_sources_offer_id_idx on public.monday_sources (offer_id);
create index if not exists scenes_salon_offer_id_idx on public.scenes (salon_id, offer_id);
create index if not exists scenes_offer_id_idx on public.scenes (offer_id);
create index if not exists scenes_base_preset_idx on public.scenes (base_preset_id);
create index if not exists scenes_exhibitor_user_idx on public.scenes (exhibitor_user_id);
create index if not exists memberships_user_salon_idx on public.exhibitor_salon_memberships (user_profile_id, salon_id);
create index if not exists memberships_client_idx on public.exhibitor_salon_memberships (client_id);
create index if not exists memberships_salon_idx on public.exhibitor_salon_memberships (salon_id);
create index if not exists stand_presets_salon_offer_idx on public.stand_presets (salon_id, offer_id);
create unique index if not exists stand_presets_active_offer_idx on public.stand_presets (offer_id) where is_active and offer_id is not null;

alter table public.user_profiles enable row level security;
alter table public.salons enable row level security;
alter table public.salon_offers enable row level security;
alter table public.exhibitor_salon_memberships enable row level security;
alter table public.stand_presets enable row level security;
alter table public.stand_preset_items enable row level security;

revoke all on table public.user_profiles, public.salons, public.salon_offers, public.exhibitor_salon_memberships, public.stand_presets, public.stand_preset_items from anon;
grant select, insert, update, delete on table public.user_profiles, public.salons, public.salon_offers, public.exhibitor_salon_memberships, public.stand_presets, public.stand_preset_items to authenticated;

drop policy if exists "admin access user_profiles" on public.user_profiles;
drop policy if exists "users read own profile" on public.user_profiles;
drop policy if exists "read user_profiles" on public.user_profiles;
create policy "read user_profiles" on public.user_profiles for select to authenticated using ((select private.is_admin()) or (select auth.uid()) = auth_user_id);
drop policy if exists "insert user_profiles admin" on public.user_profiles;
create policy "insert user_profiles admin" on public.user_profiles for insert to authenticated with check ((select private.is_admin()));
drop policy if exists "update user_profiles admin" on public.user_profiles;
create policy "update user_profiles admin" on public.user_profiles for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists "delete user_profiles admin" on public.user_profiles;
create policy "delete user_profiles admin" on public.user_profiles for delete to authenticated using ((select private.is_admin()));

drop policy if exists "admin access salons" on public.salons;
create policy "admin access salons" on public.salons for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists "admin access salon_offers" on public.salon_offers;
create policy "admin access salon_offers" on public.salon_offers for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists "admin access exhibitor_salon_memberships" on public.exhibitor_salon_memberships;
create policy "admin access exhibitor_salon_memberships" on public.exhibitor_salon_memberships for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists "admin access stand_presets" on public.stand_presets;
create policy "admin access stand_presets" on public.stand_presets for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists "admin access stand_preset_items" on public.stand_preset_items;
create policy "admin access stand_preset_items" on public.stand_preset_items for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

insert into public.user_profiles (profile_key, auth_user_id, email, role, full_name, avatar_url, metadata, created_at, updated_at)
select 'auth:' || user_id::text, user_id, email, 'admin', coalesce(full_name, email), avatar_url, jsonb_build_object('source', 'admin_backfill'), created_at, now()
from public.admin_users
on conflict (profile_key) do update set
  auth_user_id = excluded.auth_user_id,
  email = excluded.email,
  role = 'admin',
  full_name = coalesce(public.user_profiles.full_name, excluded.full_name),
  avatar_url = coalesce(public.user_profiles.avatar_url, excluded.avatar_url),
  updated_at = now();

insert into public.user_profiles (profile_key, email, role, full_name, company_name, phone, metadata, created_at, updated_at)
select client_key, email, 'exposant', display_name, company_name, phone, jsonb_build_object('source', 'client_backfill'), created_at, now()
from public.clients
where client_key is not null
on conflict (profile_key) do update set
  email = coalesce(excluded.email, public.user_profiles.email),
  role = case when public.user_profiles.role = 'admin' then 'admin' else 'exposant' end,
  full_name = coalesce(excluded.full_name, public.user_profiles.full_name),
  company_name = coalesce(excluded.company_name, public.user_profiles.company_name),
  phone = coalesce(excluded.phone, public.user_profiles.phone),
  updated_at = now();

update public.clients client
set user_profile_id = profile.id
from public.user_profiles profile
where client.user_profile_id is null
  and profile.profile_key = client.client_key;

insert into public.salons (slug, name, year, status, starts_on, ends_on, location, metadata)
values
  ('smcl-2026', 'SMCL 2026', 2026, 'active', '2026-10-14', '2026-10-18', 'Paris-Le Bourget', '{"priority":true}'::jsonb),
  ('siae-2026', 'SIAE 2026', 2026, 'upcoming', null, null, 'Paris-Le Bourget', '{}'::jsonb)
on conflict (slug) do update set
  name = excluded.name,
  year = excluded.year,
  status = excluded.status,
  starts_on = excluded.starts_on,
  ends_on = excluded.ends_on,
  location = excluded.location,
  updated_at = now();

insert into public.salon_offers (salon_id, slug, name, included_description)
select salon.id, offer.slug, offer.name, offer.included_description
from public.salons salon
cross join (values
  ('confort', 'Confort', 'Formule Confort SMCL'),
  ('prestige', 'Prestige', 'Formule Prestige SMCL')
) as offer(slug, name, included_description)
where salon.slug = 'smcl-2026'
on conflict (salon_id, slug) do update set
  name = excluded.name,
  included_description = excluded.included_description,
  updated_at = now();

insert into public.stand_presets (salon_id, offer_id, name, description, layout, base_config)
select salon.id, offer.id, 'Scène de base ' || offer.name, 'Objets inclus et placement de base pour la formule ' || offer.name, 'u', jsonb_build_object('included_items_price_mode', 'included')
from public.salons salon
join public.salon_offers offer on offer.salon_id = salon.id
where salon.slug = 'smcl-2026'
on conflict do nothing;

update public.monday_sources source
set salon_id = salon.id,
    offer_id = offer.id
from public.salons salon
join public.salon_offers offer on offer.salon_id = salon.id
where salon.slug = 'smcl-2026'
  and lower(source.salon) = 'smcl'
  and lower(source.offer) = lower(offer.name);

update public.scenes scene
set salon_id = salon.id,
    offer_id = offer.id
from public.salons salon, public.salon_offers offer
where salon.slug = 'smcl-2026'
  and offer.salon_id = salon.id
  and lower(offer.name) = lower(scene.offer)
  and lower(scene.salon) = 'smcl';

update public.scenes scene
set exhibitor_user_id = client.user_profile_id
from public.clients client
where scene.client_id = client.id
  and scene.exhibitor_user_id is null;

insert into public.exhibitor_salon_memberships (user_profile_id, client_id, salon_id, metadata)
select distinct client.user_profile_id, client.id, scene.salon_id, jsonb_build_object('source', 'scene_backfill')
from public.scenes scene
join public.clients client on client.id = scene.client_id
where client.user_profile_id is not null
  and scene.salon_id is not null
on conflict (user_profile_id, client_id, salon_id) do update set
  updated_at = now();
