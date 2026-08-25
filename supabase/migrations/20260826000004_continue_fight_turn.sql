-- fight-chapter-split: atomically create a continuation turn.
--
-- Called by continueFight (turns.ts) right after a chapter carrying the
-- turning-point marker publishes. Mirrors open_turn's advisory-lock pattern
-- (same lock key, so the two functions serialize against each other) rather
-- than doing a multi-step insert from application code: the one-live-turn
-- invariant (turns_one_live_per_story) must hold even though this path has
-- no acting user and skips openTurn's role check entirely. The new turn
-- starts life as 'generating', not 'open' — there is no submission window to
-- wait through, since submissions are copied forward from the originating
-- turn in the same transaction.

create function continue_fight_turn(
  p_chapter_id uuid,
  p_story_id uuid
)
returns turns
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  origin_chapter chapters;
  next_number int;
  created turns;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_story_id::text, 0));

  select * into origin_chapter from chapters where id = p_chapter_id and story_id = p_story_id;

  if not found then
    raise exception 'chapter % not found in story %', p_chapter_id, p_story_id
      using errcode = 'no_data_found';
  end if;

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

  insert into turns (story_id, turn_number, mode, status, continues_chapter_id)
  values (p_story_id, next_number, origin_chapter.turn_mode, 'generating', p_chapter_id)
  returning * into created;

  insert into submissions (turn_id, story_id, entity_id, user_id, content, proposals)
  select created.id, story_id, entity_id, user_id, content, proposals
  from submissions
  where turn_id = origin_chapter.turn_id;

  return created;
end;
$$;

revoke execute on function continue_fight_turn(uuid, uuid) from public, anon, authenticated;
