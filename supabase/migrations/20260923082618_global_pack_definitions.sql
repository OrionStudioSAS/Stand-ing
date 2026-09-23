-- Packs are global definitions. salon_offers only records whether a pack is
-- enabled for a salon; its configuration is copied from the global definition.
create table if not exists public.packs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  display_order integer not null default 0,
  base_price numeric(10,2),
  included_description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.salon_offers
  add column if not exists pack_id uuid references public.packs(id) on delete cascade;

create unique index if not exists salon_offers_salon_pack_idx
  on public.salon_offers (salon_id, pack_id)
  where pack_id is not null;

create index if not exists salon_offers_pack_idx on public.salon_offers (pack_id);

alter table public.packs enable row level security;
revoke all on table public.packs from anon;
grant select, insert, update, delete on table public.packs to authenticated;

drop policy if exists "admin access packs" on public.packs;
create policy "admin access packs"
on public.packs for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

-- Keep the most complete existing salon configuration as the initial global
-- definition. This notably preserves the Signature allowance configuration.
with ranked_offers as (
  select
    offer.*,
    row_number() over (
      partition by lower(offer.slug)
      order by
        (
          case when offer.metadata->'packBenefits'->>'mode' = 'allowance' then 100000 else 0 end
          + case
              when jsonb_typeof(offer.metadata->'baseItems') = 'array'
                then jsonb_array_length(offer.metadata->'baseItems') * 100
              else 0
            end
          + (
              select count(*)
              from public.stand_presets preset
              join public.stand_preset_items preset_item on preset_item.preset_id = preset.id
              where preset.offer_id = offer.id
            )
        ) desc,
        offer.updated_at desc,
        offer.created_at asc
    ) as rank
  from public.salon_offers offer
  where nullif(btrim(offer.slug), '') is not null
)
insert into public.packs (slug, name, display_order, base_price, included_description, metadata, created_at, updated_at)
select
  lower(slug),
  name,
  display_order,
  base_price,
  included_description,
  coalesce(metadata, '{}'::jsonb),
  created_at,
  updated_at
from ranked_offers
where rank = 1
on conflict (slug) do update set
  name = excluded.name,
  display_order = excluded.display_order,
  base_price = excluded.base_price,
  included_description = excluded.included_description,
  metadata = public.packs.metadata || excluded.metadata,
  updated_at = greatest(public.packs.updated_at, excluded.updated_at);

update public.salon_offers offer
set pack_id = pack.id
from public.packs pack
where lower(offer.slug) = lower(pack.slug)
  and offer.pack_id is distinct from pack.id;

-- Snapshot the canonical presets in the global pack and align every currently
-- active salon. Future activations use the same snapshots in the application.
do $$
declare
  pack_row record;
  source_offer record;
  source_preset record;
  target_offer record;
  target_preset_id uuid;
  templates jsonb;
begin
  for pack_row in select * from public.packs loop
    select offer.* into source_offer
    from public.salon_offers offer
    where offer.pack_id = pack_row.id
    order by
      (
        case when offer.metadata->'packBenefits'->>'mode' = 'allowance' then 100000 else 0 end
        + case
            when jsonb_typeof(offer.metadata->'baseItems') = 'array'
              then jsonb_array_length(offer.metadata->'baseItems') * 100
            else 0
          end
        + (
            select count(*)
            from public.stand_presets preset
            join public.stand_preset_items preset_item on preset_item.preset_id = preset.id
            where preset.offer_id = offer.id
          )
      ) desc,
      offer.updated_at desc,
      offer.created_at asc
    limit 1;

    if source_offer.id is null then
      continue;
    end if;

    select coalesce(jsonb_object_agg(template.layout, template.payload), '{}'::jsonb)
    into templates
    from (
      select
        preset.layout,
        jsonb_build_object(
          'width_m', preset.width_m,
          'depth_m', preset.depth_m,
          'height_m', preset.height_m,
          'layout', preset.layout,
          'base_config', preset.base_config,
          'items', coalesce((
            select jsonb_agg(jsonb_build_object(
              'item_uid', item.item_uid,
              'type', item.type,
              'label', item.label,
              'x', item.x,
              'y', item.y,
              'z', item.z,
              'rotation', item.rotation,
              'wall', item.wall,
              'config', item.config,
              'included', item.included,
              'price_mode', item.price_mode
            ) order by item.created_at, item.id)
            from public.stand_preset_items item
            where item.preset_id = preset.id
          ), '[]'::jsonb)
        ) as payload
      from public.stand_presets preset
      where preset.offer_id = source_offer.id
        and preset.is_active
        and preset.layout is not null
    ) template;

    update public.packs
    set metadata = coalesce(source_offer.metadata, '{}'::jsonb)
      || jsonb_build_object('presetTemplates', coalesce(templates, '{}'::jsonb)),
      updated_at = now()
    where id = pack_row.id;

    update public.salon_offers
    set metadata = coalesce(source_offer.metadata, '{}'::jsonb),
      base_price = source_offer.base_price,
      included_description = source_offer.included_description,
      updated_at = now()
    where pack_id = pack_row.id;

    for target_offer in
      select * from public.salon_offers where pack_id = pack_row.id and id <> source_offer.id
    loop
      for source_preset in
        select * from public.stand_presets
        where offer_id = source_offer.id and is_active and layout is not null
      loop
        select id into target_preset_id
        from public.stand_presets
        where offer_id = target_offer.id and layout = source_preset.layout and is_active
        limit 1;

        if target_preset_id is null then
          insert into public.stand_presets (
            salon_id, offer_id, name, description, width_m, depth_m, height_m,
            layout, base_config, is_active, updated_at
          ) values (
            target_offer.salon_id,
            target_offer.id,
            'Scene de base ' || target_offer.name || ' - ' || source_preset.layout,
            source_preset.description,
            source_preset.width_m,
            source_preset.depth_m,
            source_preset.height_m,
            source_preset.layout,
            source_preset.base_config,
            true,
            now()
          ) returning id into target_preset_id;
        else
          update public.stand_presets
          set description = source_preset.description,
            width_m = source_preset.width_m,
            depth_m = source_preset.depth_m,
            height_m = source_preset.height_m,
            base_config = source_preset.base_config,
            updated_at = now()
          where id = target_preset_id;
        end if;

        delete from public.stand_preset_items where preset_id = target_preset_id;
        insert into public.stand_preset_items (
          preset_id, item_uid, type, label, x, y, z, rotation, wall,
          config, included, price_mode
        )
        select
          target_preset_id,
          item.item_uid,
          item.type,
          item.label,
          item.x,
          item.y,
          item.z,
          item.rotation,
          item.wall,
          (coalesce(item.config, '{}'::jsonb) - 'basePresetId')
            || jsonb_build_object('basePresetId', target_preset_id),
          item.included,
          item.price_mode
        from public.stand_preset_items item
        where item.preset_id = source_preset.id;
      end loop;
    end loop;
  end loop;
