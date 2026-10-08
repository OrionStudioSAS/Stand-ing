-- Return before planning private.is_admin(): backend roles do not have access
-- to the private schema, even when the other side of an OR would be true.
create or replace function private.guard_scene_exhibitor_lock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if (select private.is_admin()) then
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
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if (select private.is_admin()) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op <> 'INSERT' then old_scene_id := old.scene_id; end if;
  if tg_op <> 'DELETE' then new_scene_id := new.scene_id; end if;
  -- Keep the parent locked while checking for concurrent admin lock changes.
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
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.guard_locked_scene_children() from public;
