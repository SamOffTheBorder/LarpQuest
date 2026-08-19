-- Phase 8: chapter_images, chapter_videos, and their Storage buckets.
--
-- One chapter_images row per generated manga panel (a chapter may have zero,
-- one, or several — panels are independent images, not a composited page).
-- At most one active chapter_videos row per chapter, seeded from that
-- chapter's completed image(s).
--
-- story_id is denormalized onto both tables (not joined through chapters),
-- matching entity_history's existing precedent for RLS on a table that hangs
-- off another entity rather than off stories directly.
--
-- This is the first use of Supabase Storage in this project. Two private
-- buckets, path convention story_id/chapter_id/..., with storage.objects
-- policies mirroring is_story_member the same way table RLS does everywhere
-- else. Only the service role writes; members (and nobody else) may read.

create table chapter_images (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  story_id uuid not null references stories(id) on delete cascade,
  prompt text,
  storage_path text,
  status text not null default 'queued'
    check (status in ('queued', 'complete', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table chapter_videos (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  story_id uuid not null references stories(id) on delete cascade,
  storage_path text,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'complete', 'failed')),
  error text,
  job_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index chapter_images_chapter_idx on chapter_images (chapter_id);
create index chapter_images_story_idx on chapter_images (story_id);
create index chapter_videos_chapter_idx on chapter_videos (chapter_id);
create index chapter_videos_story_idx on chapter_videos (story_id);

alter table chapter_images enable row level security;
alter table chapter_videos enable row level security;

create policy chapter_images_select on chapter_images
  for select using (is_story_member(story_id));

create policy chapter_videos_select on chapter_videos
  for select using (is_story_member(story_id));

-- No insert/update/delete policy for any non-service-role caller: rows are
-- written exclusively by the generation worker (service role), same as
-- extraction_queue/memory_queue.

create trigger chapter_images_touch_updated_at
  before update on chapter_images
  for each row execute function touch_updated_at();

create trigger chapter_videos_touch_updated_at
  before update on chapter_videos
  for each row execute function touch_updated_at();

-- Storage buckets: private, not public. Access goes through story membership
-- via the path convention story_id/chapter_id/filename, checked in the
-- policy below exactly as table RLS checks is_story_member(story_id).
insert into storage.buckets (id, name, public)
values ('chapter-images', 'chapter-images', false),
       ('chapter-videos', 'chapter-videos', false)
on conflict (id) do nothing;

create policy chapter_images_bucket_select on storage.objects
  for select using (
    bucket_id = 'chapter-images'
    and is_story_member(((storage.foldername(name))[1])::uuid)
  );

create policy chapter_videos_bucket_select on storage.objects
  for select using (
    bucket_id = 'chapter-videos'
    and is_story_member(((storage.foldername(name))[1])::uuid)
  );

-- No insert/update/delete storage policy for authenticated/anon: uploads
-- happen exclusively through the service role from the generation worker.
