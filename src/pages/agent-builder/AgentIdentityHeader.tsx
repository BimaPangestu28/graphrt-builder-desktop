import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { getCredentialStoreName } from '@/lib/platform'
import { useNavigate } from 'react-router-dom'
import { deleteAgent, renameAgent } from '@/api/agents'
import type { Agent } from '@/api/types'
import { Button, Icon } from '@/components/ui'
import { notifyAgentsChanged } from '@/hooks/useAgents'
import { describeError } from '@/lib/agentDisplay'
import { routePaths } from '@/routes'
import { messages } from '@/i18n'

interface AgentIdentityHeaderProps {
  agent: Agent
  /** Reloads the agent after a rename. */
  onRenamed: () => Promise<void> | void
}

/**
 * The agent's name on screen 04: click to rename in place (Enter saves, Escape cancels),
 * plus "Delete agent" with a confirmation that says what goes with it.
 */
export function AgentIdentityHeader({ agent, onRenamed }: AgentIdentityHeaderProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {isEditing ? (
          <RenameForm agent={agent} onDone={() => setIsEditing(false)} onRenamed={onRenamed} />
        ) : (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            title={messages().builder.rename}
            className="group flex min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-ink"
          >
            <h1 className="m-0 truncate text-[22px] font-semibold">{agent.name}</h1>
            <span className="sr-only">{messages().builder.renameAgent}</span>
            <Icon name="edit" size={16} className="shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          </button>
        )}
        {!isEditing && !isConfirmingDelete && (
          <Button variant="ghost" size="sm" onClick={() => setIsConfirmingDelete(true)} className="text-danger hover:bg-danger-tint">
            <Icon name="trash" size={14} />
            {messages().builder.deleteAgent}
          </Button>
        )}
      </div>
      {isConfirmingDelete && <DeleteConfirmation agent={agent} onCancel={() => setIsConfirmingDelete(false)} />}
    </div>
  )
}

interface RenameFormProps {
  agent: Agent
  onDone: () => void
  onRenamed: () => Promise<void> | void
  /** `title` sits in a page header (large text); `card` fits a Home agent card (compact, one row). */
  variant?: 'title' | 'card'
}

const renameFormStyles = {
  title: {
    form: 'flex min-w-0 flex-[1_1_320px] flex-col gap-1.5',
    row: 'flex flex-wrap items-center gap-2',
    input: 'h-10 min-w-0 flex-[1_1_220px] rounded-lg border border-line-strong px-3 text-[18px] font-semibold outline-none focus:border-brand',
  },
  card: {
    form: 'flex w-full min-w-0 flex-col gap-1.5',
    row: 'flex items-center gap-1.5',
    input: 'h-9 min-w-0 flex-1 rounded-lg border border-line-strong px-2.5 text-[15px] font-semibold outline-none focus:border-brand',
  },
} as const

/** Rename in place: Enter or Save stores the trimmed name, Escape or Cancel closes. */
export function RenameForm({ agent, onDone, onRenamed, variant = 'title' }: RenameFormProps) {
  const styles = renameFormStyles[variant]
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(agent.name)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = name.trim()
    if (trimmedName === agent.name) return onDone()
    setIsSaving(true)
    setErrorMessage(null)
    try {
      await renameAgent(agent.id, trimmedName)
      await onRenamed()
      notifyAgentsChanged()
      onDone()
    } catch (renameError) {
      setErrorMessage(messages().builder.couldNotRenameReason(describeError(renameError)))
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className={styles.form}>
      <label htmlFor={inputId} className="sr-only">
        {messages().builder.agentName}
      </label>
      <div className={styles.row}>
        <input
          id={inputId}
          ref={inputRef}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === 'Escape' && onDone()}
          maxLength={120}
          disabled={isSaving}
          className={styles.input}
        />
        <Button type="submit" size="sm" disabled={isSaving || name.trim() === ''}>
          {isSaving ? messages().builder.saving : messages().builder.save}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={isSaving}>
          {messages().builder.cancel}
        </Button>
      </div>
      {errorMessage && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {errorMessage}
        </p>
      )}
    </form>
  )
}

/**
 * Asks before deleting and says what goes with the agent. After deleting it calls `onDeleted`,
 * or goes Home when none is given (the builder of a deleted agent can't stay open).
 */
export function DeleteConfirmation({ agent, onCancel, onDeleted }: { agent: Agent; onCancel: () => void; onDeleted?: () => void }) {
  const navigate = useNavigate()
  const [isDeleting, setIsDeleting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function confirmDelete() {
    setIsDeleting(true)
    setErrorMessage(null)
    try {
      await deleteAgent(agent.id)
      notifyAgentsChanged()
      if (onDeleted) onDeleted()
      else navigate(routePaths.home, { replace: true })
    } catch (deleteError) {
      setErrorMessage(messages().builder.couldNotDeleteReason(describeError(deleteError)))
      setIsDeleting(false)
    }
  }

  const titleId = useId()
  const detailId = useId()
  return (
    <div role="alertdialog" aria-labelledby={titleId} aria-describedby={detailId} className="mt-2 flex flex-col gap-3 rounded-xl border border-danger-line bg-danger-tint p-4">
      <span id={titleId} className="font-semibold text-danger-deep">
        {messages().builder.delete}{agent.name}”?
      </span>
      <span id={detailId} className="text-[13px] leading-normal text-body">
        {messages().builder.itsStepsEveryVersionItsRun}{' '}{getCredentialStoreName()} {messages().builder.stayThisCantBeUndone}
      </span>
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" size="sm" onClick={() => void confirmDelete()} disabled={isDeleting} className="bg-danger !text-white hover:bg-danger-deep">
          {isDeleting ? messages().builder.deleting : messages().builder.deleteAgent}
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={isDeleting}>
          {messages().builder.keepIt}
        </Button>
      </div>
      {errorMessage && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {errorMessage}
        </p>
      )}
    </div>
  )
}
