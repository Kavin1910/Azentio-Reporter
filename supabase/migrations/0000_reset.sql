-- =============================================================================
-- 0000_reset.sql — DESTRUCTIVE. Run this ONCE, before 0001.
--
-- Clears the previous loan-portal schema so the reporting schema can be created
-- cleanly. Without it, 0001 fails on the first type it tries to create:
--   ERROR: 42710: type "chat_role" already exists
--
-- This deletes EVERY table, type, function and row in the public schema, and
-- the demo auth users created by the old seeder. Only run it on a project whose
-- contents you are willing to lose.
--
-- If you would rather not drop the whole schema, the alternative is to drop the
-- old objects individually — but the old schema had 11 tables, 11 types and 6
-- functions, and missing one leaves 0001 failing on a different line.
-- =============================================================================

-- The trigger lives on auth.users, outside the schema being dropped, so it has
-- to go explicitly. CASCADE below would take it with the function, but being
-- explicit means this script is also safe to run twice.
drop trigger if exists on_auth_user_created on auth.users;

drop schema if exists public cascade;
create schema public;

-- Restore the grants Supabase relies on. Dropping the schema takes these with
-- it, and without them PostgREST cannot see the new tables at all.
grant usage  on schema public to postgres, anon, authenticated, service_role;
grant create on schema public to postgres;
grant all    on schema public to postgres, service_role;

alter default privileges in schema public
  grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to postgres, anon, authenticated, service_role;

-- Demo accounts from the old seeder. Their profiles are gone with the schema,
-- so leaving them would produce signed-in users with no profile row.
delete from auth.users
 where email like '%@azentio.test'
    or email like '%@example.test';