end;
$$;

create or replace function public.delete_pack_globally(pack_name text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  pack_key text;
  pack_ids uuid[];
  offer_ids uuid[];
  linked_scene_count integer;
  deleted_packs integer;
  deleted_offers integer;
  deleted_sources integer;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Seuls les administrateurs peuvent supprimer un pack.' using errcode = '42501';
  end if;

  pack_key := lower(regexp_replace(normalize(btrim(coalesce(pack_name, '')), NFD), U&'[\0300-\036f]', '', 'g'));
  if pack_key = '' then
    raise exception 'Pack introuvable.';
  end if;

  lock table public.scenes, public.packs, public.salon_offers, public.monday_sources, public.stand_presets in share row exclusive mode;

  select coalesce(array_agg(pack.id), '{}'::uuid[]) into pack_ids
  from public.packs pack
  where lower(regexp_replace(normalize(btrim(pack.name), NFD), U&'[\0300-\036f]', '', 'g')) = pack_key;

  select coalesce(array_agg(offer.id), '{}'::uuid[]) into offer_ids
  from public.salon_offers offer
  where offer.pack_id = any(pack_ids)
    or lower(regexp_replace(normalize(btrim(offer.name), NFD), U&'[\0300-\036f]', '', 'g')) = pack_key;

  select count(*) into linked_scene_count
  from public.scenes scene
  where scene.offer_id = any(offer_ids)
    or scene.base_preset_id in (select preset.id from public.stand_presets preset where preset.offer_id = any(offer_ids))
    or lower(regexp_replace(normalize(btrim(coalesce(nullif(btrim(scene.offer), ''), scene.source_payload->>'offer', scene.source_payload->>'pack', scene.source_payload->>'includedPack', scene.source_payload->'options'->>'includedPack', '')), NFD), U&'[\0300-\036f]', '', 'g')) = pack_key;

  if linked_scene_count > 0 then
    raise exception 'Ce pack est lié à % scène(s). Supprime ou réaffecte ces scènes avant de supprimer le pack.', linked_scene_count;
  end if;

  delete from public.monday_sources source
  where source.offer_id = any(offer_ids)
    or lower(regexp_replace(normalize(btrim(source.offer), NFD), U&'[\0300-\036f]', '', 'g')) = pack_key;
  get diagnostics deleted_sources = row_count;

  delete from public.packs pack where pack.id = any(pack_ids);
  get diagnostics deleted_packs = row_count;

  delete from public.salon_offers offer where offer.id = any(offer_ids);
  get diagnostics deleted_offers = row_count;

  return jsonb_build_object(
    'deletedPacks', deleted_packs,
    'deletedOffers', deleted_offers,
    'deletedSources', deleted_sources
  );
end;
$$;

revoke all on function public.delete_pack_globally(text) from public, anon;
grant execute on function public.delete_pack_globally(text) to authenticated;
