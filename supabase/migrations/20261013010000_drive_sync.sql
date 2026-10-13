-- Drive sync helpers.
-- "Needs saving" compares updated_at with drive_synced_at, which PostgREST filters can't do,
-- so these functions run the comparison in SQL. Marking synced sets drive_synced_at = now()
-- in the same statement that fires the updated_at trigger, so both values match exactly.

create or replace function public.drive_dirty_folders()
returns setof public.folders
language sql
stable
security invoker
set search_path = ''
as $$
  select f.*
  from public.folders f
  where (f.deleted_at is null and (f.drive_synced_at is null or f.updated_at > f.drive_synced_at))
     or (f.deleted_at is not null and f.drive_folder_id is not null);
$$;

create or replace function public.drive_dirty_items(p_limit integer default 20)
returns setof public.items
language sql
stable
security invoker
set search_path = ''
as $$
  select i.*
  from public.items i
  where (i.deleted_at is null and i.status = 'saved'
         and (i.drive_synced_at is null or i.updated_at > i.drive_synced_at))
     or (i.deleted_at is not null and i.drive_file_id is not null)
  order by i.created_at
  limit greatest(1, least(p_limit, 100));
$$;

create or replace function public.drive_unsaved_count()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (select count(*) from public.folders f
      where (f.deleted_at is null and (f.drive_synced_at is null or f.updated_at > f.drive_synced_at))
         or (f.deleted_at is not null and f.drive_folder_id is not null))::integer
  + (select count(*) from public.items i
      where (i.deleted_at is null and i.status = 'saved'
             and (i.drive_synced_at is null or i.updated_at > i.drive_synced_at))
         or (i.deleted_at is not null and i.drive_file_id is not null))::integer;
$$;

-- Pass p_drive_file_id = null after trashing the Drive file of a deleted item.
create or replace function public.mark_item_synced(p_id uuid, p_drive_file_id text)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.items
  set drive_file_id = p_drive_file_id, drive_synced_at = now()
  where id = p_id;
$$;

-- Pass p_drive_folder_id = null after trashing the Drive folder of a deleted folder.
create or replace function public.mark_folder_synced(p_id uuid, p_drive_folder_id text)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.folders
  set drive_folder_id = p_drive_folder_id, drive_synced_at = now()
  where id = p_id;
$$;

revoke all on function public.drive_dirty_folders() from public, anon;
revoke all on function public.drive_dirty_items(integer) from public, anon;
revoke all on function public.drive_unsaved_count() from public, anon;
revoke all on function public.mark_item_synced(uuid, text) from public, anon;
revoke all on function public.mark_folder_synced(uuid, text) from public, anon;
grant execute on function public.drive_dirty_folders() to authenticated;
grant execute on function public.drive_dirty_items(integer) to authenticated;
grant execute on function public.drive_unsaved_count() to authenticated;
grant execute on function public.mark_item_synced(uuid, text) to authenticated;
grant execute on function public.mark_folder_synced(uuid, text) to authenticated;
