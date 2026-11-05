-- Article text lives in Cloudflare R2, Google Drive becomes an optional backup, and projects can be
-- shared with other people (docs/dev/PLAN-teams.md).
--
-- Who owns a row: `user_id` keeps meaning "whose data this is". In a shared project every folder,
-- source, highlight, card and outline row carries the project owner's `user_id`, whoever made it;
-- triggers set it. Members reach those rows through `project_members` and the rules below.
--
-- Where the text is: `items.markdown` holds a source's text only until it has been copied out.
-- A device uploads it to R2 (through the Sourcefold content Worker) and calls
-- `mark_item_content_stored`; the text is cleared once R2 has it and, if the owner keeps a Drive
-- backup, Drive has it too. `markdown is null` means "read it from R2" (or, for sources saved
-- before this migration and not moved yet, from the owner's Drive).
--
-- Needs 20261106000000_live_sync.sql first (this replaces its notify_sync()).

-- ---------------------------------------------------------------------------------------------
-- 0. Helpers live in a schema the API doesn't expose.
-- ---------------------------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- Marks (moving text to R2 or Drive, filling project_id) must not count as a change: a changed
-- updated_at makes Drive upload the file again and every computer download it again.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('sourcefold.keep_updated_at', true), '') = 'on' then
    new.updated_at = old.updated_at;
  else
    new.updated_at = now();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 1. New columns.
-- ---------------------------------------------------------------------------------------------

alter table public.folders
  add column if not exists project_id uuid,
  add column if not exists created_by uuid default auth.uid() references auth.users(id) on delete set null;

alter table public.items
  add column if not exists project_id uuid,
  add column if not exists created_by uuid default auth.uid() references auth.users(id) on delete set null,
  -- The R2 copy of the text (or image): its SHA-256, size, and the item's updated_at it matches.
  add column if not exists content_sha256 text,
  add column if not exists content_bytes bigint,
  add column if not exists content_at timestamptz;

alter table public.items drop constraint if exists items_content_sha256_check;
alter table public.items add constraint items_content_sha256_check
  check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');

-- Off: no Drive copies at all. Missing row: on (everyone had Drive before this).
alter table public.drive_state
  add column if not exists backup_enabled boolean not null default true;

-- Fill project_id with the old triggers still in place (they don't touch it).
select set_config('sourcefold.keep_updated_at', 'on', true);

with recursive tree as (
  select f.id, f.id as project_id, array[f.id] as path
  from public.folders f
  where f.parent_id is null
  union all
  select f.id, t.project_id, t.path || f.id
  from public.folders f
  join tree t on f.parent_id = t.id
  where not (f.id = any(t.path))
)
update public.folders f
set project_id = t.project_id
from tree t
where f.id = t.id
  and f.project_id is distinct from t.project_id;

-- Anything unreachable (shouldn't exist) becomes its own project rather than nobody's.
update public.folders set project_id = id where project_id is null;

update public.items i
set project_id = f.project_id
from public.folders f
where f.id = i.folder_id
  and i.project_id is distinct from f.project_id;

select set_config('sourcefold.keep_updated_at', '', true);

alter table public.folders alter column project_id set not null;
-- The check_folder_parent trigger always sets it; the default only keeps inserts from naming it.
alter table public.folders alter column project_id set default gen_random_uuid();

create index if not exists folders_project_id_idx on public.folders (project_id);
create index if not exists items_project_id_idx on public.items (project_id);
create index if not exists items_text_waiting_idx on public.items (updated_at)
  where deleted_at is null and markdown is not null;

-- ---------------------------------------------------------------------------------------------
-- 2. Members and invites.
-- ---------------------------------------------------------------------------------------------

create table if not exists public.project_members (
  project_id uuid not null references public.folders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_id_idx on public.project_members (user_id);
alter table public.project_members enable row level security;

drop trigger if exists set_project_members_updated_at on public.project_members;
create trigger set_project_members_updated_at before update on public.project_members
  for each row execute function public.set_updated_at();

-- One active code per project and role. Codes are 8 characters without the dash (`K7QM2XPD`);
-- apps show them as `K7QM-2XPD`.
create table if not exists public.project_invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.folders(id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z2-9]{8}$'),
  role text not null check (role in ('editor', 'viewer')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index if not exists project_invites_one_active_idx
  on public.project_invites (project_id, role) where revoked_at is null;
alter table public.project_invites enable row level security;
-- No policies on project_invites: only the functions below read or write it.

-- ---------------------------------------------------------------------------------------------
-- 3. Access helpers.
-- ---------------------------------------------------------------------------------------------

-- 'owner', 'editor', 'viewer' or null. A deleted project gives members nothing.
create or replace function private.project_role(p_project uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_project is null or p_user is null then null
    when exists (
      select 1 from public.folders f
      where f.id = p_project and f.parent_id is null and f.user_id = p_user
    ) then 'owner'
    else (
      select m.role
      from public.project_members m
      join public.folders f on f.id = m.project_id and f.parent_id is null and f.deleted_at is null
      where m.project_id = p_project and m.user_id = p_user
    )
  end;
$$;

create or replace function private.can_read_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.project_role(p_project, (select auth.uid())) is not null;
$$;

create or replace function private.can_edit_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.project_role(p_project, (select auth.uid())) in ('owner', 'editor'), false);
$$;

create or replace function private.can_read_item(p_item uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select i.user_id = (select auth.uid()) or private.can_read_project(i.project_id)
    from public.items i where i.id = p_item
  ), false);
$$;

create or replace function private.can_edit_item(p_item uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select i.user_id = (select auth.uid()) or private.can_edit_project(i.project_id)
    from public.items i where i.id = p_item
  ), false);
$$;

create or replace function private.can_edit_folder(p_folder uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select f.user_id = (select auth.uid()) or private.can_edit_project(f.project_id)
    from public.folders f where f.id = p_folder and f.deleted_at is null
  ), false);
$$;

-- Whether this owner's sources are also copied to Google Drive: switched on, and Drive connected.
create or replace function private.drive_backup_on(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select d.backup_enabled from public.drive_state d where d.user_id = p_user), true)
    and exists (select 1 from public.google_tokens g where g.user_id = p_user);
