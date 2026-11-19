-- One indexed lookup per requested scene, not a global history limit that can
-- hide quieter scenes. Background Monday/SFTP updates are not client activity.
create or replace function public.latest_scene_configuration_activity(p_scene_ids text[])
returns table(scene_id text, action text, actor_name text, created_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select latest.scene_id, latest.action, latest.actor_name, latest.created_at
  from (select distinct unnest(p_scene_ids) as id) requested
  cross join lateral (
    select e.scene_id, e.action, e.actor_name, e.created_at
    from public.admin_audit_events e
    where e.scene_id = requested.id and e.actor_kind in ('admin', 'exposant')
    order by e.created_at desc, e.id desc
    limit 1
  ) latest;
$$;

revoke all on function public.latest_scene_configuration_activity(text[]) from public, anon, authenticated;
grant execute on function public.latest_scene_configuration_activity(text[]) to service_role;
