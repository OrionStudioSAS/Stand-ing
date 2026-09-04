-- Rename the legacy Business pack to Signature while preserving linked presets/scenes.
update public.salon_offers
set
  slug = 'signature',
  name = 'Signature',
  included_description = replace(coalesce(included_description, ''), 'Business', 'Signature'),
  display_order = 20,
  updated_at = now()
where lower(slug) = 'business' or lower(name) = 'business';

update public.stand_presets preset
set
  name = replace(preset.name, 'Business', 'Signature'),
  description = replace(preset.description, 'Business', 'Signature'),
  updated_at = now()
from public.salon_offers offer
where preset.offer_id = offer.id
  and lower(offer.slug) = 'signature';

update public.monday_sources
set offer = 'Signature'
where lower(offer) = 'business';

update public.scenes
set offer = 'Signature', updated_at = now()
where lower(offer) = 'business';