$$;

-- Who is asking. A signed-in caller is whoever their token says, and may not name anyone else.
-- Only the server's admin client (no auth.uid()) names the user it acts for.
create or replace function private.actor(p_user uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is not null then
    if p_user is not null and p_user <> v_uid then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    return v_uid;
  end if;
  if p_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  return p_user;
end;
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. Triggers that keep owner and project right.
-- ---------------------------------------------------------------------------------------------

-- Folders: a group takes its parent's owner and project. The person adding it must be able to
-- edit that project. Groups don't move between projects with different owners.
create or replace function public.check_folder_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.user_id);
  v_parent record;
  v_current uuid;
  v_depth integer := 0;
begin
  if new.parent_id is null then
    if tg_op = 'INSERT' then
      new.user_id := v_actor;
    else
      if old.parent_id is not null and exists (
        select 1 from public.items i where i.folder_id = new.id and i.deleted_at is null
      ) then
        raise exception 'a group with sources cannot become a project';
      end if;
      if old.user_id is distinct from v_actor then
        raise exception 'only the project owner can do that' using errcode = '42501';
      end if;
      new.user_id := old.user_id;
    end if;
    new.project_id := new.id;
    return new;
  end if;

  select f.id, f.user_id, f.project_id, f.deleted_at into v_parent
  from public.folders f
  where f.id = new.parent_id;

  if not found
     or (v_parent.deleted_at is not null
         and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id)) then
    raise exception 'invalid parent folder';
  end if;

  if tg_op = 'INSERT' then
    if coalesce(private.project_role(v_parent.project_id, v_actor), '') not in ('owner', 'editor') then
      raise exception 'invalid parent folder' using errcode = '42501';
    end if;
  else
    if v_parent.user_id is distinct from old.user_id then
      raise exception 'groups can only move between projects with the same owner';
    end if;
    if new.parent_id is distinct from old.parent_id
       and coalesce(private.project_role(v_parent.project_id, v_actor), '') not in ('owner', 'editor') then
      raise exception 'invalid parent folder' using errcode = '42501';
    end if;
  end if;

  new.user_id := v_parent.user_id;
  new.project_id := v_parent.project_id;

  v_current := new.parent_id;
  while v_current is not null loop
    if v_current = new.id then
      raise exception 'a folder cannot be moved inside itself';
    end if;
    v_depth := v_depth + 1;
    exit when v_depth >= 1000;
    select f.parent_id into v_current from public.folders f where f.id = v_current;
  end loop;

  return new;
end;
$$;

drop trigger if exists check_folder_parent on public.folders;
create trigger check_folder_parent
  before insert or update of parent_id, user_id, project_id on public.folders
  for each row execute function public.check_folder_parent();

-- A folder that changed project takes its subfolders and sources along (their own triggers
-- recompute from the parent, so this recurses down the tree). It watches parent_id too: a column
-- set by a BEFORE trigger doesn't fire `update of` that column.
create or replace function private.cascade_folder_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text := coalesce(current_setting('sourcefold.keep_updated_at', true), '');
begin
  if new.project_id is distinct from old.project_id then
    perform set_config('sourcefold.keep_updated_at', 'on', true);
    update public.folders set project_id = new.project_id
    where parent_id = new.id and project_id is distinct from new.project_id;
    update public.items set project_id = new.project_id
    where folder_id = new.id and project_id is distinct from new.project_id;
    perform set_config('sourcefold.keep_updated_at', v_prev, true);
  end if;
  return null;
end;
$$;

drop trigger if exists cascade_folder_project on public.folders;
create trigger cascade_folder_project
  after update of parent_id, project_id on public.folders
  for each row execute function private.cascade_folder_project();

-- Sources: owner and project come from the group. The person adding one must be able to edit
-- that project; sources don't move between projects with different owners.
create or replace function public.check_item_folder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.user_id);
  v_folder record;
  v_moving boolean := tg_op = 'INSERT' or new.folder_id is distinct from old.folder_id;
