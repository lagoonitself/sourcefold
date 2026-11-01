-- Links waiting to be saved by the user's own computer (docs/dev/handoff-web-mcp.md).
-- The web MCP server (Claude or ChatGPT on the web) saves what a cloud server can fetch. Links a
-- cloud server can't (YouTube, Reddit, X, sites that refuse it) wait here until the desktop app is
-- open; the desktop fetches them over the user's own connection. Links that need a real browser
-- tab (X posts, pages that refuse the desktop too) are passed on to the Chrome extension.

create table public.link_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  folder_id uuid not null references public.folders(id) on delete cascade,
  url text not null check (char_length(url) between 1 and 4000),
  -- classifyLink() in apps/mcp ('youtube', 'x', 'reddit', 'substack', 'web', ...). Informational.
  kind text check (kind is null or char_length(kind) <= 40),
  -- Who fetches it next: the desktop app, or the extension in a real browser tab.
  needs text not null default 'desktop' check (needs in ('desktop', 'browser')),
  status text not null default 'waiting'
    check (status in ('waiting', 'working', 'saved', 'duplicate', 'unavailable', 'failed', 'cancelled')),
  claimed_by text check (claimed_by is null or char_length(claimed_by) <= 100),
  claimed_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  -- Written for people: why it is waiting, or why it failed.
  message text check (message is null or char_length(message) <= 1000),
  title text check (title is null or char_length(title) <= 1000),
  item_id uuid references public.items(id) on delete set null,
  -- Who asked for it, e.g. 'Claude', 'ChatGPT', 'Claude Desktop'.
  added_by text not null default 'mcp' check (char_length(added_by) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index link_queue_user_open_idx on public.link_queue (user_id, needs, status, created_at);
create index link_queue_folder_id_idx on public.link_queue (folder_id);
create index link_queue_item_id_idx on public.link_queue (item_id);

-- The same link can't wait twice in the same group.
create unique index link_queue_open_url_key on public.link_queue (user_id, folder_id, url)
  where status in ('waiting', 'working');

create trigger set_link_queue_updated_at
before update on public.link_queue
for each row execute function public.set_updated_at();

alter table public.link_queue enable row level security;

create policy link_queue_select_own on public.link_queue
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy link_queue_insert_own on public.link_queue
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.folders f
      where f.id = link_queue.folder_id and f.user_id = (select auth.uid())
    )
  );

create policy link_queue_update_own on public.link_queue
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.folders f
      where f.id = link_queue.folder_id and f.user_id = (select auth.uid())
    )
  );

create policy link_queue_delete_own on public.link_queue
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Hands the oldest waiting links to one worker (a desktop app or an extension) so two computers
-- never fetch the same link. A claim older than 10 minutes counts as abandoned (the app was closed
-- mid-save) and can be claimed again. Security invoker: RLS still applies to signed-in callers;
-- token callers use the service role and must pass their own user id (they always filter by it).
create function public.claim_link_queue(
  p_user_id uuid,
  p_needs text,
  p_worker text,
  p_limit integer default 1
)
returns setof public.link_queue
language sql
security invoker
set search_path = ''
as $$
  update public.link_queue q
  set status = 'working',
      claimed_by = left(p_worker, 100),
      claimed_at = now(),
      attempts = q.attempts + 1
  where q.id in (
    select c.id from public.link_queue c
    where c.user_id = p_user_id
      and c.needs = p_needs
      and (
        c.status = 'waiting'
        or (c.status = 'working' and c.claimed_at < now() - interval '10 minutes')
      )
    order by c.created_at
    limit greatest(1, least(coalesce(p_limit, 1), 20))
    for update skip locked
  )
  returning q.*;
$$;

revoke execute on function public.claim_link_queue(uuid, text, text, integer) from public, anon;
grant execute on function public.claim_link_queue(uuid, text, text, integer) to authenticated, service_role;
