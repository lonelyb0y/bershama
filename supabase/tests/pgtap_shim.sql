-- ============================================================================
-- pgtap_shim.sql
--
-- A pgTAP-compatible assertion shim for environments where the pgTAP extension
-- cannot be installed (it needs a system package and therefore root).
--
-- Implements the subset of pgTAP used by supabase/tests/*.test.sql:
--   plan(n), ok(bool,msg), is(got,want,msg), isnt(got,want,msg),
--   is_empty(sql,msg), results_eq(sql,want[],msg),
--   throws_ok(sql,code[,errmsg],msg), lives_ok(sql,msg), fail(msg), pass(msg),
--   finish()
--
-- Semantics match pgTAP, including the two that matter most:
--
--   is_empty()     asserts zero ROWS, not zero nulls.
--   results_eq()   compares the FIRST column of every row, cast to text,
--                  against the expected array. An empty result is not a pass
--                  when rows were expected.
--
-- A failed assertion raises, so a broken suite stops at the cause instead of
-- reporting a cascade of downstream noise.
--
-- ── SECURITY: the split below is load-bearing ──────────────────────────────
--
-- The assertion functions that run the suite's own SQL (is_empty, results_eq,
-- throws_ok, lives_ok) are deliberately SECURITY INVOKER. If they were
-- SECURITY DEFINER, their dynamic EXECUTE would run as the function owner --
-- postgres, which has BYPASSRLS -- and every RLS policy under test would be
-- bypassed. The tenant-isolation suites would then pass no matter how broken the
-- policies were, which is precisely the failure this project cannot afford.
--
-- Only the bookkeeping functions that touch the internal counter table are
-- SECURITY DEFINER, because the suites `set local role anon` and
-- `authenticated` to exercise policies and would otherwise lose the ability to
-- update that table.
--
-- Not installed when the real extension is present: `scripts/verify-db.sh`
-- prefers pgTAP and falls back to this shim only on failure.
-- ============================================================================

create schema if not exists pgtap_shim;

create table if not exists pgtap_shim._state (
  id        boolean primary key default true,
  planned   integer,
  ran       integer not null default 0,
  failed    integer not null default 0,
  constraint _state_singleton check (id)
);

insert into pgtap_shim._state (id, planned, ran, failed)
values (true, null, 0, 0)
on conflict (id) do nothing;

-- The counter is bookkeeping, not tenant data. RLS on it would break the
-- `set local role` pattern the suites rely on, so it is deliberately left
-- unprotected and reachable only through the functions below.
revoke all on pgtap_shim._state from anon, authenticated;

-- ── bookkeeping (SECURITY DEFINER) ──────────────────────────────────────────

create or replace function pgtap_shim._bump(p_ok boolean, p_msg text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ran integer;
begin
  update pgtap_shim._state
     set ran = ran + 1,
         failed = failed + (case when p_ok then 0 else 1 end)
   where id
  returning ran into v_ran;

  if p_ok then
    return format('ok %s - %s', v_ran, coalesce(p_msg, ''));
  end if;

  raise exception 'FAILED #%: %', v_ran, coalesce(p_msg, '');
end;
$$;

create or replace function pgtap_shim.plan(n integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  update pgtap_shim._state set planned = n, ran = 0, failed = 0 where id;
  return format('plan %s', n);
end;
$$;

-- Reset between suites. Each suite calls plan() itself; this guards against a
-- suite that aborts before its plan() and would otherwise inherit the previous
-- suite's counters.
create or replace function pgtap_shim._reset()
returns void
language sql
security definer
set search_path = ''
as $$
  update pgtap_shim._state set planned = null, ran = 0, failed = 0 where id
$$;

-- Final assertion: the plan count must be met exactly. A suite that forgets an
-- assertion is a suite that stopped testing something.
create or replace function pgtap_shim.finish()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_planned integer;
  v_ran     integer;
  v_failed  integer;
begin
  select planned, ran, failed into v_planned, v_ran, v_failed
  from pgtap_shim._state where id;

  if v_planned is null then
    raise exception 'finish() called without plan()';
  end if;
  if v_ran <> v_planned then
    raise exception 'plan mismatch: planned % but ran %', v_planned, v_ran;
  end if;

  return format('ran %s of %s assertions, %s failed', v_ran, v_planned, v_failed);
end;
$$;

-- ── simple assertions (INVOKER, delegate to _bump) ───────────────────────────

create or replace function pgtap_shim.ok(p_bool boolean, p_msg text default null)
returns text
language sql
as $$ select pgtap_shim._bump(coalesce(p_bool, false), p_msg) $$;

create or replace function pgtap_shim.is(
  p_got  anyelement, p_want anyelement, p_msg text default null
)
returns text
language sql
as $$ select pgtap_shim._bump(p_got is not distinct from p_want, p_msg) $$;

create or replace function pgtap_shim.isnt(
  p_got  anyelement, p_want anyelement, p_msg text default null
)
returns text
language sql
as $$ select pgtap_shim._bump(p_got is distinct from p_want, p_msg) $$;

-- Not in the subset originally implemented, but a real pgTAP function and one
-- worth having: asserting a nullable column was populated is not the same
-- assertion as "the value is not NULL" written by hand, because this fails with a
-- readable message and shows what it actually got.
create or replace function pgtap_shim.is_not_null(
  p_got anyelement, p_msg text default null
)
returns text
language sql
as $$ select pgtap_shim._bump(p_got is not null, p_msg) $$;

create or replace function pgtap_shim.is_null(
  p_got anyelement, p_msg text default null
)
returns text
language sql
as $$ select pgtap_shim._bump(p_got is null, p_msg) $$;

create or replace function pgtap_shim.fail(p_msg text default null)
returns text
language sql
as $$ select pgtap_shim._bump(false, coalesce(p_msg, 'fail')) $$;

create or replace function pgtap_shim.pass(p_msg text default null)
returns text
language sql
as $$ select pgtap_shim._bump(true, p_msg) $$;

-- ── query assertions (INVOKER — see the SECURITY note above) ────────────────

-- Zero rows. Wrapped in a count so a permission error propagates as a failure
-- rather than being mistaken for an empty result.
create or replace function pgtap_shim.is_empty(p_sql text, p_msg text default null)
returns text
language plpgsql
as $$
declare
  v_count bigint;
begin
  execute 'select count(*) from (' || p_sql || ') _t' into v_count;
  return pgtap_shim._bump(v_count = 0, p_msg);
end;
$$;

-- Every row's first column, as text, must equal the expected array.
--
-- The first column is addressed positionally, not by a name like `t`: a
-- subquery's output column is named after whatever the inner query produced
-- (`role`, `slug`, `count`, ...), so referencing a fixed alias fails on the
-- first suite that happens to use a different column name.
--
-- p_want is `anyarray` rather than `text[]` so a suite can pass
-- array['...']::uuid[] or array['...']::bigint[] without an explicit cast at
-- every call site. The comparison is done in text space, matching pgTAP's
-- behaviour of comparing rendered values.
create or replace function pgtap_shim.results_eq(
  p_sql  text,
  p_want anyarray,
  p_msg  text default null
)
returns text
language plpgsql
as $$
declare
  v_got   text[];
  v_want  text[];
begin
  execute 'select coalesce(array_agg(_c::text order by _c::text), ''{}''::text[])
             from (select * from (' || p_sql || ') _s) _r(_c)'
    into v_got;

  select coalesce(array_agg(w::text order by w::text), '{}'::text[])
    into v_want
  from unnest(p_want) w;

  return pgtap_shim._bump(v_got = v_want, p_msg);
end;
$$;

-- The statement must raise the given SQLSTATE. An error, not zero rows: this
-- asserts the operation was REFUSED, a different guarantee from "matched
-- nothing".
--
-- Two forms, matching pgTAP:
--   throws_ok(sql, errcode, description)
--   throws_ok(sql, errcode, errmsg, description)   -- errmsg matched with LIKE
--
-- The four-argument form asserts not only that a write was refused but that it
-- was refused for the expected reason.
create or replace function pgtap_shim.throws_ok(
  p_sql      text,
  p_errcode  text,
  p_msg      text default null
)
returns text
language plpgsql
as $$
declare
  v_state text;
begin
  begin
    execute p_sql;
    v_state := null;
  exception when others then
    v_state := sqlstate;
  end;

  return pgtap_shim._bump(v_state = p_errcode, p_msg);
end;
$$;

create or replace function pgtap_shim.throws_ok(
  p_sql      text,
  p_errcode  text,
  p_errmsg   text,
  p_msg      text default null
)
returns text
language plpgsql
as $$
declare
  v_state   text;
  v_message text;
begin
  begin
    execute p_sql;
    v_state   := null;
    v_message := null;
  exception when others then
    v_state   := sqlstate;
    v_message := sqlerrm;
  end;

  if p_errmsg is null then
    return pgtap_shim._bump(v_state = p_errcode, p_msg);
  end if;

  return pgtap_shim._bump(
    v_state = p_errcode and v_message like p_errmsg,
    p_msg
  );
end;
$$;

-- For statements expected to succeed. Insufficient on its own for a write: it
-- also passes when the statement matched zero rows. Pair it with `returning`
-- and results_eq to prove the row actually changed.
create or replace function pgtap_shim.lives_ok(p_sql text, p_msg text default null)
returns text
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception when others then
    return pgtap_shim._bump(false, p_msg);
  end;
  return pgtap_shim._bump(true, p_msg);
end;
$$;

grant usage on schema pgtap_shim to public;
grant execute on all functions in schema pgtap_shim to public;
