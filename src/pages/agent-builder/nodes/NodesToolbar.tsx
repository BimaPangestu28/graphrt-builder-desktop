import { Icon, joinClassNames, StrokeIcon } from '@/components/ui'
import { describeError } from '@/lib/agentDisplay'
import type { AgentGraphController } from './useAgentGraph'

const iconButtonClassNames = 'flex size-8 cursor-pointer items-center justify-center rounded-lg border border-line-strong bg-surface text-ink-2 hover:bg-subtle disabled:cursor-default disabled:opacity-50'
const toolbarButtonClassNames = 'h-8 cursor-pointer rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-subtle disabled:cursor-default disabled:opacity-50'

/** "Saved as v8 · …", "Unsaved changes", the refusal reason… */
function describeSaveState(controller: AgentGraphController): string {
  const version = controller.savedGraph?.version
  switch (controller.status) {
    case 'saving':
      return 'Saving…'
    case 'builder-busy':
      return 'Waiting for the builder to finish'
    case 'conflict':
      return 'The builder changed this agent meanwhile'
    case 'invalid':
      return `Not saved: ${controller.saveProblems[0]?.message ?? 'the steps have problems'}`
    case 'failed':
      return `Not saved: ${controller.saveError ? describeError(controller.saveError) : 'something went wrong'}`
    default:
      if (controller.isDirty) return 'Unsaved changes'
      return `Saved as v${version} · changes from chat and nodes both land here`
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
}

/** Add node, Auto-layout, Undo / Redo, the save state and Save (spec A toolbar). */
export function NodesToolbar({ controller, isPaletteOpen, onTogglePalette, onAutoLayout, onValidate, validationMessage }: NodesToolbarProps) {
  const isLocked = controller.builderBusy || controller.status === 'saving'
  return (
    <div role="toolbar" aria-label="Nodes" className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2">
      <button
        type="button"
        aria-pressed={isPaletteOpen}
        aria-keyshortcuts="A"
        onClick={onTogglePalette}
        className={joinClassNames(toolbarButtonClassNames, 'inline-flex items-center gap-1.5 border-ink bg-ink font-semibold !text-white hover:bg-ink-2', isPaletteOpen && 'ring-2 ring-brand-line')}
      >
        <Icon name="plus" size={14} />
        Add node
      </button>
      <button type="button" onClick={onAutoLayout} disabled={isLocked} className={toolbarButtonClassNames}>
        Auto-layout
      </button>
      <span aria-hidden="true" className="h-5 w-px bg-line" />
      <button type="button" aria-label="Undo" title="Undo" onClick={controller.undo} disabled={!controller.canUndo || isLocked} className={iconButtonClassNames}>
        <Icon name="undo" size={15} />
      </button>
      <button type="button" aria-label="Redo" title="Redo" onClick={controller.redo} disabled={!controller.canRedo || isLocked} className={iconButtonClassNames}>
        <StrokeIcon size={15}>
          <path d="M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3" />
        </StrokeIcon>
      </button>
      <span role="status" className="min-w-0 flex-1 truncate text-right text-[12px] text-muted">
        {validationMessage ?? describeSaveState(controller)}
      </span>
      {onValidate && (
        <button type="button" onClick={onValidate} className={toolbarButtonClassNames}>
          Validate
        </button>
      )}
      <button
        type="button"
        onClick={() => void controller.save()}
        disabled={!controller.isDirty || isLocked}
        className={joinClassNames(toolbarButtonClassNames, 'border-ink bg-ink !text-white hover:bg-ink-2')}
      >
        Save
      </button>
    </div>
  )
}
