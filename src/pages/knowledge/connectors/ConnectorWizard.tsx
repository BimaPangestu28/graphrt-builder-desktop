import { useEffect, useId, useRef, useState } from 'react'
import { addConnectorSource } from '@/api/knowledgeConnectors'
import type { ConnectorKind, KnowledgeSource } from '@/api/knowledgeTypes'
import { Icon, joinClassNames } from '@/components/ui'
import { keepTabFocusInside, useFocusOnOpenAndRestore } from '@/pages/onboarding/useDialogFocusTrap'
import { toError } from '@/lib/errors'
import { useT } from '@/i18n'
import { compactButtonClassNames } from '../FormControls'
import { SourceTypeTile } from '../SourceTypeTile'
import { ConnectorFields, ScheduleFields } from './ConnectorFields'
import { connectorKinds, connectorLabel, connectorTileType, scheduleText } from './connectorDisplay'
import { emptyDraft, scheduleOf, settingsProblem, toNewSource, type ConnectorDraft } from './connectorDraft'

type Step = 'choose' | 'settings' | 'schedule'

/** Wide cards, two or three per row, one per connector type. */
export function ConnectorKindGrid({ selected, onSelect }: { selected?: ConnectorKind; onSelect: (kind: ConnectorKind) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {connectorKinds.map((kind) => {
        const { title, hint } = connectorLabel(kind)
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onSelect(kind)}
            aria-pressed={selected === kind}
            className={joinClassNames(
              'flex cursor-pointer items-start gap-3 rounded-[14px] border bg-surface p-3.5 text-left hover:border-line-heavy',
              selected === kind ? 'border-brand ring-2 ring-brand-soft' : 'border-line',
            )}
          >
            <SourceTypeTile type={connectorTileType(kind)} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[14px] font-semibold text-ink">{title}</span>
              <span className="text-[12px] leading-snug text-muted">{hint}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

interface ConnectorWizardProps {
  knowledgeBaseId: string
  /** Start on the settings step of this type (chosen on the page already). */
  initialKind?: ConnectorKind
  onClose: () => void
  onAdded: (source: KnowledgeSource) => void
}

/**
 * "Connect a source": choose the type, fill in its settings (and sign in), pick
 * a schedule. Adding starts the first sync in the background.
 */
export function ConnectorWizard({ knowledgeBaseId, initialKind, onClose, onAdded }: ConnectorWizardProps) {
  const t = useT().knowledgeConnectors
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  useFocusOnOpenAndRestore(closeButtonRef)
  const [step, setStep] = useState<Step>(initialKind ? 'settings' : 'choose')
  const [draft, setDraft] = useState<ConnectorDraft>(() => emptyDraft(initialKind ?? 'website'))
  const [problem, setProblem] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)

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

  const update = (change: (current: ConnectorDraft) => ConnectorDraft) => {
    setProblem(null)
    setDraft(change)
  }
  const goToSchedule = () => {
    const found = settingsProblem(draft)
    if (found) {
      setProblem(found)
      return
    }
    setStep('schedule')
  }
  const add = async () => {
    setProblem(null)
    setIsAdding(true)
    try {
      const source = await addConnectorSource(knowledgeBaseId, toNewSource(draft))
      onAdded(source)
      onClose()
    } catch (addError) {
      setProblem(toError(addError).message)
    } finally {
      setIsAdding(false)
    }
  }
  const steps: { id: Step; label: string }[] = [
    { id: 'choose', label: t.stepChoose },
    { id: 'settings', label: t.stepSettings },
    { id: 'schedule', label: t.stepSchedule },
  ]
  const stepIndex = steps.findIndex((candidate) => candidate.id === step)
  const { title: kindTitle } = connectorLabel(draft.kind)

  return (
    <div className="fixed inset-0 z-50 box-border flex items-center justify-center overflow-y-auto bg-[rgba(24,24,27,0.45)] p-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="box-border flex max-h-full w-full max-w-[760px] flex-col gap-5 overflow-y-auto rounded-[20px] bg-surface p-6 text-[14px] text-ink shadow-[0_24px_64px_rgba(0,0,0,0.18)]"
      >
        <div className="flex items-center gap-3">
          {step !== 'choose' && <SourceTypeTile type={connectorTileType(draft.kind)} />}
          <h2 id={titleId} className="m-0 flex-1 text-[19px] font-semibold tracking-[-0.2px]">
            {step === 'choose' ? t.wizardTitle : kindTitle}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t.cancel}
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-muted hover:bg-chip hover:text-ink"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <ol aria-label={t.wizardTitle} className="m-0 flex list-none gap-2 p-0 text-[12px]">
          {steps.map((candidate, index) => (
            <li
              key={candidate.id}
              aria-current={candidate.id === step ? 'step' : undefined}
              className={joinClassNames(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1',
                index === stepIndex ? 'bg-ink text-inverse' : index < stepIndex ? 'bg-brand-soft text-brand-strong' : 'bg-chip text-muted',
              )}
            >
              <span className="font-semibold">{index + 1}</span>
              {candidate.label}
            </li>
          ))}
        </ol>

        {step === 'choose' && (
          <ConnectorKindGrid
            selected={draft.kind}
            onSelect={(kind) => {
              setDraft(emptyDraft(kind))
              setStep('settings')
            }}
          />
        )}
        {step === 'settings' && <ConnectorFields draft={draft} update={update} />}
        {step === 'schedule' && (
          <>
            <ScheduleFields draft={draft} update={update} />
            <p className="m-0 rounded-[10px] bg-subtle px-3 py-2.5 text-[13px] text-body">{scheduleText(scheduleOf(draft))}</p>
          </>
        )}

        {problem && (
          <p role="alert" className="m-0 rounded-[10px] border border-danger-line bg-danger-tint px-3.5 py-2.5 text-[13px] text-danger">
            {problem}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {step === 'settings' && (
            <button type="button" onClick={() => setStep('choose')} className={compactButtonClassNames('secondary')}>
              {t.back}
            </button>
          )}
          {step === 'schedule' && (
            <button type="button" onClick={() => setStep('settings')} className={compactButtonClassNames('secondary')}>
              {t.back}
            </button>
          )}
          {step === 'settings' && (
            <button type="button" onClick={goToSchedule} className={compactButtonClassNames('primary')}>
              {t.next}
            </button>
          )}
          {step === 'schedule' && (
            <button type="button" disabled={isAdding} onClick={() => void add()} className={compactButtonClassNames('primary')}>
              {isAdding ? t.adding : t.addAndSync}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** The "Connect a source" card of screen 18: one wide tile per connector type. */
export function ConnectSourceCard({ knowledgeBaseId, onAdded }: { knowledgeBaseId: string; onAdded: (source: KnowledgeSource) => void }) {
  const t = useT().knowledgeConnectors
  const [openKind, setOpenKind] = useState<ConnectorKind | null>(null)
  return (
    <section aria-labelledby="connect-h" className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-col gap-0.5">
        <h3 id="connect-h" className="m-0 text-[14px] font-semibold">
          {t.connectTitle}
        </h3>
        <p className="m-0 text-[12px] text-muted">{t.connectHint}</p>
      </div>
      <ConnectorKindGrid onSelect={setOpenKind} />
      {openKind && <ConnectorWizard knowledgeBaseId={knowledgeBaseId} initialKind={openKind} onClose={() => setOpenKind(null)} onAdded={onAdded} />}
    </section>
  )
}
