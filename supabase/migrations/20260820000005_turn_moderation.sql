-- Phase 5: moderation pass results, recorded on the turn it ran against.
--
-- Moderation runs once per turn at lock time (build plan 7.5), over the
-- turn's combined submissions — not per-submission — so the result belongs
-- on turns, not submissions.

alter table turns
  add column moderation_status text check (moderation_status in ('pass', 'flag', 'block')),
  add column moderation_reason text;
