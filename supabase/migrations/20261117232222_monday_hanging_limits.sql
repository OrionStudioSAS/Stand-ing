-- Check the current row rather than the earlier, batched Monday read. The
-- exhibitor may have started configuring while the synchronization was running.
create or replace function public.patch_scene_from_monday(
  p_scene_id text, p_source_patch jsonb, p_client_email text, p_client_name text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer;
  patch jsonb := coalesce(p_source_patch, '{}'::jsonb);
begin
  update public.scenes
    set source_payload = coalesce(source_payload, '{}'::jsonb) ||
          ((case when client_status = 'configured'
            and coalesce(offer, '') !~* '(^|[^a-z])signature([^a-z]|$)'
          then patch - 'packBenefits' - 'baseItems'
          else patch end)
          - case when status = 'created' and client_status = 'not_started'
              and source_payload->>'exhibitor_view_only' is distinct from 'true'
            then array[]::text[] else array['hanging_limits']::text[] end),
        configuration_revision = configuration_revision +
          case when status = 'created' and client_status = 'not_started'
            and source_payload->>'exhibitor_view_only' is distinct from 'true'
            and patch ? 'hanging_limits'
            and source_payload->'hanging_limits' is distinct from patch->'hanging_limits'
          then 1 else 0 end,
        client_email = coalesce(nullif(trim(client_email), ''), nullif(p_client_email, ''), client_email),
        client_name = coalesce(nullif(trim(client_name), ''), nullif(p_client_name, ''), client_name)
    where id = p_scene_id;
  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

revoke all on function public.patch_scene_from_monday(text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.patch_scene_from_monday(text, jsonb, text, text) to service_role;
