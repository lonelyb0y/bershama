import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { Link } from '@/i18n/routing';
import { getSession } from '@/lib/session';
import { setProductActive } from './actions';
import { ProductForm } from '@/components/inventory/product-form';
import { LocationForm } from '@/components/inventory/location-form';
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

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-[color:var(--text-muted)] mt-1 text-sm">{t('subtitle', { count: products.length })}</p>
        </div>
      </header>

      <ProductForm
        canWrite={canWrite}
        editing={editing ?? null}
        labels={{
          titleNew: t('form.newTitle'),
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

      <form method="get" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          className="w-full max-w-sm rounded-lg border px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-[color:var(--text-muted)]/10">
          {t('search')}
        </button>
        {query !== '' && (
          <Link
            href="/admin/inventory/products"
            className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-[color:var(--text-muted)]/10"
          >
            {t('clear')}
          </Link>
        )}
      </form>

      {error ? (
        <p className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 text-sm text-red-500">
          {t('loadError')}
        </p>
      ) : products.length === 0 ? (
        <p className="rounded-xl border p-8 text-center text-sm text-[color:var(--text-muted)]">
          {query === '' ? t('empty') : t('emptySearch', { query })}
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {products.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {locale === 'ar' ? p.nameAr : p.nameEn}
                  {/* The other language stays visible on purpose. A catalogue
                      manager needs to know the record is not missing its Arabic
                      or English name. */}
                  <span className="text-[color:var(--text-muted)] ms-2 text-sm font-normal">
                    {locale === 'ar' ? p.nameEn : p.nameAr}
                  </span>
                </p>
                <p className="text-[color:var(--text-muted)] mt-0.5 font-mono text-xs">
                  {p.sku} · {p.strength} {p.strengthUnit ?? ''} · {p.packSize} {p.uom}
                </p>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {p.requiresPrescription && <Badge tone="info">{t('badge.rx')}</Badge>}
                {p.isControlled && <Badge tone="warn">{t('badge.controlled')}</Badge>}
                {p.isColdChain && <Badge tone="cold">{t('badge.cold')}</Badge>}
                {!p.isActive && <Badge tone="muted">{t('badge.inactive')}</Badge>}
              </div>

              {canWrite && (
                <div className="flex gap-2">
                  <Link
                    href={`/admin/inventory/products?edit=${p.id}`}
                      // Prefetching off. Each of these links to *this* page with a
                      // different product's edit form attached, so the default
                      // viewport prefetch fired one RSC request per row -- each
                      // re-running the catalogue query to prove an edit form exists.
                      // The largest single source of requests on this surface.
                      prefetch={false}
                    className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-[color:var(--text-muted)]/10"
                  >
                    {t('edit')}
                  </Link>
<form action={setProductActive}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="active" value={String(!p.isActive)} />
                    <button
                      type="submit"
                      className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-[color:var(--text-muted)]/10"
                    >
                      {p.isActive ? t('deactivate') : t('reactivate')}
                    </button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Badge({ tone, children }: { tone: 'info' | 'warn' | 'cold' | 'muted'; children: React.ReactNode }) {
  const tones = {
    info: 'border-sky-500/40 text-sky-600',
    warn: 'border-amber-500/40 text-amber-600',
    cold: 'border-cyan-500/40 text-cyan-600',
    muted: 'border-[color:var(--border)] text-[color:var(--text-muted)]',
  } as const;

  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
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
