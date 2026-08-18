-- Phase 1: atomic turn and entity operations.
--
-- These exist as database functions rather than client-side sequences because
-- each enforces an invariant that a multi-statement client cannot hold:
--
--   * entity data and entity_history must move together or not at all, so state
--     and history can never diverge (entity-state spec, "History write fails")
--   * a story must never have two live turns, which requires the read of
--     existing turns and the insert of the new one to be one atomic step
--     (turn-loop spec, "Second concurrent turn prevented")
--
-- All are security definer with a pinned search_path, and all revoke execute
-- from anon/authenticated: they are called from server-side code through the
-- service role, which does its own membership check first. Exposing them over
-- PostgREST would let a caller pass an arbitrary acting user id.

-- Update an entity's data and record the change in one transaction.
-- A null p_chapter_id means a manual edit; p_applied_by is the acting user.
create function apply_entity_update(
  p_entity_id uuid,
  p_data jsonb,
  p_diff jsonb,
  p_applied_by uuid default null,
  p_chapter_id uuid default null,
  p_is_reversal boolean default false
)
returns entities
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  updated entities;
begin
  update entities
  set data = p_data
  where id = p_entity_id
  returning * into updated;

  if not found then
    raise exception 'entity % not found', p_entity_id
      using errcode = 'no_data_found';
  end if;

  insert into entity_history (entity_id, story_id, diff, applied_by, chapter_id, is_reversal)
  values (p_entity_id, updated.story_id, p_diff, p_applied_by, p_chapter_id, p_is_reversal);

  return updated;
end;
$$;

revoke execute on function apply_entity_update(uuid, jsonb, jsonb, uuid, uuid, boolean)
  from public, anon, authenticated;

-- Create an entity and seed its history with the creating diff.
create function create_entity_with_history(
  p_story_id uuid,
  p_type text,
  p_name text,
  p_data jsonb,
  p_created_by uuid,
  p_controlled_by uuid default null
)
returns entities
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  created entities;
begin
  insert into entities (story_id, type, name, data, controlled_by)
  values (p_story_id, p_type, p_name, p_data, p_controlled_by)
  returning * into created;

  insert into entity_history (entity_id, story_id, diff, applied_by)
  values (
    created.id,
    p_story_id,
    jsonb_build_object(
      'kind', 'create',
      'entity_id', created.id,
      'to', p_data,
      'evidence', 'Entity created'
    ),
    p_created_by
  );

  return created;
end;
$$;

revoke execute on function create_entity_with_history(uuid, text, text, jsonb, uuid, uuid)
  from public, anon, authenticated;

-- Open a turn, rejecting a second live turn in the same story.
-- The advisory lock serializes concurrent opens for one story so two callers
-- cannot both observe "no live turn" and both insert.
create function open_turn(
  p_story_id uuid,
  p_mode text default 'freeform',
  p_scene_setup text default null
)
returns turns
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  opened turns;
  next_number int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_story_id::text, 0));

  if exists (
    select 1 from turns
    where story_id = p_story_id
      and status <> 'published'
  ) then
    raise exception 'story % already has a live turn', p_story_id
      using errcode = 'unique_violation';
  end if;

  select coalesce(max(turn_number), 0) + 1
  into next_number
  from turns
  where story_id = p_story_id;

  insert into turns (story_id, turn_number, mode, scene_setup, status)
  values (p_story_id, next_number, p_mode, p_scene_setup, 'open')
  returning * into opened;

  return opened;
end;
$$;

revoke execute on function open_turn(uuid, text, text) from public, anon, authenticated;

-- Publish a generated chapter: write the chapter, advance the turn to
-- published, bump the story's current_turn, and enqueue extraction — all in one
-- transaction. Extraction is only ENQUEUED here, never run: publication must
-- not be able to block on it.
create function publish_chapter(
  p_turn_id uuid,
  p_prose text,
  p_entity_ids uuid[] default '{}'
)
returns chapters
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  turn_row turns;
  published chapters;
begin
  select * into turn_row from turns where id = p_turn_id for update;

  if not found then
    raise exception 'turn % not found', p_turn_id
      using errcode = 'no_data_found';
  end if;

  if turn_row.status <> 'generating' then
    raise exception 'turn % is %, expected generating', p_turn_id, turn_row.status
      using errcode = 'check_violation';
  end if;

  insert into chapters (story_id, turn_id, turn_number, turn_mode, prose, entity_ids)
  values (
    turn_row.story_id,
    turn_row.id,
    turn_row.turn_number,
    turn_row.mode,
    p_prose,
    p_entity_ids
  )
  returning * into published;

  update turns set status = 'published', failure_reason = null where id = p_turn_id;

  update stories
  set current_turn = greatest(current_turn, turn_row.turn_number)
  where id = turn_row.story_id;

  insert into extraction_queue (chapter_id, story_id)
  values (published.id, turn_row.story_id)
  on conflict (chapter_id) do nothing;

  return published;
end;
$$;

revoke execute on function publish_chapter(uuid, text, uuid[]) from public, anon, authenticated;
