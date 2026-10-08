alter table public.monday_sync_runs
  add column if not exists actor_user_id uuid references auth.users(id) on delete set null,
  add column if not exists actor_name text,
  add column if not exists finished_at timestamptz,
  add column if not exists duration_ms integer,
  add column if not exists source_ids uuid[] not null default '{}',
  add column if not exists result jsonb not null default '{}'::jsonb;

create index if not exists monday_sync_runs_history_idx
  on public.monday_sync_runs(created_at desc, id desc);

-- History is server-written; the existing admin-only RLS policy still controls reads.
revoke insert, update, delete on public.monday_sync_runs from authenticated, anon;
grant select on public.monday_sync_runs to authenticated;

-- Merge only Monday-owned fields against the current row. Batched reads must not
-- overwrite options, requests or lock changes saved by a client/admin meanwhile.
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
begin
  update public.scenes
    set source_payload = coalesce(source_payload, '{}'::jsonb) ||
          case when client_status = 'configured'
            and coalesce(offer, '') !~* '(^|[^a-z])signature([^a-z]|$)'
          then coalesce(p_source_patch, '{}'::jsonb) - 'packBenefits' - 'baseItems'
          else coalesce(p_source_patch, '{}'::jsonb) end,
        client_email = coalesce(nullif(trim(client_email), ''), nullif(p_client_email, ''), client_email),
        client_name = coalesce(nullif(trim(client_name), ''), nullif(p_client_name, ''), client_name)
    where id = p_scene_id;
  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

revoke all on function public.patch_scene_from_monday(text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.patch_scene_from_monday(text, jsonb, text, text) to service_role;
