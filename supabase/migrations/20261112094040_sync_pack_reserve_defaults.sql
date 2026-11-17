create or replace function public.apply_scene_base_preset_payload()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  preset_config jsonb;
  offer_metadata jsonb;
  reserve_rules jsonb;
  partition_head_rules jsonb;
  base_items jsonb;
  current_payload jsonb := coalesce(new.source_payload, '{}'::jsonb);
  current_pricing jsonb := coalesce(nullif(current_payload->'pricing', 'null'::jsonb), '{}'::jsonb);
begin
  if new.base_preset_id is null then
    return new;
  end if;

  select sp.base_config, coalesce(so.metadata, '{}'::jsonb)
    into preset_config, offer_metadata
  from public.stand_presets sp
  left join public.salon_offers so on so.id = sp.offer_id
  where sp.id = new.base_preset_id;

  if preset_config is null then
    return new;
  end if;

  reserve_rules := coalesce(nullif(preset_config->'reserveRules', 'null'::jsonb),
    nullif(preset_config#>'{options,reserveRules}', 'null'::jsonb), '{}'::jsonb);

  if tg_op = 'UPDATE' and old.base_preset_id = new.base_preset_id then
    if nullif(btrim(current_payload#>>'{options,reserveOptionType}'), '') is not null
      or current_payload#>>'{options,reserveUpgradeEnabled}' = 'true'
      or (
        (old.status <> 'created' or old.client_status not in ('not_started', 'draft')
          or old.source_payload->>'exhibitor_view_only' = 'true') is true
        and
        (new.status <> 'created' or new.client_status not in ('not_started', 'draft')
          or current_payload->>'exhibitor_view_only' = 'true') is true
      )
    then
      reserve_rules := coalesce(nullif(old.source_payload->'reserveRules', 'null'::jsonb),
        nullif(old.source_payload->'reserve_rules', 'null'::jsonb),
        nullif(old.source_payload#>'{pricing,reserveRules}', 'null'::jsonb),
        nullif(old.source_payload#>'{options,reserveRules}', 'null'::jsonb), reserve_rules);
    elsif current_payload->'reserveRules' = reserve_rules
      and current_pricing->'reserveRules' = reserve_rules
      and (current_payload - 'reserveRules' - 'pricing') = (old.source_payload - 'reserveRules' - 'pricing')
      and (current_pricing - 'reserveRules') =
        (coalesce(nullif(old.source_payload->'pricing', 'null'::jsonb), '{}'::jsonb) - 'reserveRules')
      and current_payload is distinct from old.source_payload
    then
      -- Propagation changes only the reserve snapshot, not other pack defaults.
      return new;
    end if;
  end if;

  partition_head_rules := coalesce(preset_config->'partitionHeadRules', preset_config#>'{options,partitionHeadRules}', '{}'::jsonb);
  base_items := case
    when jsonb_typeof(offer_metadata->'baseItems') = 'array' then offer_metadata->'baseItems'
    else '[]'::jsonb
  end;
  new.source_payload := current_payload || jsonb_build_object(
    'baseItems', base_items,
    'reserveRules', reserve_rules,
    'partitionHeadRules', partition_head_rules,
    'pricing', current_pricing || jsonb_build_object(
      'baseItems', base_items,
      'reserveRules', reserve_rules,
      'partitionHeadRules', partition_head_rules
    )
  );
  return new;
end;
$$;

create function private.refresh_preset_reserve_rules(p_preset_id uuid, p_reserve_rules jsonb, p_min_area numeric default null)
returns void
language sql
set search_path = ''
as $$
  update public.scenes s
  set source_payload = s.source_payload || jsonb_build_object(
        'reserveRules', p_reserve_rules,
        'pricing', coalesce(nullif(s.source_payload->'pricing', 'null'::jsonb), '{}'::jsonb)
          || jsonb_build_object('reserveRules', p_reserve_rules)
      ),
      configuration_revision = s.configuration_revision + 1
  where s.base_preset_id = p_preset_id
    and private.scene_configuration_editable(s.status, s.client_status, s.source_payload)
    and nullif(btrim(s.source_payload#>>'{options,reserveOptionType}'), '') is null
    and s.source_payload#>>'{options,reserveUpgradeEnabled}' is distinct from 'true'
    and (p_min_area is null or s.width_m * s.depth_m >= p_min_area)
    and (s.source_payload->'reserveRules' is distinct from p_reserve_rules
      or s.source_payload#>'{pricing,reserveRules}' is distinct from p_reserve_rules);
$$;
revoke all on function private.refresh_preset_reserve_rules(uuid, jsonb, numeric) from public, anon, authenticated;

create function private.propagate_preset_reserve_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_rules jsonb := coalesce(nullif(old.base_config->'reserveRules', 'null'::jsonb),
    nullif(old.base_config#>'{options,reserveRules}', 'null'::jsonb), '{}'::jsonb);
  next_rules jsonb := coalesce(nullif(new.base_config->'reserveRules', 'null'::jsonb),
    nullif(new.base_config#>'{options,reserveRules}', 'null'::jsonb), '{}'::jsonb);
begin
  if new.is_active and next_rules is distinct from previous_rules then
    perform private.refresh_preset_reserve_rules(new.id, next_rules);
  end if;
  return new;
end;
$$;
revoke all on function private.propagate_preset_reserve_rules() from public, anon, authenticated;

create trigger propagate_preset_reserve_rules
after update of base_config on public.stand_presets
for each row
when (new.base_config is distinct from old.base_config)
execute function private.propagate_preset_reserve_rules();

-- Catch up Confort drafts affected by the already-saved SMCL 2026 change.
do $$
declare
  preset record;
begin
  for preset in
    select p.id, p.base_config->'reserveRules' as rules
    from public.stand_presets p
    join public.salon_offers o on o.id = p.offer_id
    join public.salons sl on sl.id = p.salon_id
    where p.is_active and sl.slug = 'smcl-2026' and lower(btrim(o.name)) = 'confort'
      and nullif(p.base_config#>>'{reserveRules,large,includedType}', '') is not null
  loop
    perform private.refresh_preset_reserve_rules(preset.id, preset.rules, 25);
  end loop;
end;
$$;
