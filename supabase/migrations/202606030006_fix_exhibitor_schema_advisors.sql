drop index if exists public.user_profiles_profile_key_idx;

create index if not exists memberships_client_idx on public.exhibitor_salon_memberships (client_id);
create index if not exists memberships_salon_idx on public.exhibitor_salon_memberships (salon_id);
create index if not exists monday_sources_offer_id_idx on public.monday_sources (offer_id);
create index if not exists scenes_offer_id_idx on public.scenes (offer_id);
create index if not exists scenes_base_preset_idx on public.scenes (base_preset_id);

drop policy if exists "admin access user_profiles" on public.user_profiles;
drop policy if exists "users read own profile" on public.user_profiles;
drop policy if exists "read user_profiles" on public.user_profiles;
create policy "read user_profiles" on public.user_profiles
  for select
  to authenticated
  using ((select private.is_admin()) or (select auth.uid()) = auth_user_id);

drop policy if exists "insert user_profiles admin" on public.user_profiles;
create policy "insert user_profiles admin" on public.user_profiles
  for insert
  to authenticated
  with check ((select private.is_admin()));

drop policy if exists "update user_profiles admin" on public.user_profiles;
create policy "update user_profiles admin" on public.user_profiles
  for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists "delete user_profiles admin" on public.user_profiles;
create policy "delete user_profiles admin" on public.user_profiles
  for delete
  to authenticated
  using ((select private.is_admin()));
