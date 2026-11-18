import type { ReactNode } from 'react'

/** Text only screen readers see (the mockup's `.sr` class). */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>
}
