import { useState } from 'react'
import { getCredentialStoreName } from '@/lib/platform'
import { defaultExportPath, deleteAllData, exportAgents } from '@/api/appSettings'
import { describeError } from '@/lib/agentDisplay'
import { settingsButtonClassNames } from './SettingRows'

type DataActionState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'confirmDelete' }
  | { kind: 'done'; message: string }
  | { kind: 'failed'; message: string }

interface DeleteConfirmationProps {
  shouldRemoveKeys: boolean
  onRemoveKeysChange: (shouldRemoveKeys: boolean) => void
  onConfirm: () => void
  onCancel: () => void
}

function DeleteConfirmation({ shouldRemoveKeys, onRemoveKeysChange, onConfirm, onCancel }: DeleteConfirmationProps) {
  return (
    <div role="alert" className="flex flex-col gap-2.5 rounded-[10px] border border-danger-line bg-danger-tint px-3.5 py-3">
      <span className="flex flex-wrap items-center gap-3">
        <span className="flex-auto text-[13px] text-danger-deep">Delete every agent, run and schedule? This cannot be undone</span>
        <button type="button" onClick={onCancel} className={`${settingsButtonClassNames} h-[34px]`}>
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="h-[34px] cursor-pointer rounded-[9px] border-0 bg-danger px-3.5 font-sans text-[13px] font-semibold text-white"
        >
          Delete everything
        </button>
      </span>
      <label className="flex cursor-pointer items-center gap-2 text-[13px] text-danger-deep">
        <input type="checkbox" checked={shouldRemoveKeys} onChange={(event) => onRemoveKeysChange(event.target.checked)} className="size-4 accent-danger" />
        Also remove saved API keys and secrets from {getCredentialStoreName()}
      </label>
    </div>
  )
}

function describeDeletion(deletedAgentCount: number, removedKeychainItemCount: number): string {
  const agentsText = `${deletedAgentCount} ${deletedAgentCount === 1 ? 'agent' : 'agents'}`
  const keysText = removedKeychainItemCount > 0 ? ' and the saved keys' : ''
  return `Deleted ${agentsText}, their runs and schedules${keysText} from this computer`
}

/**
 * "Export all agents" (JSON in Downloads, never keys) and "Delete all data" (asks first).
 *
 * @param onDataDeleted - Called after a successful delete, e.g. to reload settings
 */
export function DataActions({ onDataDeleted }: { onDataDeleted: () => void }) {
  const [actionState, setActionState] = useState<DataActionState>({ kind: 'idle' })
  const [shouldRemoveKeys, setShouldRemoveKeys] = useState(true)
  const isWorking = actionState.kind === 'working'

  async function handleExport() {
    setActionState({ kind: 'working' })
    try {
      const summary = await exportAgents(await defaultExportPath())
      const agentsText = `${summary.agentCount} ${summary.agentCount === 1 ? 'agent' : 'agents'}`
      setActionState({ kind: 'done', message: `Exported ${agentsText} to ${summary.path}` })
    } catch (exportFailure) {
      setActionState({ kind: 'failed', message: `Could not export: ${describeError(exportFailure)}` })
    }
  }

  async function handleDelete() {
    setActionState({ kind: 'working' })
    try {
      const summary = await deleteAllData(shouldRemoveKeys)
      setActionState({ kind: 'done', message: describeDeletion(summary.deletedAgentCount, summary.removedKeychainItemCount) })
      onDataDeleted()
    } catch (deleteFailure) {
      setActionState({ kind: 'failed', message: `Could not delete: ${describeError(deleteFailure)}` })
    }
  }

  return (
    <>
      <div className="flex gap-2 py-3.5">
        <button type="button" disabled={isWorking} onClick={() => void handleExport()} className={`${settingsButtonClassNames} h-9 disabled:opacity-50`}>
          Export all agents
        </button>
        <button
          type="button"
          disabled={isWorking}
          onClick={() => setActionState({ kind: 'confirmDelete' })}
          className="h-9 cursor-pointer rounded-[9px] border border-danger-line bg-surface px-3.5 font-sans text-[13px] font-medium text-danger hover:bg-danger-tint disabled:opacity-50"
        >
          Delete all data
        </button>
      </div>
      {actionState.kind === 'confirmDelete' && (
        <DeleteConfirmation
          shouldRemoveKeys={shouldRemoveKeys}
          onRemoveKeysChange={setShouldRemoveKeys}
          onConfirm={() => void handleDelete()}
          onCancel={() => setActionState({ kind: 'idle' })}
        />
      )}
      {actionState.kind === 'done' && (
        <p role="status" className="m-0 text-[13px] text-body">
          {actionState.message}
        </p>
      )}
      {actionState.kind === 'failed' && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {actionState.message}
        </p>
      )}
    </>
  )
}
