-- Wikipedia articles are a new kind of source, saved as Markdown like Grokipedia and Substack.
--
-- 1. items.kind accepts 'wikipedia'.
-- 2. mark_item_stored_in_drive clears a Wikipedia article's text from Supabase once its Drive
--    copy exists, like the other text sources (signature, security and grants are unchanged).

-- The check was created inline on the column, so Postgres named it items_kind_check.
alter table public.items drop constraint if exists items_kind_check;
alter table public.items
  add constraint items_kind_check
  check (kind in ('grokipedia', 'substack', 'wikipedia', 'x', 'note', 'image'));

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
      markdown = case when kind in ('grokipedia', 'substack', 'wikipedia', 'x') then null else markdown end,
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
