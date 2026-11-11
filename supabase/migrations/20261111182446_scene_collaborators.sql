create table public.scene_collaborators (
  id uuid primary key default gen_random_uuid(),
  scene_id text not null references public.scenes(id) on delete cascade,
  slot smallint not null check (slot between 1 and 2),
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 254),
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  code_requested_at timestamptz,
  unique (scene_id, slot),
  unique (scene_id, email),
  check ((accepted_at is null) = (user_id is null))
);

alter table public.scene_collaborators enable row level security;
revoke all on public.scene_collaborators from public, anon, authenticated;
grant select, insert, update, delete on public.scene_collaborators to service_role;
create index scene_collaborators_user_idx on public.scene_collaborators(user_id);

create function private.is_scene_collaborator(target_scene_id text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.scene_collaborators c
    where c.scene_id = target_scene_id and c.user_id = (select auth.uid())
      and c.email = (select private.current_email()) and c.accepted_at is not null
  );
$$;
revoke all on function private.is_scene_collaborator(text) from public, anon;
grant execute on function private.is_scene_collaborator(text) to authenticated;

create policy "collaborators read their scene" on public.scenes
  for select to authenticated using ((select private.is_scene_collaborator(id)));

create policy "collaborators read their scene items" on public.scene_items
  for select to authenticated using ((select private.is_scene_collaborator(scene_id)));

create policy "collaborators read their scene files" on public.scene_files
  for select to authenticated using ((select private.is_scene_collaborator(scene_id)));

create function private.can_upload_scene_visual(target_scene_id text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select private.is_admin()) or exists (
    select 1 from public.scenes s where s.id = target_scene_id
      and s.source_payload->>'exhibitor_view_only' is distinct from 'true'
      and (
        lower(s.client_email) = (select private.current_email())
        or (s.status = 'created' and s.client_status in ('not_started', 'draft')
          and (select private.is_scene_collaborator(target_scene_id)))
      )
  );
$$;
revoke all on function private.can_upload_scene_visual(text) from public, anon;
grant execute on function private.can_upload_scene_visual(text) to authenticated;

drop policy "client insert scene option uploads" on storage.objects;
drop policy "client update scene option uploads" on storage.objects;
create policy "scene editors insert option uploads" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'object-assets' and (storage.foldername(name))[1] = 'scene-options'
    and (select private.can_upload_scene_visual((storage.foldername(name))[2]))
  );
create policy "scene editors update option uploads" on storage.objects
  for update to authenticated using (
    bucket_id = 'object-assets' and (storage.foldername(name))[1] = 'scene-options'
    and (select private.can_upload_scene_visual((storage.foldername(name))[2]))
  ) with check (
    bucket_id = 'object-assets' and (storage.foldername(name))[1] = 'scene-options'
    and (select private.can_upload_scene_visual((storage.foldername(name))[2]))
  );
create policy "collaborators read option uploads" on storage.objects
  for select to authenticated using (
    bucket_id = 'object-assets' and (storage.foldername(name))[1] = 'scene-options'
    and (select private.is_scene_collaborator((storage.foldername(name))[2]))
  );

create policy "collaborators read uploaded visuals" on public.scene_uploaded_files
  for select to authenticated using ((select private.is_scene_collaborator(scene_id)));
create policy "collaborators insert uploaded visuals" on public.scene_uploaded_files
  for insert to authenticated with check (
    (select private.is_scene_collaborator(scene_id)) and (select private.can_upload_scene_visual(scene_id))
    and uploaded_by = (select auth.uid())
  );
create policy "collaborators update uploaded visuals" on public.scene_uploaded_files
  for update to authenticated using (
    (select private.is_scene_collaborator(scene_id)) and (select private.can_upload_scene_visual(scene_id))
  ) with check (
    (select private.is_scene_collaborator(scene_id)) and (select private.can_upload_scene_visual(scene_id))
  );

-- Collaborators may replace an artwork, but not rewrite the previous file's metadata.
create function private.guard_collaborator_visual_replacement()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_user = 'authenticated' and (select private.is_scene_collaborator(old.scene_id))
    and not (select private.can_access_scene(old.scene_id))
    and (new.is_active or (to_jsonb(new) - 'is_active') is distinct from (to_jsonb(old) - 'is_active'))
  then
    raise exception using errcode = '42501', message = 'Un collaborateur peut seulement remplacer un visuel.';
  end if;
  return new;
