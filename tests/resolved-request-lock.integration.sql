-- Integration verification: supabase db query --linked --file tests/resolved-request-lock.integration.sql
-- Requires an existing exhibitor and active admin. All test writes are rolled back.
begin;
create temp table lock_test_identities as
select
 (select u.id from auth.users u where not exists (select 1 from public.admin_users a where a.user_id=u.id and a.is_active) limit 1) as client_id,
 (select u.email from auth.users u where not exists (select 1 from public.admin_users a where a.user_id=u.id and a.is_active) limit 1) as client_email,
 (select user_id from public.admin_users where is_active limit 1) as admin_id;
grant select on lock_test_identities to authenticated;
insert into public.scenes (id, salon, offer, client_email, source_payload)
select 'codex-lock-verification', 'Test rollback only', 'Confort', client_email, '{"exhibitor_view_only":true}'::jsonb from lock_test_identities;
insert into public.scene_items (scene_id,item_uid,type,label) values ('codex-lock-verification','test-item','test','Before');
insert into public.scene_files (scene_id,type,file_name) values ('codex-lock-verification','other','before.txt');
select set_config('request.jwt.claims', jsonb_build_object('sub',client_id,'email',client_email,'role','authenticated')::text,true) is not null as client_claims_set from lock_test_identities;
set local role authenticated;
do $$
declare rejected boolean;
begin
  if not exists(select 1 from public.scenes where id='codex-lock-verification') then raise exception 'Client cannot view locked scene'; end if;
  rejected := false;
  begin update public.scenes set project_name='Blocked' where id='codex-lock-verification'; exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'Client parent update was not blocked'; end if;
  rejected := false;
  begin update public.scenes set source_payload='{}'::jsonb where id='codex-lock-verification'; exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'Client removed the lock'; end if;
  rejected := false;
  begin update public.scene_items set label='Blocked' where scene_id='codex-lock-verification'; exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'Client item update was not blocked'; end if;
  rejected := false;
  begin insert into public.scene_items(scene_id,item_uid,type) values ('codex-lock-verification','blocked','test'); exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'Client item insert was not blocked'; end if;
  rejected := false;
  begin delete from public.scene_items where scene_id='codex-lock-verification'; exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'Client item delete was not blocked'; end if;
  rejected := false;
  begin insert into public.scene_files(scene_id,type,file_name) values ('codex-lock-verification','other','blocked.txt'); exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'Client file insert was not blocked'; end if;
  rejected := false;
  begin update public.scene_files set file_name='blocked.txt' where scene_id='codex-lock-verification'; exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'Client file update was not blocked'; end if;
  rejected := false;
  begin delete from public.scene_files where scene_id='codex-lock-verification'; exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'Client file delete was not blocked'; end if;
end;
$$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true) is not null as admin_claims_set from lock_test_identities;
set local role authenticated;
update public.scenes set project_name='Admin may edit' where id='codex-lock-verification';
update public.scene_items set label='Admin may edit' where scene_id='codex-lock-verification';
update public.scene_files set file_name='admin.txt' where scene_id='codex-lock-verification';
update public.scenes set source_payload=jsonb_build_object('exhibitor_view_only',false) where id='codex-lock-verification';
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',client_id,'email',client_email,'role','authenticated')::text,true) is not null as client_claims_restored from lock_test_identities;
set local role authenticated;
update public.scenes set project_name='Client may edit when unlocked' where id='codex-lock-verification';
update public.scene_items set label='Client may edit when unlocked' where scene_id='codex-lock-verification';
delete from public.scene_files where scene_id='codex-lock-verification';
do $$
declare rejected boolean := false;
begin
  if not exists(select 1 from public.scenes where id='codex-lock-verification' and project_name='Client may edit when unlocked') then raise exception 'Unlocked scene did not save'; end if;
  begin update public.scenes set source_payload=jsonb_build_object('exhibitor_view_only',true) where id='codex-lock-verification'; exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'Client changed the lock setting'; end if;
end;
$$;
reset role;
select 'PASS: client read preserved, scene/items/files writes denied while locked, admin edits allowed, unlocked client edits allowed' as verification;
rollback;
