-- Initial schema migration for Sourcefold
-- Sets up extensions, core tables, indexes, triggers, functions, and row-level security.

-- Section 1: Extensions
create extension if not exists pg_trgm with schema extensions;

-- Section 2: Timestamp helper function
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Section 3: Tables
create table public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  parent_id uuid references public.folders(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  position integer not null default 0,
  drive_folder_id text,
  drive_synced_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  folder_id uuid not null references public.folders(id) on delete cascade,
  kind text not null check (kind in ('grokipedia', 'substack', 'x', 'note', 'image')),
  title text not null check (char_length(btrim(title)) between 1 and 500),
  source_url text,
  canonical_url text,
  status text not null default 'pending' check (status in ('pending', 'saved', 'failed', 'unavailable')),
  error text,
  markdown text,
  meta jsonb not null default '{}'::jsonb,
  note text,
  position integer not null default 0,
  storage_path text,
  drive_file_id text,
  drive_synced_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.x_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  parent_id uuid references public.x_posts(id) on delete cascade,
  post_url text not null,
  canonical_url text not null,
  author_name text not null,
  handle text not null,
  author_url text not null,
  posted_at timestamptz,
  text text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint x_posts_item_id_canonical_url_key unique (item_id, canonical_url)
);

create table public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  token_hash text not null unique,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.google_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.drive_state (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  root_folder_id text,
  last_saved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Section 4: Indexes
create index folders_user_id_parent_id_position_idx on public.folders (user_id, parent_id, position) where deleted_at is null;
create index folders_parent_id_idx on public.folders (parent_id);

create index items_user_id_folder_id_position_idx on public.items (user_id, folder_id, position) where deleted_at is null;
create index items_folder_id_idx on public.items (folder_id);
create unique index items_user_canonical_url_key on public.items (user_id, canonical_url) where canonical_url is not null and deleted_at is null;
create index items_title_trgm_idx on public.items using gin (title extensions.gin_trgm_ops);

create index x_posts_item_id_idx on public.x_posts (item_id);
create index x_posts_parent_id_idx on public.x_posts (parent_id);
create index x_posts_user_id_idx on public.x_posts (user_id);

create index api_tokens_user_id_idx on public.api_tokens (user_id);

-- Section 5: Timestamp triggers
create trigger set_folders_updated_at
before update on public.folders
for each row execute function public.set_updated_at();

create trigger set_items_updated_at
before update on public.items
for each row execute function public.set_updated_at();

create trigger set_x_posts_updated_at
before update on public.x_posts
for each row execute function public.set_updated_at();

create trigger set_api_tokens_updated_at
before update on public.api_tokens
for each row execute function public.set_updated_at();

create trigger set_google_tokens_updated_at
before update on public.google_tokens
for each row execute function public.set_updated_at();

create trigger set_drive_state_updated_at
before update on public.drive_state
for each row execute function public.set_updated_at();

-- Section 6: X post item touch trigger
create or replace function public.touch_item_from_x_post()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.items
  set updated_at = now()
  where id = coalesce(new.item_id, old.item_id);
  return null;
end;
$$;

create trigger touch_item_from_x_post
after insert or update or delete on public.x_posts
for each row execute function public.touch_item_from_x_post();

-- Section 7: Folder parent validation trigger
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

create trigger check_folder_parent
before insert or update of parent_id on public.folders
for each row execute function public.check_folder_parent();

-- Section 8: Item folder validation trigger
create or replace function public.check_item_folder()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.folders
    where id = new.folder_id
      and user_id = new.user_id
      and deleted_at is null
  ) then
    raise exception 'invalid folder';
  end if;

  return new;
end;
$$;

create trigger check_item_folder
before insert or update of folder_id on public.items
for each row execute function public.check_item_folder();

-- Section 9: Soft delete folder function
create or replace function public.soft_delete_folder(p_folder_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_folder_ids uuid[];
begin
  with recursive folder_tree as (
    select f.id
    from public.folders f
    where f.id = p_folder_id
      and f.user_id = auth.uid()
      and f.deleted_at is null
    union all
    select child.id
    from public.folders child
    inner join folder_tree ft on child.parent_id = ft.id
    where child.user_id = auth.uid()
      and child.deleted_at is null
  )
  select coalesce(array_agg(id), '{}') into v_folder_ids
  from folder_tree;

  if array_length(v_folder_ids, 1) is not null then
    update public.folders
    set deleted_at = now()
    where id = any(v_folder_ids);

    update public.items
    set deleted_at = now()
    where folder_id = any(v_folder_ids)
      and deleted_at is null;
  end if;
end;
$$;

revoke all on function public.soft_delete_folder(uuid) from public;
revoke all on function public.soft_delete_folder(uuid) from anon;
grant execute on function public.soft_delete_folder(uuid) to authenticated;

-- Section 10: Google refresh token upsert function
create or replace function public.save_google_refresh_token(p_refresh_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.google_tokens (user_id, refresh_token)
  values (auth.uid(), p_refresh_token)
  on conflict (user_id) do update
  set refresh_token = excluded.refresh_token;
end;
$$;

revoke all on function public.save_google_refresh_token(text) from public;
revoke all on function public.save_google_refresh_token(text) from anon;
grant execute on function public.save_google_refresh_token(text) to authenticated;

-- Section 11: Health check function
create or replace function public.health()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select 'ok';
$$;

revoke all on function public.health() from public;
grant execute on function public.health() to anon, authenticated;

-- Section 12: Row Level Security
alter table public.folders enable row level security;

create policy folders_select_own on public.folders
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy folders_insert_own on public.folders
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy folders_update_own on public.folders
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy folders_delete_own on public.folders
  for delete to authenticated
  using ((select auth.uid()) = user_id);

alter table public.items enable row level security;

create policy items_select_own on public.items
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy items_insert_own on public.items
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy items_update_own on public.items
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy items_delete_own on public.items
  for delete to authenticated
  using ((select auth.uid()) = user_id);

alter table public.x_posts enable row level security;

create policy x_posts_select_own on public.x_posts
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy x_posts_insert_own on public.x_posts
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy x_posts_update_own on public.x_posts
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy x_posts_delete_own on public.x_posts
  for delete to authenticated
  using ((select auth.uid()) = user_id);

alter table public.api_tokens enable row level security;

create policy api_tokens_select_own on public.api_tokens
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy api_tokens_insert_own on public.api_tokens
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy api_tokens_update_own on public.api_tokens
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy api_tokens_delete_own on public.api_tokens
  for delete to authenticated
  using ((select auth.uid()) = user_id);

alter table public.drive_state enable row level security;

create policy drive_state_select_own on public.drive_state
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy drive_state_insert_own on public.drive_state
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy drive_state_update_own on public.drive_state
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy drive_state_delete_own on public.drive_state
  for delete to authenticated
  using ((select auth.uid()) = user_id);

alter table public.google_tokens enable row level security;
-- Note: google_tokens has no RLS policies; direct client access is denied.
