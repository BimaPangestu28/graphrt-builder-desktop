import { useState, type FormEvent } from 'react'
import { getCredentialStoreName } from '@/lib/platform'
import { describeError } from '@/lib/agentDisplay'

interface ProviderKeyFormProps {
  providerName: string
  /** True when a key is stored already, so the form replaces it. */
  isReplacing: boolean
  /** Saves the key; rejects with the backend error to show. */
  onSave: (apiKey: string) => Promise<void>
  onCancel: () => void
}

const smallButtonClassNames = 'h-8 cursor-pointer rounded-lg px-3 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-50'

/** Inline card for pasting a model provider key on the Connections screen (21). */
export function ProviderKeyForm({ providerName, isReplacing, onSave, onCancel }: ProviderKeyFormProps) {
  const [apiKey, setApiKey] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const canSave = apiKey.trim().length > 0 && !isSaving

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSave) return
    setIsSaving(true)
    setErrorMessage(null)
    try {
      await onSave(apiKey.trim())
    } catch (saveError) {
      setErrorMessage(`Could not save the key: ${describeError(saveError)}`)
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label={`${providerName} key`} className="flex flex-col gap-2.5 rounded-xl border-2 border-ink p-3.5">
      <b className="font-semibold">{providerName}</b>
      <input
        type="password"
        aria-label={`${providerName} API key`}
        placeholder={isReplacing ? 'Paste the new key' : 'Paste your API key'}
        value={apiKey}
        autoFocus
        onChange={(event) => setApiKey(event.target.value)}
        className="box-border h-9 rounded-[9px] border border-line-strong bg-surface px-3 text-[14px] text-ink"
      />
      {errorMessage && (
        <span aria-live="polite" className="text-[13px] text-danger">
          {errorMessage}
        </span>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={!canSave} className={`${smallButtonClassNames} border-0 bg-ink text-white hover:bg-ink-2`}>
          {isSaving ? 'Saving…' : 'Save key'}
        </button>
        <button type="button" onClick={onCancel} className={`${smallButtonClassNames} border border-line-strong bg-surface text-ink hover:bg-subtle`}>
          Cancel
        </button>
      </div>
      <span className="text-[12px] text-muted">Saved in {getCredentialStoreName()}, never shown again</span>
    </form>
  )
}
