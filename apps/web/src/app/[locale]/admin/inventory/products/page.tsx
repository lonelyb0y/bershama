import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';
import { ROLES_BY_SURFACE } from '@/lib/roles';
import { formatQuantity } from '@/lib/format';
import { Link } from '@/i18n/routing';
import type { Locale } from '@/i18n/routing';
import type { Database } from '@/lib/database.types';

type ProductRow = Database['public']['Tables']['products']['Row'];

export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('products');
  const session = await getSession();
  if (!session) notFound();

  if (!ROLES_BY_SURFACE.admin.includes(session.role)) notFound();

  const supabase = await getSupabase();
  const { q } = await searchParams;
  const query = (q ?? '').trim();

  let select = supabase
    .from('products')
    .select(
      'id, sku, name_en, name_ar, generic_name_en, generic_name_ar, form, strength, strength_unit, uom, is_cold_chain, requires_prescription, is_active',
    )
    .order('name_en');

  if (query !== '') {
    const escaped = query.replace(/[%_]/g, (c) => `\\${c}`);
    select = select.or(
      `name_en.ilike.%${escaped}%,name_ar.ilike.%${escaped}%,sku.ilike.%${escaped}%,generic_name_en.ilike.%${escaped}%`,
    );
  }

  const { data } = await select.limit(200);
  const products: ProductRow[] = (data ?? []) as ProductRow[];

  const displayName = (p: ProductRow) => (locale === 'ar' ? p.name_ar : p.name_en);

  return (
    <div className="min-h-[100dvh] bg-[var(--surface)] text-[var(--text)]">
      {/* ── PAGE HEADER ── */}
      <section className="mx-auto max-w-[1720px] px-6 py-8 flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="pf-display text-[1.5rem] font-semibold tracking-tight">
                {t('title')}
              </h1>
              <span className="px-2 py-0.5 rounded-full border border-[var(--border)]/30 text-[11px] font-mono text-[var(--primary)]">
                {t('activeFormulary')}
              </span>
            </div>
            <p className="text-[13px] text-[var(--text-muted)] mt-0.5 tracking-normal">
              {t('subtitle', { count: products.length })} · Node 04 Central Hub
            </p>
          </div>

          {/* ── Action Cluster ── */}
          <div className="flex items-center gap-2">
            <div className="relative w-full sm:w-80">
              <span
                aria-hidden="true"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-[var(--text-muted)]"
              >
                <span className="w-5 h-5" />
              </span>
              <input
                type="search"
                name="q"
                defaultValue={query}
                placeholder={t('searchPlaceholder')}
                aria-label={t('searchPlaceholder')}
                className="w-full h-11 pl-9 pr-8 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl font-mono text-[11px] text-[var(--text)] placeholder:[var(--text-muted)]/50 focus:border-[var(--primary)] focus:ring-0 focus:outline-none transition-colors"
              />
              {query !== '' ? (
                <Link
                  href="/admin/inventory/products"
                  className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-0.5 text-[11px] font-mono rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
                >
                  {t('clear')}
                </Link>
              ) : null}
            </div>
            <Link
              href="/admin/inventory/products?edit=new"
              className="h-11 px-5 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] font-mono text-[11px] font-semibold flex items-center gap-2 hover:bg-[color:var(--primary)]/90 transition-colors active:scale-[0.98] whitespace-nowrap"
            >
              <span className="w-4 h-4" />{' '}
              {t('newProduct')}
            </Link>
          </div>
        </div>

        {/* ── FILTER TOOLBAR ── */}
        <div className="bg-[var(--surface-raised)] border border-[var(--border)] rounded-xl px-4 py-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <select
                defaultValue="all"
                className="h-9 pl-3 pr-8 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg text-[13px] font-body-md text-[var(--text)] focus:border-[var(--primary)] focus:ring-0 appearance-none cursor-pointer"
              >
                <option value="all">{t('filter.allForms')}</option>
                <option value="tablet">{t('filter.tablet')}</option>
                <option value="sachet">{t('filter.sachet')}</option>
                <option value="solution">{t('filter.solution')}</option>
                <option value="powder">{t('filter.powder')}</option>
                <option value="syringe">{t('filter.syringe')}</option>
              </select>
              <span
                aria-hidden="true"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[16px] text-[var(--text-muted)] pointer-events-none"
              >
                <span className="w-3 h-3" />
              </span>
            </div>
            <div className="relative">
              <select
                defaultValue="all"
                className="h-9 pl-3 pr-8 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg text-[13px] font-body-md text-[var(--text)] focus:border-[var(--primary)] focus:ring-0 appearance-none cursor-pointer"
              >
                <option value="all">{t('filter.allStrengths')}</option>
                <option value="500mg">{t('filter.strength500')}</option>
                <option value="875-125mg">{t('filter.strength875')}</option>
                <option value="100iu">{t('filter.strength100')}</option>
                <option value="1g">{t('filter.strength1g')}</option>
                <option value="0.5ml">{t('filter.strength05')}</option>
              </select>
              <span
                aria-hidden="true"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[16px] text-[var(--text-muted)] pointer-events-none"
              >
                <span className="w-3 h-3" />
              </span>
            </div>
            <div className="h-4 w-[1px] bg-[var(--border)] hidden sm:block mx-1" />
            <label className="h-9 px-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex items-center gap-2 cursor-pointer hover:border-[var(--border)]/60 transition-colors select-none">
              <input
                type="checkbox"
                className="w-3 h-3 rounded border-[var(--border)] text-[var(--primary)] focus:ring-0 focus:ring-offset-0 bg-[var(--surface)]"
              />
              <span className="text-[13px] font-body-md text-[var(--text)]">{t('filter.rx')}</span>
            </label>
            <label className="h-9 px-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex items-center gap-2 cursor-pointer hover:border-[var(--border)]/60 transition-colors select-none">
              <span className="w-4 h-4 text-[var(--primary)]" />
              <span className="text-[13px] font-body-md text-[var(--text)]">{t('filter.coldChain')}</span>
            </label>
          </div>
          <button
            className="h-9 px-3 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-muted)] text-[var(--text)] border border-[var(--border)] text-[11px] font-body-sm flex items-center gap-1 transition-colors duration-150"
          >
            <span className="w-4 h-4" /> {t('filter.displayOptions')}
          </button>
        </div>

        {/* ── DENSE TABLE ── */}
        <div className="mt-4 bg-[var(--surface-raised)] border border-[var(--border)] rounded-xl overflow-hidden flex flex-col flex-1">
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse min-w-[960px]">
              <thead>
                <tr className="bg-[var(--surface)]/50 border-b border-[var(--border)] text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
                  <th className="px-3 py-2 text-left" scope="col">
                    {t('column.product')}
                  </th>
                  <th className="px-3 py-3 text-left font-mono w-28" scope="col">
                    {t('column.sku')}
                  </th>
                  <th className="px-3 py-3 text-left font-mono w-28" scope="col">
                    {t('column.form')}
                  </th>
                  <th className="px-3 py-3 text-left font-mono w-32" scope="col">
                    {t('column.strength')}
                  </th>
                  <th className="px-3 py-3 text-left font-mono w-36" scope="col">
                    {t('column.cold')}
                  </th>
                  <th className="px-3 py-3 text-left font-mono w-32" scope="col">
                    {t('column.status')}
                  </th>
                  <th className="px-3 py-3 w-16 text-right" scope="col">
                    <span className="sr-only">{t('column.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]/30 text-[13px] font-body-md">
                {products.map((p) => {
                  const isCold = p.is_cold_chain;
                  const isActive = p.is_active;
                  const status = isActive
                    ? { label: t('status.inFormulary'), tone: 'ok' as const }
                    : { label: t('status.outOfFormulary'), tone: 'neutral' as const };
                  return (
                    <tr
                      key={p.id}
                      className="group hover:bg-[var(--surface-2)]/50 transition-colors duration-100"
                    >
                      <td className="px-3 py-3">
                        <div className="font-mono text-[13px] leading-tight text-[var(--text)] font-semibold truncate">
                          {displayName(p)}
                        </div>
                        <div className="text-[12px] leading-normal text-[var(--text-muted)] truncate">
                          {p.generic_name_en ?? p.generic_name_ar ?? ''}
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap font-mono text-[11px] text-[var(--text-muted)]">
                        <Ltr>{p.sku}</Ltr>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className="inline-block px-2 py-0.5 rounded text-[10px] font-mono tracking-wider uppercase bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border)]/20"
                        >
                          {p.form}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap font-mono text-[11px] text-[var(--text)]">
                        {p.strength} {p.strength_unit ?? ''}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {isCold ? (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono text-[var(--primary)] border border-[var(--primary)]/30 bg-[var(--primary)]/10"
                          >
                            <span className="w-3 h-3 text-[var(--primary)]" /> {t('coldChain')}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-[10px] text-[var(--text-muted)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-2 px-2 py-0.5 rounded-full text-[10px] font-mono ${
                            status.tone === 'ok'
                              ? 'bg-[var(--color-stock-ok)]/15 text-[var(--color-stock-ok)] border border-[var(--color-stock-ok)]/30'
                              : 'bg-[var(--color-stock-critical)]/15 text-[var(--color-stock-critical)] border border-[var(--color-stock-critical)]/30'
                          }`}
                        >
                          <span
                            className="w-1 h-1 rounded-full"
                            style={{ backgroundColor: status.tone === 'ok' ? 'var(--color-stock-ok)' : 'var(--color-stock-critical)' }}
                          />
                          {status.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Link
                          href={`/admin/inventory/products?edit=${p.id}`}
                          className="opacity-0 group-hover:opacity-100 px-3 py-1 rounded bg-[var(--surface-2)] hover:bg-[var(--primary)] hover:text-[var(--primary-foreground)] text-[var(--text)] text-[11px] font-mono transition-all duration-150 border border-[var(--border)]/30"
                          aria-label={`${t('action.edit')} ${displayName(p)}`}
                        >
                          {t('edit')}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
                {products.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-[var(--text-muted)]">
                      {t('empty')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── FOOTER / PAGINATION BAND ── */}
          <div className="mt-auto border-t border-[var(--border)]/20 bg-[var(--surface)] px-4 py-2 flex flex-col sm:flex-row items-center justify-between gap-2">
            <div className="text-[11px] font-mono text-[var(--text-muted)]">
              {t('showing', { count: products.length, total: products.length })} {t('activeProducts')}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 text-[11px] font-mono text-[var(--text-muted)]">
                <span>{t('rows')}</span>
                <select
                  defaultValue="50"
                  className="h-7 px-2 bg-[var(--surface-2)] border border-[var(--border)] rounded text-[11px] font-mono text-[var(--text)] focus:ring-0 focus:border-[var(--primary)]"
                >
                  <option value="50">{t('rows50')}</option>
                  <option value="100">{t('rows100')}</option>
                  <option value="250">{t('rows250')}</option>
                </select>
              </div>
              <div className="h-4 w-[1px] bg-[var(--border)]" />
              <div className="flex items-center gap-1 text-[11px] font-mono text-[var(--text-muted)]">
                <span className="px-2">{t('page', { current: 1, total: 1 })}</span>
                <button
                  disabled
                  className="w-7 h-7 rounded flex items-center justify-center bg-[var(--surface-2)] border border-[var(--border)]/20 text-[var(--text-muted)]/40 cursor-not-allowed"
                >
                  <span className="w-3 h-3" />
                </button>
                <button
                  disabled
                  className="w-7 h-7 rounded flex items-center justify-center bg-[var(--surface-2)] border border-[var(--border)]/20 text-[var(--text-muted)]/40 cursor-not-allowed"
                >
                  <span className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Ltr({ children, className }: { children: React.ReactNode; className?: string }) {
  return <bdi dir="ltr" className={className}>{children}</bdi>;
}
