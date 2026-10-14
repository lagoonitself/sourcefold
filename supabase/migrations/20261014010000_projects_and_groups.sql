-- Projects and groups.
-- A project is a top-level folder; a group is any folder inside a project.
-- Sources live only in groups. Projects are isolated from each other, and the same
-- link may be saved in several groups, but only once per group.

-- 1. Duplicate links: once per group instead of once per user.
drop index if exists public.items_user_canonical_url_key;
create unique index items_folder_canonical_url_key
  on public.items (folder_id, canonical_url)
  where canonical_url is not null and deleted_at is null;

-- 2. Sources must be saved in a group, never directly in a project.
create or replace function public.check_item_folder()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent_id uuid;
begin
  select f.parent_id into v_parent_id
  from public.folders f
  where f.id = new.folder_id
    and f.user_id = new.user_id
    and f.deleted_at is null;

  if not found then
    raise exception 'invalid folder';
  end if;

  if v_parent_id is null then
    raise exception 'invalid folder: sources must be saved in a group';
  end if;

  return new;
end;
$$;

-- 3. A group that holds sources can't be turned into a project.
create or replace function public.check_folder_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_current_parent uuid;
  v_depth integer := 0;
begin
  if new.parent_id is null then
    if tg_op = 'UPDATE' and old.parent_id is not null and exists (
      select 1
      from public.items i
      where i.folder_id = new.id
        and i.deleted_at is null
    ) then
      raise exception 'a group with sources cannot become a project';
    end if;
    return new;
  end if;

  if not exists (
    select 1
    from public.folders
    where id = new.parent_id
      and user_id = new.user_id
      and deleted_at is null
  ) then
    raise exception 'invalid parent folder';
  end if;

  v_current_parent := new.parent_id;
  while v_current_parent is not null loop
    if v_current_parent = new.id then
      raise exception 'a folder cannot be moved inside itself';
    end if;

    v_depth := v_depth + 1;
    if v_depth >= 1000 then
      exit;
    end if;

    select f.parent_id into v_current_parent
    from public.folders f
    where f.id = v_current_parent;
  end loop;

  return new;
end;
$$;
