-- Archived projects are hidden from the project switcher, pickers, the extension and
-- search across projects. Nothing is deleted; unarchiving brings the project back as it was.
alter table public.folders
  add column if not exists archived_at timestamptz;

-- Archives or unarchives a project (top-level folder). Archiving changes nothing in Drive,
-- so a project that was saved stays saved instead of showing up as an unsaved change.
create or replace function public.set_project_archived(p_id uuid, p_archived boolean)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.folders
  set archived_at = case when p_archived then now() else null end,
      drive_synced_at = case
        when drive_synced_at is not null and drive_synced_at >= updated_at then now()
        else drive_synced_at
      end
  where id = p_id
    and user_id = (select auth.uid())
    and parent_id is null
    and deleted_at is null;

  return found;
end;
$$;

revoke all on function public.set_project_archived(uuid, boolean) from public, anon;
grant execute on function public.set_project_archived(uuid, boolean) to authenticated;
