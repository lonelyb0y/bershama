'use client';

import { DataTable, type Column } from '@/components/ui/data-table';
import { Badge, Ltr } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Link } from '@/i18n/routing';
import type { Product } from '@/lib/types';

/**
 * The catalogue table.
 *
 * ── why this is a separate client component ─────────────────────────────────────
 *
 * A column is a render function, and a render function cannot be passed from a server
 * component to a client one. The first version of this table was written straight into
 * the server-rendered page, and the page died at runtime with "This page couldn't
 * load" -- on every visit, in production, with a green build and a passing test suite.
 *
 * So the table lives here, in the client, and the page hands it plain data and plain
 * labels. The batches table was already shaped this way, which is why it worked; the
 * catalogue was the one that had not been converted.
 *
 * The rows are still rendered on the server. This is a client component because it has
 * to be, not because it fetches anything.
 *
 * ── what crosses the boundary ────────────────────────────────────────────────────
 *
 * A server action, and nothing else. Server actions are references and can be handed
 * to a client component; a plain function cannot, and passing one is what broke the
 * page. So the deactivate action arrives as a prop, the edit link is built here from
 * the row's own id, and the locale is the one the page already resolved.
 */
export interface ProductTableLabels {
  columnProduct: string;
  columnSku: string;
  columnForm: string;
  columnPack: string;
  columnFlags: string;
  edit: string;
  deactivate: string;
  reactivate: string;
  actionEdit: string;
  actionDeactivate: string;
  actionReactivate: string;
  rx: string;
  controlled: string;
  cold: string;
  inactive: string;
  empty: string;
  emptyBody: string;
  caption: string;
}

export function ProductTable({
  rows,
  labels: l,
  locale,
  canWrite,
  setActiveAction,
}: {
  rows: Product[];
  labels: ProductTableLabels;
  locale: 'en' | 'ar';
  canWrite: boolean;
  /** The server action that flips a product's active flag. */
  setActiveAction: (formData: FormData) => void;
}) {
  const displayName = (p: Product) => (locale === 'ar' ? p.nameAr : p.nameEn);

  /**
   * Five columns, not twelve.
   *
   * A catalogue manager is looking for a product by name or SKU, and then checking two
   * things about it: whether it is prescription-only, and whether it is active. The ATC
   * code, the GTIN and the EDAN registration are real facts about the product, and
   * they are also three more columns of noise on a screen whose job is to be scanned.
   * They live in the edit form, which is where somebody asks for them.
   */
  const columns: Column<Product>[] = [
    {
      key: 'name',
      header: l.columnProduct,
      primary: true,
      render: (p) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{displayName(p)}</div>
          {/* The other language stays visible on purpose. A catalogue manager needs to
              know the record is not missing its Arabic or English name. */}
          <div className="truncate text-xs text-[color:var(--text-muted)]">
            {locale === 'ar' ? p.nameEn : p.nameAr}
          </div>
        </div>
      ),
    },
    {
      key: 'sku',
      header: l.columnSku,
      mobileLabel: l.columnSku,
      // whitespace-nowrap: a SKU is an atomic identifier. Wrapped across two lines
      // it is un-typeable into a search box, and it is the one string on this
      // screen somebody copies.
      className: 'whitespace-nowrap font-mono text-xs',
      render: (p) => <Ltr>{p.sku}</Ltr>,
    },
    {
      key: 'strength',
      header: l.columnForm,
      mobileLabel: l.columnForm,
      render: (p) => `${p.strength} ${p.strengthUnit ?? ''}`.trim(),
    },
    {
      key: 'pack',
      header: l.columnPack,
      mobileLabel: l.columnPack,
      numeric: true,
      secondary: true,
      render: (p) => `${p.packSize} ${p.uom}`,
    },
    {
      key: 'flags',
      header: l.columnFlags,
      mobileLabel: l.columnFlags,
      render: (p) => (
        <div className="flex flex-wrap gap-1">
          {p.requiresPrescription ? <Badge tone="info">{l.rx}</Badge> : null}
          {p.isControlled ? <Badge tone="warn">{l.controlled}</Badge> : null}
          {p.isColdChain ? <Badge tone="info">{l.cold}</Badge> : null}
          {!p.isActive ? <Badge tone="neutral">{l.inactive}</Badge> : null}
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      caption={l.caption}
      rowKey={(p) => p.id}
      rowLabel={(p) => displayName(p)}
      rowTestId="product-row"
      empty={<EmptyState title={l.empty} body={l.emptyBody} />}
      renderActions={
        canWrite
          ? (p) => (
              <>
                <Link
                  href={`/admin/inventory/products?edit=${p.id}`}
                  // Prefetching off. Each of these links to *this* page with a
                  // different product's edit form attached, so the default viewport
                  // prefetch fired one RSC request per row -- each re-running the
                  // catalogue query to prove an edit form exists. The largest single
                  // source of requests on this surface.
                  prefetch={false}
                  // The product's name is in the accessible name. Ten links all called
                  // "Edit" is ten identical announcements, and a screen reader user
                  // has no way to tell which product any of them belongs to.
                  aria-label={l.actionEdit.replace('{name}', displayName(p))}
                  className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-[color:var(--text-muted)]/10"
                >
                  {l.edit}
                </Link>
                {/* Named, so the landmark list says which product each form
                    belongs to instead of listing "form" five times. */}
                <form
                  action={setActiveAction}
                  aria-label={(p.isActive ? l.actionDeactivate : l.actionReactivate).replace(
                    '{name}',
                    displayName(p),
                  )}
                >
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="active" value={String(!p.isActive)} />
                  <button
                    type="submit"
                    aria-label={(p.isActive ? l.actionDeactivate : l.actionReactivate).replace(
                      '{name}',
                      displayName(p),
                    )}
                    className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-[color:var(--text-muted)]/10"
                  >
                    {p.isActive ? l.deactivate : l.reactivate}
                  </button>
                </form>
              </>
            )
          : undefined
      }
    />
  );
}
