-- Who can save waiting links right now (docs/dev/PLAN-link-status.md).
-- The desktop app and the Chrome extension check in every 30-60 seconds while they run. Every
-- place that shows a waiting link (desktop, extension, Claude's get_add_progress) can then say
-- what it is actually waiting for: "the desktop app isn't open", "Chrome isn't open", or "it'll
-- be saved in a moment", instead of a bare "waiting".

create table public.link_workers (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- `claimed_by` in link_queue: 'desktop:<uuid>' or 'extension:<uuid>'.
  worker_id text not null check (char_length(worker_id) between 1 and 100),
  kind text not null check (kind in ('desktop', 'extension')),
  -- Extension: false while it can't work the queue (the desktop app isn't reachable from it, or
  -- it isn't signed in). Desktop: always true.
  can_run boolean not null default true,
  version text check (version is null or char_length(version) <= 40),
  seen_at timestamptz not null default now(),
  primary key (user_id, worker_id)
);

create index link_workers_user_seen_idx on public.link_workers (user_id, kind, seen_at desc);

alter table public.link_workers enable row level security;

create policy link_workers_select_own on public.link_workers
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy link_workers_delete_own on public.link_workers
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Upsert one check-in. Writes go through this function only (no insert/update policy), so a
-- worker can't set another account's row or a time in the future. Rows older than 30 days are
-- dropped on the way, so the table stays a handful of rows per account.
create function public.link_worker_check_in(
  p_worker text,
  p_kind text,
  p_can_run boolean default true,
  p_version text default null,
  p_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    -- The server's admin client (sf_ tokens) acts for the user it names.
    if coalesce(auth.role(), '') <> 'service_role' or p_user_id is null then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    v_user := p_user_id;
  elsif p_user_id is not null and p_user_id <> v_user then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_kind not in ('desktop', 'extension') then
    raise exception 'kind must be desktop or extension' using errcode = '22023';
  end if;
  if p_worker is null or char_length(p_worker) not between 1 and 100 then
    raise exception 'worker must be 1 to 100 characters' using errcode = '22023';
  end if;

  insert into public.link_workers (user_id, worker_id, kind, can_run, version, seen_at)
  values (v_user, p_worker, p_kind, coalesce(p_can_run, true), left(p_version, 40), now())
  on conflict (user_id, worker_id) do update
    set kind = excluded.kind,
        can_run = excluded.can_run,
        version = excluded.version,
        seen_at = excluded.seen_at;

  delete from public.link_workers
  where user_id = v_user and seen_at < now() - interval '30 days';
end;
$$;

revoke execute on function public.link_worker_check_in(text, text, boolean, text, uuid) from public, anon;
grant execute on function public.link_worker_check_in(text, text, boolean, text, uuid) to authenticated, service_role;
