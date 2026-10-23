-- Who may sign up, enforced by Supabase Auth itself, so the desktop app and the extension (which
-- sign in with Supabase directly, without the website) follow the same rule as the website's
-- ALLOWED_EMAIL. Contract: docs/dev/handoff-no-website.md.
--
-- Rows are lower-case email addresses, or '*' for anyone. Keep this list the same as the
-- website's ALLOWED_EMAIL and the google-access-token Edge Function's ALLOWED_EMAIL secret.
-- The hook only runs once it's turned on: Dashboard > Authentication > Hooks >
-- "Before user created" > Postgres function public.hook_before_user_created.

create table if not exists public.signup_allow_list (
  email text primary key check (email = lower(btrim(email)) and email <> '')
);

-- Readable only by Supabase Auth; no policies, so signed-in users and anon see nothing.
alter table public.signup_allow_list enable row level security;
revoke all on table public.signup_allow_list from public, anon, authenticated;

-- Anyone may sign up until the list says otherwise (the owner's deployment uses '*').
insert into public.signup_allow_list (email)
select '*'
where not exists (select 1 from public.signup_allow_list);

create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(event -> 'user' ->> 'email', '')));
begin
  if exists (
    select 1 from public.signup_allow_list l where l.email = '*' or (v_email <> '' and l.email = v_email)
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object('http_code', 403, 'message', 'This account can''t use Sourcefold.')
  );
end;
$$;

revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
grant select on table public.signup_allow_list to supabase_auth_admin;

create policy signup_allow_list_auth_admin_read on public.signup_allow_list
  as permissive for select to supabase_auth_admin using (true);
