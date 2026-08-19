-- RLS coverage audit.
--
-- Every table in the public schema must have RLS enabled and at least one
-- policy. A table without a policy is a bug — this fails loudly rather than
-- leaving story data readable across accounts.
--
-- Run against a migrated database:
--   psql "$DATABASE_URL" -f supabase/tests/rls_coverage.sql

do $$
declare
  missing_rls text;
  missing_policy text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
  into missing_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity;

  if missing_rls is not null then
    raise exception 'Tables without RLS enabled: %', missing_rls;
  end if;

  select string_agg(c.relname, ', ' order by c.relname)
  into missing_policy
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not exists (
      select 1 from pg_policy p where p.polrelid = c.oid
    );

  if missing_policy is not null then
    raise exception 'Tables with RLS but no policy: %', missing_policy;
  end if;

  raise notice 'RLS coverage OK: every public table has RLS enabled and at least one policy.';
end;
$$;

-- Append-only tables must have no UPDATE or DELETE policy, or history could be
-- rewritten and rollback would stop being trustworthy.
do $$
declare
  violation text;
begin
  select string_agg(format('%s (%s)', c.relname, p.polcmd), ', ')
  into violation
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('entity_history', 'submissions', 'universe_versions', 'story_reports', 'proposals', 'canon_exceptions')
    and p.polcmd = 'd';

  if violation is not null then
    raise exception 'Append-only tables must not have DELETE policies: %', violation;
  end if;

  raise notice 'Append-only constraints OK.';
end;
$$;
