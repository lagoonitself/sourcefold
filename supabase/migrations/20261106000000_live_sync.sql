-- Live sync between computers (docs/dev/PLAN-sync.md).
--
-- Every write to a synced table sends one small Realtime Broadcast message per account it touched,
-- on the private topic `sync:<user_id>`. The message is only a wake-up call: it carries the table,
-- the operation, how many rows and the first 25 ids, never row contents. Each app then reloads
-- what it shows the way it always has, so a lost or repeated message can't lose anything.

create or replace function public.notify_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  device text;
  account record;
begin
  -- Each desktop install sends its own id, so it can skip the echo of its own writes.
  begin
    device := left(
      nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-sourcefold-device',
      64
    );
  exception when others then
    device := null;
  end;

  for account in
    select
      to_jsonb(r) ->> 'user_id' as user_id,
      count(*) as n,
      (array_agg(coalesce(to_jsonb(r) ->> 'item_id', to_jsonb(r) ->> 'id')))[1:25] as ids
    from changed_rows r
    group by 1
  loop
    continue when account.user_id is null;
    perform realtime.send(
      jsonb_build_object(
        'table', tg_table_name,
        'op', lower(tg_op),
        'n', account.n,
        'ids', to_jsonb(account.ids),
        'device', device
      ),
      'change',
      'sync:' || account.user_id,
      true
    );
  end loop;
  return null;
exception when others then
  -- A sync signal must never make a save fail.
  raise warning 'notify_sync on %: %', tg_table_name, sqlerrm;
  return null;
end;
$$;

revoke all on function public.notify_sync() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'folders', 'items', 'highlights', 'cards', 'outline_sections',
    'item_tldrs', 'x_posts', 'shelf_links'
  ] loop
    execute format('drop trigger if exists sync_insert on public.%I', t);
    execute format('drop trigger if exists sync_update on public.%I', t);
    execute format('drop trigger if exists sync_delete on public.%I', t);
    execute format(
      'create trigger sync_insert after insert on public.%I referencing new table as changed_rows '
      'for each statement execute function public.notify_sync()', t);
    execute format(
      'create trigger sync_update after update on public.%I referencing new table as changed_rows '
      'for each statement execute function public.notify_sync()', t);
    execute format(
      'create trigger sync_delete after delete on public.%I referencing old table as changed_rows '
      'for each statement execute function public.notify_sync()', t);
  end loop;
end;
$$;

-- Links waiting for a computer: only new ones matter to the other devices (claims and progress
-- updates would wake every computer every few seconds during a job).
drop trigger if exists sync_insert on public.link_queue;
create trigger sync_insert after insert on public.link_queue
  referencing new table as changed_rows
  for each statement execute function public.notify_sync();

-- Only the account itself may listen on its topic.
drop policy if exists "sync: receive own account's changes" on realtime.messages;
create policy "sync: receive own account's changes"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'sync:' || (select auth.uid())::text
  );
