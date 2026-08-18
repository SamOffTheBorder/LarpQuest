-- Move the vector extension out of public per Supabase's advisor guidance
-- (extension_in_public) — extensions in public pollute search_path and grant
-- their functions to every role that can use that schema.

create schema if not exists extensions;

alter extension vector set schema extensions;
