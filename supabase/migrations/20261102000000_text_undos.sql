-- Removals made by remove_text, so undo_remove_text works across web connector
-- requests. The web server keeps nothing in memory between calls, and one process
-- serves every user, so the removed text has to live with the source's owner.
-- `before_markdown` is the reader body to restore. `after_hash` is the sha256 of
-- that body after the cut, so undo refuses when the text changed some other way.
-- At most eight removals are kept per source (the route deletes older rows).

create table public.text_undos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  before_markdown text not null check (char_length(before_markdown) between 1 and 2000000),
  after_hash text not null check (after_hash ~ '^[a-f0-9]{64}$'),
  lost_highlights jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index text_undos_item_idx on public.text_undos (user_id, item_id, created_at desc);

alter table public.text_undos enable row level security;

create policy text_undos_select_own on public.text_undos
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy text_undos_insert_own on public.text_undos
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.items i
      where i.id = text_undos.item_id
        and i.user_id = (select auth.uid())
        and i.deleted_at is null
    )
  );

create policy text_undos_delete_own on public.text_undos
  for delete to authenticated
  using ((select auth.uid()) = user_id);
