-- fight-chapter-split fix: continue_fight_turn creates the new turn as
-- 'locked', not 'generating'.
--
-- generateTurn() (turns.ts) is the only path that actually starts
-- generation, and its state-machine guard only accepts a turn currently
-- 'locked' or 'failed' (turn-state.ts: locked -> generating, failed ->
-- generating). A turn inserted directly as 'generating' would be rejected by
-- that guard the moment continueFight tried to hand it off. 'locked' is also
-- the semantically correct state here: submissions are already frozen (they
-- were copied forward already-locked from the originating turn), same as any
-- normal turn immediately after lockTurn runs.

create or replace function continue_fight_turn(
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
  values (p_story_id, next_number, origin_chapter.turn_mode, 'locked', p_chapter_id)
  returning * into created;

  insert into submissions (turn_id, story_id, entity_id, user_id, content, proposals)
  select created.id, story_id, entity_id, user_id, content, proposals
  from submissions
  where turn_id = origin_chapter.turn_id;

  return created;
end;
$$;
