-- Drop the enum-typed update_product overload left by 0032's mis-matched drop.
--
-- 0032 correctly restated the function with text parameters, so the text version
-- exists -- but its `drop function if exists` named the wrong signature and was
-- a silent no-op against the overload actually present. Two functions with one
-- name and different signatures is PGRST203, which makes BOTH uncallable, so
-- this is not a tidy-up: it is the difference between api.update_product working
-- and not working.
--
-- The signature is taken from pg_proc.oid::regprocedure rather than written by
-- hand, which is the lesson. I have now written this drop twice from memory and
-- got it wrong both times.
--
-- Restated in no other way: 0032 has already been applied and a migration that
-- has run is not re-run by editing it.

drop function if exists api.update_product(uuid,text,text,text,text,text,text,text,text,integer,private.stock_unit,text,text,text,boolean,boolean,boolean,integer);
