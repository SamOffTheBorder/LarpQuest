-- Legal document acceptance audit trail (launch plan B1.4).
--
-- Keyed by email, not user_id: the sign-in flow is passwordless
-- (signInWithOtp), so no session or auth.users row is guaranteed to exist
-- yet at the moment the acceptance checkbox is checked — account creation
-- is a side effect of the *next* request (clicking the emailed link), not
-- this one. Email alone is a complete, durable answer to "did this address
-- confirm agreement to version X at time Y," which is what an acceptance
-- audit trail needs; nothing in the app reads this back, so no client RLS
-- policy is needed, matching how rate_limit_counters is RLS-enabled with no
-- policies at all — every access goes through the service-role client.

create table legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  document text not null check (document in ('terms', 'privacy', 'acceptable_use')),
  version text not null,
  accepted_at timestamptz not null default now()
);

create index legal_acceptances_email_idx on legal_acceptances (email);

alter table legal_acceptances enable row level security;
-- No policies: service-role only, same pattern as rate_limit_counters.
