-- Run after admin_scene_latest_activity. All fixture events roll back.
begin;
insert into public.admin_audit_events(scene_id, scene_name, actor_kind, actor_name, action, created_at)
values
  ('activity-old', 'Same stand name', 'exposant', 'Older contact', 'Older edit', '2026-11-01T08:00:00Z'),
  ('activity-new', 'Same stand name', 'admin', 'Admin', 'First edit', '2026-11-18T09:00:00Z'),
  ('activity-new', 'Same stand name', 'exposant', 'Latest contact', 'Latest edit', '2026-11-18T09:00:00Z'),
  ('activity-old', 'Same stand name', 'system', 'Monday', 'Background sync', '2040-01-01T00:00:00Z');
insert into public.admin_audit_events(scene_id, actor_kind, actor_name, action, created_at)
select 'activity-noise', 'exposant', 'Other contact', 'Other edit', '2030-01-01T00:00:00Z'
from generate_series(1, 600);

set local role service_role;
do $$
declare
  rows_found integer;
begin
  select count(*) into rows_found from public.latest_scene_configuration_activity(
    array['activity-old', 'activity-new', 'activity-new', 'missing-scene']);
  if rows_found <> 2 then raise exception 'Duplicate names or repeated IDs mixed the scenes'; end if;
  if not exists(select 1 from public.latest_scene_configuration_activity(array['activity-new'])
    where actor_name = 'Latest contact' and action = 'Latest edit') then
    raise exception 'Same-timestamp events were not ordered by their event IDs';
  end if;
  if not exists(select 1 from public.latest_scene_configuration_activity(array['activity-old'])
    where actor_name = 'Older contact' and created_at = '2026-11-01T08:00:00Z') then
    raise exception 'Background sync was counted as a modification or a quiet scene was dropped';
  end if;
  if exists(select 1 from public.latest_scene_configuration_activity('{}')) then
    raise exception 'Empty requests returned activity';
  end if;
end;
$$;
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.latest_scene_configuration_activity(text[])', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.latest_scene_configuration_activity(text[])', 'EXECUTE') then
    raise exception 'Private scene activity is callable outside the authenticated admin endpoint';
  end if;
end;
$$;
select 'PASS: exact per-scene latest human activity, duplicate names, stable ties, background sync exclusion and privileges' as verification;
rollback;
