-- Run after applying the Monday hanging-limits migration.
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
    and configuration_revision = 2 and source_payload#>>'{hanging_limits,ceilingM}' = '4.25'
    and source_payload->>'plan_aisle_side' = 'top' and source_payload#>>'{options,carpet}' = 'blue') then
    raise exception 'A concurrent draft must retain its height and saved choices';
  end if;
end;
$$;
rollback;
