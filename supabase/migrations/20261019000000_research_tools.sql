-- Research tools: keep / maybe / cut, outline tags, a summary and the author on each source,
-- plus outline sections and cards (quotes, b-roll clips and script lines) that belong to a
-- project. Contract: docs/dev/handoff-research.md.

-- 1. Per-source fields. They go through the normal items update, so updated_at moves and the
--    Drive file and the desktop's local copy are rebuilt with the new front matter and summary.
alter table public.items
  add column triage text check (triage in ('keep', 'maybe', 'cut')),
  add column tags text[] not null default '{}' check (cardinality(tags) <= 20),
  add column summary text check (summary is null or char_length(summary) <= 5000),
  add column author text check (author is null or char_length(author) <= 200),
  add column author_type text check (
    author_type in (
      'lab', 'researcher', 'journalist', 'company', 'government',
      'creator', 'forum', 'encyclopedia', 'other'
    )
  );

-- 2. Outline sections: the named parts of a project's outline. Their titles double as the tags
--    suggested on sources.
create table public.outline_sections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null references public.folders(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index outline_sections_user_id_project_id_idx
  on public.outline_sections (user_id, project_id);

create trigger set_outline_sections_updated_at
before update on public.outline_sections
for each row execute function public.set_updated_at();

-- 3. Cards. A quote card comes from a source (usually a highlight), a broll card is a video clip,
--    a line card is a script line the user wrote. section_id is null while the card waits in the
--    card pile. Deleting a source deletes its cards; deleting a highlight keeps them.
create table public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null references public.folders(id) on delete cascade,
  kind text not null check (kind in ('quote', 'broll', 'line')),
  item_id uuid references public.items(id) on delete cascade,
  highlight_id uuid references public.highlights(id) on delete set null,
  quote text not null default '' check (char_length(quote) <= 10000),
  seconds integer check (seconds is null or seconds >= 0),
  end_seconds integer check (end_seconds is null or end_seconds >= 0),
  url text check (url is null or char_length(url) <= 2000),
  note text check (note is null or char_length(note) <= 5000),
  script_line text check (script_line is null or char_length(script_line) <= 5000),
  section_id uuid references public.outline_sections(id) on delete set null,
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cards_end_seconds_check check (end_seconds is null or end_seconds >= seconds)
);

create index cards_user_id_project_id_idx on public.cards (user_id, project_id);
-- Cascades from items, highlights and sections need to find the affected cards without the
-- user_id prefix.
create index cards_item_id_idx on public.cards (item_id);
create index cards_section_id_idx on public.cards (section_id);
create index cards_highlight_id_idx on public.cards (highlight_id);

create trigger set_cards_updated_at
before update on public.cards
for each row execute function public.set_updated_at();

-- 4. Row level security: one policy per action, like highlights. A section or card can only
--    point at the user's own project, source, highlight and section.
alter table public.outline_sections enable row level security;

create policy outline_sections_select_own on public.outline_sections
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy outline_sections_insert_own on public.outline_sections
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.folders f
      where f.id = outline_sections.project_id
        and f.user_id = (select auth.uid())
        and f.parent_id is null
    )
  );

create policy outline_sections_update_own on public.outline_sections
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.folders f
      where f.id = outline_sections.project_id
        and f.user_id = (select auth.uid())
        and f.parent_id is null
    )
  );

create policy outline_sections_delete_own on public.outline_sections
  for delete to authenticated
  using ((select auth.uid()) = user_id);

alter table public.cards enable row level security;

create policy cards_select_own on public.cards
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy cards_insert_own on public.cards
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.folders f
      where f.id = cards.project_id
        and f.user_id = (select auth.uid())
        and f.parent_id is null
    )
    and (
      cards.item_id is null
      or exists (
        select 1 from public.items i
        where i.id = cards.item_id and i.user_id = (select auth.uid())
      )
    )
    and (
      cards.highlight_id is null
      or exists (
        select 1 from public.highlights h
        where h.id = cards.highlight_id and h.user_id = (select auth.uid())
      )
    )
    and (
      cards.section_id is null
      or exists (
        select 1 from public.outline_sections s
        where s.id = cards.section_id and s.user_id = (select auth.uid())
      )
    )
  );

create policy cards_update_own on public.cards
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.folders f
      where f.id = cards.project_id
        and f.user_id = (select auth.uid())
        and f.parent_id is null
    )
    and (
      cards.item_id is null
      or exists (
        select 1 from public.items i
        where i.id = cards.item_id and i.user_id = (select auth.uid())
      )
    )
    and (
      cards.highlight_id is null
      or exists (
        select 1 from public.highlights h
        where h.id = cards.highlight_id and h.user_id = (select auth.uid())
      )
    )
    and (
      cards.section_id is null
      or exists (
        select 1 from public.outline_sections s
        where s.id = cards.section_id and s.user_id = (select auth.uid())
      )
    )
  );

create policy cards_delete_own on public.cards
  for delete to authenticated
  using ((select auth.uid()) = user_id);
