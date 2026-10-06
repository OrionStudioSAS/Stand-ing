alter table public.admin_audit_events
  add column if not exists scene_id text,
  add column if not exists scene_name text,
  add column if not exists actor_email text,
  add column if not exists actor_kind text,
  add column if not exists target_type text not null default 'other',
  add column if not exists changes jsonb not null default '[]'::jsonb;

create index if not exists admin_audit_events_scene_history_idx
  on public.admin_audit_events (scene_id, created_at desc, id desc);
create index if not exists admin_audit_events_actor_history_idx
  on public.admin_audit_events (actor_user_id, created_at desc, id desc);

create or replace function private.audit_value(p_value jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or p_value = 'null'::jsonb then '—'
    when jsonb_typeof(p_value) in ('string', 'number', 'boolean') then left(p_value #>> '{}', 120)
    when jsonb_typeof(p_value) = 'array' then jsonb_array_length(p_value)::text || ' élément(s)'
    else 'Modifié'
  end;
$$;

revoke all on function private.audit_value(jsonb) from public;

create or replace function private.write_scene_audit(
  p_scene_id text,
  p_action text,
  p_detail text,
  p_changes jsonb,
  p_target_type text,
  p_target_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  scene_row public.scenes%rowtype;
  actor_id uuid := auth.uid();
  actor_mail text;
  actor_label text;
  actor_role text;
begin
  select * into scene_row from public.scenes where id = p_scene_id;
  if not found then return; end if;

  if actor_id is not null then
    select u.email, a.full_name, a.role_label
      into actor_mail, actor_label, actor_role
      from auth.users u
      left join public.admin_users a on a.user_id = u.id
     where u.id = actor_id;
    actor_label := coalesce(nullif(actor_label, ''), nullif(actor_mail, ''), 'Utilisateur');
  else
    actor_label := 'Système';
  end if;

  insert into public.admin_audit_events
    (actor_user_id, actor_name, actor_email, actor_kind, action, detail, salon, target_id, target_type, scene_id, scene_name, changes)
  values
    (actor_id, actor_label, actor_mail,
     case when actor_id is null then 'system' when actor_role is not null then 'admin' else 'exposant' end,
     p_action, p_detail, coalesce(nullif(scene_row.event_name, ''), scene_row.salon),
     p_target_id, p_target_type, p_scene_id,
     coalesce(nullif(scene_row.client_name, ''), nullif(scene_row.project_name, ''), p_scene_id),
     coalesce(p_changes, '[]'::jsonb));
end;
$$;

revoke all on function private.write_scene_audit(text, text, text, jsonb, text, text) from public;

create or replace function private.audit_scene_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_action text;
  fields text[] := array[]::text[];
  differences jsonb := '[]'::jsonb;
  option_key text;
  field_label text;
  before_value jsonb;
  after_value jsonb;
  scene_label text;
begin
  if old.client_status is distinct from new.client_status then
    event_action := case new.client_status
      when 'draft' then 'Configuration commencée'
      when 'configured' then 'Configuration terminée'
      when 'bat_review' then 'BAT envoyé'
      when 'bat_validated' then 'BAT validé'
      else null end;
  end if;
  if event_action is null and old.status is distinct from new.status then
    event_action := case new.status
      when 'bat_pending' then 'Demande envoyée'
      when 'configured' then 'Configuration terminée'
      when 'validated' then 'BAT validé'
      else null end;
  end if;

  if old.width_m is distinct from new.width_m or old.depth_m is distinct from new.depth_m then
    fields := array_append(fields, 'Dimensions du stand');
    differences := differences || jsonb_build_array(jsonb_build_object(
      'field', 'Dimensions du stand',
      'before', old.width_m::text || ' × ' || old.depth_m::text || ' m',
      'after', new.width_m::text || ' × ' || new.depth_m::text || ' m'));
  end if;
  if old.layout is distinct from new.layout then
    fields := array_append(fields, 'Implantation');
    differences := differences || jsonb_build_array(jsonb_build_object('field', 'Implantation', 'before', old.layout, 'after', new.layout));
  end if;
  if old.client_name is distinct from new.client_name or old.project_name is distinct from new.project_name then
    fields := array_append(fields, 'Nom du stand');
    differences := differences || jsonb_build_array(jsonb_build_object('field', 'Nom du stand', 'before', coalesce(old.client_name, old.project_name), 'after', coalesce(new.client_name, new.project_name)));
  end if;
  if old.source_payload->'contactDetails' is distinct from new.source_payload->'contactDetails' then
    fields := array_append(fields, 'Coordonnées exposant');
    differences := differences || jsonb_build_array(jsonb_build_object('field', 'Coordonnées exposant'));
  end if;

  foreach option_key in array array[
    'carpetColorName', 'carpetFootprintColorName', 'wallFabricColorName',
    'reserveWallFabricColorName', 'technicalFloorLabel', 'technicalFloorType',
    'reserveOptionType', 'ledRailsEnabled', 'ledSpotCount', 'carpetThick',
    'partitionHeadCompany', 'partitionHeadVisuals', 'wallCovers',
    'reserveOptions', 'prestigeArchEnabled', 'prestigeArchTvEnabled',
    'prestigeSignageEnabled'
  ] loop
    before_value := old.source_payload->'options'->option_key;
    after_value := new.source_payload->'options'->option_key;
    if before_value is not distinct from after_value then continue; end if;
    field_label := case option_key
      when 'carpetColorName' then 'Couleur moquette'
      when 'carpetFootprintColorName' then 'Couleur empreinte moquette'
      when 'wallFabricColorName' then 'Couleur coton cloison'
      when 'reserveWallFabricColorName' then 'Couleur réserve'
      when 'technicalFloorLabel' then 'Sol technique'
      when 'technicalFloorType' then 'Type de sol technique'
      when 'reserveOptionType' then 'Réserve'
      when 'ledRailsEnabled' then 'Rails LED'
      when 'ledSpotCount' then 'Nombre de spots'
      when 'carpetThick' then 'Moquette épaisse'
      when 'partitionHeadCompany' then 'Texte tête de cloison'
      when 'partitionHeadVisuals' then 'Visuels tête de cloison'
      when 'wallCovers' then 'Bâches de cloison'
      when 'reserveOptions' then 'Options de réserve'
      when 'prestigeArchEnabled' then 'Arche'
      when 'prestigeArchTvEnabled' then 'TV de l’arche'
      when 'prestigeSignageEnabled' then 'Enseigne'
      else option_key end;
    fields := array_append(fields, field_label);
    differences := differences || jsonb_build_array(jsonb_build_object(
      'field', field_label,
      'before', private.audit_value(before_value),
      'after', private.audit_value(after_value)));
  end loop;

  if old.source_payload->'specialRequest'->>'text' is distinct from new.source_payload->'specialRequest'->>'text' then
    fields := array_append(fields, 'Demande spéciale');
    differences := differences || jsonb_build_array(jsonb_build_object('field', 'Demande spéciale'));
  end if;

  if event_action is null and cardinality(fields) = 0 then return new; end if;
  event_action := coalesce(event_action, 'Scène modifiée');
  scene_label := coalesce(nullif(new.client_name, ''), nullif(new.project_name, ''), 'Scène');
  perform private.write_scene_audit(
    new.id, event_action,
    scene_label || case when cardinality(fields) > 0 then ' · ' || array_to_string(fields[1:5], ', ') || case when cardinality(fields) > 5 then '…' else '' end else '' end,
    differences, 'scene', new.id);
  return new;
end;
$$;

revoke all on function private.audit_scene_change() from public;

create or replace function private.audit_scene_item_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_row public.scene_items%rowtype;
  event_action text;
  fields text[] := array[]::text[];
  differences jsonb := '[]'::jsonb;
  option_key text;
  before_value jsonb;
  after_value jsonb;
  item_label text;
begin
  if tg_op = 'DELETE' then item_row := old; else item_row := new; end if;
  item_label := coalesce(nullif(item_row.label, ''), nullif(item_row.type, ''), 'Objet');

  if tg_op = 'INSERT' then
    event_action := 'Objet ajouté';
  elsif tg_op = 'DELETE' then
    event_action := 'Objet retiré';
  else
    if old.x is distinct from new.x or old.y is distinct from new.y or old.z is distinct from new.z or old.wall is distinct from new.wall then
      fields := array_append(fields, 'Position');
      differences := differences || jsonb_build_array(jsonb_build_object('field', 'Position',
        'before', concat_ws(', ', old.x, old.y, old.z, old.wall),
        'after', concat_ws(', ', new.x, new.y, new.z, new.wall)));
    end if;
    if old.rotation is distinct from new.rotation then
      fields := array_append(fields, 'Rotation');
      differences := differences || jsonb_build_array(jsonb_build_object('field', 'Rotation', 'before', old.rotation::text, 'after', new.rotation::text));
    end if;
    if old.config->'color' is distinct from new.config->'color' then
      fields := array_append(fields, 'Couleur');
      differences := differences || jsonb_build_array(jsonb_build_object('field', 'Couleur', 'before', private.audit_value(old.config->'color'), 'after', private.audit_value(new.config->'color')));
    end if;
    foreach option_key in array array[
      'variantLabel', 'variantId', 'variantColorSelections', 'binary2ColorName',
      'binary3ImageName', 'binary3VisualPending', 'signatureArchColorName',
      'signatureArchVariantLabel', 'fileCheck', 'extraOptions', 'globalExtraOptions',
      'textureSlotValues'
    ] loop
      before_value := old.config->'options'->option_key;
      after_value := new.config->'options'->option_key;
      if before_value is not distinct from after_value then continue; end if;
      fields := array_append(fields, option_key);
      differences := differences || jsonb_build_array(jsonb_build_object(
        'field', option_key,
        'before', private.audit_value(before_value),
        'after', private.audit_value(after_value)));
    end loop;
    if cardinality(fields) = 0 then return new; end if;
    event_action := case when fields = array['Position']::text[] then 'Objet déplacé'
      when fields = array['Rotation']::text[] then 'Objet tourné'
      else 'Objet modifié' end;
  end if;

  perform private.write_scene_audit(
    item_row.scene_id, event_action,
    item_label || case when cardinality(fields) > 0 then ' · ' || array_to_string(fields[1:4], ', ') else '' end,
    differences, 'scene_item', item_row.item_uid);
  return item_row;
end;
$$;

revoke all on function private.audit_scene_item_change() from public;

drop trigger if exists audit_scene_status on public.scenes;
create trigger audit_scene_history after update on public.scenes
  for each row execute function private.audit_scene_change();

drop trigger if exists audit_scene_item_history on public.scene_items;
create trigger audit_scene_item_history after insert or update or delete on public.scene_items
  for each row execute function private.audit_scene_item_change();
