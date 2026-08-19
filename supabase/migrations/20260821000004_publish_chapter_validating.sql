-- Phase 6: publish_chapter now runs from 'validating', not 'generating', and
-- accepts the validation report to write onto the new chapter row.
--
-- The turn loop now inserts a validating step between a finished draft and
-- publication (turn-loop capability, "Draft enters validation before
-- publication"). publish_chapter is only ever called once validation has
-- decided to publish (no block-severity flags remaining), so its guard moves
-- to match the state the turn is actually in at that point.
--
-- `create or replace` cannot change a function's parameter list — same
-- caveat 20260819000005 and 20260821000003 already ran into. Drop the old
-- 3-arg signature explicitly first.

drop function if exists publish_chapter(uuid, text, uuid[]);

create function publish_chapter(
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

  insert into chapters (story_id, turn_id, turn_number, turn_mode, prose, entity_ids, validation_report)
  values (
    turn_row.story_id,
    turn_row.id,
    turn_row.turn_number,
    turn_row.mode,
    p_prose,
    p_entity_ids,
    p_validation_report
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

revoke execute on function publish_chapter(uuid, text, uuid[], jsonb) from public, anon, authenticated;
