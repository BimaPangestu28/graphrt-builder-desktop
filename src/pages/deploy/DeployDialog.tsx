import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Icon } from '@/components/ui'
import { keepTabFocusInside, useFocusOnOpenAndRestore } from '@/pages/onboarding/useDialogFocusTrap'

interface DeployDialogProps {
  title: string
  /** Shown left of the title, e.g. a provider logo. */
  leading?: ReactNode
  onClose: () => void
  children: ReactNode
  /** Buttons at the bottom right. */
  footer?: ReactNode
}

/**
 * A modal popup for the Connect flows: focus moves in on open and back on close, Tab stays
 * inside, Escape and the close button call `onClose`.
 */
export function DeployDialog({ title, leading, onClose, children, footer }: DeployDialogProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  useFocusOnOpenAndRestore(closeButtonRef)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
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

  return (
    <div className="fixed inset-0 z-50 box-border flex items-center justify-center overflow-y-auto bg-[rgba(24,24,27,0.45)] p-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="box-border flex max-h-full w-full max-w-[560px] flex-col gap-5 overflow-y-auto rounded-[20px] bg-surface p-6 text-[14px] text-ink shadow-[0_24px_64px_rgba(0,0,0,0.18)]"
      >
        <div className="flex items-center gap-3">
          {leading}
          <h2 id={titleId} className="m-0 flex-1 text-[19px] font-semibold tracking-[-0.2px]">
            {title}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-muted hover:bg-chip hover:text-ink"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        {children}
        {footer && <div className="flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}

/** Numbered guide steps inside a Connect dialog. */
export function GuideSteps({ steps }: { steps: ReactNode[] }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-2 p-0">
      {steps.map((step, index) => (
        <li key={index} className="flex items-start gap-2.5 leading-normal text-body">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[12px] font-semibold text-brand-strong">{index + 1}</span>
          <span className="pt-0.5">{step}</span>
        </li>
      ))}
    </ol>
  )
}

/** "Advanced (for developers)": closed by default, technical words only inside. */
export function DevelopersDetails({ children, summary = 'Advanced (for developers)' }: { children: ReactNode; summary?: string }) {
  return (
    <details className="rounded-xl border border-line bg-surface px-4 py-3 text-[13px] text-body">
      <summary className="cursor-pointer font-medium text-ink-2">{summary}</summary>
      <div className="mt-2 flex flex-col gap-2 leading-normal">{children}</div>
    </details>
  )
}