begin
  select f.parent_id, f.user_id, f.project_id, f.deleted_at into v_folder
  from public.folders f
  where f.id = new.folder_id;

  if not found or (v_moving and v_folder.deleted_at is not null) then
    raise exception 'invalid folder';
  end if;
  if v_moving and v_folder.parent_id is null then
    raise exception 'invalid folder: sources must be saved in a group';
  end if;

  if tg_op = 'UPDATE' and v_folder.user_id is distinct from old.user_id then
    raise exception 'sources can only move between projects with the same owner';
  end if;
  if v_moving
     and coalesce(private.project_role(v_folder.project_id, v_actor), '') not in ('owner', 'editor') then
    raise exception 'invalid folder' using errcode = '42501';
  end if;

  new.user_id := v_folder.user_id;
  new.project_id := v_folder.project_id;
  return new;
end;
$$;

drop trigger if exists check_item_folder on public.items;
create trigger check_item_folder
  before insert or update of folder_id, user_id, project_id on public.items
  for each row execute function public.check_item_folder();

-- Rows hanging off a source (highlights, X posts, TL;DRs, undo steps) belong to the source's owner.
create or replace function private.set_owner_from_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.user_id);
  v_item record;
begin
  select i.user_id, i.project_id into v_item from public.items i where i.id = new.item_id;
  if not found then
    raise exception 'invalid item';
  end if;
  if (tg_op = 'INSERT' or new.item_id is distinct from old.item_id)
     and v_item.user_id is distinct from v_actor
     and coalesce(private.project_role(v_item.project_id, v_actor), '') not in ('owner', 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  new.user_id := v_item.user_id;
  return new;
end;
$$;

-- Cards and outline sections belong to the project's owner.
create or replace function private.set_owner_from_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.user_id);
  v_owner uuid;
