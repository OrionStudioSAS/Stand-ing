alter table public.admin_users
  add column if not exists is_active boolean not null default true;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = (select auth.uid()) and is_active = true
  );
$$;

revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = (select auth.uid()) and is_active = true
  );
$$;

drop policy if exists "admin users can read themselves" on public.admin_users;
create policy "admin users can read themselves" on public.admin_users
  for select to authenticated
  using ((select auth.uid()) = user_id and is_active = true);

create table if not exists public.admin_audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_name text not null default 'Système',
  action text not null,
  detail text not null default '',
  salon text,
  target_id text,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_events_created_at_idx
  on public.admin_audit_events (created_at desc);

alter table public.admin_audit_events enable row level security;
revoke all on public.admin_audit_events from anon, authenticated;

create or replace function private.audit_admin_content_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_label text;
  event_action text;
  event_detail text;
  event_salon text;
  event_target text;
begin
  select coalesce(nullif(full_name, ''), email)
    into actor_label
    from public.admin_users
   where user_id = actor_id;
  actor_label := coalesce(actor_label, 'Système');

  if tg_table_name = 'scenes' then
    if tg_op <> 'UPDATE' then return new; end if;
    if old.client_status is distinct from new.client_status then
      if new.client_status = 'configured' then event_action := 'Config terminée'; end if;
      if new.client_status = 'bat_review' then event_action := 'BAT envoyé'; end if;
      if new.client_status = 'bat_validated' then event_action := 'BAT validé'; end if;
    end if;
    if event_action is null and old.status is distinct from new.status then
      if new.status = 'configured' then event_action := 'Config terminée'; end if;
      if new.status = 'validated' then event_action := 'BAT validé'; end if;
    end if;
    if event_action is null then return new; end if;
    event_detail := coalesce(nullif(new.client_name, ''), nullif(new.project_name, ''), 'Scène') || ' — ' || coalesce(nullif(new.event_name, ''), new.salon);
    event_salon := coalesce(nullif(new.event_name, ''), new.salon);
    event_target := new.id;
  elsif tg_table_name = 'object_bank' then
    event_action := case when tg_op = 'INSERT' then 'Asset ajouté' else 'Asset modifié' end;
    event_detail := new.label;
    event_target := new.id::text;
  elsif tg_table_name = 'stand_presets' then
    event_action := case when tg_op = 'INSERT' then 'Preset créé' else 'Preset modifié' end;
    event_detail := new.name;
    event_target := new.id::text;
  else
    return new;
  end if;

  insert into public.admin_audit_events (actor_user_id, actor_name, action, detail, salon, target_id)
  values (actor_id, actor_label, event_action, event_detail, event_salon, event_target);
  return new;
end;
$$;

revoke all on function private.audit_admin_content_change() from public;

drop trigger if exists audit_scene_status on public.scenes;
create trigger audit_scene_status after update on public.scenes
  for each row execute function private.audit_admin_content_change();

drop trigger if exists audit_object_bank on public.object_bank;
create trigger audit_object_bank after insert or update on public.object_bank
  for each row execute function private.audit_admin_content_change();

drop trigger if exists audit_stand_presets on public.stand_presets;
create trigger audit_stand_presets after insert or update on public.stand_presets
  for each row execute function private.audit_admin_content_change();
