import { joinClassNames } from '@/components/ui'
import { describeError } from '@/lib/agentDisplay'
import type { AgentGraphController } from './useAgentGraph'

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
}

/** Add node, Auto-layout, Undo / Redo, the save state and Save (spec A toolbar). */
export function NodesToolbar({ controller, isPaletteOpen, onTogglePalette, onAutoLayout }: NodesToolbarProps) {
  const isLocked = controller.builderBusy || controller.status === 'saving'
  return (
    <div role="toolbar" aria-label="Nodes" className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2">
      <button type="button" aria-pressed={isPaletteOpen} onClick={onTogglePalette} className={joinClassNames(toolbarButtonClassNames, isPaletteOpen && 'bg-selected')}>
        Add node
      </button>
      <button type="button" onClick={onAutoLayout} disabled={isLocked} className={toolbarButtonClassNames}>
        Auto-layout
      </button>
      <button type="button" onClick={controller.undo} disabled={!controller.canUndo || isLocked} className={toolbarButtonClassNames}>
        Undo
      </button>
      <button type="button" onClick={controller.redo} disabled={!controller.canRedo || isLocked} className={toolbarButtonClassNames}>
        Redo
      </button>
      <span role="status" className="min-w-0 flex-1 truncate text-[12px] text-muted">
        {describeSaveState(controller)}
      </span>
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
