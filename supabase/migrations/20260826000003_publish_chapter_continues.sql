-- fight-chapter-split: publish_chapter copies the turn's continues_chapter_id
-- onto the chapter it creates.
--
-- No new parameter needed: continueFight (turns.ts) sets turns.continues_chapter_id
-- at turn-creation time, before generation ever starts, so by the time
-- publish_chapter runs the value is already sitting on turn_row. Same
-- create-or-replace-cannot-change-signature caveat as prior publish_chapter
-- migrations — but this one only changes the function body, so no drop is
-- needed.

create or replace function publish_chapter(
  p_turn_id uuid,
  p_prose text,
  p_entity_ids uuid[] default '{}',
  p_validation_report jsonb default '[]'::jsonb
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

  if turn_row.status <> 'validating' then
    raise exception 'turn % is %, expected validating', p_turn_id, turn_row.status
      using errcode = 'check_violation';
  end if;

  insert into chapters (
    story_id, turn_id, turn_number, turn_mode, prose, entity_ids,
    validation_report, continues_chapter_id
  )
  values (
    turn_row.story_id,
    turn_row.id,
    turn_row.turn_number,
    turn_row.mode,
    p_prose,
    p_entity_ids,
    p_validation_report,
    turn_row.continues_chapter_id
  )
  returning * into published;

  update turns set status = 'published', failure_reason = null where id = p_turn_id;

  update stories
  set current_turn = greatest(current_turn, turn_row.turn_number)
  where id = turn_row.story_id;

  insert into extraction_queue (chapter_id, story_id)
  values (published.id, turn_row.story_id)
  on conflict (chapter_id) do nothing;

  insert into memory_queue (chapter_id, story_id)
  values (published.id, turn_row.story_id)
  on conflict (chapter_id) do nothing;

  return published;
end;
$$;
