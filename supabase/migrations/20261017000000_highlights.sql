-- Highlights: passages (or images) a user marks in a source, with an optional note.
-- Contract: docs/handoff-highlights.md.

create table public.highlights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  kind text not null check (kind in ('text', 'image')),
  quote text not null check (char_length(quote) <= 10000),
  prefix text not null default '' check (char_length(prefix) <= 64),
  suffix text not null default '' check (char_length(suffix) <= 64),
  start_offset integer not null check (start_offset >= 0),
  end_offset integer not null,
  image_src text,
  note text check (note is null or char_length(note) <= 5000),
  seconds integer check (seconds is null or seconds >= 0),
  cited jsonb not null default '[]'::jsonb check (jsonb_typeof(cited) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint highlights_offsets_check check (end_offset >= start_offset)
);

create index highlights_user_id_item_id_idx on public.highlights (user_id, item_id);
-- Cascades from items need to find a deleted item's highlights without the user_id prefix.
create index highlights_item_id_idx on public.highlights (item_id);

create trigger set_highlights_updated_at
before update on public.highlights
for each row execute function public.set_updated_at();

-- A change to a highlight marks its item "needs saving to Drive" (updated_at > drive_synced_at),
-- which also changes the item's local-copy version. SECURITY INVOKER on purpose, and the update
-- is limited to the highlight owner's own items, so it can never touch another user's row.
-- The existing set_items_updated_at trigger fires on this update and sets the same now().
create or replace function public.touch_item_from_highlight()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    update public.items
    set updated_at = now()
    where id = old.item_id
      and user_id = old.user_id;
  end if;

  if tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.item_id is distinct from old.item_id) then
    update public.items
    set updated_at = now()
    where id = new.item_id
      and user_id = new.user_id;
  end if;

  return null;
end;
$$;

create trigger touch_item_from_highlight
after insert or update or delete on public.highlights
for each row execute function public.touch_item_from_highlight();

alter table public.highlights enable row level security;

create policy highlights_select_own on public.highlights
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy highlights_insert_own on public.highlights
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.items i
      where i.id = highlights.item_id and i.user_id = (select auth.uid())
    )
  );

create policy highlights_update_own on public.highlights
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.items i
      where i.id = highlights.item_id and i.user_id = (select auth.uid())
    )
  );

create policy highlights_delete_own on public.highlights
  for delete to authenticated
  using ((select auth.uid()) = user_id);
