'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import type { Locale } from '@/i18n/routing';
import type { ApiResult } from '@/lib/api/result';
import { runAlertScanAction } from './actions';

/**
 * "Run the scan now".
 *
 * ── why the button exists at all ───────────────────────────────────────────────
 *
 * The scan is a function a scheduler would call nightly. There is no scheduler in
 * this project, so without a button the alerts would appear only when something else
 * happened to invoke it -- which means the first person to look at an empty alert
 * centre would have no way to tell "nothing is wrong" from "nothing has ever run".
 *
 * That distinction is the whole value of the page. An empty list has to be
 * trustworthy, and the cheapest way to make it so is to let somebody press the thing
 * and watch it raise nothing.
 *
 * ── it is idempotent, so this is safe to press twice ────────────────────────────
 *
 * `api.run_alert_scan()` conflicts on a partial unique index over open alerts, so a
 * second press bumps `occurrences` rather than duplicating anything. That is a
 * database guarantee, not a UI one, which is the only place this kind of thing
 * belongs.
 */
export function AlertScanButton({ locale }: { locale: Locale }) {
  const t = useTranslations('alerts');
  // The first argument of useActionState is the previous state, which nothing here
  // reads; the buttons render their own pending state. Named  rather than
  // dropped, because the hook needs it.
  const [state, action, pending] = useActionState<ApiResult<null>, FormData>(
    runAlertScanAction,
    { ok: true, data: null },
  );

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="locale" value={locale} />
      <button
        type="submit"
        disabled={pending}
        data-testid="run-alert-scan"
        className="pf-pill border border-[color:var(--border)] disabled:opacity-50"
      >
        {pending ? t('scanning') : t('runScan')}
      </button>

      {state.ok && state.data === null && !pending && (
        // A success line, because "I pressed it and nothing appeared" is the outcome
        // most likely to look like a broken button.
        <p className="text-xs text-[color:var(--text-muted)]">{t('scanDone')}</p>
      )}
      {!state.ok && (
        // A test id rather than only `role="alert"`: Next.js ships its own
        // visually-hidden `__next-route-announcer__` with that role, so a bare
        // role query matches the framework's element and reports an error that is not
        // there. Naming ours is the difference between asserting on this component and
        // asserting on the router.
        <p
          role="alert"
          data-testid="scan-error"
          className="text-xs font-medium text-red-600 dark:text-red-400"
        >
          {state.error.message}
        </p>
      )}
    </form>
  );
}