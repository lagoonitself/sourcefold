-- TL;DRs of saved sources (docs/dev/PLAN-tldr.md). Their own table, not columns on items: a TL;DR
-- is never written into the source's file, so changing one must not move items.updated_at (that
-- would rebuild the Drive file, the Google Doc and the local copy for nothing).

create table public.item_tldrs (
  item_id uuid primary key references public.items(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- { gist, points, best_part } (normalizeTldr in packages/core/src/tldr/types.ts)
  tldr jsonb not null check (jsonb_typeof(tldr) = 'object' and char_length(tldr::text) <= 4000),
  source text not null check (source in ('article', 'ai')),
  model text check (model is null or char_length(model) <= 200),
  body_hash text check (body_hash is null or char_length(body_hash) <= 128),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index item_tldrs_user_id_idx on public.item_tldrs (user_id);

create trigger set_item_tldrs_updated_at
before update on public.item_tldrs
for each row execute function public.set_updated_at();

alter table public.item_tldrs enable row level security;

create policy item_tldrs_select_own on public.item_tldrs
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy item_tldrs_insert_own on public.item_tldrs
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.items i
      where i.id = item_tldrs.item_id and i.user_id = (select auth.uid())
    )
  );

create policy item_tldrs_update_own on public.item_tldrs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.items i
      where i.id = item_tldrs.item_id and i.user_id = (select auth.uid())
    )
  );

create policy item_tldrs_delete_own on public.item_tldrs
  for delete to authenticated
  using ((select auth.uid()) = user_id);
