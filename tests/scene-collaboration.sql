-- Run against a disposable database with the Supabase migrations applied.
begin;
create function pg_temp.check_test(ok boolean, description text)
returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'Failed: %', description; end if;
end;
$$;

insert into auth.users (id, email) values
  ('b0000000-0000-0000-0000-000000000001', 'collab-owner@example.test'),
  ('b0000000-0000-0000-0000-000000000002', 'collab-guest@example.test'),
  ('b0000000-0000-0000-0000-000000000003', 'collab-pending@example.test');
insert into public.scenes (id, share_token, salon, offer, client_email, client_status, source_payload) values
  ('collab-test-scene', 'collab-test-token', 'Test', 'Signature', 'collab-owner@example.test', 'draft',
    '{"options":{"carpet":"blue"},"contactDetails":{"email":"collab-owner@example.test"},"questions":[{"id":"keep"}]}'),
  ('collab-other-scene', 'collab-other-token', 'Test', 'Signature', 'collab-owner@example.test', 'draft', '{}');
insert into public.scene_collaborators (scene_id, slot, email, user_id, accepted_at) values
  ('collab-test-scene', 1, 'collab-guest@example.test', 'b0000000-0000-0000-0000-000000000002', now()),
  ('collab-test-scene', 2, 'collab-pending@example.test', null, null);

do $$ begin
  begin
    insert into public.scene_collaborators (scene_id, slot, email)
      values ('collab-test-scene', 3, 'collab-third@example.test');
    raise exception 'A third slot was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.scene_collaborators (scene_id, slot, email)
      values ('collab-test-scene', 2, 'collab-third@example.test');
    raise exception 'An occupied slot was reused';
  exception when unique_violation then null;
  end;
end $$;

set local role anon;
do $$ begin
  begin
    perform public.save_configurator_scene('collab-test-scene', 0, '{}', '[]', null);
    raise exception 'Anonymous RPC was authorized';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000003","email":"collab-pending@example.test"}';
select pg_temp.check_test(not exists(select 1 from public.scenes where id = 'collab-test-scene'), 'pending invitation does not grant access');

set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","email":"collab-guest@example.test"}';
select pg_temp.check_test(exists(select 1 from public.scenes where id = 'collab-test-scene'), 'accepted collaborator reads the scene');
select pg_temp.check_test(not exists(select 1 from public.scenes where id = 'collab-other-scene'), 'cannot read another scene');
select pg_temp.check_test(private.can_upload_scene_visual('collab-test-scene'), 'collaborator can upload visual in draft');
insert into public.scene_uploaded_files (scene_id, surface_key, original_filename, uploaded_by)
  values ('collab-test-scene', 'wall', 'artwork.pdf', 'b0000000-0000-0000-0000-000000000002');
do $$ begin
  begin
    update public.scene_uploaded_files set original_filename = 'modified.pdf' where scene_id = 'collab-test-scene';
    raise exception 'Guest rewrote an uploaded file record';
  exception when insufficient_privilege then null;
  end;
end $$;
update public.scene_uploaded_files set is_active = false where scene_id = 'collab-test-scene';
select pg_temp.check_test(exists(select 1 from public.scene_uploaded_files where scene_id = 'collab-test-scene'
  and original_filename = 'artwork.pdf' and not is_active), 'guest can replace but not rewrite an uploaded visual');

select pg_temp.check_test((public.save_configurator_scene('collab-test-scene', 0,
  '{"status":"created","client_status":"draft","client_email":"attacker@example.test","width_m":99,"source_payload":{"options":{"carpet":"red"},"contactDetails":{"email":"attacker@example.test"},"exhibitor_view_only":true}}',
  '[{"item_uid":"chair-1","type":"chair","label":"Chair","x":0,"y":0,"z":0,"rotation":0,"config":{}}]', null)
  ->> 'configuration_revision') = '1', 'guest edits draft atomically');
select pg_temp.check_test(exists(
  select 1 from public.scenes where id = 'collab-test-scene' and width_m = 4
    and client_email = 'collab-owner@example.test'
    and source_payload#>>'{contactDetails,email}' = 'collab-owner@example.test'
    and source_payload#>>'{options,carpet}' = 'red'
    and source_payload#>>'{questions,0,id}' = 'keep'
    and not (source_payload ? 'exhibitor_view_only')
), 'guest changes config but not contact, stand dimensions or lock');
select pg_temp.check_test(exists(select 1 from public.scene_items where scene_id = 'collab-test-scene' and item_uid = 'chair-1'), 'guest reads edited item');

do $$ begin
  begin
    perform public.save_configurator_scene('collab-test-scene', 1, '{"status":"validated","client_status":"bat_validated"}', '[]', null);
    raise exception 'Guest approved a BAT as an administrator';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_configurator_scene('collab-test-scene', 1, '{"status":"created","client_status":"draft"}',
      '[{"item_uid":"broken","type":"chair","x":999999999,"y":0,"z":0,"rotation":0,"config":{}}]', null);
    raise exception 'Invalid item saved';
  exception when numeric_value_out_of_range then null;
  end;
  begin
    insert into public.scene_items (scene_id, item_uid, type) values ('collab-test-scene', 'bypass', 'chair');
    raise exception 'Guest bypassed atomic save';
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.check_test(exists(select 1 from public.scenes where id = 'collab-test-scene' and configuration_revision = 1), 'failed item save rolls back scene revision');

set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000001","email":"collab-owner@example.test"}';
do $$ begin
  begin
    perform public.save_configurator_scene('collab-test-scene', 0, '{"status":"created","client_status":"draft"}', '[]', null);
    raise exception 'Stale owner overwrote the guest changes';
  exception when sqlstate 'PT409' then null;
  end;
end $$;
select pg_temp.check_test(exists(select 1 from public.scene_items where scene_id = 'collab-test-scene' and item_uid = 'chair-1'), 'stale save did not remove items');
select pg_temp.check_test((public.save_configurator_scene('collab-other-scene', 0,
  '{"status":"configured","client_status":"configured"}', '[]', null) ->> 'configuration_revision') = '1', 'owner can still submit');

set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","email":"collab-guest@example.test"}';
select pg_temp.check_test((public.save_configurator_scene('collab-test-scene', 1,
  '{"status":"configured","client_status":"configured"}', '[]', null) #>> '{source_payload,configuration_submitted_by}')
  = 'b0000000-0000-0000-0000-000000000002', 'guest submits the latest revision as themselves');
select pg_temp.check_test(not private.can_upload_scene_visual('collab-test-scene'), 'guest cannot upload after submission');
do $$ begin
  begin
    perform public.save_configurator_scene('collab-test-scene', 2, '{"status":"created","client_status":"draft"}', '[]', null);
    raise exception 'Guest reopened a submitted stand';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
delete from public.scene_collaborators where scene_id = 'collab-test-scene' and slot = 1;
set local role authenticated;
select pg_temp.check_test(not exists(select 1 from public.scenes where id = 'collab-test-scene'), 'revocation invalidates existing session access');
do $$ begin
  begin
    perform public.save_configurator_scene('collab-test-scene', 2, '{"status":"created","client_status":"draft"}', '[]', null);
    raise exception 'Revoked guest could still edit';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
