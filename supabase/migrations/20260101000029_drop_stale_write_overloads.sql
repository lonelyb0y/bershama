-- Drop the text-typed overloads left behind by 0028.
--
-- Changing a parameter's TYPE creates a new function rather than replacing the
-- old one, so after 0028 the api schema held two create_product and two
-- create_location. PostgREST resolves by argument names, and an ambiguous match
-- is PGRST203 -- so both became uncallable rather than one of them winning.
--
-- The sequence is worth recording because it is a trap in `create or replace`:
-- it replaces a function only when the signature is identical. A default value
-- that nobody changes, or one parameter retyped to match its column, silently
-- produces an overload.
--
-- Dropped explicitly and by signature. There is no blanket "drop on schema api",
-- and dropping the wrong overload here would take out a working function.

drop function if exists api.create_product(
  text, text, text, text, text, text, text, text, text,
  integer, private.stock_unit, text, text, text, boolean, boolean, boolean, integer);

drop function if exists api.create_location(uuid, text, text, text, text, numeric, numeric);
