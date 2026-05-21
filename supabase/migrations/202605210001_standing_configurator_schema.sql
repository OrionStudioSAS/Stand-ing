create extension if not exists "pgcrypto";

create table if not exists public.scenes (
  id text primary key default encode(gen_random_bytes(16), 'hex'),
  share_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  monday_item_id text unique,
  monday_board_id text,
  monday_group_id text,
  salon text not null,
  offer text not null,
  status text not null default 'created'
    check (status in ('created', 'configured', 'bat_pending', 'validated', 'archived')),
  client_status text not null default 'not_started'
    check (client_status in ('not_started', 'draft', 'configured', 'bat_review', 'bat_validated')),
  client_name text,
  client_email text,
  project_name text,
  event_name text,
  width_m numeric(8,2) not null default 4,
  depth_m numeric(8,2) not null default 3,
  height_m numeric(8,2) not null default 2.5,
  layout text not null default 'u' check (layout in ('back', 'left', 'right', 'u')),
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scene_items (
  id uuid primary key default gen_random_uuid(),
  scene_id text not null references public.scenes(id) on delete cascade,
  item_uid text not null,
  type text not null,
  label text,
  x numeric(8,3) not null default 0,
  y numeric(8,3) not null default 0,
  z numeric(8,3) not null default 0,
  rotation numeric(8,3) not null default 0,
  wall text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.scene_files (
  id uuid primary key default gen_random_uuid(),
  scene_id text not null references public.scenes(id) on delete cascade,
  type text not null check (type in ('technical_plan', 'bat', 'client_annotation', 'asset', 'other')),
  file_name text not null,
  storage_path text,
  public_url text,
  status text not null default 'created',
  created_at timestamptz not null default now()
);

create table if not exists public.object_bank (
  id uuid primary key default gen_random_uuid(),
  type text not null unique,
  label text not null,
  model_url text,
  thumbnail_url text,
  dimensions jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.monday_sources (
  id uuid primary key default gen_random_uuid(),
  salon text not null,
  offer text not null,
  board_id text not null,
  group_id text,
  create_column_id text not null default 'creer_la_scene',
  create_trigger_values text[] not null default array['OK', 'OUI'],
  status_column_id text not null default 'statut_scene',
  created_status_label text not null default 'ENVOYE PAR MAIL',
  link_column_id text not null default 'lien_scene',
  mapping jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (salon, offer)
);

create table if not exists public.monday_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.monday_sources(id) on delete set null,
  status text not null default 'started',
  processed_count integer not null default 0,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists scenes_salon_offer_idx on public.scenes (salon, offer);
create index if not exists scenes_status_idx on public.scenes (status, client_status);
create index if not exists scene_items_scene_idx on public.scene_items (scene_id);
create index if not exists scene_files_scene_idx on public.scene_files (scene_id);

alter table public.scenes enable row level security;
alter table public.scene_items enable row level security;
alter table public.scene_files enable row level security;
alter table public.object_bank enable row level security;
alter table public.monday_sources enable row level security;
alter table public.monday_sync_runs enable row level security;

create policy "public read scenes" on public.scenes for select using (true);
create policy "public write scenes" on public.scenes for all using (true) with check (true);
create policy "public read scene_items" on public.scene_items for select using (true);
create policy "public write scene_items" on public.scene_items for all using (true) with check (true);
create policy "public read scene_files" on public.scene_files for select using (true);
create policy "public write scene_files" on public.scene_files for all using (true) with check (true);
create policy "public read object_bank" on public.object_bank for select using (true);
create policy "public write object_bank" on public.object_bank for all using (true) with check (true);
create policy "admin read monday_sources" on public.monday_sources for select using (true);
create policy "admin write monday_sources" on public.monday_sources for all using (true) with check (true);
create policy "admin read monday_sync_runs" on public.monday_sync_runs for select using (true);
create policy "admin write monday_sync_runs" on public.monday_sync_runs for all using (true) with check (true);

insert into public.monday_sources (salon, offer, board_id, group_id, create_column_id, create_trigger_values, status_column_id, created_status_label, link_column_id, mapping)
values
  ('SMCL', 'Confort', '18395911999', null, array['OUI', 'OK'], 'statut464', 'ENVOYE PAR MAIL', 'link_mkvkj5ng', '{"client_name":["texte2","texte8"],"client_email":"email","width_m":"chiffres","depth_m":"chiffres9","layout":"color_mkvmbxxb"}'),
  ('SMCL', 'Prestige', '18395912050', null, array['OUI', 'OK'], 'statut464', 'ENVOYE PAR MAIL', 'link_mkv987vg', '{"client_name":["texte2","texte8"],"client_email":"email","width_m":"chiffres","depth_m":"chiffres9","layout":"color_mkvn6znx"}')
on conflict (salon, offer) do update set
  board_id = excluded.board_id,
  group_id = excluded.group_id,
  create_column_id = excluded.create_column_id,
  create_trigger_values = excluded.create_trigger_values,
  status_column_id = excluded.status_column_id,
  created_status_label = excluded.created_status_label,
  link_column_id = excluded.link_column_id,
  mapping = excluded.mapping;

insert into public.object_bank (type, label, model_url, dimensions)
values
  ('chair', 'Chaise', null, '{}'::jsonb),
  ('table', 'Table', null, '{}'::jsonb),
  ('screen', 'Ecran', null, '{}'::jsonb),
  ('counter', 'Comptoir', null, '{}'::jsonb),
  ('obj-cloison', 'Cloison 1x2.5m', '/models/Cloison%201x2.5m%20HT%20(1).obj', '{"size":[1,2.5,0.06]}'::jsonb),
  ('obj-podium', 'Podium 50cm', '/models/Poidum%20Blanc%2050x50x50cm.obj', '{"size":[0.5,0.5,0.5]}'::jsonb),
  ('obj-porte', 'Porte poussant', '/models/Porte%20Poussant%20Gauche%20(1).obj', '{"size":[1,2.5,0.24]}'::jsonb),
  ('obj-meuble-bas', 'Meuble bas', '/models/Simulateur%20Stand-ING%20Meuble%20Bas.obj', '{"size":[1.04,0.54,0.5]}'::jsonb),
  ('obj-porte-doc', 'Porte document', '/models/Simulateur%20Stand-ING.obj', '{"size":[0.3,1.4,0.3]}'::jsonb),
  ('obj-tabouret', 'Tabouret SIAE', '/models/TABOURET%20SIAE.obj', '{"size":[0.52,0.86,0.5]}'::jsonb)
on conflict (type) do update set
  label = excluded.label,
  model_url = excluded.model_url,
  dimensions = excluded.dimensions;
