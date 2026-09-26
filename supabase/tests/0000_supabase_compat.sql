-- ============================================================================
-- 0000_supabase_compat.sql
--
-- A minimal stand-in for the parts of a Supabase project that the migrations
-- depend on, plus a pgTAP-compatible assertion shim.
--
-- WHY THIS EXISTS
--
-- The Supabase CLI's local stack runs in Docker, which is the normal way to work
-- on this project. Docker is not always available (locked-down machines, CI
-- runners with no docker group), and a migration set that can only be verified
-- with Docker is a migration set that goes unverified.
--
-- This file lets the exact production migrations and the exact same test files
-- run against a plain PostgreSQL instance, so `make verify` can prove the SQL is
-- correct anywhere Postgres runs. It is a TEST HARNESS, never part of the
-- application: `supabase db push` only pushes supabase/migrations/*, which does
-- not include this file. See supabase/README-dev.md.
--
-- Fidelity note: this is a compatibility layer, not a reimplementation of GoTrue
-- or of pgTAP. It implements only the assertion functions the suites in
-- supabase/tests/ actually call, with the same semantics:
--
--   plan(n)                    fail at finish() if the count does not match
--   ok(bool, msg)              truth assertion
--   is(got, want, msg)         equality
--   is_empty(sql, msg)         query returns zero rows
--   results_eq(sql, want[], m) query's first column equals the array
--   throws_ok(sql, code, m)    statement raises errcode
--   fail(msg)                  unconditional failure
--   finish()                   return the summary row
--
-- When the real pgTAP extension is available it is used instead, and these
-- functions are never installed. See `make verify` in the Makefile.
-- ============================================================================

create schema if not exists auth;
comment on schema auth is
  'Stand-in for the Supabase-managed auth schema. See 0000_supabase_compat.sql.';

-- pgcrypto supplies gen_random_uuid() (used for every primary key), crypt() and
-- gen_salt() (used by the seed to hash demo passwords), and digest() for the
-- idempotency keys. Supabase provisions it on every project; here it has to be
-- enabled explicitly. In Postgres 13+ gen_random_uuid() is built in, but the
-- rest still comes from pgcrypto.
create extension if not exists pgcrypto;

-- ── roles ───────────────────────────────────────────────────────────────────
--
-- The three roles Supabase maps API keys onto:
--   anon           low privilege, unauthenticated requests
--   authenticated  low privilege, signed-in requests
--   service_role   elevated, BYPASSRLS, must never reach a browser
--
-- NOLOGIN: they are switched into with `set local role`, never logged in as.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- BYPASSRLS is the point of this role, and the reason it must never be
    -- reachable from a client.
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema auth to anon, authenticated, service_role;

-- ── auth schema tables ──────────────────────────────────────────────────────

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  phone              text,
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  aud                text,
  role               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists auth.identities (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  provider_id     text,
  identity_data   jsonb not null default '{}'::jsonb,
  provider        text not null,
  last_sign_in_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists identities_user_id_idx on auth.identities (user_id);

-- ── JWT claim access ────────────────────────────────────────────────────────
--
-- The real implementation reads and verifies the signed access token from the
-- request header. The suites set the claims directly:
--
--   set local request.jwt.claim.sub = '...';
--
-- Reading a custom GUC this way is how the real auth.uid() behaves, so a policy
-- that works here works there.

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

comment on function auth.uid() is
  'Returns NULL when unauthenticated, so a policy comparing auth.uid() to a '
  'column is false for anonymous requests. Deny by default rather than error.';

grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;
