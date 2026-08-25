-- Fight chapter split (fight-chapter-split capability).
--
-- A 1v1 `action` turn may resolve at a narrative turning point instead of a
-- full resolution. When it does, the system automatically creates, locks,
-- and generates a second turn that resumes the same fight and always
-- resolves it. `continues_chapter_id` links the continuation's chapter/turn
-- back to the chapter it continues, so context assembly and the UI can treat
-- the pair as one continuous scene without inferring it from turn_number
-- adjacency. Nullable on both tables; existing rows default to null, meaning
-- "not a continuation" — the correct default. No new RLS policy needed: both
-- columns live on tables whose existing policies already gate through
-- is_story_member/is_story_owner.

alter table chapters
  add column continues_chapter_id uuid references chapters(id) on delete set null;

alter table turns
  add column continues_chapter_id uuid references chapters(id) on delete set null;
