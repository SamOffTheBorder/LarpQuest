-- Account deletion, resolved as anonymize-and-preserve rather than cascade
-- (build plan Part 11 tension, launch plan C1.1).
--
-- Deleting the auth.users row is how deletion actually happens (Supabase
-- Admin API, auth.admin.deleteUser). What this migration changes is what that
-- deletion does to everyone else's data: four foreign keys currently cascade
-- in a way that would destroy collaborative work belonging to other users, or
-- violate CLAUDE.md #4 (submissions persist independently of generation).
--
-- Every other auth.users reference in the schema was already `on delete set
-- null` from its original migration — story_invites.created_by,
-- entities.controlled_by, entity_history.applied_by, story_reports.reporter_id,
-- proposals.created_by, turn_mode changes, export_jobs.requested_by,
-- share_links.created_by. Only these four need to change.
--
-- api_keys.owner_id is deliberately left as cascade: a key with no owner has
-- no meaning and holds no collaborative value, so deleting it alongside the
-- account is correct rather than an oversight.

-- stories.owner_id: ownership for RLS purposes actually flows through
-- story_members.role = 'owner' (see is_story_owner()), not this column — it
-- is attribution only. Orphaning it cannot change who can manage the story;
-- deleting the account already removes that user's story_members row via its
-- own cascade, which is the change that actually matters for access.
alter table stories drop constraint stories_owner_id_fkey;
alter table stories add constraint stories_owner_id_fkey
  foreign key (owner_id) references auth.users on delete set null;
alter table stories alter column owner_id drop not null;

-- submissions.user_id: CLAUDE.md #4 — "No generation outcome may delete or
-- alter a submission." An account deletion is not a generation outcome, but
-- the same principle applies for the same reason: other players' turns may be
-- waiting on this submission, and a cascade would silently corrupt a turn
-- already in progress for people who did nothing wrong.
alter table submissions drop constraint submissions_user_id_fkey;
alter table submissions add constraint submissions_user_id_fkey
  foreign key (user_id) references auth.users on delete set null;
alter table submissions alter column user_id drop not null;

-- universes.owner_id: a published universe may be cloned into other users'
-- stories (universe marketplace) or actively pinned by stories via
-- universe_version. Cascading here would delete universes out from under
-- stories that depend on them.
alter table universes drop constraint universes_owner_id_fkey;
alter table universes add constraint universes_owner_id_fkey
  foreign key (owner_id) references auth.users on delete set null;
alter table universes alter column owner_id drop not null;

-- universe_drafts.owner_id: same preserve-and-orphan treatment for
-- consistency, even though an in-progress draft is lower stakes than a
-- published universe. A draft mid-research-pipeline is not something the
-- pipeline's own worker should have to handle being deleted out from under.
alter table universe_drafts drop constraint universe_drafts_owner_id_fkey;
alter table universe_drafts add constraint universe_drafts_owner_id_fkey
  foreign key (owner_id) references auth.users on delete set null;
alter table universe_drafts alter column owner_id drop not null;

-- RLS policies for these four tables filter on owner_id = auth.uid() for
-- insert/update/delete, which a null owner_id can never match — so an
-- orphaned row simply becomes unmodifiable by ordinary users going forward,
-- which is the correct terminal state for something whose owner no longer
-- exists. No policy needs to change.
