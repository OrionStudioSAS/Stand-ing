with pack_refs as (
  select distinct on (salon_id, offer_id)
    salon_id,
    offer_id,
    name,
    description,
    width_m,
    depth_m,
    height_m,
    base_config
  from public.stand_presets
  where offer_id is not null
    and is_active
  order by salon_id, offer_id, created_at asc
), layout_refs(layout, label) as (
  values
    ('left', 'Arriere gauche'),
    ('back', 'Arriere'),
    ('right', 'Arriere droite'),
    ('u', 'U')
)
insert into public.stand_presets (
  salon_id,
  offer_id,
  name,
  description,
  width_m,
  depth_m,
  height_m,
  layout,
  base_config,
  is_active,
  updated_at
)
select
  pack_refs.salon_id,
  pack_refs.offer_id,
  pack_refs.name || ' - ' || layout_refs.label,
  coalesce(pack_refs.description, 'Scene de base') || ' (' || layout_refs.label || ')',
  coalesce(pack_refs.width_m, 5),
  coalesce(pack_refs.depth_m, 5),
  coalesce(pack_refs.height_m, 2.5),
  layout_refs.layout,
  coalesce(pack_refs.base_config, '{}'::jsonb) || jsonb_build_object('layout_reference', layout_refs.layout, 'price_mode', 'included'),
  true,
  now()
from pack_refs
cross join layout_refs
where not exists (
  select 1
  from public.stand_presets existing
  where existing.offer_id = pack_refs.offer_id
    and existing.salon_id = pack_refs.salon_id
    and existing.layout = layout_refs.layout
    and existing.is_active
);
