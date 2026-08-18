-- Phase 4: enqueue a memory job alongside extraction on chapter publish.
--
-- Same transaction as the extraction enqueue, same guarantee: memory
-- generation is only ever ENQUEUED here, never run, so publication cannot
-- block, delay, or be reversed by it (build plan Part 11.8).

create or replace function publish_chapter(
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

  insert into memory_queue (chapter_id, story_id)
  values (published.id, turn_row.story_id)
  on conflict (chapter_id) do nothing;

  return published;
end;
$$;

revoke execute on function publish_chapter(uuid, text, uuid[]) from public, anon, authenticated;
