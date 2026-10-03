'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import type { Locale } from '@/i18n/routing';
import type { ApiResult } from '@/lib/api/result';
import { acknowledgeAlertAction, resolveAlertAction } from './actions';

/**
 * The alert list, with its two buttons.
 *
 * ── why this is a client component at all ──────────────────────────────────────
 *
 * Two buttons. The alternative is a form per row that posts and revalidates, which is
 * more markup and a full page transition to say "I have seen this".
 *
 * ── the optimistic behaviour is deliberately absent ─────────────────────────────
 *
 * Acknowledging should feel instant, and the tempting move is to grey the row out the
 * moment it is clicked. That would be a lie whenever the database refuses -- and the
 * database does refuse, for a role that cannot acknowledge and for an alert somebody
 * else already resolved a second earlier. A row that dims and then comes back is worse
 * than one that waits a moment, because the user has to work out whether their click
 * registered. So the row shows a pending state and waits for the answer.
 */

export interface AlertRow {
  id: string;
  type: string;
  severity: string;
  status: string;
  entityType: string;
  entityId: string | null;
  message: string;
  data: Record<string, unknown>;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

const SEVERITY_STYLE: Record<string, string> = {
  CRITICAL: 'border-red-500/50 bg-red-500/5',
  WARN: 'border-amber-500/40 bg-amber-500/5',
  INFO: 'border-[color:var(--border)]/60',
};

const SEVERITY_DOT: Record<string, string> = {
  CRITICAL: 'bg-red-500',
  WARN: 'bg-amber-500',
  INFO: 'bg-[color:var(--text-muted)]',
};

export function AlertList({
  locale,
  alerts,
  canAct,
  now,
}: {
  locale: Locale;
  alerts: AlertRow[];
  canAct: boolean;
  now: Date;
}) {
  const t = useTranslations('alerts');

  // The container is rendered whether or not there is anything in it, and carries the
  // test id in both cases. It used to be on the <ul> alone, which meant the empty state
  // -- the state this page spends most of its life in -- had no handle on it, and the
  // tests could only assert on the page when something had gone wrong.
  if (alerts.length === 0) {
    return (
      <div className="pf-glass rounded-2xl p-8 text-center" data-testid="alert-list">
        <p className="text-sm font-medium">{t('allClear')}</p>
        <p className="mt-1 text-sm text-[color:var(--text-muted)]">{t('allClearHint')}</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2" data-testid="alert-list">
      {alerts.map((alert) => (
        <AlertItem
          key={alert.id}
          alert={alert}
          locale={locale}
          canAct={canAct}
            now={now}
        />
      ))}
    </ul>
  );
}

function AlertItem({
  alert,
  locale,
  canAct,
  now,
}: {
  alert: AlertRow;
  locale: Locale;
  canAct: boolean;
  now: Date;
}) {
  const t = useTranslations('alerts');
  const [ackState, ackAction, ackPending] = useActionState<ApiResult<null>, FormData>(
    acknowledgeAlertAction,
    { ok: true, data: null },
  );
  const [resolveState, resolveAction, resolvePending] = useActionState<ApiResult<null>, FormData>(
    resolveAlertAction,
    { ok: true, data: null },
  );

  const busy = ackPending || resolvePending;
  const failure = !ackState.ok ? ackState.error.message : !resolveState.ok ? resolveState.error.message : null;

  // Localised here rather than in the action because these read facts about the row,
  // not about a failure: "first seen 3 days ago" is the same sentence in both
  // languages and does not belong in the error namespace.
  const firstSeen = relative(alert.firstSeenAt, now, locale);
  const lastSeen = relative(alert.lastSeenAt, now, locale);

  return (
    <li
      className={`pf-glass rounded-2xl border p-4 ${SEVERITY_STYLE[alert.severity] ?? SEVERITY_STYLE.INFO}`}
      data-testid={`alert-${alert.severity.toLowerCase()}`}
      data-severity={alert.severity}
    >
      <div className="flex items-start gap-3">
        {/* The dot is not decoration: it is the severity, readable without reading. */}
        <span
          className={`mt-1.5 size-2.5 shrink-0 rounded-full ${SEVERITY_DOT[alert.severity] ?? SEVERITY_DOT.INFO}`}
          aria-hidden
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
              {t(`type.${alert.type}`)}
            </span>
            {alert.occurrences > 1 && (
              <span
                className="text-xs text-[color:var(--text-muted)]"
                title={t('lastSeen', { when: lastSeen })}
              >
                {t('seenTimes', { n: alert.occurrences })}
              </span>
            )}
            {alert.status === 'ACK' && (
              <span className="pf-pill !py-0.5 !text-[0.6875rem]">{t('acknowledged')}</span>
            )}
          </div>

          <p className="mt-1 text-sm">{alert.message}</p>

          <p className="mt-1 text-xs text-[color:var(--text-muted)]">
            {t('firstSeen', { when: firstSeen })}
          </p>

          {typeof alert.data.note === 'string' && alert.data.note.length > 0 && (
            <p className="mt-1 text-xs italic text-[color:var(--text-muted)]">
              {t('note', { note: alert.data.note })}
            </p>
          )}

          {failure && (
            <p
              role="alert"
              data-testid="alert-error"
              className="mt-2 text-xs font-medium text-red-600 dark:text-red-400"
            >
              {failure}
            </p>
          )}

          {canAct && (
            <div className="mt-3 flex flex-wrap gap-2">
              {alert.status === 'OPEN' && (
                <form action={ackAction} data-testid={`ack-${alert.id}`}>
                  <input type="hidden" name="alertId" value={alert.id} />
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="note" value="" />
                  <button
                    type="submit"
                    disabled={busy}
                    className="pf-pill border border-[color:var(--border)] disabled:opacity-50"
                  >
                    {ackPending ? t('working') : t('acknowledge')}
                  </button>
                </form>
              )}

              <form action={resolveAction} data-testid={`resolve-${alert.id}`}>
                <input type="hidden" name="alertId" value={alert.id} />
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="note" value="" />
                <button
                  type="submit"
                  disabled={busy}
                  className="pf-pill border border-[color:var(--border)] disabled:opacity-50"
                >
                  {resolvePending ? t('working') : t('resolve')}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * A short relative time, in the active locale.
 *
 * `Intl.RelativeTimeFormat` rather than a hand-rolled "3 days ago", because the
 * Arabic form is not the English form with words swapped -- it is a different
 * grammatical shape, and this is exactly the sort of string that gets hardcoded.
 */
function relative(iso: string, now: Date, locale: Locale): string {
  const then = new Date(iso).getTime();
  const seconds = Math.round((then - now.getTime()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    numeric: 'auto',
  });

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['week', 60 * 60 * 24 * 7],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
  ];

  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }

  return formatter.format(seconds, 'second');
}