-- Allow authenticated exhibitors to upload/update their own scene visual files.
-- Paths are created as scene-options/<scene_id>/<item_id>/<file>.
drop policy if exists "client read scene option uploads" on storage.objects;
create policy "client read scene option uploads"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'object-assets'
    and (storage.foldername(name))[1] = 'scene-options'
    and private.can_access_scene((storage.foldername(name))[2])
  );

drop policy if exists "client insert scene option uploads" on storage.objects;
create policy "client insert scene option uploads"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'object-assets'
    and (storage.foldername(name))[1] = 'scene-options'
    and private.can_access_scene((storage.foldername(name))[2])
  );

drop policy if exists "client update scene option uploads" on storage.objects;
create policy "client update scene option uploads"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'object-assets'
    and (storage.foldername(name))[1] = 'scene-options'
    and private.can_access_scene((storage.foldername(name))[2])
  )
  with check (
    bucket_id = 'object-assets'
    and (storage.foldername(name))[1] = 'scene-options'
    and private.can_access_scene((storage.foldername(name))[2])
  );
