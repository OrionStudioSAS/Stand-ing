create or replace function private.guard_scene_exhibitor_lock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') or (select private.is_admin()) then
    return new;
  end if;

  if old.source_payload->>'exhibitor_view_only' = 'true' then
    raise exception using errcode = '42501', message = 'Cette scene est en lecture seule pour l''exposant.';
  end if;
  if old.source_payload->'exhibitor_view_only' is distinct from new.source_payload->'exhibitor_view_only'
    or old.source_payload->'exhibitor_view_only_updated_at' is distinct from new.source_payload->'exhibitor_view_only_updated_at' then
    raise exception using errcode = '42501', message = 'Seul un administrateur peut modifier le verrouillage de la scene.';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_scene_exhibitor_lock() from public;

create trigger guard_scene_exhibitor_lock
before update on public.scenes
for each row execute function private.guard_scene_exhibitor_lock();

create or replace function private.guard_locked_scene_children()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  old_scene_id text;
  new_scene_id text;
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') and not (select private.is_admin()) then
    if tg_op <> 'INSERT' then old_scene_id := old.scene_id; end if;
    if tg_op <> 'DELETE' then new_scene_id := new.scene_id; end if;
    -- Lock the parent while checking, so an admin lock cannot race a child write.
    perform 1 from public.scenes
      where id in (old_scene_id, new_scene_id)
      order by id for share;
    if exists (
      select 1 from public.scenes
      where id in (old_scene_id, new_scene_id)
        and source_payload->>'exhibitor_view_only' = 'true'
    ) then
      raise exception using errcode = '42501', message = 'Cette scene est en lecture seule pour l''exposant.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.guard_locked_scene_children() from public;

create trigger guard_locked_scene_items
before insert or update or delete on public.scene_items
for each row execute function private.guard_locked_scene_children();

create trigger guard_locked_scene_files
before insert or update or delete on public.scene_files
for each row execute function private.guard_locked_scene_children();
