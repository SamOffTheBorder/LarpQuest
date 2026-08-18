-- Phase 4: vector similarity search RPCs.
--
-- PostgREST does not expose the `<=>` cosine-distance operator directly, so
-- retrieval goes through these two functions rather than a raw `.select()`.
-- Both are scoped to one story_id in the query itself (not just RLS) so a
-- caller cannot accidentally rank across stories by omitting a filter —
-- retrieval-pipeline.spec's "retrieval is scoped to one story_id."
--
-- security definer with pinned search_path, same as every other RPC in this
-- schema; execute revoked from anon/authenticated since this runs from
-- server-side code through the service role.

create function match_chapter_summaries(
  p_story_id uuid,
  p_query_embedding extensions.vector(1536),
  p_match_count int default 5
)
returns table (
  turn_number int,
  summary text,
  similarity float
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    turn_number,
    summary,
    1 - (embedding <=> p_query_embedding) as similarity
  from chapters
  where story_id = p_story_id
    and embedding is not null
    and summary is not null
  order by embedding <=> p_query_embedding
  limit p_match_count;
$$;

revoke execute on function match_chapter_summaries(uuid, extensions.vector, int)
  from public, anon, authenticated;

create function match_arc_summaries(
  p_story_id uuid,
  p_query_embedding extensions.vector(1536),
  p_match_count int default 5
)
returns table (
  from_chapter int,
  to_chapter int,
  summary text,
  similarity float
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    from_chapter,
    to_chapter,
    summary,
    1 - (embedding <=> p_query_embedding) as similarity
  from arc_summaries
  where story_id = p_story_id
    and embedding is not null
  order by embedding <=> p_query_embedding
  limit p_match_count;
$$;

revoke execute on function match_arc_summaries(uuid, extensions.vector, int)
  from public, anon, authenticated;
