-- Phase 5: entities.controlled_by becomes enforced, not schema-only.
--
-- Unclaimed entities stay editable by any member so Phase 1-style solo stories
-- keep working unchanged. Once claimed, only the controller or a GM/owner may
-- edit — closing the gap where any member could edit any entity regardless of
-- controlled_by.

drop policy entities_update on entities;

create policy entities_update on entities
  for update
  using (
    is_story_role(story_id, array['owner', 'gm'])
    or controlled_by = (select auth.uid())
    or (controlled_by is null and is_story_member(story_id))
  )
  with check (
    is_story_role(story_id, array['owner', 'gm'])
    or controlled_by = (select auth.uid())
    or (controlled_by is null and is_story_member(story_id))
  );

-- Member removal: owner or GM, never the owner row itself.
drop policy story_members_delete on story_members;

create policy story_members_delete on story_members
  for delete using (
    (is_story_owner(story_id) or is_story_role(story_id, array['gm']))
    and role <> 'owner'
  );
