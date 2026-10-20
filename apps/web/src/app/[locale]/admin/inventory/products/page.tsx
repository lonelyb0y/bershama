import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { Link } from '@/i18n/routing';
import { getSession } from '@/lib/session';
import { setProductActive } from './actions';
import { ProductForm } from '@/components/inventory/product-form';
import { ProductTable } from '@/components/inventory/product-table';
import { LocationForm } from '@/components/inventory/location-form';
import { PageHeader } from '@/components/ui/page-header';
import { Toolbar } from '@/components/ui/toolbar';
import type { Locale } from '@/i18n/routing';
import type { Product } from '@/lib/types';

/**
 * The product catalogue.
 *
 * Products are the spine of the system: a batch belongs to one, a stock balance
 * refers to one, and a requisition line cannot be priced without one. This screen
 * is therefore the first of the CRUD surfaces, and the shape of it is what the
 * rest follow.
 *
 * Deliberately not paginated yet. A distributor's catalogue runs to a few
 * thousand rows, which fits in a page; when it does not, the fix is a cursor
 * rather than an offset, and building the offset now means building it twice.
 * The search box narrows in the database, so it stays fast as the catalogue grows
 * and does not depend on shipping every row to the browser first.
 */
export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ q?: string; edit?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('products');
  const session = await getSession();
  if (!session) notFound();

  // WAREHOUSE_MANAGER and TENANT_ADMIN may write; the policy allows exactly
  // these two roles. Derived from the same list rather than from a second
  // hard-coded set that could drift from the policy.
  const canWrite = session.role === 'TENANT_ADMIN' || session.role === 'WAREHOUSE_MANAGER';

  const { q, edit } = await searchParams;
  const query = (q ?? '').trim();

  const supabase = await getSupabase();
  let select = supabase
    .from('products')
    .select(
      'id, sku, name_en, name_ar, generic_name_en, generic_name_ar, brand, form, strength, strength_unit, pack_size, uom, atc_code, gtin, eda_reg_no, requires_prescription, is_controlled, is_cold_chain, shelf_life_months, sell_price_minor, is_active',
    )
    .order('name_en');

  // ilike on both names, so an Arabic search works as well as an English one.
  // `%` and `_` are escaped: they are wildcards, and a user pasting a GTIN that
  // contains one should get a literal comparison rather than every row.
  if (query !== '') {
    const escaped = query.replace(/[%_]/g, (c) => `\\${c}`);
    select = select.or(
      `name_en.ilike.%${escaped}%,name_ar.ilike.%${escaped}%,sku.ilike.%${escaped}%,generic_name_en.ilike.%${escaped}%`,
    );
  }

  const { data, error } = await select.limit(200);
  const products = ((data ?? []) as unknown as ProductRow[]).map(toProduct);

  // The form is shown for one product, or blank for a new one. A query
  // parameter rather than a route segment, so editing does not need a URL of its
  // own and the list stays one page deep.
  const editing = edit ? products.find((p) => p.id === edit) : undefined;

  // Facilities are needed by the location form on the same page.
  const { data: facilityData } = await supabase
    .from('facilities')
    .select('id, name_en, name_ar, code, kind')
    .eq('is_active', true)
    .order('name_en');
  const facilities = (facilityData ?? []).map((f) => ({
    id: f.id as string,
    label: `${f.name_en}${f.name_ar ? ` · ${f.name_ar}` : ''}`,
    code: f.code as string,
  }));

  const displayName = (p: Product) => (locale === 'ar' ? p.nameAr : p.nameEn);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('title')}
        description={t('subtitle', { count: products.length })}
      />

      {/*
        The two disclosures, side by side and the width of their labels.

        They were full-width bordered strips, one word each, stacked — two entire rows
        of the screen for two actions, and the widest elements on the page. `w-fit`
        makes the closed disclosure exactly as wide as its summary, and the form
        inside sets its own width when it opens.
      */}
      <div className="flex flex-wrap items-start gap-2">
        <ProductForm
          canWrite={canWrite}
          editing={editing ?? null}
          labels={{
            titleNew: t('form.newTitle'),
            register: {
              title: t('form.register.title'),
              placeholder: t('form.register.placeholder'),
              searching: t('form.register.searching'),
              noResults: t('form.register.noResults'),
              use: t('form.register.use'),
              provenance: t('form.register.provenance'),
            },
            titleEdit: t('form.editTitle'),
            sku: t('form.sku'),
            nameEn: t('form.nameEn'),
            nameAr: t('form.nameAr'),
            genericNameEn: t('form.genericNameEn'),
            genericNameAr: t('form.genericNameAr'),
            brand: t('form.brand'),
            form: t('form.form'),
            strength: t('form.strength'),
            strengthUnit: t('form.strengthUnit'),
            packSize: t('form.packSize'),
            uom: t('form.uom'),
            atcCode: t('form.atcCode'),
            gtin: t('form.gtin'),
            edaRegNo: t('form.edaRegNo'),
            requiresPrescription: t('form.requiresPrescription'),
            isControlled: t('form.isControlled'),
            isColdChain: t('form.isColdChain'),
            shelfLifeMonths: t('form.shelfLifeMonths'),
            sellPrice: t('form.sellPrice'),
            sellPriceHint: t('form.sellPriceHint'),
            isActive: t('form.isActive'),
            facility: t('form.facility'),
            code: t('form.code'),
            kind: t('form.kind'),
            tempMinC: t('form.tempMinC'),
            tempMaxC: t('form.tempMaxC'),
            submit: t('form.submit'),
            cancel: t('form.cancel'),
            saved: t('form.saved'),
            created: t('form.created'),
            titleNewLocation: t('form.newLocationTitle'),
            locationSaved: t('form.locationSaved'),
            submitLocation: t('form.submitLocation'),
          }}
        />

        <LocationForm canWrite={canWrite} facilities={facilities} labels={{
          facility: t('form.facility'),
          code: t('form.code'),
          nameEn: t('form.nameEn'),
          nameAr: t('form.nameAr'),
          kind: t('form.kind'),
          tempMinC: t('form.tempMinC'),
          tempMaxC: t('form.tempMaxC'),
          isActive: t('form.isActive'),
          titleNewLocation: t('form.newLocationTitle'),
          locationSaved: t('form.locationSaved'),
          submitLocation: t('form.submitLocation'),
        }} />
      </div>

      {/*
        One search landmark, not six.

        The catalogue had a search form and two disclosure forms and an action form
        per row, so the page announced six form landmarks and a screen reader user
        listing them heard "form" six times. The search is a `role="search"` region
        with a name, and the per-row action forms are inside the table where they
        belong.
      */}
      <Toolbar label={t('searchPlaceholder')}>
        <form method="get" className="flex flex-1 gap-2">
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            className="w-full max-w-sm rounded-lg border bg-transparent px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-[color:var(--text-muted)]/10"
          >
            {t('search')}
          </button>
          {query !== '' ? (
            <Link
              href="/admin/inventory/products"
              className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-[color:var(--text-muted)]/10"
            >
              {t('clear')}
            </Link>
          ) : null}
        </form>
      </Toolbar>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-[var(--color-stock-critical)]/40 bg-[var(--color-stock-critical)]/5 p-4 text-sm text-[var(--color-stock-critical)]"
        >
          {t('loadError')}
        </p>
      ) : (
        <ProductTable
          rows={products}
          locale={locale}
          canWrite={canWrite}
          setActiveAction={setProductActive}
          labels={{
            columnProduct: t('column.product'),
            columnSku: t('column.sku'),
            columnForm: t('column.form'),
            columnPack: t('column.pack'),
            columnFlags: t('column.flags'),
            edit: t('edit'),
            deactivate: t('deactivate'),
            reactivate: t('reactivate'),
            actionEdit: t('action.edit'),
            actionDeactivate: t('action.deactivate'),
            actionReactivate: t('action.reactivate'),
            rx: t('badge.rx'),
            controlled: t('badge.controlled'),
            cold: t('badge.cold'),
            inactive: t('badge.inactive'),
            empty: query === '' ? t('empty') : t('emptySearch', { query }),
            emptyBody: query === '' ? t('emptyBody') : t('emptySearchBody', { query }),
            caption: t('title'),
          }}
        />
      )}
    </div>
  );
}

