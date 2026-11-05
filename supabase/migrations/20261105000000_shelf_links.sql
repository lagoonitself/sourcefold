-- The Link Shelf (docs/dev/PLAN-shelf.md): sites the user keeps with a note, without saving the
-- page as a source. Nothing is downloaded; a shelf link is only this row.

create table public.shelf_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  url text not null check (char_length(url) between 1 and 2048),
  -- shelfKey(url) in packages/core/src/shelf.ts: the same link twice has the same key.
  key text not null check (char_length(key) between 1 and 2048),
  title text not null default '' check (char_length(title) <= 300),
  note text not null default '' check (char_length(note) <= 8000),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  pinned boolean not null default false,
  open_count integer not null default 0 check (open_count >= 0),
  last_opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, key)
);

create trigger set_shelf_links_updated_at
before update on public.shelf_links
for each row execute function public.set_updated_at();

alter table public.shelf_links enable row level security;

create policy shelf_links_select_own on public.shelf_links
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy shelf_links_insert_own on public.shelf_links
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy shelf_links_update_own on public.shelf_links
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy shelf_links_delete_own on public.shelf_links
  for delete to authenticated
  using ((select auth.uid()) = user_id);