begin
  select f.user_id into v_owner
  from public.folders f
  where f.id = new.project_id and f.parent_id is null;
  if not found then
    raise exception 'invalid project';
  end if;
  if (tg_op = 'INSERT' or new.project_id is distinct from old.project_id)
     and v_owner is distinct from v_actor
     and coalesce(private.project_role(new.project_id, v_actor), '') not in ('owner', 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  new.user_id := v_owner;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['highlights', 'x_posts', 'item_tldrs', 'text_undos'] loop
    execute format('drop trigger if exists a_set_owner on public.%I', t);
    execute format(
      'create trigger a_set_owner before insert or update of item_id, user_id on public.%I '
      'for each row execute function private.set_owner_from_item()', t);
  end loop;
  foreach t in array array['cards', 'outline_sections'] loop
    execute format('drop trigger if exists a_set_owner on public.%I', t);
    execute format(
      'create trigger a_set_owner before insert or update of project_id, user_id on public.%I '
      'for each row execute function private.set_owner_from_project()', t);
  end loop;
end;
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. Row rules: your own rows, plus the projects you're a member of.
-- ---------------------------------------------------------------------------------------------

-- folders: members read; editors change groups; only the owner changes or deletes the project row.
drop policy if exists folders_select_own on public.folders;
drop policy if exists folders_insert_own on public.folders;
drop policy if exists folders_update_own on public.folders;
drop policy if exists folders_delete_own on public.folders;
create policy folders_select on public.folders for select to authenticated
  using (user_id = (select auth.uid()) or private.can_read_project(project_id));
create policy folders_insert on public.folders for insert to authenticated
  with check (
    (parent_id is null and user_id = (select auth.uid()))
    or (parent_id is not null and private.can_edit_project(project_id))
  );
create policy folders_update on public.folders for update to authenticated
  using (user_id = (select auth.uid()) or (parent_id is not null and private.can_edit_project(project_id)))
  with check (user_id = (select auth.uid()) or (parent_id is not null and private.can_edit_project(project_id)));
create policy folders_delete on public.folders for delete to authenticated
  using (user_id = (select auth.uid()));

-- items
drop policy if exists items_select_own on public.items;
drop policy if exists items_insert_own on public.items;
drop policy if exists items_update_own on public.items;
drop policy if exists items_delete_own on public.items;
create policy items_select on public.items for select to authenticated
  using (user_id = (select auth.uid()) or private.can_read_project(project_id));
create policy items_insert on public.items for insert to authenticated
  with check (private.can_edit_project(project_id));
create policy items_update on public.items for update to authenticated
  using (user_id = (select auth.uid()) or private.can_edit_project(project_id))
  with check (user_id = (select auth.uid()) or private.can_edit_project(project_id));
create policy items_delete on public.items for delete to authenticated
  using (user_id = (select auth.uid()) or private.can_edit_project(project_id));

-- highlights, x_posts, item_tldrs: through their source.
do $$
declare
  t text;
begin
  foreach t in array array['highlights', 'x_posts', 'item_tldrs'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format(
      'create policy %I on public.%I for select to authenticated '
      'using (user_id = (select auth.uid()) or private.can_read_item(item_id))', t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated '
      'with check (private.can_edit_item(item_id))', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated '
      'using (user_id = (select auth.uid()) or private.can_edit_item(item_id)) '
      'with check (private.can_edit_item(item_id))', t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated '
      'using (user_id = (select auth.uid()) or private.can_edit_item(item_id))', t || '_delete', t);
  end loop;
end;
$$;

-- text_undos (no updates)
drop policy if exists text_undos_select_own on public.text_undos;
drop policy if exists text_undos_insert_own on public.text_undos;
drop policy if exists text_undos_delete_own on public.text_undos;
create policy text_undos_select on public.text_undos for select to authenticated
  using (user_id = (select auth.uid()) or private.can_edit_item(item_id));
create policy text_undos_insert on public.text_undos for insert to authenticated
  with check (
    private.can_edit_item(item_id)
    and exists (select 1 from public.items i where i.id = item_id and i.deleted_at is null)
  );
create policy text_undos_delete on public.text_undos for delete to authenticated
  using (user_id = (select auth.uid()) or private.can_edit_item(item_id));

-- cards and outline_sections: through their project. A card's source, highlight and section must
-- belong to the same owner, as before.
drop policy if exists cards_select_own on public.cards;
drop policy if exists cards_insert_own on public.cards;
drop policy if exists cards_update_own on public.cards;
drop policy if exists cards_delete_own on public.cards;
create policy cards_select on public.cards for select to authenticated
  using (user_id = (select auth.uid()) or private.can_read_project(project_id));
create policy cards_insert on public.cards for insert to authenticated
  with check (
    private.can_edit_project(project_id)
    and exists (select 1 from public.folders f where f.id = project_id and f.parent_id is null)
    and (item_id is null or exists (
      select 1 from public.items i where i.id = item_id and i.user_id = cards.user_id))
    and (highlight_id is null or exists (
      select 1 from public.highlights h where h.id = highlight_id and h.user_id = cards.user_id))
    and (section_id is null or exists (
      select 1 from public.outline_sections s where s.id = section_id and s.user_id = cards.user_id))
  );
create policy cards_update on public.cards for update to authenticated
  using (user_id = (select auth.uid()) or private.can_edit_project(project_id))
  with check (
    private.can_edit_project(project_id)
    and (item_id is null or exists (
      select 1 from public.items i where i.id = item_id and i.user_id = cards.user_id))
    and (highlight_id is null or exists (
      select 1 from public.highlights h where h.id = highlight_id and h.user_id = cards.user_id))
    and (section_id is null or exists (
      select 1 from public.outline_sections s where s.id = section_id and s.user_id = cards.user_id))
  );
create policy cards_delete on public.cards for delete to authenticated
  using (user_id = (select auth.uid()) or private.can_edit_project(project_id));

drop policy if exists outline_sections_select_own on public.outline_sections;
drop policy if exists outline_sections_insert_own on public.outline_sections;
drop policy if exists outline_sections_update_own on public.outline_sections;
drop policy if exists outline_sections_delete_own on public.outline_sections;
create policy outline_sections_select on public.outline_sections for select to authenticated
  using (user_id = (select auth.uid()) or private.can_read_project(project_id));
create policy outline_sections_insert on public.outline_sections for insert to authenticated
  with check (private.can_edit_project(project_id));
create policy outline_sections_update on public.outline_sections for update to authenticated
  using (user_id = (select auth.uid()) or private.can_edit_project(project_id))
  with check (private.can_edit_project(project_id));
create policy outline_sections_delete on public.outline_sections for delete to authenticated
  using (user_id = (select auth.uid()) or private.can_edit_project(project_id));

-- link_queue stays personal (your computer saves your links), but may target a shared group.
drop policy if exists link_queue_insert_own on public.link_queue;
drop policy if exists link_queue_update_own on public.link_queue;
create policy link_queue_insert_own on public.link_queue for insert to authenticated
  with check (user_id = (select auth.uid()) and private.can_edit_folder(folder_id));
create policy link_queue_update_own on public.link_queue for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.can_edit_folder(folder_id));

-- project_members: everyone in a project sees who else is in it. Changes go through functions.
drop policy if exists project_members_select on public.project_members;
create policy project_members_select on public.project_members for select to authenticated
  using (user_id = (select auth.uid()) or private.can_read_project(project_id));

-- ---------------------------------------------------------------------------------------------
-- 6. Text in R2.
-- ---------------------------------------------------------------------------------------------

-- What the content Worker asks before reading or writing an item's text or image. Null: no access
-- (or no such item). `used_bytes` is everything stored, for the free-plan stop.
create or replace function public.content_access(p_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_item record;
  v_role text;
begin
  if v_uid is null then
    return null;
  end if;
  select i.user_id, i.project_id, i.kind into v_item from public.items i where i.id = p_item_id;
  if not found then
    return null;
  end if;
  v_role := case
    when v_item.user_id = v_uid then 'owner'
    else private.project_role(v_item.project_id, v_uid)
  end;
  if v_role is null then
    return null;
  end if;
  return jsonb_build_object(
    'can_read', true,
    'can_edit', v_role in ('owner', 'editor'),
    'kind', v_item.kind,
    'used_bytes', (select coalesce(sum(i.content_bytes), 0) from public.items i)
  );
end;
$$;

-- Sources whose text (or image) still waits in Supabase for its R2 copy, that this person may
-- write. Images only from the person's own upload folder, which is all they can read.
create or replace function public.content_waiting_items(p_limit integer default 20, p_user_id uuid default null)
returns setof public.items
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.actor(p_user_id);
begin
  return query
  select i.*
  from public.items i
  where i.deleted_at is null
    and i.status = 'saved'
    and i.kind <> 'note'
    and (
      (i.kind <> 'image' and i.markdown is not null)
      or (i.kind = 'image' and i.storage_path is not null
          and split_part(i.storage_path, '/', 1) = v_actor::text)
    )
    and (i.content_at is distinct from i.updated_at or not private.drive_backup_on(i.user_id))
    and (i.user_id = v_actor or private.project_role(i.project_id, v_actor) = 'editor')
  order by i.updated_at
  limit greatest(1, least(p_limit, 100));
end;
$$;

-- Sources saved before R2 whose only copy is in the owner's Drive. Only the owner can move them
-- (only the owner's Drive has them).
create or replace function public.content_drive_only_items(p_limit integer default 20, p_user_id uuid default null)
returns setof public.items
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.actor(p_user_id);
begin
  return query
  select i.*
  from public.items i
  where i.user_id = v_actor
    and i.deleted_at is null
    and i.status = 'saved'
    and i.kind <> 'note'
    and i.content_sha256 is null
    and i.drive_file_id is not null
    and ((i.kind <> 'image' and i.markdown is null) or (i.kind = 'image' and i.storage_path is null))
  order by i.created_at
  limit greatest(1, least(p_limit, 100));
end;
$$;

-- R2 now holds this item's text (or image) as of p_seen_updated_at. Clears the Supabase copy when
-- nothing changed since and Drive doesn't still need it. True when it cleared something (for an
-- image, the caller then deletes the Storage file).
create or replace function public.mark_item_content_stored(
  p_id uuid,
  p_seen_updated_at timestamptz,
  p_sha256 text,
  p_bytes bigint,
  p_user_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.actor(p_user_id);
  v_prev text := coalesce(current_setting('sourcefold.keep_updated_at', true), '');
  v_item record;
  v_clear boolean := false;
begin
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' or p_bytes is null or p_bytes < 0 then
    raise exception 'invalid content hash or size';
  end if;

  select i.* into v_item from public.items i where i.id = p_id for update;
  if not found then
    return false;
  end if;
  if v_item.user_id is distinct from v_actor
     and coalesce(private.project_role(v_item.project_id, v_actor), '') not in ('owner', 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  perform set_config('sourcefold.keep_updated_at', 'on', true);
  if v_item.updated_at = p_seen_updated_at then
    v_clear := v_item.kind <> 'note'
      and (not private.drive_backup_on(v_item.user_id)
           or (v_item.drive_file_id is not null and v_item.drive_synced_at >= v_item.updated_at));
    v_clear := v_clear and (
      (v_item.kind <> 'image' and v_item.markdown is not null)
      or (v_item.kind = 'image' and v_item.storage_path is not null)
    );
    update public.items
    set content_sha256 = p_sha256,
        content_bytes = p_bytes,
        content_at = p_seen_updated_at,
        markdown = case when v_clear and kind <> 'image' then null else markdown end,
        storage_path = case when v_clear and kind = 'image' then null else storage_path end
    where id = p_id;
  else
    -- Changed while uploading: the Supabase copy stays the newest and is sent again.
    update public.items
    set content_sha256 = p_sha256, content_bytes = p_bytes
    where id = p_id and content_sha256 is null;
  end if;
  perform set_config('sourcefold.keep_updated_at', v_prev, true);
  return v_clear;
end;
$$;

-- Drive now has the item. Clears the Supabase copy only when R2 holds the same version (or, with
-- p_r2 false, a deployment without R2, as before R2 existed).
create or replace function public.mark_item_saved_to_drive(
  p_id uuid,
  p_drive_file_id text,
  p_seen_updated_at timestamptz,
  p_r2 boolean default true
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_prev text := coalesce(current_setting('sourcefold.keep_updated_at', true), '');
  v_item record;
  v_clear boolean := false;
begin
  select i.kind, i.updated_at, i.content_sha256, i.content_at, i.markdown, i.storage_path
  into v_item
  from public.items i
  where i.id = p_id
  for update;
  if not found then
    return false;
  end if;

  perform set_config('sourcefold.keep_updated_at', 'on', true);
  if v_item.updated_at = p_seen_updated_at then
    v_clear := (not p_r2 or (v_item.content_sha256 is not null and v_item.content_at = p_seen_updated_at))
      and (
        (v_item.kind in ('grokipedia', 'substack', 'wikipedia', 'x', 'youtube', 'web', 'reddit',
                         'pdf', 'hackernews', 'bluesky')
         and v_item.markdown is not null)
        or (v_item.kind = 'image' and v_item.storage_path is not null)
      );
    update public.items
    set drive_file_id = p_drive_file_id,
        drive_synced_at = now(),
        markdown = case when v_clear and kind <> 'image' then null else markdown end,
        storage_path = case when v_clear and kind = 'image' then null else storage_path end
    where id = p_id;
  else
    update public.items set drive_file_id = p_drive_file_id where id = p_id;
  end if;
  perform set_config('sourcefold.keep_updated_at', v_prev, true);
  return v_clear;
end;
$$;

-- Apps from before R2 still call this name: with R2 in place their Drive save must never clear text.
create or replace function public.mark_item_stored_in_drive(
  p_id uuid,
  p_drive_file_id text,
  p_seen_updated_at timestamptz
)
returns boolean
language sql
set search_path = ''
as $$
  select public.mark_item_saved_to_drive(p_id, p_drive_file_id, p_seen_updated_at, true);
$$;

-- ---------------------------------------------------------------------------------------------
-- 7. Drive is a backup that can be off.
-- ---------------------------------------------------------------------------------------------

create or replace function public.set_drive_backup(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  insert into public.drive_state (user_id, backup_enabled)
  values (v_uid, coalesce(p_enabled, true))
  on conflict (user_id) do update set backup_enabled = excluded.backup_enabled;
  return coalesce(p_enabled, true);
end;
$$;

create or replace function public.drive_dirty_folders(p_user_id uuid default null)
returns setof public.folders
language sql
stable
set search_path = ''
as $$
  select f.*
  from public.folders f
  where (p_user_id is null or f.user_id = p_user_id)
    and private.drive_backup_on(f.user_id)
    and ((f.deleted_at is null and (f.drive_synced_at is null or f.updated_at > f.drive_synced_at))
     or (f.deleted_at is not null and f.drive_folder_id is not null));
$$;

create or replace function public.drive_dirty_folders()
returns setof public.folders
language sql
stable
set search_path = ''
as $$
  select * from public.drive_dirty_folders((select auth.uid()));
$$;

create or replace function public.drive_dirty_items(p_limit integer default 20, p_user_id uuid default null)
returns setof public.items
language sql
stable
set search_path = ''
as $$
  select i.*
  from public.items i
  where (p_user_id is null or i.user_id = p_user_id)
    and private.drive_backup_on(i.user_id)
    and ((i.deleted_at is null and i.status = 'saved'
         and (i.drive_synced_at is null or i.updated_at > i.drive_synced_at))
     or (i.deleted_at is not null and i.drive_file_id is not null))
  order by i.created_at
  limit greatest(1, least(p_limit, 100));
$$;

create or replace function public.drive_dirty_items(p_limit integer default 20)
returns setof public.items
language sql
stable
set search_path = ''
as $$
  select * from public.drive_dirty_items(p_limit, (select auth.uid()));
$$;

create or replace function public.drive_unsaved_count(p_user_id uuid default null)
returns integer
language sql
stable
set search_path = ''
as $$
  select
    (select count(*) from public.folders f
      where (p_user_id is null or f.user_id = p_user_id)
        and private.drive_backup_on(f.user_id)
        and ((f.deleted_at is null and (f.drive_synced_at is null or f.updated_at > f.drive_synced_at))
         or (f.deleted_at is not null and f.drive_folder_id is not null)))::integer
  + (select count(*) from public.items i
      where (p_user_id is null or i.user_id = p_user_id)
        and private.drive_backup_on(i.user_id)
        and ((i.deleted_at is null and i.status = 'saved'
             and (i.drive_synced_at is null or i.updated_at > i.drive_synced_at))
         or (i.deleted_at is not null and i.drive_file_id is not null)))::integer;
$$;

create or replace function public.drive_unsaved_count()
returns integer
language sql
stable
set search_path = ''
as $$
  select public.drive_unsaved_count((select auth.uid()));
$$;

-- ---------------------------------------------------------------------------------------------
-- 8. Existing functions that must see shared projects.
-- ---------------------------------------------------------------------------------------------

-- Signed in: every source you can see. Server admin client: only that user's own.
create or replace function public.folder_item_counts(p_user_id uuid)
returns table (folder_id uuid, item_count bigint)
language sql
stable
set search_path = ''
as $$
  select i.folder_id, count(*) as item_count
  from public.items i
  where i.deleted_at is null
    and i.folder_id is not null
    and (i.user_id = p_user_id or (select auth.uid()) = p_user_id)
  group by i.folder_id;
$$;

-- Editors may delete groups in a shared project; only the owner deletes the project itself.
create or replace function public.soft_delete_folder(p_folder_id uuid, p_user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.actor(p_user_id);
  v_folder record;
  v_folder_ids uuid[];
begin
  select f.id, f.parent_id, f.user_id, f.project_id into v_folder
  from public.folders f
  where f.id = p_folder_id and f.deleted_at is null;
  if not found then
    return;
  end if;
  if v_folder.parent_id is null then
    if v_folder.user_id is distinct from v_actor then
      raise exception 'only the project owner can delete it' using errcode = '42501';
    end if;
  elsif v_folder.user_id is distinct from v_actor
        and coalesce(private.project_role(v_folder.project_id, v_actor), '') not in ('owner', 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  with recursive folder_tree as (
    select f.id, array[f.id] as path
    from public.folders f
    where f.id = p_folder_id
    union all
    select child.id, ft.path || child.id
    from public.folders child
    join folder_tree ft on child.parent_id = ft.id
    where child.deleted_at is null
      and not (child.id = any(ft.path))
  )
  select coalesce(array_agg(id), '{}') into v_folder_ids from folder_tree;

  if array_length(v_folder_ids, 1) is not null then
    update public.folders set deleted_at = now() where id = any(v_folder_ids);
    update public.items set deleted_at = now()
    where folder_id = any(v_folder_ids) and deleted_at is null;
  end if;
end;
$$;

create or replace function public.soft_delete_folder(p_folder_id uuid)
returns void
language sql
set search_path = ''
as $$
  select public.soft_delete_folder(p_folder_id, null::uuid);
$$;

-- ---------------------------------------------------------------------------------------------
-- 9. Sharing.
-- ---------------------------------------------------------------------------------------------

create or replace function private.person(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', u.id,
    'email', u.email,
    'name', coalesce(
      nullif(u.raw_user_meta_data ->> 'full_name', ''),
      nullif(u.raw_user_meta_data ->> 'name', ''),
      split_part(u.email, '@', 1)
    ),
    'avatar_url', nullif(u.raw_user_meta_data ->> 'avatar_url', '')
  )
  from auth.users u
  where u.id = p_user;
$$;

create or replace function private.new_invite_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text;
begin
  loop
    v_bytes := extensions.gen_random_bytes(8);
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.project_invites where code = v_code);
  end loop;
  return v_code;
end;
$$;

create or replace function private.normalize_invite_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

create or replace function private.require_project_owner(p_project_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.folders f
    where f.id = p_project_id and f.parent_id is null and f.deleted_at is null
      and f.user_id = auth.uid()
  ) then
    raise exception 'only the project owner can do that' using errcode = '42501';
  end if;
end;
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- The project's invite code for this role, made the first time it's asked for.
create or replace function public.get_project_invite(p_project_id uuid, p_role text default 'editor')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  perform private.require_project_owner(p_project_id);
  if p_role not in ('editor', 'viewer') then
    raise exception 'invalid role';
  end if;
  select code into v_code from public.project_invites
  where project_id = p_project_id and role = p_role and revoked_at is null;
  if v_code is null then
    v_code := private.new_invite_code();
    insert into public.project_invites (project_id, code, role, created_by)
    values (p_project_id, v_code, p_role, auth.uid());
  end if;
  return v_code;
end;
$$;

-- A new code; the old one stops working.
create or replace function public.reset_project_invite(p_project_id uuid, p_role text default 'editor')
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_project_owner(p_project_id);
  update public.project_invites set revoked_at = now()
  where project_id = p_project_id and role = p_role and revoked_at is null;
  return public.get_project_invite(p_project_id, p_role);
end;
$$;

create or replace function public.revoke_project_invite(p_project_id uuid, p_role text default 'editor')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_project_owner(p_project_id);
  update public.project_invites set revoked_at = now()
  where project_id = p_project_id and role = p_role and revoked_at is null;
end;
$$;

-- What a code leads to, before joining. Null when the code doesn't work.
create or replace function public.preview_project_invite(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_invite record;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select pi.project_id, pi.role, f.name, f.user_id as owner_id into v_invite
  from public.project_invites pi
  join public.folders f on f.id = pi.project_id and f.parent_id is null and f.deleted_at is null
  where pi.code = private.normalize_invite_code(p_code) and pi.revoked_at is null;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'project_id', v_invite.project_id,
    'project_name', v_invite.name,
    'role', v_invite.role,
    'owner', private.person(v_invite.owner_id),
    'member_count', (select count(*) from public.project_members m where m.project_id = v_invite.project_id) + 1,
    'your_role', private.project_role(v_invite.project_id, v_uid)
  );
end;
$$;

-- Joins the project. Already in it: keeps your current role. Returns the project id.
create or replace function public.accept_project_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_invite record;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select pi.project_id, pi.role, pi.created_by, f.user_id as owner_id into v_invite
  from public.project_invites pi
  join public.folders f on f.id = pi.project_id and f.parent_id is null and f.deleted_at is null
  where pi.code = private.normalize_invite_code(p_code) and pi.revoked_at is null;
  if not found then
    raise exception 'This invite code doesn''t work. Ask for a new one.' using errcode = 'P0002';
  end if;
  if v_invite.owner_id <> v_uid then
    insert into public.project_members (project_id, user_id, role, added_by)
    values (v_invite.project_id, v_uid, v_invite.role, v_invite.created_by)
    on conflict (project_id, user_id) do nothing;
  end if;
  return v_invite.project_id;
end;
$$;

-- Who is in a project, and (for its owner) the invite codes.
create or replace function public.get_project_sharing(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_project record;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  v_role := private.project_role(p_project_id, v_uid);
  if v_role is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  select f.id, f.name, f.user_id into v_project
  from public.folders f where f.id = p_project_id and f.parent_id is null;
  return jsonb_build_object(
    'project_id', v_project.id,
    'project_name', v_project.name,
    'your_role', v_role,
    'owner', private.person(v_project.user_id),
    'members', coalesce((
      select jsonb_agg(private.person(m.user_id) || jsonb_build_object('role', m.role, 'joined_at', m.created_at)
                       order by m.created_at)
      from public.project_members m
      where m.project_id = p_project_id
    ), '[]'::jsonb),
    'invites', case when v_role = 'owner' then coalesce((
      select jsonb_agg(jsonb_build_object('role', pi.role, 'code', pi.code) order by pi.role)
      from public.project_invites pi
      where pi.project_id = p_project_id and pi.revoked_at is null
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

create or replace function public.set_project_member_role(p_project_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_project_owner(p_project_id);
  if p_role not in ('editor', 'viewer') then
    raise exception 'invalid role';
  end if;
  update public.project_members set role = p_role
  where project_id = p_project_id and user_id = p_user_id;
end;
$$;

-- The owner removes someone, or a member leaves.
create or replace function public.remove_project_member(p_project_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_user_id <> auth.uid() then
    perform private.require_project_owner(p_project_id);
  end if;
  delete from public.project_members where project_id = p_project_id and user_id = p_user_id;
end;
$$;

-- Every project you can see that involves someone else: projects shared with you, and your own
-- projects that have members. Apps mark these as shared.
create or replace function public.project_access(p_user_id uuid default null)
returns table (
  project_id uuid,
  your_role text,
  owner_id uuid,
  owner_name text,
  owner_email text,
  member_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.actor(p_user_id);
begin
  return query
  with mine as (
    select m.project_id, m.role from public.project_members m where m.user_id = v_actor
    union
    select f.id, 'owner' from public.folders f
    where f.user_id = v_actor and f.parent_id is null and f.deleted_at is null
      and exists (select 1 from public.project_members m where m.project_id = f.id)
  )
  select mine.project_id,
         mine.role,
         f.user_id,
         (private.person(f.user_id) ->> 'name'),
         (private.person(f.user_id) ->> 'email'),
         ((select count(*) from public.project_members m where m.project_id = mine.project_id) + 1)::integer
  from mine
  join public.folders f on f.id = mine.project_id and f.parent_id is null and f.deleted_at is null;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 10. Live sync reaches everyone in a project.
-- ---------------------------------------------------------------------------------------------

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
  begin
    device := left(
      nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-sourcefold-device',
      64
    );
  exception when others then
    device := null;
  end;

  for account in
    with changed as (
      select to_jsonb(r) as j from changed_rows r
    ),
    keyed as (
      select
        c.j,
        c.j ->> 'user_id' as owner,
        coalesce(
          (c.j ->> 'project_id')::uuid,
          (select i.project_id from public.items i where i.id = (c.j ->> 'item_id')::uuid),
          (select f.project_id from public.folders f where f.id = (c.j ->> 'folder_id')::uuid)
        ) as project
      from changed c
    ),
    recipients as (
      select k.owner as user_id, k.j from keyed k where k.owner is not null
      union all
      select m.user_id::text, k.j
      from keyed k join public.project_members m on m.project_id = k.project
      where m.user_id::text is distinct from k.owner
      union all
      select f.user_id::text, k.j
      from keyed k join public.folders f on f.id = k.project and f.parent_id is null
      where f.user_id::text is distinct from k.owner
    )
    select
      r.user_id,
      count(*) as n,
      (array_agg(coalesce(r.j ->> 'item_id', r.j ->> 'id', r.j ->> 'project_id')))[1:25] as ids
    from recipients r
    group by r.user_id
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
  raise warning 'notify_sync on %: %', tg_table_name, sqlerrm;
  return null;
end;
$$;

revoke all on function public.notify_sync() from public, anon, authenticated;

drop trigger if exists sync_insert on public.project_members;
drop trigger if exists sync_update on public.project_members;
drop trigger if exists sync_delete on public.project_members;
create trigger sync_insert after insert on public.project_members
  referencing new table as changed_rows
  for each statement execute function public.notify_sync();
create trigger sync_update after update on public.project_members
  referencing new table as changed_rows
  for each statement execute function public.notify_sync();
create trigger sync_delete after delete on public.project_members
  referencing old table as changed_rows
  for each statement execute function public.notify_sync();

-- ---------------------------------------------------------------------------------------------
-- 11. Who may call what.
-- ---------------------------------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.content_access(uuid)',
    'public.content_waiting_items(integer, uuid)',
    'public.content_drive_only_items(integer, uuid)',
    'public.mark_item_content_stored(uuid, timestamptz, text, bigint, uuid)',
    'public.mark_item_saved_to_drive(uuid, text, timestamptz, boolean)',
    'public.mark_item_stored_in_drive(uuid, text, timestamptz)',
    'public.set_drive_backup(boolean)',
    'public.drive_dirty_folders(uuid)',
    'public.drive_dirty_folders()',
    'public.drive_dirty_items(integer, uuid)',
    'public.drive_dirty_items(integer)',
    'public.drive_unsaved_count(uuid)',
    'public.drive_unsaved_count()',
    'public.folder_item_counts(uuid)',
    'public.soft_delete_folder(uuid, uuid)',
    'public.soft_delete_folder(uuid)',
    'public.get_project_invite(uuid, text)',
    'public.reset_project_invite(uuid, text)',
    'public.revoke_project_invite(uuid, text)',
    'public.preview_project_invite(text)',
    'public.accept_project_invite(text)',
    'public.get_project_sharing(uuid)',
    'public.set_project_member_role(uuid, uuid, text)',
    'public.remove_project_member(uuid, uuid)',
    'public.project_access(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$$;
