import { useTranslations } from 'next-intl';

import { SkeletonRow } from '@/components/ui/skeleton';

/**
 * Loading placeholder for /admin/inventory/batches.
 *
 * Mirrors the real layout on purpose -- a batch table -- because a placeholder of the
 * wrong height makes the page jump the moment the data lands, and that jump is worse
 * than the wait it was covering.
 *
 * The status line is not decoration. A skeleton with no text is a silent blank
 * region to a screen reader, which is worse than no skeleton at all: `aria-busy`
 * marks the region as busy, and this line says what is happening inside it.
 */
export default function Loading() {
  const t = useTranslations('dashboard');

  return (
    <div className="space-y-5" aria-busy="true">
      <p className="pf-section-title">{t('loading')}</p>

      <div className="pf-glass rounded-2xl p-5">
          {Array.from({ length: 8 }, (_, i) => (
            <SkeletonRow key={i} columns={5} />
          ))}
      </div>
    </div>
  );
}
