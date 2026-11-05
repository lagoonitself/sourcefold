-- Checks for 20261107000000_r2_content_and_teams.sql. Run after the migration inside a transaction
-- that is thrown away: the block always ends by raising, so nothing is kept. A passing run raises
-- "ALL PASSED" followed by the checks; a failing one raises "FAILED: <check>".
do $test$
declare
  a uuid := gen_random_uuid();  -- owner
  b uuid := gen_random_uuid();  -- editor
  v uuid := gen_random_uuid();  -- viewer
  c uuid := gen_random_uuid();  -- stranger
  p uuid; g1 uuid; g2 uuid; p2 uuid; q uuid; i1 uuid; i2 uuid; h1 uuid;
  code_e text; code_v text;
  n integer; t text; seen timestamptz; before timestamptz;
  log text := '';

begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values
    (a, 'owner@test.local', '{"full_name":"Owner A"}', 'authenticated', 'authenticated'),
    (b, 'editor@test.local', '{"full_name":"Editor B"}', 'authenticated', 'authenticated'),
    (v, 'viewer@test.local', '{}', 'authenticated', 'authenticated'),
    (c, 'stranger@test.local', '{}', 'authenticated', 'authenticated');

  -- ---- as A (owner)
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  insert into public.folders (name, user_id) values ('Proj', a) returning id into p;
  insert into public.folders (name, parent_id, user_id) values ('G1', p, a) returning id into g1;
  insert into public.items (folder_id, kind, title, status, markdown, user_id)
    values (g1, 'web', 'One', 'saved', 'hello body', a) returning id into i1;
  insert into public.highlights (item_id, kind, quote, prefix, suffix, start_offset, end_offset, user_id) values (i1, 'text', 'hello', '', '', 0, 1, a) returning id into h1;
  select count(*) into n from public.items where id = i1 and project_id = p and user_id = a;
  if n <> 1 then raise exception 'FAILED: owner item has project and owner'; end if;
  log := log || E'\nok owner saves';

  code_e := public.get_project_invite(p, 'editor');
  code_v := public.get_project_invite(p, 'viewer');
  if code_e !~ '^[A-Z2-9]{8}$' or code_e = code_v then raise exception 'FAILED: invite codes %', code_e; end if;
  if public.get_project_invite(p, 'editor') <> code_e then raise exception 'FAILED: code is stable'; end if;
  log := log || E'\nok invite codes';

  -- ---- as B before joining
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.items where id = i1;
  if n <> 0 then raise exception 'FAILED: stranger sees item'; end if;
  begin
    insert into public.folders (name, parent_id, user_id) values ('Sneak', p, b);
    raise exception 'FAILED: stranger added a group';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
  end;
  begin
    insert into public.items (folder_id, kind, title, status, markdown, user_id)
      values (g1, 'web', 'Sneak', 'saved', 'x', b);
    raise exception 'FAILED: stranger added a source';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
  end;
  if public.content_access(i1) is not null then raise exception 'FAILED: stranger content access'; end if;
  begin
    perform public.get_project_sharing(p);
    raise exception 'FAILED: stranger read sharing';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
  end;
  log := log || E'\nok stranger shut out';

  -- join with a messy code
  t := lower(substr(code_e, 1, 4)) || '- ' || lower(substr(code_e, 5));
  if (public.preview_project_invite(t) ->> 'project_name') <> 'Proj' then raise exception 'FAILED: preview'; end if;
  if public.preview_project_invite('ZZZZZZZZ') is not null then raise exception 'FAILED: bad code preview'; end if;
  if public.accept_project_invite(t) <> p then raise exception 'FAILED: accept'; end if;
  perform public.accept_project_invite(t);  -- twice is fine
  select count(*) into n from public.items where id = i1;
  if n <> 1 then raise exception 'FAILED: member sees item'; end if;
  select count(*) into n from public.highlights where id = h1;
  if n <> 1 then raise exception 'FAILED: member sees highlight'; end if;

  insert into public.folders (name, parent_id, user_id) values ('G2', p, b) returning id into g2;
  select count(*) into n from public.folders where id = g2 and user_id = a and project_id = p;
  if n <> 1 then raise exception 'FAILED: member group owned by project owner'; end if;
  insert into public.items (folder_id, kind, title, status, markdown, user_id)
    values (g2, 'web', 'Two', 'saved', 'second body', b) returning id into i2;
  select count(*) into n from public.items where id = i2 and user_id = a and created_by = b;
  if n <> 1 then raise exception 'FAILED: member item owned by owner, made by member'; end if;
  insert into public.highlights (item_id, kind, quote, prefix, suffix, start_offset, end_offset, user_id) values (i1, 'text', 'he', '', '', 0, 1, b);
  update public.items set title = 'One edited' where id = i1;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAILED: editor edits'; end if;
  if not (public.content_access(i1) ->> 'can_edit')::boolean then raise exception 'FAILED: editor can_edit'; end if;
  select count(*) into n from public.content_waiting_items(50) where id in (i1, i2);
  if n <> 2 then raise exception 'FAILED: editor waiting items %', n; end if;
  begin
    update public.folders set name = 'Renamed' where id = p;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAILED: editor renamed project'; end if;
  end;
  begin
    perform public.soft_delete_folder(p, null);
    raise exception 'FAILED: editor deleted project';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
  end;
  begin
    perform public.get_project_invite(p, 'editor');
    raise exception 'FAILED: editor made invite';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
  end;
  if (public.get_project_sharing(p) ->> 'your_role') <> 'editor'
     or jsonb_array_length(public.get_project_sharing(p) -> 'invites') <> 0 then
    raise exception 'FAILED: editor sharing view';
  end if;

  -- R2: no Drive backup for A (no Google token), so the text is cleared at once.
  select updated_at into seen from public.items where id = i1;
  if not public.mark_item_content_stored(i1, seen, repeat('a', 64), 10) then
    raise exception 'FAILED: content mark clears';
  end if;
  select count(*) into n from public.items where id = i1 and markdown is null and content_at = seen and updated_at = seen;
  if n <> 1 then raise exception 'FAILED: content mark state'; end if;
  select count(*) into n from public.content_waiting_items(50) where id = i1;
  if n <> 0 then raise exception 'FAILED: still waiting after mark'; end if;
  -- a stale mark doesn't clear
  -- now() is fixed inside one transaction, so a stale read is an older timestamp.
  select updated_at - interval '1 second' into seen from public.items where id = i2;
  update public.items set markdown = 'second body v2' where id = i2;
  if public.mark_item_content_stored(i2, seen, repeat('b', 64), 10) then
    raise exception 'FAILED: stale mark cleared';
  end if;
  select count(*) into n from public.items where id = i2 and markdown = 'second body v2';
  if n <> 1 then raise exception 'FAILED: stale mark kept text'; end if;
  begin
    perform public.mark_item_content_stored(i2, seen, repeat('b', 64), 10, a);
    raise exception 'FAILED: member named another user';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
  end;
  log := log || E'\nok editor works, content marks';

  -- B makes their own project; nothing crosses owners
  insert into public.folders (name, user_id) values ('Mine', b) returning id into q;
  begin
    update public.folders set parent_id = q where id = g2;
    raise exception 'FAILED: group moved across owners';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
  end;

  -- ---- as V (viewer)
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.accept_project_invite(code_v);
  select count(*) into n from public.items where project_id = p;
  if n <> 2 then raise exception 'FAILED: viewer sees % items', n; end if;
  update public.items set title = 'nope' where id = i1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAILED: viewer edited'; end if;
  begin
    insert into public.highlights (item_id, kind, quote, prefix, suffix, start_offset, end_offset, user_id) values (i1, 'text', 'x', '', '', 0, 1, v);
    raise exception 'FAILED: viewer highlighted';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
  end;
  begin
    insert into public.folders (name, parent_id, user_id) values ('V', g1, v);
    raise exception 'FAILED: viewer added group';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
  end;
  if (public.content_access(i1) ->> 'can_edit')::boolean then raise exception 'FAILED: viewer can_edit'; end if;
  select count(*) into n from public.content_waiting_items(50);
  if n <> 0 then raise exception 'FAILED: viewer waiting items'; end if;
  select sum(item_count) into n from public.folder_item_counts(v);
  if n <> 2 then raise exception 'FAILED: viewer counts %', n; end if;
  select count(*) into n from public.project_access() where project_id = p and your_role = 'viewer' and owner_email = 'owner@test.local' and member_count = 3;
  if n <> 1 then raise exception 'FAILED: viewer project_access'; end if;
  log := log || E'\nok viewer reads only';

  -- ---- as C (stranger) after all that
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.items;
  if n <> 0 then raise exception 'FAILED: stranger sees items'; end if;
  select count(*) into n from public.project_members;
  if n <> 0 then raise exception 'FAILED: stranger sees members'; end if;
  select count(*) into n from public.content_waiting_items(50);
  if n <> 0 then raise exception 'FAILED: stranger waiting'; end if;
  begin
    perform public.remove_project_member(p, b);
    raise exception 'FAILED: stranger removed member';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
  end;

  -- ---- back as A
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.highlights where item_id = i1 and user_id = a;
  if n <> 2 then raise exception 'FAILED: member highlight owned by owner'; end if;
  if jsonb_array_length(public.get_project_sharing(p) -> 'members') <> 2
     or jsonb_array_length(public.get_project_sharing(p) -> 'invites') <> 2 then
    raise exception 'FAILED: owner sharing view';
  end if;
  -- moving a group to another of A's projects carries its sources, without touching updated_at
  insert into public.folders (name, user_id) values ('Proj2', a) returning id into p2;
  select updated_at into before from public.items where id = i1;
  update public.folders set parent_id = p2 where id = g1;
  select count(*) into n from public.items where id = i1 and project_id = p2 and updated_at = before;
  if n <> 1 then raise exception 'FAILED: cascade project'; end if;
  update public.folders set parent_id = p where id = g1;
  -- the old Drive mark never clears text now; the new one clears only with R2 current
  select updated_at into seen from public.items where id = i2;
  if public.mark_item_stored_in_drive(i2, 'drive-file', seen) then
    raise exception 'FAILED: old Drive mark cleared';
  end if;
  select count(*) into n from public.items where id = i2 and markdown is not null and drive_synced_at is not null and updated_at = seen;
  if n <> 1 then raise exception 'FAILED: Drive mark state'; end if;
  if not public.mark_item_saved_to_drive(i2, 'drive-file', seen, false) then
    raise exception 'FAILED: Drive mark without R2 clears';
  end if;
  -- set_drive_backup
  perform public.set_drive_backup(false);
  select count(*) into n from public.drive_state where user_id = a and backup_enabled = false;
  if n <> 1 then raise exception 'FAILED: backup off'; end if;
  -- owner removes B; B loses access
  perform public.remove_project_member(p, b);
  perform public.reset_project_invite(p, 'editor');

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.items where project_id = p;
  if n <> 0 then raise exception 'FAILED: removed member still sees'; end if;
  begin
    perform public.accept_project_invite(code_e);
    raise exception 'FAILED: old code still works';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
  end;
  -- V leaves by themselves
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.remove_project_member(p, v);
  select count(*) into n from public.items where project_id = p;
  if n <> 0 then raise exception 'FAILED: leaver still sees'; end if;
  log := log || E'\nok owner manages, removal and leaving';

  -- ---- server admin client (no auth.uid()) acting for a named user
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  begin
    insert into public.items (folder_id, kind, title, status, markdown, user_id)
      values (g1, 'web', 'Admin sneak', 'saved', 'x', c);
    raise exception 'FAILED: admin insert for stranger';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
  end;
  insert into public.items (folder_id, kind, title, status, markdown, user_id)
    values (g1, 'web', 'Admin ok', 'saved', 'x', a);
  select count(*) into n from public.content_waiting_items(50, c);
  if n <> 0 then raise exception 'FAILED: admin waiting for stranger'; end if;
  select count(*) into n from public.content_waiting_items(50, a) where project_id = p;
  if n < 1 then raise exception 'FAILED: admin waiting for owner'; end if;

  raise exception 'ALL PASSED%', log;
end;
$test$;