/* ── row shapes ────────────────────────────────────────────────────────────── */

interface ProductRow {
  id: string;
  sku: string;
  name_en: string;
  name_ar: string;
  generic_name_en: string | null;
  generic_name_ar: string | null;
  brand: string | null;
  form: string;
  strength: string;
  strength_unit: string | null;
  pack_size: number;
  uom: string;
  atc_code: string | null;
  gtin: string | null;
  eda_reg_no: string | null;
  requires_prescription: boolean;
  is_controlled: boolean;
  is_cold_chain: boolean;
  shelf_life_months: number;
  sell_price_minor: number;
  is_active: boolean;
}

function toProduct(r: ProductRow): Product {
  return {
    id: r.id,
    tenantId: '',
    sku: r.sku,
    nameEn: r.name_en,
    nameAr: r.name_ar,
    genericNameEn: r.generic_name_en,
    genericNameAr: r.generic_name_ar,
    brand: r.brand,
    form: r.form,
    strength: r.strength,
    strengthUnit: r.strength_unit,
    packSize: r.pack_size,
    uom: r.uom,
    atcCode: r.atc_code,
    gtin: r.gtin,
    edaRegNo: r.eda_reg_no,
    requiresPrescription: r.requires_prescription,
    isControlled: r.is_controlled,
    isColdChain: r.is_cold_chain,
    shelfLifeMonths: r.shelf_life_months,
    sellPriceMinor: r.sell_price_minor,
    isActive: r.is_active,
  };
}
