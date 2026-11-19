import { useState } from 'react'
import { RestartControls } from './RestartControls'
import type { AppUpdateControls } from './updateContext'

/**
 * Small toast in the bottom-right corner once an update is downloaded: "graphrt X is
 * ready" with Restart and Later. It never blocks the screen, and Later hides it for that
 * version (Settings > Updates still offers the restart).
 */
export function UpdateReadyBanner({ updateControls }: { updateControls: AppUpdateControls }) {
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)
  const { status } = updateControls
  if (status.kind !== 'ready' || dismissedVersion === status.update.version) return null
  return (
    <section
      aria-label="Update ready"
      className="fixed right-4 bottom-4 z-40 box-border flex w-[min(360px,calc(100vw-32px))] flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-4 text-[14px] text-ink shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
    >
      <p className="m-0 font-semibold">graphrt {status.update.version} is ready</p>
      <RestartControls updateControls={updateControls} onLater={() => setDismissedVersion(status.update.version)} />
    </section>
  )
}
