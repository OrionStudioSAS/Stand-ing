create table public.scene_bat_edits (
  scene_id text primary key references public.scenes(id) on delete cascade,
  edits jsonb not null default '{}'::jsonb check (jsonb_typeof(edits) = 'object' and octet_length(edits::text) <= 1048576),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid()
);

alter table public.scene_bat_edits enable row level security;
revoke all on public.scene_bat_edits from public, anon, authenticated;
grant select, insert on public.scene_bat_edits to authenticated;
grant update (edits) on public.scene_bat_edits to authenticated;

create policy "admins read BAT edits" on public.scene_bat_edits
for select to authenticated using ((select private.is_admin()));
create policy "admins create BAT edits" on public.scene_bat_edits
for insert to authenticated with check ((select private.is_admin()) and updated_by = (select auth.uid()) and revision = 1);
create policy "admins update BAT edits" on public.scene_bat_edits
for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

create function private.track_bat_edit_revision()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
revoke all on function private.track_bat_edit_revision() from public;
create trigger track_bat_edit_revision before update on public.scene_bat_edits
for each row execute function private.track_bat_edit_revision();
