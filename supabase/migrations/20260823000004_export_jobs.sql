-- Phase 8: story export (Markdown/PDF/EPUB) as a background job.
--
-- PDF/EPUB generation from a long story can be slow, so export runs as a
-- queued background step rather than holding a request open — same
-- queued-task shape as extraction_queue/memory_queue, own table because
-- export is an independent failure domain from either.

create table export_jobs (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories(id) on delete cascade,
  requested_by uuid references auth.users on delete set null,
  format text not null check (format in ('markdown', 'pdf', 'epub')),
  status text not null default 'queued'
    check (status in ('queued', 'complete', 'failed')),
  storage_path text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index export_jobs_story_idx on export_jobs (story_id, created_at);

alter table export_jobs enable row level security;

create policy export_jobs_select on export_jobs
  for select using (is_story_member(story_id));

create policy export_jobs_insert on export_jobs
  for insert with check (is_story_member(story_id) and requested_by = (select auth.uid()));

-- No update/delete policy for any non-service-role caller: status
-- transitions happen exclusively through the export worker (service role).

create trigger export_jobs_touch_updated_at
  before update on export_jobs
  for each row execute function touch_updated_at();

insert into storage.buckets (id, name, public)
values ('story-exports', 'story-exports', false)
on conflict (id) do nothing;

create policy story_exports_bucket_select on storage.objects
  for select using (
    bucket_id = 'story-exports'
    and is_story_member(((storage.foldername(name))[1])::uuid)
  );

-- No insert/update/delete storage policy for authenticated/anon: uploads
-- happen exclusively through the service role from the export worker.
