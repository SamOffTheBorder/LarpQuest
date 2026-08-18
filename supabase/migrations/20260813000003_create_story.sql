-- Phase 1: atomic story creation.
--
-- The story row and the owner's story_members row must be inserted together —
-- an orphaned story its creator cannot access (membership insert failing after
-- the story insert) is exactly the failure the story-lifecycle spec calls out.
-- A single client-side insert cannot guarantee that; a transaction can.

create function create_story(
  p_owner_id uuid,
  p_title text,
  p_content_rating text,
  p_model_config jsonb,
  p_turn_config jsonb default '{}'::jsonb
)
returns stories
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  created stories;
begin
  insert into stories (owner_id, title, content_rating, model_config, turn_config)
  values (p_owner_id, p_title, p_content_rating, p_model_config, p_turn_config)
  returning * into created;

  insert into story_members (story_id, user_id, role)
  values (created.id, p_owner_id, 'owner');

  return created;
end;
$$;

revoke execute on function create_story(uuid, text, text, jsonb, jsonb)
  from public, anon, authenticated;
