alter table public.salon_offers add column if not exists display_order integer not null default 0;

with desired_packs as (
  select salon.id as salon_id, pack.slug, pack.name, pack.display_order
  from public.salons salon
  join lateral (
    values
      ('confort', 'Confort', 10),
      ('business', 'Business', 20),
      ('prestige', 'Prestige', 30)
  ) as pack(slug, name, display_order) on lower(salon.slug) like 'smcl%'
  union all
  select salon.id as salon_id, 'siae', 'SIAE', 10
  from public.salons salon
  where lower(salon.slug) like 'siae%'
), upserted_offers as (
  insert into public.salon_offers (salon_id, slug, name, display_order, included_description, metadata, updated_at)
  select
    salon_id,
    slug,
    name,
    display_order,
    'Pack ' || name || ' configurable pour ce salon',
    jsonb_build_object('seeded_default_pack', true),
    now()
  from desired_packs
  on conflict (salon_id, slug) do update set
    name = excluded.name,
    display_order = excluded.display_order,
    included_description = coalesce(public.salon_offers.included_description, excluded.included_description),
    metadata = public.salon_offers.metadata || excluded.metadata,
    updated_at = now()
  returning id, salon_id, name
)
insert into public.stand_presets (salon_id, offer_id, name, description, width_m, depth_m, height_m, layout, base_config, is_active, updated_at)
select
  offer.salon_id,
  offer.id,
  'Scene de base ' || offer.name || ' - ' || salon.name,
  'Objets inclus et placement de base pour le pack ' || offer.name || ' sur ' || salon.name,
  5,
  5,
  2.5,
  'u',
  jsonb_build_object('price_mode', 'included'),
  true,
  now()
from upserted_offers offer
join public.salons salon on salon.id = offer.salon_id
where not exists (
  select 1
  from public.stand_presets preset
  where preset.offer_id = offer.id
    and preset.is_active = true
);
