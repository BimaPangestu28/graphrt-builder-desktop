import { useId, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui'
import { describeError } from '@/lib/agentDisplay'

interface SecretRequirementFormProps {
  secretName: string
  onSave: (value: string) => Promise<void>
  onCancel: () => void
}

/**
 * Inline form under a "Needs" row to paste a workflow secret (API key, token).
 * The value goes straight to the OS keychain and is never shown again.
 */
export function SecretRequirementForm({ secretName, onSave, onCancel }: SecretRequirementFormProps) {
  const inputId = useId()
  const [secretValue, setSecretValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSaving(true)
    setErrorMessage(null)
    try {
      await onSave(secretValue)
    } catch (error) {
      setErrorMessage(describeError(error))
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-2 px-4 pb-3">
      <label htmlFor={inputId} className="text-[12px] text-muted">
        Value for <code className="font-mono">{secretName}</code> · saved in the Keychain on this Mac
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={inputId}
          type="password"
          autoComplete="off"
          value={secretValue}
          onChange={(event) => setSecretValue(event.target.value)}
          className="h-9 min-w-0 flex-[1_1_200px] rounded-lg border border-line-strong px-3 text-[13px] outline-none focus:border-brand"
        />
        <Button type="submit" size="sm" disabled={isSaving || secretValue.trim() === ''}>
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
      </div>
      {errorMessage && (
        <p role="alert" className="m-0 text-[12px] text-danger">
          {errorMessage}
        </p>
      )}
    </form>
  )
}
