drop index if exists public.stand_presets_active_offer_idx;

create unique index if not exists stand_presets_active_offer_layout_idx
  on public.stand_presets (offer_id, layout)
  where is_active and offer_id is not null and layout is not null;

create index if not exists stand_presets_offer_layout_idx
  on public.stand_presets (offer_id, layout);
