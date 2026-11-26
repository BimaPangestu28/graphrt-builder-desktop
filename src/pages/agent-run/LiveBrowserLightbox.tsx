import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { StrokeIcon } from '@/components/ui'
import { keepTabFocusInside, useFocusOnOpenAndRestore } from '@/pages/onboarding/useDialogFocusTrap'
import { messages } from '@/i18n'

interface LiveBrowserLightboxProps {
  /** The live frame, still updating while the dialog is open. */
  src: string
  aspectRatio: number
  onClose: () => void
}

/**
 * The live browser view enlarged in a modal dialog (rendered into `document.body`). Escape,
 * the close button or a click outside the picture closes it; focus moves to the close button and back afterwards.
 */
export function LiveBrowserLightbox({ src, aspectRatio, onClose }: LiveBrowserLightboxProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  useFocusOnOpenAndRestore(closeButtonRef)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (dialogRef.current) keepTabFocusInside(event, dialogRef.current)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-50 box-border flex items-center justify-center bg-[rgba(24,24,27,0.7)] p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-full flex-col gap-3 rounded-[16px] bg-surface p-4 shadow-[0_24px_64px_rgba(0,0,0,0.3)]"
        // As wide as fits without the picture overflowing the window's height.
        style={{ maxWidth: `min(1280px, calc((100vh - 120px) * ${aspectRatio}))` }}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="m-0 text-[14px] font-semibold text-ink">
            {messages().agentRun.liveViewOfTheBrowser}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label={messages().agentRun.closeTheEnlargedView}
            onClick={onClose}
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-muted hover:bg-subtle focus-visible:outline-2 focus-visible:outline-brand"
          >
            <StrokeIcon size={16}>
              <path d="M7 7l10 10M17 7 7 17" />
            </StrokeIcon>
          </button>
        </div>
        <div className="overflow-hidden rounded-lg border border-line bg-subtle" style={{ aspectRatio: String(aspectRatio) }}>
          <img src={src} alt={messages().agentRun.whatTheBrowserShowsRightNow} className="block size-full object-contain" />
        </div>
      </div>
    </div>,
    document.body,
  )
}
