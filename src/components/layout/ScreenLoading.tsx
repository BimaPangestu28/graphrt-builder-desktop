import { Spinner, VisuallyHidden, joinClassNames } from '@/components/ui'
import { useT } from '@/i18n'

/**
 * What shows while a lazily loaded screen or panel downloads its code: the app's
 * spinner, centred, on the page background. From the app's own files this takes a
 * few milliseconds, so it stays quiet: no text on screen, only for screen readers.
 *
 * @param label - What is loading, read by screen readers (string, default "Loading")
 * @param className - Extra classes, e.g. to fill a panel instead of the window (string, optional)
 *
 * @example
 * <Suspense fallback={<ScreenLoading />}><RunsPage /></Suspense>
 */
export function ScreenLoading({ label, className }: { label?: string; className?: string }) {
  const t = useT()
  return (
    <div role="status" className={joinClassNames('flex min-h-screen flex-1 items-center justify-center bg-canvas', className)}>
      <Spinner />
      <VisuallyHidden>{label ?? t.common.loading}</VisuallyHidden>
    </div>
  )
}