end;
$$;
create trigger guard_collaborator_visual_replacement before update on public.scene_uploaded_files
  for each row execute function private.guard_collaborator_visual_replacement();

alter table public.scenes add column configuration_revision integer not null default 0;

create function private.bump_configuration_revision()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.configuration_revision is distinct from old.configuration_revision
    or row(new.status, new.client_status, new.client_email, new.client_name, new.project_name, new.event_name,
      new.width_m, new.depth_m, new.height_m, new.layout, new.salon, new.offer, new.base_preset_id,
      new.source_payload->'options', new.source_payload->'contactDetails', new.source_payload->'specialRequest',
      new.source_payload->'exhibitor_view_only')
      is distinct from
    row(old.status, old.client_status, old.client_email, old.client_name, old.project_name, old.event_name,
      old.width_m, old.depth_m, old.height_m, old.layout, old.salon, old.offer, old.base_preset_id,
      old.source_payload->'options', old.source_payload->'contactDetails', old.source_payload->'specialRequest',
      old.source_payload->'exhibitor_view_only')
  then
    new.configuration_revision := old.configuration_revision + 1;
  end if;
  return new;
end;
$$;
create trigger bump_configuration_revision before update on public.scenes
  for each row execute function private.bump_configuration_revision();

-- Scene options and objects are one revision: either both are saved or neither is.
create function private.save_configurator_scene(
  p_scene_id text, p_revision integer, p_scene jsonb, p_items jsonb, p_manual_order_lines jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  current_scene public.scenes%rowtype;
  proposed public.scenes%rowtype;
  actor_id uuid := auth.uid();
  actor_email text := private.current_email();
  administrator boolean;
  collaborator boolean;
  source_patch jsonb;
begin
  if actor_id is null or not (select private.can_access_scene(p_scene_id) or private.is_scene_collaborator(p_scene_id)) then
    raise exception using errcode = '42501', message = 'Accès refusé à cette scène.';
  end if;

  select * into current_scene from public.scenes where id = p_scene_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'Accès refusé à cette scène.';
  end if;

  select exists (
    select 1 from public.admin_users where user_id = actor_id and is_active and lower(role_label) !~ 'dessinateur|dessinatrice'
  ) into administrator;
  collaborator := not administrator and lower(coalesce(current_scene.client_email, '')) <> actor_email;
  if collaborator then
    perform 1 from public.scene_collaborators where scene_id = p_scene_id and user_id = actor_id
      and email = actor_email and accepted_at is not null for share;
    if not found then
      raise exception using errcode = '42501', message = 'Votre accès à cette scène a été retiré.';
    end if;
    if current_scene.status <> 'created' or current_scene.client_status not in ('not_started', 'draft') then
      raise exception using errcode = '42501', message = 'Ce stand a déjà été validé. Le brouillon n’est plus modifiable.';
    end if;
    if not coalesce(
      (p_scene->>'status' = 'created' and p_scene->>'client_status' = 'draft')
      or (p_scene->>'status' in ('configured', 'bat_pending') and p_scene->>'client_status' = 'configured'), false
    ) then
      raise exception using errcode = '42501', message = 'Ce changement de statut n’est pas autorisé.';
    end if;
  elsif not administrator and actor_email = '' then
    raise exception using errcode = '42501', message = 'Accès refusé à cette scène.';
  end if;

  if not administrator and current_scene.source_payload->>'exhibitor_view_only' = 'true' then
    raise exception using errcode = '42501', message = 'Cette scène est en lecture seule.';
  end if;
  if current_scene.configuration_revision is distinct from p_revision
    or current_scene.source_payload->'manualPurchaseOrderLines' is distinct from nullif(p_manual_order_lines, 'null'::jsonb)
  then
    raise exception using errcode = 'PT409', message = 'Cette scène a été modifiée ailleurs. Rechargez-la avant de continuer.';
  end if;

  proposed := jsonb_populate_record(current_scene, p_scene);
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into source_patch
  from jsonb_each(coalesce(p_scene->'source_payload', '{}'::jsonb))
  where key in ('options', 'pricing', 'packBenefits', 'partitionHeadCompany', 'specialRequest')
    or (not collaborator and key = 'contactDetails');
  if collaborator and source_patch->'specialRequest' ? 'status' then
    source_patch := jsonb_set(source_patch, '{specialRequest,status}',
      to_jsonb(case when coalesce(source_patch#>>'{specialRequest,text}', '') = '' then '' else 'pending' end));
    if source_patch ? 'options' then
      source_patch := jsonb_set(source_patch, '{options,specialRequest}', source_patch->'specialRequest');
    end if;
  end if;
  if current_scene.status = 'created' and current_scene.client_status in ('not_started', 'draft')
    and proposed.status in ('configured', 'bat_pending') and proposed.client_status = 'configured'
  then
    source_patch := source_patch || jsonb_build_object('configuration_submitted_by', actor_id);
  end if;

  update public.scenes set
    status = proposed.status, client_status = proposed.client_status,
    client_name = case when collaborator then current_scene.client_name else proposed.client_name end,
    client_email = case when administrator then proposed.client_email else current_scene.client_email end,
    project_name = case when collaborator then current_scene.project_name else proposed.project_name end,
    event_name = case when collaborator then current_scene.event_name else proposed.event_name end,
    width_m = case when collaborator then current_scene.width_m else proposed.width_m end,
    depth_m = case when collaborator then current_scene.depth_m else proposed.depth_m end,
    height_m = case when collaborator then current_scene.height_m else proposed.height_m end,
    layout = case when collaborator then current_scene.layout else proposed.layout end,
    source_payload = current_scene.source_payload || source_patch,
    updated_at = clock_timestamp(),
    configuration_revision = current_scene.configuration_revision + 1
  where id = p_scene_id returning * into current_scene;

  -- Keep existing row IDs and only record audit events for actual item changes.
  with incoming as (
    select distinct on (i.item_uid) i.* from jsonb_to_recordset(p_items)
      as i(item_uid text, type text, label text, x numeric, y numeric, z numeric, rotation numeric, wall text, config jsonb)
    where i.item_uid is not null and i.type is not null order by i.item_uid
  ), existing as (
    select distinct on (item_uid) id, item_uid from public.scene_items
    where scene_id = p_scene_id order by item_uid, created_at, id
  ), removed as (
    delete from public.scene_items s where s.scene_id = p_scene_id
      and not exists (select 1 from incoming i join existing e using (item_uid) where e.id = s.id)
  ), changed as (
    update public.scene_items s set
      type = i.type, label = i.label, x = i.x, y = i.y, z = i.z,
      rotation = i.rotation, wall = i.wall, config = i.config
    from incoming i join existing e using (item_uid) where s.id = e.id
      and row(s.type, s.label, s.x, s.y, s.z, s.rotation, s.wall, s.config)
        is distinct from row(i.type, i.label, round(i.x, 3), round(i.y, 3), round(i.z, 3), round(i.rotation, 3), i.wall, i.config)
  )
  insert into public.scene_items (scene_id, item_uid, type, label, x, y, z, rotation, wall, config)
    select p_scene_id, i.item_uid, i.type, i.label, i.x, i.y, i.z, i.rotation, i.wall, i.config
    from incoming i where not exists (select 1 from existing e where e.item_uid = i.item_uid);

  return jsonb_build_object('configuration_revision', current_scene.configuration_revision,
    'updated_at', current_scene.updated_at, 'source_payload', current_scene.source_payload);
end;
$$;
revoke all on function private.save_configurator_scene(text, integer, jsonb, jsonb, jsonb) from public, anon;
grant execute on function private.save_configurator_scene(text, integer, jsonb, jsonb, jsonb) to authenticated;

create function public.save_configurator_scene(
  p_scene_id text, p_revision integer, p_scene jsonb, p_items jsonb, p_manual_order_lines jsonb
)
returns jsonb language sql security invoker set search_path = ''
as $$
  select private.save_configurator_scene(p_scene_id, p_revision, p_scene, p_items, p_manual_order_lines);
$$;
revoke all on function public.save_configurator_scene(text, integer, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_configurator_scene(text, integer, jsonb, jsonb, jsonb) to authenticated;
