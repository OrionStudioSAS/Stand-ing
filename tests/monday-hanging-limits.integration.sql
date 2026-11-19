-- Run after applying monday_production_settings_after_creation. All writes roll back.
begin;
insert into public.scenes (id, salon, offer, status, client_status, source_payload)
values ('monday-hanging-test', 'Test', 'Signature', 'created', 'not_started', '{}');

set local role service_role;
select public.patch_scene_from_monday('monday-hanging-test', '{"hanging_limits":{"ceilingM":4.25},"plan_aisle_side":"left"}', null, null);
select public.patch_scene_from_monday('monday-hanging-test', '{"hanging_limits":{"ceilingM":4.25},"plan_aisle_side":"right"}', null, null);
do $$
begin
  if not exists(select 1 from public.scenes where id = 'monday-hanging-test'
    and configuration_revision = 1 and source_payload#>>'{hanging_limits,ceilingM}' = '4.25'
    and source_payload->>'plan_aisle_side' = 'right') then
    raise exception 'Only a changed pre-configuration height should increment the revision';
  end if;
end;
$$;

update public.scenes set client_status = 'draft',
  source_payload = source_payload || '{"options":{"carpet":"blue"}}'
where id = 'monday-hanging-test';
select public.patch_scene_from_monday('monday-hanging-test', '{"hanging_limits":{"ceilingM":5.25},"plan_aisle_side":"top"}', null, null);
do $$
begin
  if not exists(select 1 from public.scenes where id = 'monday-hanging-test'
    and configuration_revision = 3 and source_payload#>>'{hanging_limits,ceilingM}' = '5.25'
    and source_payload->>'plan_aisle_side' = 'top' and source_payload#>>'{options,carpet}' = 'blue') then
    raise exception 'A draft must receive the new height without losing saved choices';
  end if;
end;
$$;

-- Partial patches must retain the latest row's other heights, not a batched snapshot.
update public.scenes set source_payload = source_payload ||
  '{"hanging_limits":{"ceilingM":4.8,"slingM":4.25,"slingStatus":"4,25 m"},"options":{"carpet":"fresh"}}'
where id = 'monday-hanging-test';
select public.patch_scene_from_monday('monday-hanging-test',
  '{"hanging_limits":{"slingM":5.25,"slingStatus":"5,25 m"}}', null, null);
do $$
begin
  if not exists(select 1 from public.scenes where id = 'monday-hanging-test'
    and source_payload#>>'{hanging_limits,ceilingM}' = '4.8'
    and source_payload#>>'{hanging_limits,slingM}' = '5.25'
    and source_payload#>>'{options,carpet}' = 'fresh') then
    raise exception 'Partial height patch overwrote another height or concurrent options';
  end if;
end;
$$;

do $$
declare
  pack text;
  scene_state text[];
  revision integer;
  payload jsonb;
begin
  foreach pack in array array['Signature', 'Prestige', 'Confort', 'Équipé'] loop
    foreach scene_state slice 1 in array array[
      ['created', 'draft'], ['configured', 'configured'], ['validated', 'bat_validated']
    ] loop
      update public.scenes set offer = pack, status = scene_state[1], client_status = scene_state[2],
        client_name = 'Current contact', client_email = 'current@example.com',
        source_payload = '{"hanging_limits":{"ceilingM":5.25,"slingM":5.25,"slingStatus":"5,25 m"},
          "options":{"carpet":"blue","wallCovers":{"back":{"imageUrl":"saved.jpg"}}},
          "exhibitor_view_only":true,"exhibitor_view_only_updated_at":"2026-11-18T12:00:00Z",
          "specialRequest":{"text":"Keep this"},"contactDetails":{"company":"Saved"},
          "baseItems":[{"type":"desk"}],"packBenefits":{"mode":"included-items"}}'
      where id = 'monday-hanging-test'
      returning configuration_revision, source_payload into revision, payload;

      perform public.patch_scene_from_monday('monday-hanging-test',
        '{"hanging_limits":{"ceilingM":4.25,"slingM":4.25,"slingStatus":"4,25 m"},
          "plan_aisle_side":"left"}', 'outdated@example.com', 'Outdated contact');
      if not exists(select 1 from public.scenes where id = 'monday-hanging-test'
        and offer = pack and status = scene_state[1] and client_status = scene_state[2]
        and configuration_revision = revision + 1
        and source_payload#>>'{hanging_limits,ceilingM}' = '4.25'
        and source_payload#>>'{hanging_limits,slingM}' = '4.25'
        and source_payload->>'plan_aisle_side' = 'left'
        and source_payload - 'hanging_limits' - 'plan_aisle_side'
          = payload - 'hanging_limits' - 'plan_aisle_side'
        and client_name = 'Current contact' and client_email = 'current@example.com') then
        raise exception 'Production patch lost choices, lock, status or contacts for % / %', pack, scene_state;
      end if;

      perform public.patch_scene_from_monday('monday-hanging-test',
        '{"hanging_limits":{"ceilingM":4.25,"slingM":4.25,"slingStatus":"4,25 m"},
          "plan_aisle_side":"right"}', null, null);
      perform public.patch_scene_from_monday('monday-hanging-test', '{}', null, null);
      if not exists(select 1 from public.scenes where id = 'monday-hanging-test'
        and configuration_revision = revision + 1 and source_payload->>'plan_aisle_side' = 'right') then
        raise exception 'Identical heights or aisle-only changes invalidated a draft';
      end if;

      perform public.patch_scene_from_monday('monday-hanging-test',
        '{"hanging_limits":{"slingM":null,"slingStatus":"ATT"},"plan_aisle_side":null}', null, null);
      if not exists(select 1 from public.scenes where id = 'monday-hanging-test'
        and configuration_revision = revision + 2
        and source_payload#>>'{hanging_limits,ceilingM}' = '4.25'
        and source_payload#>'{hanging_limits,slingM}' = 'null'::jsonb
        and source_payload->'plan_aisle_side' = 'null'::jsonb) then
        raise exception 'Clearing Monday cells did not reset only the requested limits';
      end if;
    end loop;
  end loop;
end;
$$;

set local role authenticated;
do $$
declare
  denied boolean := false;
begin
  begin
    perform public.patch_scene_from_monday('monday-hanging-test', '{}', null, null);
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Exhibitors can change Monday production settings'; end if;
end;
$$;
reset role;
select 'PASS: production settings update all packs and statuses; choices and locks preserved; partial merges and revisions verified' as verification;
rollback;
