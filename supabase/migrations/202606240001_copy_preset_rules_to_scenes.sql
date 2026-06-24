create or replace function public.apply_scene_base_preset_payload()
returns trigger
language plpgsql
as $$
declare
  preset_config jsonb;
  offer_metadata jsonb;
  reserve_rules jsonb;
  partition_head_rules jsonb;
  base_items jsonb;
  current_payload jsonb;
  current_pricing jsonb;
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

  reserve_rules := coalesce(preset_config->'reserveRules', preset_config #> '{options,reserveRules}', '{}'::jsonb);
  partition_head_rules := coalesce(preset_config->'partitionHeadRules', preset_config #> '{options,partitionHeadRules}', '{}'::jsonb);
  base_items := case
    when jsonb_typeof(offer_metadata->'baseItems') = 'array' then offer_metadata->'baseItems'
    else '[]'::jsonb
  end;

  current_payload := coalesce(new.source_payload, '{}'::jsonb);
  current_pricing := coalesce(current_payload->'pricing', '{}'::jsonb);

  new.source_payload := current_payload
    || jsonb_build_object(
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

drop trigger if exists scenes_apply_base_preset_payload on public.scenes;
create trigger scenes_apply_base_preset_payload
before insert or update of base_preset_id, source_payload on public.scenes
for each row
execute function public.apply_scene_base_preset_payload();

update public.scenes sc
set source_payload = coalesce(sc.source_payload, '{}'::jsonb)
from public.stand_presets sp
where sc.base_preset_id = sp.id;
