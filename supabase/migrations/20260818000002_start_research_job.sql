-- Phase 3: atomic stage-start for the research pipeline.
--
-- Marks a stage as started, incrementing attempt_count in the same statement
-- so a step retried by Inngest (network blip, transient 5xx) has that
-- reflected without a read-modify-write race between concurrent step
-- attempts. Mirrors claim_extraction_job's atomic-update shape from Phase 1.

create function start_research_job(p_draft_id uuid, p_stage text)
returns research_jobs
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  update research_jobs
  set status = 'running',
      attempt_count = attempt_count + 1
  where draft_id = p_draft_id
    and stage = p_stage
  returning *;
$$;

revoke execute on function start_research_job(uuid, text) from public, anon, authenticated;
