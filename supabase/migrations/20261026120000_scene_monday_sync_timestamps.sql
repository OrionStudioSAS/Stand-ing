-- One batch per import avoids one extra HTTP/database round trip for every scene.
create or replace function public.stamp_scene_monday_sync(
  p_scene_ids text[], p_direction text, p_synced_at timestamptz default now()
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer;
  field_name text;
begin
  if p_direction is null or p_direction not in ('import', 'export') then
    raise exception 'Invalid Monday synchronization direction';
  end if;
  if p_synced_at is null then
    raise exception 'Missing Monday synchronization timestamp';
  end if;
  field_name := case when p_direction = 'import' then 'monday_synced_at' else 'monday_config_synced_at' end;
  update public.scenes
    set source_payload = jsonb_set(coalesce(source_payload, '{}'::jsonb), array[field_name], to_jsonb(p_synced_at))
    where id = any(p_scene_ids);
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.stamp_scene_monday_sync(text[], text, timestamptz) from public, anon, authenticated;
grant execute on function public.stamp_scene_monday_sync(text[], text, timestamptz) to service_role;
