import type { ReactNode } from 'react'
import { Icon, joinClassNames, StrokeIcon } from '@/components/ui'
import { describeError } from '@/lib/agentDisplay'
import type { AgentGraphController } from './useAgentGraph'
import { messages } from '@/i18n'

const iconButtonClassNames = 'flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line-strong bg-surface text-ink-2 hover:bg-subtle disabled:cursor-default disabled:opacity-50'
const toolbarButtonClassNames =
  'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-subtle disabled:cursor-default disabled:opacity-50 @max-[46rem]:px-2'

/**
 * A toolbar label that folds away (kept for screen readers) when the toolbar is narrow,
 * leaving the button's icon: the toolbar sits in a container query (`@container`).
 */
export const foldingLabelClassNames = '@max-[46rem]:sr-only'

/** The save state: a short part that always shows and a detail that folds away when narrow. */
export interface SaveStateText {
  summary: string
  detail: string | null
}

/** "Saved as v8 · …", "Unsaved changes", the refusal reason… */
export function describeSaveState(controller: AgentGraphController): SaveStateText {
  const version = controller.savedGraph?.version
  switch (controller.status) {
    case 'saving':
      return { summary: messages().nodes.saving, detail: null }
    case 'builder-busy':
      return { summary: messages().nodes.waitingForTheBuilderToFinish, detail: null }
    case 'conflict':
      return { summary: messages().nodes.theBuilderChangedThisAgentMeanwhile, detail: null }
    case 'invalid':
      return { summary: messages().nodes.notSavedProblem(controller.saveProblems[0]?.message ?? null), detail: null }
    case 'failed':
      return { summary: messages().nodes.notSavedError(controller.saveError ? describeError(controller.saveError) : null), detail: null }
    default:
      if (controller.isDirty) return { summary: messages().nodes.unsavedChanges, detail: null }
      return { summary: messages().nodes.savedAsVVersion(version), detail: messages().nodes.changesFromChatAndNodesBoth }
  }
}

interface NodesToolbarProps {
  controller: AgentGraphController
  isPaletteOpen: boolean
  onTogglePalette: () => void
  onAutoLayout: () => void
  /** Validate: shows what blocks Test and saving (selects the first problem's step). */
  onValidate?: () => void
  /** The last Validate's outcome ("No problems found"), until the next edit. */
  validationMessage?: string | null
  /** More actions before Save (Add note, Validate, Test from the live/sync part). */
  extraActions?: ReactNode
}

/**
 * Add node, Auto-layout, Undo / Redo, the save state and Save (spec A toolbar). One row:
 * when the canvas column is narrow, button labels fold to icons and the save state
 * shortens (the full text stays in its tooltip).
 */
export function NodesToolbar({ controller, isPaletteOpen, onTogglePalette, onAutoLayout, onValidate, validationMessage, extraActions }: NodesToolbarProps) {
  const isLocked = controller.builderBusy || controller.status === 'saving'
  const saveState = validationMessage ? { summary: validationMessage, detail: null } : describeSaveState(controller)
  const fullSaveState = saveState.detail ? `${saveState.summary} · ${saveState.detail}` : saveState.summary
  return (
    <div className="@container border-b border-line bg-surface">
    <div role="toolbar" aria-label={messages().nodes.nodes} className="flex items-center gap-2 px-4 py-2 @max-[46rem]:gap-1.5 @max-[46rem]:px-3">
      <button
        type="button"
        aria-pressed={isPaletteOpen}
        aria-keyshortcuts="A"
        onClick={onTogglePalette}
        className={joinClassNames(toolbarButtonClassNames, 'inline-flex items-center gap-1.5 border-ink bg-ink font-semibold !text-white hover:bg-ink-2', isPaletteOpen && 'ring-2 ring-brand-line')}
      >
        <Icon name="plus" size={14} />
        <span className={foldingLabelClassNames}>{messages().nodes.addNode}</span>
      </button>
      <button type="button" onClick={onAutoLayout} disabled={isLocked} title={messages().nodes.autoLayoutPlaceEveryStepAgain} className={toolbarButtonClassNames}>
        <StrokeIcon size={14}>
          <path d="M4 4h6v6H4zM14 4h6v6h-6zM9 14h6v6H9zM7 10v2h10v-2M12 12v2" />
        </StrokeIcon>
        <span className={foldingLabelClassNames}>{messages().nodes.autoLayout}</span>
      </button>
      <span aria-hidden="true" className="h-5 w-px bg-line" />
      <button type="button" aria-label={messages().nodes.undo} title={messages().nodes.undo} onClick={controller.undo} disabled={!controller.canUndo || isLocked} className={iconButtonClassNames}>
        <Icon name="undo" size={15} />
      </button>
      <button type="button" aria-label={messages().nodes.redo} title={messages().nodes.redo} onClick={controller.redo} disabled={!controller.canRedo || isLocked} className={iconButtonClassNames}>
        <StrokeIcon size={15}>
          <path d="M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3" />
        </StrokeIcon>
      </button>
      <span role="status" className="min-w-0 flex-1 truncate text-right text-[12px] text-muted">
        {/* The tooltip holds the full text when the detail folds away or is cut off. */}
        <span title={fullSaveState}>
          {saveState.summary}
          {saveState.detail && <span className="@max-[64rem]:hidden"> · {saveState.detail}</span>}
        </span>
      </span>
      {onValidate && (
        <button type="button" onClick={onValidate} className={toolbarButtonClassNames}>
          {messages().nodes.validate}
        </button>
      )}
      {extraActions}
      <button
        type="button"
        onClick={() => void controller.save()}
        disabled={!controller.isDirty || isLocked}
        className={joinClassNames(toolbarButtonClassNames, 'border-ink bg-ink !text-white hover:bg-ink-2')}
      >
        {messages().nodes.save}
      </button>
    </div>
    </div>
  )
}
