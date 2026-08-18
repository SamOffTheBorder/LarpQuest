-- Phase 1: chapter rollback (task 5.6 / entity-state spec, "Rollback via history").
--
-- Unpublishing a chapter keeps it visible — the prose is the narrative record
-- and stays readable — but reverses the entity effects it caused. Reversal
-- writes new compensating entity_history rows rather than deleting or
-- rewriting the originals (CLAUDE.md rule 3: history is append-only).
--
-- A field a later chapter or manual edit has since touched is left alone and
-- reported as a conflict rather than silently overwritten with the
-- pre-chapter value — that would destroy real, newer information.

alter table chapters
  add column rolled_back_at timestamptz;

-- No new RLS policy needed: rollback only ever happens through this
-- security-definer function (EXECUTE is revoked below from every role except
-- the service role), so it is not reachable through the existing
-- chapters_update policy at all. Ownership is checked in application code
-- before this function is called, mirroring chapters_delete's owner-only intent.

-- Reverse every entity_history row this chapter caused, in reverse
-- chronological order, skipping (and reporting) any field a later change has
-- since touched. Returns one row per history row considered, so the caller
-- can tell the user exactly what was reversed and what was left as a
-- conflict.
create function rollback_chapter(p_chapter_id uuid, p_user_id uuid)
returns table (
  entity_history_id uuid,
  entity_id uuid,
  field text,
  outcome text -- 'reversed' | 'conflict'
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  chapter_row chapters;
  history_row entity_history;
  current_value jsonb;
  claimed_from jsonb;
  restore_to jsonb;
begin
  select * into chapter_row from chapters where id = p_chapter_id for update;

  if not found then
    raise exception 'chapter % not found', p_chapter_id
      using errcode = 'no_data_found';
  end if;

  if chapter_row.rolled_back_at is not null then
    raise exception 'chapter % was already rolled back', p_chapter_id
      using errcode = 'check_violation';
  end if;

  for history_row in
    select * from entity_history
    where chapter_id = p_chapter_id
      and is_reversal = false
    order by created_at desc
  loop
    -- diff column shape matches Diff in diff.ts: {entity_id, field, from, to, evidence}.
    claimed_from := history_row.diff -> 'to'; -- the value THIS diff produced
    restore_to := history_row.diff -> 'from'; -- the value to restore

    select data -> (history_row.diff ->> 'field')
    into current_value
    from entities
    where id = history_row.entity_id
    for update;

    if not found then
      entity_id := history_row.entity_id;
      field := history_row.diff ->> 'field';
      outcome := 'conflict';
      entity_history_id := history_row.id;
      return next;
      continue;
    end if;

    -- A later change moved this field away from what this chapter set it to.
    -- Restoring the pre-chapter value would clobber that newer information.
    if current_value is distinct from claimed_from then
      entity_id := history_row.entity_id;
      field := history_row.diff ->> 'field';
      outcome := 'conflict';
      entity_history_id := history_row.id;
      return next;
      continue;
    end if;

    update entities
    set data = jsonb_set(data, array[history_row.diff ->> 'field'], coalesce(restore_to, 'null'::jsonb), true)
    where id = history_row.entity_id;

    insert into entity_history (entity_id, story_id, diff, applied_by, chapter_id, is_reversal)
    values (
      history_row.entity_id,
      history_row.story_id,
      jsonb_build_object(
        'entity_id', history_row.entity_id,
        'field', history_row.diff ->> 'field',
        'from', claimed_from,
        'to', restore_to,
        'evidence', 'Reversal of chapter ' || p_chapter_id::text
      ),
      p_user_id,
      p_chapter_id,
      true
    );

    entity_id := history_row.entity_id;
    field := history_row.diff ->> 'field';
    outcome := 'reversed';
    entity_history_id := history_row.id;
    return next;
  end loop;

  update chapters set rolled_back_at = now() where id = p_chapter_id;

  return;
end;
$$;

revoke execute on function rollback_chapter(uuid, uuid) from public, anon, authenticated;
