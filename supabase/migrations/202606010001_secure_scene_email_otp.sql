create table if not exists public.scene_access_requests (
  scene_id text primary key references public.scenes(id) on delete cascade,
  requested_at timestamptz not null default now()
);

alter table public.scene_access_requests enable row level security;
revoke all on table public.scene_access_requests from anon, authenticated;
drop policy if exists "deny public scene_access_requests" on public.scene_access_requests;
create policy "deny public scene_access_requests"
  on public.scene_access_requests
  for all
  to public
  using (false)
  with check (false);

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to authenticated;

create or replace function private.current_email()
returns text
language sql
stable
set search_path = ''
as $$
  select lower(coalesce((select auth.jwt() ->> 'email'), ''));
$$;

revoke all on function private.current_email() from public;
grant execute on function private.current_email() to authenticated;

create or replace function private.can_access_scene(target_scene_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select private.is_admin())
    or exists (
      select 1
      from public.scenes
      where id = target_scene_id
        and lower(client_email) = (select private.current_email())
    );
$$;

revoke all on function private.can_access_scene(text) from public;
grant execute on function private.can_access_scene(text) to authenticated;

drop function if exists public.is_admin();

drop policy if exists "public read scenes" on public.scenes;
drop policy if exists "public write scenes" on public.scenes;
drop policy if exists "client or admin read scenes" on public.scenes;
drop policy if exists "client or admin update scenes" on public.scenes;
create policy "client or admin read scenes"
  on public.scenes
  for select
  to authenticated
  using (
    (select private.is_admin())
    or lower(client_email) = (select private.current_email())
  );
create policy "client or admin update scenes"
  on public.scenes
  for update
  to authenticated
  using (
    (select private.is_admin())
    or lower(client_email) = (select private.current_email())
  )
  with check (
    (select private.is_admin())
    or lower(client_email) = (select private.current_email())
  );

drop policy if exists "public read scene_items" on public.scene_items;
drop policy if exists "public write scene_items" on public.scene_items;
drop policy if exists "client or admin access scene_items" on public.scene_items;
create policy "client or admin access scene_items"
  on public.scene_items
  for all
  to authenticated
  using ((select private.can_access_scene(scene_id)))
  with check ((select private.can_access_scene(scene_id)));

drop policy if exists "public read scene_files" on public.scene_files;
drop policy if exists "public write scene_files" on public.scene_files;
drop policy if exists "client or admin access scene_files" on public.scene_files;
create policy "client or admin access scene_files"
  on public.scene_files
  for all
  to authenticated
  using ((select private.can_access_scene(scene_id)))
  with check ((select private.can_access_scene(scene_id)));

drop policy if exists "public write object_bank" on public.object_bank;
drop policy if exists "admin write object_bank" on public.object_bank;
drop policy if exists "admin insert object_bank" on public.object_bank;
drop policy if exists "admin update object_bank" on public.object_bank;
drop policy if exists "admin delete object_bank" on public.object_bank;
create policy "admin insert object_bank"
  on public.object_bank
  for insert
  to authenticated
  with check ((select private.is_admin()));
create policy "admin update object_bank"
  on public.object_bank
  for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
create policy "admin delete object_bank"
  on public.object_bank
  for delete
  to authenticated
  using ((select private.is_admin()));

drop policy if exists "admin read monday_sources" on public.monday_sources;
drop policy if exists "admin write monday_sources" on public.monday_sources;
create policy "admin access monday_sources"
  on public.monday_sources
  for all
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists "admin read monday_sync_runs" on public.monday_sync_runs;
drop policy if exists "admin write monday_sync_runs" on public.monday_sync_runs;
create policy "admin access monday_sync_runs"
  on public.monday_sync_runs
  for all
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists "admin users can read themselves" on public.admin_users;
create policy "admin users can read themselves"
  on public.admin_users
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create index if not exists monday_sync_runs_source_idx
  on public.monday_sync_runs(source_id);
