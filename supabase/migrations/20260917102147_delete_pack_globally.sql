create or replace function public.delete_pack_globally(pack_name text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  pack_key text;
  offer_ids uuid[];
  linked_scene_count integer;
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

  -- Keep scene checks and removal atomic, including legacy name-only links.
  lock table public.scenes, public.salon_offers, public.monday_sources, public.stand_presets in share row exclusive mode;

  select coalesce(array_agg(o.id), '{}'::uuid[]) into offer_ids
  from public.salon_offers o
  where lower(regexp_replace(normalize(btrim(o.name), NFD), U&'[\0300-\036f]', '', 'g')) = pack_key;

  select count(*) into linked_scene_count
  from public.scenes s
  where s.offer_id = any(offer_ids)
    or s.base_preset_id in (select p.id from public.stand_presets p where p.offer_id = any(offer_ids))
    or lower(regexp_replace(normalize(btrim(coalesce(nullif(btrim(s.offer), ''), s.source_payload->>'offer', s.source_payload->>'pack', s.source_payload->>'includedPack', s.source_payload->'options'->>'includedPack', '')), NFD), U&'[\0300-\036f]', '', 'g')) = pack_key;

  if linked_scene_count > 0 then
    raise exception 'Ce pack est lié à % scène(s). Supprime ou réaffecte ces scènes avant de supprimer le pack de tous les salons.', linked_scene_count;
  end if;

  delete from public.monday_sources m
  where m.offer_id = any(offer_ids)
    or lower(regexp_replace(normalize(btrim(m.offer), NFD), U&'[\0300-\036f]', '', 'g')) = pack_key;
  get diagnostics deleted_sources = row_count;

  -- Presets and their items are removed by the existing cascade constraints.
  delete from public.salon_offers o where o.id = any(offer_ids);
  get diagnostics deleted_offers = row_count;

  return jsonb_build_object('deletedOffers', deleted_offers, 'deletedSources', deleted_sources);
end;
$$;

revoke all on function public.delete_pack_globally(text) from public, anon;
grant execute on function public.delete_pack_globally(text) to authenticated;
