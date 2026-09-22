-- Object availability and commercial data are now configured per pack rather
-- than per salon. Keep the legacy keys during the transition for rollback and
-- for older deployed clients, but make `packs` / `packPricing` authoritative.
with asset_context as (
  select
    object_bank.type,
    coalesce(object_bank.dimensions, '{}'::jsonb) as dimensions,
    exists (
      select 1
      from jsonb_array_elements_text(coalesce(object_bank.dimensions->'salons', '[]'::jsonb)) as salon(value)
      where lower(salon.value) like '%smcl%'
    ) or exists (
      select 1
      from jsonb_each(coalesce(object_bank.dimensions->'salonPricing', '{}'::jsonb)) as pricing(key, value)
      where lower(pricing.key) like '%smcl%'
         or lower(coalesce(pricing.value->>'salon', '')) like '%smcl%'
    ) as has_smcl,
    exists (
      select 1
      from jsonb_array_elements_text(coalesce(object_bank.dimensions->'salons', '[]'::jsonb)) as salon(value)
      where lower(salon.value) like '%sitl%'
    ) or exists (
      select 1
      from jsonb_each(coalesce(object_bank.dimensions->'salonPricing', '{}'::jsonb)) as pricing(key, value)
      where lower(pricing.key) like '%sitl%'
         or lower(coalesce(pricing.value->>'salon', '')) like '%sitl%'
    ) as has_sitl,
    exists (
      select 1
      from jsonb_array_elements_text(coalesce(object_bank.dimensions->'salons', '[]'::jsonb)) as salon(value)
      where lower(salon.value) like '%siae%'
    ) or exists (
      select 1
      from jsonb_each(coalesce(object_bank.dimensions->'salonPricing', '{}'::jsonb)) as pricing(key, value)
      where lower(pricing.key) like '%siae%'
         or lower(coalesce(pricing.value->>'salon', '')) like '%siae%'
    ) as has_siae
  from public.object_bank
), migrated as (
  select
    type,
    coalesce((
      select jsonb_agg(pack.name order by pack.sort_order)
      from (
        values
          ('Confort', 10, has_smcl),
          ('Signature', 20, has_sitl),
          ('SIAE', 25, has_siae),
          ('Prestige', 30, has_smcl)
      ) as pack(name, sort_order, enabled)
      where pack.enabled
    ), '[]'::jsonb) as packs,
    jsonb_strip_nulls(jsonb_build_object(
      'confort', case when has_smcl then
        coalesce(dimensions->'salonPricing'->'smcl-2026', '{}'::jsonb)
          || jsonb_build_object('pack', 'Confort', 'sourceSalon', 'SMCL 2026')
      end,
      'prestige', case when has_smcl then
        coalesce(dimensions->'salonPricing'->'smcl-2026', '{}'::jsonb)
          || jsonb_build_object('pack', 'Prestige', 'sourceSalon', 'SMCL 2026')
      end,
      'signature', case when has_sitl then
        coalesce(dimensions->'salonPricing'->'sitl-2027', '{}'::jsonb)
          || jsonb_build_object('pack', 'Signature', 'sourceSalon', 'SITL 2027')
      end,
      'siae', case when has_siae then
        coalesce(dimensions->'salonPricing'->'siae-2027', '{}'::jsonb)
          || jsonb_build_object('pack', 'SIAE', 'sourceSalon', 'SIAE 2027')
      end
    )) as pack_pricing
  from asset_context
)
update public.object_bank as object_bank
set dimensions = jsonb_set(
  jsonb_set(coalesce(object_bank.dimensions, '{}'::jsonb), '{packs}', migrated.packs, true),
  '{packPricing}', migrated.pack_pricing, true
)
from migrated
where migrated.type = object_bank.type;
