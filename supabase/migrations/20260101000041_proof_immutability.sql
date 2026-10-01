-- Making "a signature cannot be rewritten" true rather than aspirational.
--
-- proofs_of_delivery has a SELECT policy and no UPDATE or DELETE policy, and the
-- table comment claimed that meant "the database refuses to rewrite a signature
-- even for an administrator". It did not. Two reasons:
--
--   * RLS is bypassed by the table owner, and
--   * a client role with no UPDATE policy gets zero rows updated, not an error.
--
-- So the comment described a protection that did not exist. A signature is
-- evidence, and the one party with a real reason to want it changed -- the company
-- being sued over a delivery -- is precisely the party the constraint has to stop.
--
-- A BEFORE UPDATE trigger is the only thing here that holds for every role. DELETE
-- is left available to the owner, because that is what a tenant erasure or the
-- removal of a run cascades through; erasing evidence is a deliberate DBA act with a
-- trail, which is different from quietly editing it, and it is asserted in the
-- test suite that no client role has a delete path at all.

create or replace function private.proofs_of_delivery_are_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception
    'a proof of delivery cannot be rewritten; record what happened and leave it alone'
    using errcode = '42501';
end
$$;

drop trigger if exists proofs_of_delivery_immutable on public.proofs_of_delivery;

create trigger proofs_of_delivery_immutable
  before update on public.proofs_of_delivery
  for each row execute function private.proofs_of_delivery_are_immutable();

comment on function private.proofs_of_delivery_are_immutable() is
  'Blocks UPDATE on proofs_of_delivery for every role, including the owner. RLS is not enough: the owner bypasses it, and a client with no UPDATE policy gets a silent zero rather than a refusal. UPDATE is blocked and DELETE is left to the owner on purpose, so tenant erasure still cascades.';

-- The table comment in 0035 described a protection the schema did not have. Correcting
-- the comment rather than leaving the stronger claim in place, because a comment that
-- overstates a guarantee is worse than no comment -- it is a guarantee somebody will
-- rely on.

comment on table public.proofs_of_delivery is
  'Evidence. A SELECT policy and no UPDATE or DELETE policy means no client role can rewrite or remove a signature; a BEFORE UPDATE trigger enforces the same for the owner, since RLS is bypassed by the owner and a client with no UPDATE policy gets a silent zero rather than a refusal. `meaning` is required: a signature with no declared meaning attests to nothing specific.';