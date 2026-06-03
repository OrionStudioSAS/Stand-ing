insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('object-assets', 'object-assets', true, 104857600, null)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read object assets" on storage.objects;
drop policy if exists "admin read object assets" on storage.objects;
create policy "admin read object assets"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'object-assets'
    and (select private.is_admin())
  );

drop policy if exists "admin insert object assets" on storage.objects;
create policy "admin insert object assets"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'object-assets'
    and (select private.is_admin())
  );

drop policy if exists "admin update object assets" on storage.objects;
create policy "admin update object assets"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'object-assets'
    and (select private.is_admin())
  )
  with check (
    bucket_id = 'object-assets'
    and (select private.is_admin())
  );

drop policy if exists "admin delete object assets" on storage.objects;
create policy "admin delete object assets"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'object-assets'
    and (select private.is_admin())
  );
