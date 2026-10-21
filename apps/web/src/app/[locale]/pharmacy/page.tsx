import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';

import { getSession } from '@/lib/session';
import { getSupabase } from '@/lib/supabase/server';
import { timeAgo } from '@/lib/format';
import { RequisitionQueue } from '@/components/inventory/requisition-queue';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import type { Locale } from '@/i18n/routing';

/**
 * The pharmacy manager's dashboard.
 *
 * ── what it used to be ──────────────────────────────────────────────────────────
 *
 * A card that said the work was "coming in a later milestone", with a paragraph of
 * English hard-coded into the JSX. On the Arabic page that paragraph was English,
 * because it was never a translation at all — it was a sentence somebody typed.
 *
 * That is the kind of thing a linter for missing keys cannot find, and it is the
 * kind of thing a person on the Arabic side finds immediately.
 *
 * ── what it is now ──────────────────────────────────────────────────────────────
 *
 * The pharmacy manager's own requisitions, and where each one has got to. That is
 * the whole job: raise a request, and know whether it has been allocated. A
 * distributor's decision is not theirs to make, so there is no "needs a decision"
 * filter here — only their own requests and their state.
 */
export default async function PharmacyDashboard({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('pharmacy');
  const tNav = await getTranslations('nav');
  const session = await getSession();
  if (!session) return null;

  const supabase = await getSupabase();

  // A read, so it goes through RLS on the table: a pharmacy manager sees their own
  // requisitions and nobody else's, because the policy says so rather than because
  // this query filters.
  const { data } = await supabase
    .from('requisitions')
    .select('id, code, status, justification, requested_at, decided_at')
    .eq('requested_by', session.userId)
    .order('requested_at', { ascending: false })
    .limit(50);

  const rows = (data ?? []) as Array<{
    id: string;
    code: string;
    status: string;
    justification: string | null;
    requested_at: string;
    decided_at: string | null;
  }>;

  // Whether the request got stock, in the pharmacy's terms rather than the
  // distributor's: "allocated" and "refused" are decisions, "waiting" is a state.
  const waiting = rows.filter((r) => r.status === 'SUBMITTED' || r.status === 'DRAFT').length;
  const allocated = rows.filter((r) => r.status === 'ALLOCATED').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={tNav('dashboard')}
        description={t('subtitle', { name: session.fullName, count: rows.length })}
      />

      {rows.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          body={t('emptyBody')}
          action={
            <Link
              href="/pharmacy"
              className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-[color:var(--text-muted)]/10"
            >
              {t('browseCatalogue')}
            </Link>
          }
        />
      ) : (
        <RequisitionQueue
          locale={locale}
          showFilters={false}
          rows={rows.map((r) => ({
            id: r.id,
            code: r.code,
            facility: t('yourFacility'),
            status: r.status,
            statusLabel: t(`status.${r.status}`),
            requestedAgo: timeAgo(r.requested_at, new Date(), locale),
            justification: r.justification,
            // A pharmacy manager does not make the decision, so nothing here is
            // "waiting for a decision" -- it is waiting for the distributor.
            needsDecision: false,
          }))}
          labels={{
            code: t('column.code'),
            facility: t('column.raisedBy'),
            status: t('column.status'),
            requested: t('column.requested'),
            justification: t('column.justification'),
            needsAction: t('filter.all'),
            canWait: t('filter.all'),
            all: t('filter.all'),
            searchPlaceholder: t('searchPlaceholder'),
            searchLabel: t('searchLabel'),
            emptyNeedsAction: t('emptyTitle'),
            emptyNeedsActionBody: t('emptyBody'),
            emptyAll: t('emptyTitle'),
            emptyAllBody: t('emptyBody'),
            caption: t('caption'),
            needsActionTitle: t('filter.all'),
            canWaitTitle: t('filter.all'),
          }}
        />
      )}

      {rows.length > 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">
          {t('summary', { waiting, allocated })}
        </p>
      ) : null}
    </div>
  );
}
