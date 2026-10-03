-- Catalogue provenance and manufacturer.
--
-- ── why this migration exists ──────────────────────────────────────────────────
--
-- scripts/import-egyptian-drugs.py brings in ~25,000 real products from the Egyptian drug
-- register. Two of the fields in that source have nowhere to go today:
--
--   manufacturer  Who makes it. Not decoration -- a pharmacy substitutes on manufacturer,
--                 and a buyer deciding between two suppliers of the same generic is asking
--                 exactly this question. It is arguably a more important catalogue field
--                 than anything else the source lacks.
--   drug_class    The therapeutic class ("COLD PRODUCTS", "MULTIVITAMIN"). Also a real
--                 purchasing axis.
--
-- The obvious alternative was to drop them and import only what already fits. That would
-- have thrown away the two most commercially useful columns in the dataset to avoid a
-- migration, which is the wrong trade.
--
-- ── source, deliberately recorded per row ───────────────────────────────────────
--
-- `source` is not documentation, it is a column. Every imported row carries the provenance
-- of its own data, because "where did this come from" is the first question anyone should
-- ask of a catalogue field and the answer should not require archaeology through git. The
-- seed rows get a matching value so the column is never half-populated.
--
-- The import is a third-party CC0 compilation, not the Egyptian Drug Authority's own
-- export -- the EDA publishes no API. That is recorded rather than smoothed over, and it is
-- why `eda_reg_no` stays null: the source has no registration numbers and inventing them
-- would be worse than admitting the gap.

alter table public.products
  add column if not exists manufacturer text,
  add column if not exists drug_class   text,
  add column if not exists source       text;

comment on column public.products.manufacturer is
  'Who manufactures the product. Null when unknown; a pharmacy substitutes on this.';
comment on column public.products.drug_class is
  'Therapeutic class as published by the register the row was imported from.';
comment on column public.products.source is
  'Provenance of the row''s catalogue data, e.g. the EDA register import and its licence.';

-- The seeded demo products are hand-written, and saying so is more useful than leaving the
-- column null, which would be indistinguishable from "we forgot".
update public.products
   set source = 'demo seed (hand-written)'
 where source is null;

notify pgrst, 'reload schema';
