import { useTranslations } from 'next-intl';

import { SkeletonCard } from '@/components/ui/skeleton';

/**
 * Loading placeholder for /admin/inventory.
 *
 * Mirrors the real layout on purpose -- the index page's card grid -- because a placeholder of the
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}
