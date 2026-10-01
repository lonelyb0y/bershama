import { useTranslations } from 'next-intl';

import { Skeleton, SkeletonCard, SkeletonText } from '@/components/ui/skeleton';

/**
 * Loading placeholder for /admin.
 *
 * Mirrors the real layout on purpose -- the dashboard's stat row, hero panel and ranked column -- because a placeholder of the
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      <div className="pf-split">
        <div className="pf-hero p-5">
          <SkeletonText size="sm" width="35%" className="opacity-70" />
          <SkeletonText size="xl" width="45%" className="mt-4 opacity-90" />
          {/* The chart's own footprint, so the hero panel does not resize when it draws. */}
          <Skeleton className="mt-4 h-48 w-full opacity-40" />
        </div>
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </div>
  );
}
