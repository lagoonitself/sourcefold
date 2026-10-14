-- Performance and sync fixes:
-- 1. folder_item_counts function for efficient folder item counting
-- 2. mark_item_sync_failed function for atomic error recording and sync advancement
-- 3. drive_unsaved_count function with user scoping
-- 4. Partial and foreign key indexes for fast querying
-- 5. drive_state sync lease lock column and functions

-- 1. Folder item counts
create or replace function public.folder_item_counts(p_user_id uuid)
returns table (folder_id uuid, item_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select folder_id, count(*) as item_count
  from public.items
  where user_id = p_user_id
    and deleted_at is null
    and folder_id is not null
  group by folder_id;
$$;

revoke execute on function public.folder_item_counts(uuid) from public, anon;
grant execute on function public.folder_item_counts(uuid) to authenticated, service_role;

-- 2. Mark item sync failed
create or replace function public.mark_item_sync_failed(
  p_item_id uuid,
  p_user_id uuid,
  p_meta jsonb,
  p_give_up boolean
)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.items
  set meta = p_meta,
      drive_synced_at = case when p_give_up then now() else drive_synced_at end
  where id = p_item_id
    and user_id = p_user_id;
$$;

revoke execute on function public.mark_item_sync_failed(uuid, uuid, jsonb, boolean) from public, anon;
grant execute on function public.mark_item_sync_failed(uuid, uuid, jsonb, boolean) to authenticated, service_role;

-- 3. Scoped drive_unsaved_count
drop function if exists public.drive_unsaved_count();

create or replace function public.drive_unsaved_count(p_user_id uuid default null)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (select count(*) from public.folders f
      where (p_user_id is null or f.user_id = p_user_id)
        and ((f.deleted_at is null and (f.drive_synced_at is null or f.updated_at > f.drive_synced_at))
         or (f.deleted_at is not null and f.drive_folder_id is not null)))::integer
  + (select count(*) from public.items i
      where (p_user_id is null or i.user_id = p_user_id)
        and ((i.deleted_at is null and i.status = 'saved'
             and (i.drive_synced_at is null or i.updated_at > i.drive_synced_at))
         or (i.deleted_at is not null and i.drive_file_id is not null)))::integer;
$$;

revoke execute on function public.drive_unsaved_count(uuid) from public, anon;
grant execute on function public.drive_unsaved_count(uuid) to authenticated, service_role;

-- 4. Indexes
create index if not exists items_user_kind_created_idx
  on public.items (user_id, kind, created_at desc)
  where deleted_at is null;

create index if not exists items_folder_list_idx
  on public.items (folder_id, position, created_at desc)
  where deleted_at is null;

create index if not exists items_user_created_idx
  on public.items (user_id, created_at);

-- 5. Sync lease lock
alter table public.drive_state
  add column if not exists sync_lock_until timestamptz;

create or replace function public.acquire_drive_sync_lock(
  p_user_id uuid,
  p_seconds int default 90
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (p_user_id = (select auth.uid()) or (select auth.role()) = 'service_role') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into public.drive_state (user_id, sync_lock_until)
  values (p_user_id, now() + make_interval(secs => greatest(10, least(coalesce(p_seconds, 90), 300))))
  on conflict (user_id) do update
    set sync_lock_until = excluded.sync_lock_until
    where public.drive_state.sync_lock_until is null
       or public.drive_state.sync_lock_until < now();

  return found;
end;
$$;

create or replace function public.release_drive_sync_lock(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (p_user_id = (select auth.uid()) or (select auth.role()) = 'service_role') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  update public.drive_state
  set sync_lock_until = null
  where user_id = p_user_id;
end;
$$;

revoke execute on function public.acquire_drive_sync_lock(uuid, int) from public, anon;
grant execute on function public.acquire_drive_sync_lock(uuid, int) to authenticated, service_role;

revoke execute on function public.release_drive_sync_lock(uuid) from public, anon;
grant execute on function public.release_drive_sync_lock(uuid) to authenticated, service_role;
