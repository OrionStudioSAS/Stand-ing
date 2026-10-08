-- All writes are rolled back. No Monday calls, invitations or SFTP operations.
begin;
create temp table monday_test_identities as
select
  (select u.id from auth.users u where not exists (select 1 from public.admin_users a where a.user_id=u.id and a.is_active) limit 1) as client_id,
  (select user_id from public.admin_users where is_active limit 1) as admin_id;
grant select on monday_test_identities to authenticated;
insert into public.scenes(id, salon, offer, client_name, client_email, client_status, source_payload)
values ('codex-monday-test', 'Rollback test only', 'Confort', 'Current contact', 'current@example.com', 'configured',
  '{"options":{"custom":"fresh"},"exhibitor_view_only":true,"packBenefits":{"mode":"included-items"},"baseItems":[{"type":"included"}]}'::jsonb);
set local role service_role;
do $$
begin
  if not public.patch_scene_from_monday('codex-monday-test',
    '{"stand_number":"C12","packBenefits":{"mode":"allowance"},"baseItems":[]}', 'old@example.com', 'Old contact') then
    raise exception 'Backend patch failed';
  end if;
  if exists(select 1 from public.scenes where id='codex-monday-test' and (
    source_payload->>'stand_number' <> 'C12'
    or source_payload->'options'->>'custom' <> 'fresh'
    or source_payload->>'exhibitor_view_only' <> 'true'
    or source_payload->'packBenefits'->>'mode' <> 'included-items'
    or jsonb_array_length(source_payload->'baseItems') <> 1
    or client_name <> 'Current contact' or client_email <> 'current@example.com')) then
    raise exception 'Patch overwrote concurrent configuration, contact or lock data';
  end if;
  if public.patch_scene_from_monday('codex-monday-absent', '{}', null, null) then
    raise exception 'Missing scene was reported as updated';
  end if;
end;
$$;
update public.scenes set offer='Signature', client_name='', client_email=null where id='codex-monday-test';
select public.patch_scene_from_monday('codex-monday-test', '{"packBenefits":{"mode":"allowance","allowanceAmount":800},"baseItems":[]}', 'new@example.com', 'New contact');
do $$
begin
  if not exists(select 1 from public.scenes where id='codex-monday-test'
    and source_payload->'packBenefits'->>'allowanceAmount'='800'
    and client_email='new@example.com' and client_name='New contact') then
    raise exception 'Signature allowance or missing contact was not updated';
  end if;
end;
$$;
insert into public.monday_sync_runs(status, actor_name, duration_ms, result)
values ('success', 'Codex rollback test', 100, '{"created":0}');
reset role;
select set_config('request.jwt.claims', jsonb_build_object('sub',client_id,'role','authenticated')::text,true) is not null as client_claims from monday_test_identities;
set local role authenticated;
do $$
declare denied boolean := false;
begin
  if exists(select 1 from public.monday_sync_runs) then raise exception 'Exhibitor can read admin history'; end if;
  begin perform public.patch_scene_from_monday('codex-monday-test', '{}', null, null);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Exhibitor can call privileged patch'; end if;
end;
$$;
reset role;
select set_config('request.jwt.claims', jsonb_build_object('sub',admin_id,'role','authenticated')::text,true) is not null as admin_claims from monday_test_identities;
set local role authenticated;
do $$
declare denied boolean;
begin
  if not exists(select 1 from public.monday_sync_runs where actor_name='Codex rollback test') then raise exception 'Admin cannot read history'; end if;
  denied := false;
  begin insert into public.monday_sync_runs(status,actor_name) values ('success','Forged');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Admin can forge history'; end if;
  denied := false;
  begin update public.monday_sync_runs set actor_name='Forged';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Admin can overwrite history'; end if;
  denied := false;
  begin delete from public.monday_sync_runs;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Admin can delete history'; end if;
end;
$$;
reset role;
select 'PASS: atomic Monday merge preserves locks/options/finalized benefits; only backend writes history; admins read, exhibitors denied' as verification;
rollback;
