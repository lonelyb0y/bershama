import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getSession } from '@/lib/session';
import { timeAgo } from '@/lib/format';
import { asRows, toAuditLogEntry, type AuditLogRow } from '@/lib/mappers';
import { getSupabase } from '@/lib/supabase/server';
import { describeAction, labelEntities, translateEntityType } from '@/lib/audit-labels';
import type { Locale } from '@/i18n/routing';

export default async function AdminDashboard({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('m0');
  const tNav = await getTranslations('nav');
  const tRoles = await getTranslations();
  const tAudit = await getTranslations('auth');
  const session = await getSession();

  // Reading the audit trail here is the point of the milestone: it proves RLS is
  // working end to end, because a broken policy would either show another
  // tenant's rows or show nothing at all.
  const supabase = await getSupabase();
  const { data } = await supabase
    .from('audit_logs')
    .select('id, actor_user_id, actor_label, actor_role, action, entity_type, entity_id, occurred_at')
    .order('occurred_at', { ascending: false })
    .limit(5);

  const entries = asRows<AuditLogRow>(data).map(toAuditLogEntry);
  // Names for whatever these rows point at, in one query per entity type.
  // Without it every row read "facilities · 11111111", which is neither a name
  // nor a usable identifier.
  const entityLabels = await labelEntities(entries, locale);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {tNav('dashboard')}
        </h1>
        <p className="text-[color:var(--text-muted)] mt-1 text-sm">
          {tAudit('welcome', {
            // The Arabic name on the Arabic page. whoami has returned full_name_ar
            // since migration 0015, and the greeting ignored it, so a person's
            // name was spelled in Latin script on an Arabic screen.
            name:
              locale === 'ar'
                ? (session?.fullNameAr ?? session?.fullName ?? '')
                : (session?.fullName ?? ''),
          })}
        </p>
      </header>

      <section
        aria-labelledby="status-heading"
        className="rounded-xl border p-5"
      >
        <h2 id="status-heading" className="text-sm font-semibold tracking-wide uppercase">
          {t('status')}
        </h2>

        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-[color:var(--text-muted)] text-sm">{t('tenant')}</dt>
            <dd className="mt-0.5 font-medium">{session?.tenantSlug ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[color:var(--text-muted)] text-sm">{t('role')}</dt>
            <dd className="mt-0.5 font-medium">
              {/* Translated through the roles namespace, so the label is
                  "Warehouse manager" rather than a raw enum value. */}
              {session ? tRoles(`roles.${session.role}`) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[color:var(--text-muted)] text-sm">
              {t('currency')}
            </dt>
            <dd className="mt-0.5 font-medium tabular">
              {session?.currencyCode ?? '—'}
            </dd>
          </div>
        </dl>

        <p className="text-[color:var(--text-muted)] mt-4 text-sm">
          {t('roadmapNote')}
        </p>
      </section>

      <section aria-labelledby="audit-heading" className="rounded-xl border p-5">
        <h2 id="audit-heading" className="text-sm font-semibold tracking-wide uppercase">
          {tNav('audit')}
        </h2>

        {entries.length === 0 ? (
          <p className="text-[color:var(--text-muted)] mt-3 text-sm">
            No entries yet. The audit trail fills as soon as something changes.
          </p>
        ) : (
          <ul className="mt-3 divide-y">
            {entries.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
                  {/*
                    "facilities.insert" is a database detail, not a sentence. It
                    is rendered as a verb plus a translated noun, because an audit
                    log is read by someone asking "who changed what" -- and
                    `facilities.insert` answers neither half of that question.
                    Anything the tables do not cover falls back to the raw action,
                    which is still better than showing nothing.
                  */}
                  <span className="text-xs">
                    {describeAction(entry.action, t, locale)}
                  </span>
                  <span className="text-[color:var(--text-muted)]">
                    {translateEntityType(entry.entityType, t, locale)}
                    {entry.entityId
                      ? ` · ${
                          // The short id is a fallback, not the normal case: it
                          // appears only when the row has been deleted or its
                          // type is not one the resolver knows, which are exactly
                          // the cases where an identifier is all there is to show.
                          entityLabels.get(`${entry.entityType}:${entry.entityId}`) ??
                          entry.entityId.slice(0, 8)
                        }`
                      : ''}
                </span>
                <span className="ms-auto text-[color:var(--text-muted)] text-xs">
                  {entry.actorLabel ?? t('systemActor')} · {timeAgo(entry.occurredAt, new Date(), locale)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[color:var(--text-muted)] mt-4 text-xs">
            {t('auditFootnote')}
          </p>
      </section>
    </div>
  );
}
