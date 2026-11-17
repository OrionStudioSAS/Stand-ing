-- Run on a disposable database migrated through 20261111230928_scene_collaborators.sql.
begin;

create function pg_temp.check_test(ok boolean, description text)
returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'Failed: %', description; end if;
end;
$$;

create temp table reserve_test_preset as
select p.id
from public.stand_presets p
join public.salon_offers o on o.id = p.offer_id
join public.salons sl on sl.id = p.salon_id
where sl.slug = 'smcl-2026' and o.slug = 'confort' and p.layout = 'back' and p.is_active;
select pg_temp.check_test((select count(*) from reserve_test_preset) = 1, 'Confort test preset exists');
grant select on reserve_test_preset to authenticated, service_role;

update public.stand_presets
set base_config = '{"reserveRules":{"large":{"includedType":"reserve-2","options":[{"type":"reserve-1","price":0}]}},"partitionHeadRules":{"keep":"old"}}'
where id in (select id from reserve_test_preset);

insert into public.scenes (id, salon, offer, base_preset_id, status, client_status, client_email, width_m, depth_m, source_payload)
select 'reserve-test-' || kind, 'SMCL 2026', 'Confort', p.id, status, client_status,
  'reserve-owner@example.test', width_m, 5,
  '{"options":{"carpet":"blue","reserveOptions":{"handle":"left"}},"pricing":{"lines":[{"label":"keep"}]}}'::jsonb || extra::jsonb
from reserve_test_preset p cross join (values
  ('default', 'created', 'draft', 5, '{}'),
  ('small', 'created', 'not_started', 4.99, '{}'),
  ('custom', 'created', 'draft', 5, '{"options":{"reserveOptionType":"reserve-1"}}'),
  ('removed', 'created', 'draft', 5, '{"options":{"reserveOptionType":"__none__"}}'),
  ('legacy', 'created', 'draft', 5, '{"options":{"reserveUpgradeEnabled":true}}'),
  ('validated', 'validated', 'bat_validated', 5, '{}'),
  ('locked', 'created', 'draft', 5, '{"exhibitor_view_only":true}')
) as cases(kind, status, client_status, width_m, extra);

update public.stand_presets
set base_config = '{"reserveRules":{"large":{"includedType":"reserve-3"}},"partitionHeadRules":{"keep":"new"}}'
where id in (select id from reserve_test_preset);

\ir ../supabase/migrations/20261112094040_sync_pack_reserve_defaults.sql

select pg_temp.check_test((select count(*) from public.scenes
  where id like 'reserve-test-%' and configuration_revision = 1) = 1, 'backfill updates only the eligible draft');
select pg_temp.check_test(exists(select 1 from public.scenes where id = 'reserve-test-default'
  and configuration_revision = 1
  and source_payload#>>'{reserveRules,large,includedType}' = 'reserve-3'
  and source_payload#>'{pricing,reserveRules}' = source_payload->'reserveRules'
  and source_payload#>>'{partitionHeadRules,keep}' = 'old'
  and source_payload#>>'{options,reserveOptions,handle}' = 'left'
  and source_payload#>>'{pricing,lines,0,label}' = 'keep'
), 'backfill writes both reserve snapshots but preserves other scene settings');

insert into auth.users (id, email) values
  ('b0000000-0000-0000-0000-000000000011', 'reserve-admin@example.test'),
  ('b0000000-0000-0000-0000-000000000012', 'reserve-owner@example.test');
insert into public.admin_users (user_id, email) values
  ('b0000000-0000-0000-0000-000000000011', 'reserve-admin@example.test');

set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000011","email":"reserve-admin@example.test"}';
update public.stand_presets
set base_config = '{"options":{"reserveRules":{"large":{"includedType":"reserve-latest"}}},"partitionHeadRules":{"keep":"newer"}}'
where id in (select id from reserve_test_preset);
update public.stand_presets
set base_config = base_config || '{"unrelated":true}'
where id in (select id from reserve_test_preset);

select pg_temp.check_test(exists(select 1 from public.scenes where id = 'reserve-test-default'
  and configuration_revision = 2
  and source_payload#>>'{reserveRules,large,includedType}' = 'reserve-latest'
  and source_payload#>>'{partitionHeadRules,keep}' = 'old'
), 'admin reserve changes propagate; unrelated pack changes do not');
select pg_temp.check_test((select count(*) from public.scenes
  where id like 'reserve-test-%' and id not in ('reserve-test-default', 'reserve-test-small')
  and configuration_revision = 0 and source_payload#>>'{reserveRules,large,includedType}' = 'reserve-2'
) = 5, 'locked scenes and manual or legacy choices are unchanged');

set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000012","email":"reserve-owner@example.test"}';
select pg_temp.check_test(not exists(select 1 from public.stand_presets where id in (select id from reserve_test_preset))
  and exists(select 1 from public.scenes where id = 'reserve-test-default'
    and source_payload#>>'{reserveRules,large,includedType}' = 'reserve-latest'),
  'owner sees the new default without direct access to the preset');
do $$ begin
  perform public.save_configurator_scene('reserve-test-default', 1,
    '{"status":"configured","client_status":"configured"}', '[]', null);
  raise exception 'A stale tab could validate the old default';
exception when sqlstate 'PT409' then null;
end $$;

reset role;
set local role service_role;
update public.scenes set source_payload = source_payload || '{"note":"update"}'
where id in ('reserve-test-validated', 'reserve-test-custom');
select pg_temp.check_test((select count(*) from public.scenes
  where id in ('reserve-test-validated', 'reserve-test-custom')
    and source_payload#>>'{reserveRules,large,includedType}' = 'reserve-2'
    and source_payload->>'note' = 'update') = 2, 'service-role writes do not refresh frozen reserve snapshots');

insert into public.scenes (id, salon, offer, base_preset_id)
select 'reserve-test-new', 'SMCL 2026', 'Confort', id from reserve_test_preset;
select pg_temp.check_test(exists(select 1 from public.scenes where id = 'reserve-test-new'
  and source_payload#>>'{reserveRules,large,includedType}' = 'reserve-latest'), 'new scenes still inherit the current rules');

rollback;
