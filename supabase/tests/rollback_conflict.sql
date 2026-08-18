-- Rollback conflict detection (task 5.6 / entity-state spec, "Entity changed
-- after the chapter being rolled back").
--
-- Exercises rollback_chapter end to end against real tables: a chapter sets a
-- field, a later manual edit changes it again, and rollback must report a
-- conflict for that field rather than clobbering the newer value. A second
-- field untouched since the chapter must still reverse cleanly.
--
-- Everything happens inside a transaction that rolls back at the end, so this
-- is safe to run against a live database and leaves no trace.
--
-- Run with:
--   supabase db query --linked --file supabase/tests/rollback_conflict.sql

begin;

do $$
declare
  test_owner uuid := gen_random_uuid();
  test_story uuid;
  test_entity uuid;
  test_chapter uuid;
  reversed_count int;
  conflict_count int;
  final_location text;
  final_morale text;
begin
  -- stories.owner_id has a real FK into auth.users, so a throwaway row is
  -- needed here too. Rolled back with everything else at the end.
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
  values (test_owner, test_owner::text || '@rollback-test.invalid', '', now(), 'authenticated', 'authenticated');

  -- Minimal fixture: a story, an entity, and a chapter that changed two fields.
  insert into stories (id, owner_id, title, content_rating)
  values (gen_random_uuid(), test_owner, 'Rollback Test Story', 'teen')
  returning id into test_story;

  insert into story_members (story_id, user_id, role)
  values (test_story, test_owner, 'owner');

  insert into entities (id, story_id, type, name, data)
  values (gen_random_uuid(), test_story, 'character', 'Test Character', '{"location": "harbor", "morale": 3}'::jsonb)
  returning id into test_entity;

  insert into chapters (id, story_id, turn_number, turn_mode, prose)
  values (gen_random_uuid(), test_story, 1, 'freeform', 'They traveled.')
  returning id into test_chapter;

  -- The chapter's own diffs: location harbor -> citadel, morale 3 -> 1.
  insert into entity_history (entity_id, story_id, chapter_id, diff, is_reversal)
  values
    (test_entity, test_story, test_chapter,
     jsonb_build_object('entity_id', test_entity, 'field', 'location', 'from', 'harbor', 'to', 'citadel', 'evidence', 'test'),
     false),
    (test_entity, test_story, test_chapter,
     jsonb_build_object('entity_id', test_entity, 'field', 'morale', 'from', 3, 'to', 1, 'evidence', 'test'),
     false);

  update entities
  set data = jsonb_build_object('location', 'citadel', 'morale', 1)
  where id = test_entity;

  -- A manual edit AFTER the chapter changes morale again. location is
  -- untouched since the chapter.
  update entities set data = jsonb_set(data, '{morale}', '5') where id = test_entity;

  -- Roll back the chapter.
  select count(*) filter (where outcome = 'reversed'), count(*) filter (where outcome = 'conflict')
  into reversed_count, conflict_count
  from rollback_chapter(test_chapter, test_owner);

  if reversed_count <> 1 then
    raise exception 'expected exactly 1 reversed field (location), got %', reversed_count;
  end if;

  if conflict_count <> 1 then
    raise exception 'expected exactly 1 conflicted field (morale), got %', conflict_count;
  end if;

  select data ->> 'location', data ->> 'morale' into final_location, final_morale
  from entities where id = test_entity;

  if final_location <> 'harbor' then
    raise exception 'location should have been restored to harbor, got %', final_location;
  end if;

  -- The conflicted field must be untouched: the manual edit's value (5)
  -- survives, not the chapter's original value (3), and not garbage.
  if final_morale <> '5' then
    raise exception 'morale should remain at the manually-edited value 5, got % (rollback clobbered a newer change)', final_morale;
  end if;

  -- rolled_back_at must be set, and a second rollback attempt must be rejected.
  perform 1 from chapters where id = test_chapter and rolled_back_at is not null;
  if not found then
    raise exception 'chapter rolled_back_at was not set';
  end if;

  begin
    perform rollback_chapter(test_chapter, test_owner);
    raise exception 'second rollback of the same chapter should have raised';
  exception
    when others then
      if sqlerrm not like '%already%' then
        raise;
      end if;
  end;

  raise notice 'rollback_conflict.sql: all assertions passed';
end;
$$;

rollback;
