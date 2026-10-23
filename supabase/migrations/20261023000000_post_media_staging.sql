-- Post images and GIFs from an imported project file wait here until the Drive save copies them
-- into the post's `<file name>_files/` folder, then they are deleted. Objects live under
-- "<user_id>/<item_id>/<file name>". 25 MB and the types match what the Drive save keeps.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-media',
  'post-media',
  false,
  26214400,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'video/mp4']
)
on conflict (id) do nothing;

create policy post_media_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'post-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy post_media_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy post_media_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'post-media' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy post_media_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'post-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
