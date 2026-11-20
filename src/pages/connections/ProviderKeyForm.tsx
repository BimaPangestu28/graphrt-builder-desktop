import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui'
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
    <form
      onSubmit={handleSubmit}
      aria-label={`${providerName} key`}
      className="flex h-full min-w-0 flex-col gap-2.5 rounded-[14px] border border-line-heavy bg-surface p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
    >
      <div className="flex flex-col gap-0.5">
        <b className="text-[14px] font-semibold">{providerName}</b>
        <span className="text-[12px] text-muted">Saved in {getCredentialStoreName()}, never shown again</span>
      </div>
      <input
        type="password"
        aria-label={`${providerName} API key`}
        placeholder={isReplacing ? 'Paste the new key' : 'Paste your API key'}
        value={apiKey}
        autoFocus
        onChange={(event) => setApiKey(event.target.value)}
        className="box-border h-9 rounded-[9px] border border-line-strong bg-surface px-3 text-[14px] text-ink outline-none focus:border-ink"
      />
      {errorMessage && (
        <span aria-live="polite" className="text-[13px] text-danger">
          {errorMessage}
        </span>
      )}
      <div className="mt-auto flex justify-end gap-2 border-t border-chip pt-3">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!canSave}>
          {isSaving ? 'Saving…' : 'Save key'}
        </Button>
      </div>
    </form>
  )
}
