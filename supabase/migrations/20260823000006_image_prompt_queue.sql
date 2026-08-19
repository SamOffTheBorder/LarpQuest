-- Phase 8: image_prompt_queue — post-publish, never-blocking image prompt
-- generation, same shape and same reason as extraction_queue/memory_queue.
--
-- `publish_chapter` is extended to also enqueue this job at publish time,
-- exactly as it already does for extraction_queue/memory_queue. Publication
-- itself is unchanged: the insert happens after the chapter row is written
-- and committed as part of the same transaction, so a queue-insert failure
-- would roll back publication — but enqueuing is a plain insert with no
-- external call, so there is nothing here that can meaningfully fail short of
-- the database itself being down, in which case publication was already
-- failing.

create table image_prompt_queue (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  story_id uuid not null references stories(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'claimed', 'complete', 'failed')),
  attempt_count int not null default 0,
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chapter_id)
);

create index image_prompt_queue_claimable_idx on image_prompt_queue (status, claimed_at)
  where status in ('queued', 'claimed');

alter table image_prompt_queue enable row level security;

create policy image_prompt_queue_select on image_prompt_queue
  for select using (is_story_member(story_id));

create trigger image_prompt_queue_touch_updated_at
  before update on image_prompt_queue
  for each row execute function touch_updated_at();

create function claim_image_prompt_job(stale_after interval default '5 minutes')
returns image_prompt_queue
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  update image_prompt_queue
  set status = 'claimed',
      claimed_at = now(),
      attempt_count = attempt_count + 1
  where id = (
    select id
    from image_prompt_queue
    where status = 'queued'
       or (status = 'claimed' and claimed_at < now() - stale_after)
    order by created_at
    for update skip locked
    limit 1
  )
  returning *;
$$;

revoke execute on function claim_image_prompt_job(interval) from public, anon, authenticated;

drop function if exists publish_chapter(uuid, text, uuid[], jsonb);

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

  insert into image_prompt_queue (chapter_id, story_id)
  values (published.id, turn_row.story_id)
  on conflict (chapter_id) do nothing;

  return published;
end;
$$;

revoke execute on function publish_chapter(uuid, text, uuid[], jsonb) from public, anon, authenticated;
