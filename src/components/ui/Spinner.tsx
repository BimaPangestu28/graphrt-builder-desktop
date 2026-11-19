import { joinClassNames } from './cn'

/**
 * A 20px ring that spins while something is in progress (a running step, a build item).
 * With reduced motion it stays still: the open ring alone still reads as "in progress".
 * Decorative only: say the state in text next to it (e.g. a VisuallyHidden "Running").
 *
 * @param className - Extra classes, e.g. a flex sizing override (string, optional)
 *
 * @example
 * <Spinner />
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-spinner=""
      className={joinClassNames(
        'box-border size-5 shrink-0 rounded-full border-2 border-brand border-r-brand-line motion-safe:animate-spin',
        className,
      )}
    />
  )
}
