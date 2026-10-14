-- Supabase keeps links and metadata only. Article text and images live in Google Drive.
-- An item's Markdown (Grokipedia, Substack, X) or image file stays in Supabase only until
-- its first copy reaches Drive, then this function clears it. Notes keep their text because
-- you edit them in the app. X keeps x_posts so "Add to this thread" can rebuild the file.
--
-- Returns true when the content was cleared. Returns false when the item changed while it
-- was uploading; then only the Drive id is recorded, the item stays unsaved, and the next
-- save uploads the newer version.
create or replace function public.mark_item_stored_in_drive(
  p_id uuid,
  p_drive_file_id text,
  p_seen_updated_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.items
  set drive_file_id = p_drive_file_id,
      drive_synced_at = now(),
      markdown = case when kind in ('grokipedia', 'substack', 'x') then null else markdown end,
      storage_path = case when kind = 'image' then null else storage_path end
  where id = p_id
    and updated_at = p_seen_updated_at;

  if found then
    return true;
  end if;

  update public.items
  set drive_file_id = p_drive_file_id
  where id = p_id;

  return false;
end;
$$;

revoke all on function public.mark_item_stored_in_drive(uuid, text, timestamptz) from public, anon;
grant execute on function public.mark_item_stored_in_drive(uuid, text, timestamptz)
  to authenticated, service_role;

-- Move content already stored in Supabase out to Drive on the next save.
update public.items
set drive_synced_at = null
where deleted_at is null
  and status = 'saved'
  and (
    (kind in ('grokipedia', 'substack', 'x') and markdown is not null)
    or (kind = 'image' and storage_path is not null)
  );
