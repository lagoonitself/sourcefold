-- Audit fixes: cycle prevention, user_id scoping for background service execution, and sync safety.

create or replace function public.soft_delete_folder(p_folder_id uuid, p_user_id uuid default null)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := coalesce(auth.uid(), p_user_id);
  v_folder_ids uuid[];
begin
  if v_uid is null then
    raise exception 'soft_delete_folder requires an authenticated user or p_user_id';
  end if;

  with recursive folder_tree as (
    select f.id, array[f.id] as path
    from public.folders f
    where f.id = p_folder_id
      and f.user_id = v_uid
      and f.deleted_at is null
    union all
    select child.id, ft.path || child.id
    from public.folders child
    inner join folder_tree ft on child.parent_id = ft.id
    where child.user_id = v_uid
      and child.deleted_at is null
      and not (child.id = any(ft.path))
  )
  select coalesce(array_agg(id), '{}') into v_folder_ids
  from folder_tree;

  if array_length(v_folder_ids, 1) is not null then
    update public.folders
    set deleted_at = now()
    where id = any(v_folder_ids)
      and user_id = v_uid;

    update public.items
    set deleted_at = now()
    where folder_id = any(v_folder_ids)
      and user_id = v_uid
      and deleted_at is null;
  end if;
end;
$$;

create or replace function public.drive_dirty_folders(p_user_id uuid default null)
returns setof public.folders
language sql
stable
security invoker
set search_path = ''
as $$
  select f.*
  from public.folders f
  where (p_user_id is null or f.user_id = p_user_id)
    and ((f.deleted_at is null and (f.drive_synced_at is null or f.updated_at > f.drive_synced_at))
     or (f.deleted_at is not null and f.drive_folder_id is not null));
$$;

create or replace function public.drive_dirty_items(p_limit integer default 20, p_user_id uuid default null)
returns setof public.items
language sql
stable
security invoker
set search_path = ''
as $$
  select i.*
  from public.items i
  where (p_user_id is null or i.user_id = p_user_id)
    and ((i.deleted_at is null and i.status = 'saved'
         and (i.drive_synced_at is null or i.updated_at > i.drive_synced_at))
     or (i.deleted_at is not null and i.drive_file_id is not null))
  order by i.created_at
  limit greatest(1, least(p_limit, 100));
$$;
