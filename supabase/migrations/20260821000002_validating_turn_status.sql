-- Phase 6: widen turns.status to add 'validating', inserted between
-- 'generating' and 'published' in the state machine (see
-- apps/web/src/lib/engine/turn-state.ts). Existing rows are unaffected since
-- none can hold the new value yet.

alter table turns
  drop constraint turns_status_check;

alter table turns
  add constraint turns_status_check
    check (status in ('open', 'locked', 'generating', 'validating', 'published', 'failed'));
