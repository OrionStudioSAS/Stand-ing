create table if not exists public.scene_uploaded_files (
  id uuid primary key default gen_random_uuid(),
  scene_id text not null references public.scenes(id) on delete cascade,
  item_uid text,
  item_type text,
  surface_key text not null,
  surface_label text,
  original_filename text not null,
  original_mime_type text,
  original_size bigint,
  preview_url text,
  preview_storage_path text,
  sftp_remote_dir text,
  sftp_remote_path text,
  version integer not null default 1,
  is_active boolean not null default true,
  uploaded_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists scene_uploaded_files_scene_idx
  on public.scene_uploaded_files(scene_id, surface_key, is_active);

alter table public.scene_uploaded_files enable row level security;

revoke all on table public.scene_uploaded_files from anon;
grant select, insert, update on table public.scene_uploaded_files to authenticated;

drop policy if exists "client or admin read scene uploaded files" on public.scene_uploaded_files;
create policy "client or admin read scene uploaded files"
  on public.scene_uploaded_files
  for select
  to authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1
      from public.scenes s
      where s.id = scene_uploaded_files.scene_id
        and lower(s.client_email) = lower((select auth.email()))
    )
  );

drop policy if exists "client or admin insert scene uploaded files" on public.scene_uploaded_files;
create policy "client or admin insert scene uploaded files"
  on public.scene_uploaded_files
  for insert
  to authenticated
  with check (
    (select private.is_admin())
    or exists (
      select 1
      from public.scenes s
      where s.id = scene_uploaded_files.scene_id
        and lower(s.client_email) = lower((select auth.email()))
    )
  );

drop policy if exists "client or admin update scene uploaded files" on public.scene_uploaded_files;
create policy "client or admin update scene uploaded files"
  on public.scene_uploaded_files
  for update
  to authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1
      from public.scenes s
      where s.id = scene_uploaded_files.scene_id
        and lower(s.client_email) = lower((select auth.email()))
    )
  )
  with check (
    (select private.is_admin())
    or exists (
      select 1
      from public.scenes s
      where s.id = scene_uploaded_files.scene_id
        and lower(s.client_email) = lower((select auth.email()))
    )
  );
