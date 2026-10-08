-- Match Signature's reserve fabric without changing the stand's wall or carpet colours.
do $$
declare
  colours jsonb := jsonb_build_object(
    'reserveWallFabricColorId', '3026',
    'reserveWallFabricColorCode', '3026',
    'reserveWallFabricColorName', 'Anthracite',
    'reserveWallFabricColorHex', '#787878',
    'reserveWallFabricColorPrice', 0,
    'reserveWallFabricColorReference', ''
  );
  preset record;
  pack_row record;
  template record;
  config jsonb;
  options jsonb;
  templates jsonb;
begin
  for preset in
    select sp.* from public.stand_presets sp
    join public.salon_offers so on so.id = sp.offer_id
    join public.packs p on p.id = so.pack_id
    where p.slug = 'equipe'
  loop
    config := coalesce(preset.base_config, '{}'::jsonb);
    options := coalesce(config->'options', '{}'::jsonb);
    update public.stand_presets set base_config = config || jsonb_build_object(
      'defaultColorOptions', coalesce(config->'defaultColorOptions', options->'defaultColorOptions', '{}'::jsonb) || colours,
      'options', options || colours || jsonb_build_object(
        'defaultColorOptions', coalesce(options->'defaultColorOptions', config->'defaultColorOptions', '{}'::jsonb) || colours
      )
    ) where id = preset.id;
  end loop;

  for pack_row in select * from public.packs where slug = 'equipe' loop
    templates := coalesce(pack_row.metadata->'presetTemplates', '{}'::jsonb);
    for template in select * from jsonb_each(templates) loop
      config := coalesce(template.value->'base_config', '{}'::jsonb);
      options := coalesce(config->'options', '{}'::jsonb);
      config := config || jsonb_build_object(
        'defaultColorOptions', coalesce(config->'defaultColorOptions', options->'defaultColorOptions', '{}'::jsonb) || colours,
        'options', options || colours || jsonb_build_object(
          'defaultColorOptions', coalesce(options->'defaultColorOptions', config->'defaultColorOptions', '{}'::jsonb) || colours
        )
      );
      templates := jsonb_set(templates, array[template.key, 'base_config'], config, true);
    end loop;
    update public.packs set metadata = metadata || jsonb_build_object('presetTemplates', templates), updated_at = now()
    where id = pack_row.id;
  end loop;

  update public.scenes sc
  set source_payload = coalesce(sc.source_payload, '{}'::jsonb) || jsonb_build_object(
    'options', coalesce(sc.source_payload->'options', '{}'::jsonb) || colours || jsonb_build_object(
      'defaultColorOptions', coalesce(sc.source_payload#>'{options,defaultColorOptions}', '{}'::jsonb) || colours
    )
  )
  from public.salon_offers so join public.packs p on p.id = so.pack_id
  where sc.offer_id = so.id and p.slug = 'equipe';
end;
$$;
