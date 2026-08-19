-- Phase 8: public read-only share links.
--
-- The one table on this page with no anonymous-read RLS policy: a share-link
-- visitor is not a story_members row, so token validation and access happen
-- through resolve_share_link (security definer, callable by anon), mirroring
-- join_story_via_invite's pre-membership pattern from Phase 5 — the token
-- itself is the authorization, not session-based RLS.
--
-- Revocation is an update (revoked_at), not a delete, matching
-- story_invites — keeps the link's history intact and makes "was this ever
-- valid" answerable after the fact.

create table share_links (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories(id) on delete cascade,
  token text not null unique,
  created_by uuid references auth.users on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index share_links_story_idx on share_links (story_id);
create index share_links_token_idx on share_links (token);

alter table share_links enable row level security;

create policy share_links_select on share_links
  for select using (is_story_role(story_id, array['owner', 'gm']));

create policy share_links_insert on share_links
  for insert with check (is_story_role(story_id, array['owner', 'gm']));

create policy share_links_update on share_links
  for update
  using (is_story_role(story_id, array['owner', 'gm']))
  with check (is_story_role(story_id, array['owner', 'gm']));

-- No delete policy: revocation is an update, not a deletion.

-- Resolves a token to its story id, only if the link exists and is not
-- revoked. Returns null rather than raising, so a route can distinguish
-- "invalid/revoked link" (render a not-found page) from an actual error.
-- security definer + granted to anon: a share-link visitor is never signed
-- in, by definition.
create function resolve_share_link(p_token text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select story_id
  from share_links
  where token = p_token
    and revoked_at is null;
$$;

revoke execute on function resolve_share_link(text) from public;
grant execute on function resolve_share_link(text) to anon, authenticated;
