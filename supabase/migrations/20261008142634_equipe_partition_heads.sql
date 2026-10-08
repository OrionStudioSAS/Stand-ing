-- Retain complete model dimensions: only the support's placement footprint changes.
update public.object_bank
set dimensions = coalesce(dimensions, '{}'::jsonb) || jsonb_build_object(
  'placementBounds', jsonb_build_object(
    'minX', case when type like 'asset-tete-de-cloison-siae-gauche-%'
      then (dimensions->'size'->>0)::numeric / 2 - 0.6
      else -(dimensions->'size'->>0)::numeric / 2 end,
    'maxX', case when type like 'asset-tete-de-cloison-siae-gauche-%'
      then (dimensions->'size'->>0)::numeric / 2
      else -(dimensions->'size'->>0)::numeric / 2 + 0.6 end,
    'minZ', -(dimensions->'size'->>2)::numeric / 2,
    'maxZ', (dimensions->'size'->>2)::numeric / 2,
    'height', (dimensions->'size'->>1)::numeric,
    'source', 'siae-head-solid'
  )
)
where (type like 'asset-tete-de-cloison-siae-gauche-%' or type like 'asset-tete-de-cloison-siae-droite-%')
  and (dimensions->'size'->>0)::numeric >= 0.6;

do $$
declare
  preset record;
  band record;
  left_asset record;
  right_asset record;
  old_rules jsonb;
  rules jsonb;
  source_rule jsonb;
  config jsonb;
  pack_row record;
  templates jsonb;
begin
  select type, label into left_asset from public.object_bank
  where type like 'asset-tete-de-cloison-siae-gauche-%'
  order by is_active desc, type limit 1;
  select type, label into right_asset from public.object_bank
  where type like 'asset-tete-de-cloison-siae-droite-%'
  order by is_active desc, type limit 1;

  for preset in
    select sp.* from public.stand_presets sp
    join public.salon_offers so on so.id = sp.offer_id
    join public.packs p on p.id = so.pack_id
    where p.slug = 'equipe'
  loop
    config := coalesce(preset.base_config, '{}'::jsonb);
    old_rules := coalesce(config->'partitionHeadRules', config#>'{options,partitionHeadRules}', '{}'::jsonb);
    rules := '{}'::jsonb;
    for band in select * from (values
      ('small', 'Moins de 12 m²', 0, 11.999, 0),
      ('medium', '12 à 24 m²', 12, 24.999, 1),
      ('large', '25 à 30 m²', 25, 30.999, 2),
      ('extraLarge', '31 m² et plus', 31, null, 2)
    ) as bands(id, label, min_area, max_area, included_count)
    loop
      source_rule := coalesce(old_rules->band.id,
        case when band.id = 'extraLarge' then old_rules->'large' end, '{}'::jsonb);
      rules := rules || jsonb_build_object(band.id, source_rule || jsonb_build_object(
        'id', band.id, 'bandLabel', band.label,
        'minArea', band.min_area, 'maxArea', band.max_area,
        'includedCount', band.included_count,
        'includedSides', case when band.included_count = 1
          then coalesce(source_rule->'includedSides', to_jsonb(array[case when preset.layout = 'right' then 'right' else 'left' end]))
          else '[]'::jsonb end,
        'leftType', coalesce(left_asset.type, source_rule->>'leftType', ''),
        'leftLabel', coalesce(left_asset.label, source_rule->>'leftLabel', 'Tête de cloison gauche'),
        'leftPrice', coalesce(source_rule->'leftPrice', '""'::jsonb),
        'rightType', coalesce(right_asset.type, source_rule->>'rightType', ''),
        'rightLabel', coalesce(right_asset.label, source_rule->>'rightLabel', 'Tête de cloison droite'),
        'rightPrice', coalesce(source_rule->'rightPrice', '""'::jsonb)
      ));
    end loop;
    update public.stand_presets set base_config = config || jsonb_build_object(
      'partitionHeadRules', rules,
      'options', coalesce(config->'options', '{}'::jsonb) || jsonb_build_object('partitionHeadRules', rules)
    ) where id = preset.id;
  end loop;

  -- Future salon activations must use the same corrected global templates.
  for pack_row in select * from public.packs where slug = 'equipe' loop
    select coalesce(jsonb_object_agg(t.layout, t.payload), '{}'::jsonb) into templates
    from (
      select distinct on (sp.layout) sp.layout, jsonb_build_object(
        'width_m', sp.width_m, 'depth_m', sp.depth_m, 'height_m', sp.height_m,
        'layout', sp.layout, 'base_config', sp.base_config,
        'items', coalesce((select jsonb_agg(jsonb_build_object(
          'item_uid', i.item_uid, 'type', i.type, 'label', i.label,
          'x', i.x, 'y', i.y, 'z', i.z, 'rotation', i.rotation, 'wall', i.wall,
          'config', i.config, 'included', i.included, 'price_mode', i.price_mode
        ) order by i.created_at, i.id) from public.stand_preset_items i where i.preset_id = sp.id), '[]'::jsonb)
      ) as payload
      from public.stand_presets sp join public.salon_offers so on so.id = sp.offer_id
      where so.pack_id = pack_row.id and sp.is_active
      order by sp.layout, sp.updated_at desc, sp.id
    ) t;
    update public.packs set metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object('presetTemplates', templates), updated_at = now()
    where id = pack_row.id;
  end loop;

  -- Refresh only rule copies; keep contacts, client choices, objects and scene locks intact.
  update public.scenes sc
  set source_payload = coalesce(sc.source_payload, '{}'::jsonb) || jsonb_build_object(
    'partitionHeadRules', sp.base_config->'partitionHeadRules',
    'options', coalesce(sc.source_payload->'options', '{}'::jsonb)
      || jsonb_build_object('partitionHeadRules', sp.base_config->'partitionHeadRules')
  )
  from public.stand_presets sp
  join public.salon_offers so on so.id = sp.offer_id
  join public.packs p on p.id = so.pack_id
  where sc.base_preset_id = sp.id and p.slug = 'equipe';
end;
$$;
