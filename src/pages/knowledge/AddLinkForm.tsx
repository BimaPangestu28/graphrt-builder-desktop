import { useState, type FormEvent } from 'react'
import { isWebLink } from '@/api/knowledge'
import { compactButtonClassNames, fieldControlClassNames } from './FormControls'

interface AddLinkFormProps {
  onAddLink: (url: string) => Promise<void>
  /** Accessible label of the link field. */
  label: string
  buttonText?: string
}

/** "Paste a link" field with an Add button; rejects text that is not an http(s) link. */
export function AddLinkForm({ onAddLink, label, buttonText = 'Add link' }: AddLinkFormProps) {
  const [linkText, setLinkText] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [validationMessage, setValidationMessage] = useState<string | null>(null)

  const submitLink = async (event: FormEvent) => {
    event.preventDefault()
    if (!isWebLink(linkText)) {
      setValidationMessage('Paste a link that starts with https://')
      return
    }
    setValidationMessage(null)
    setIsAdding(true)
    try {
      await onAddLink(linkText.trim())
      setLinkText('')
    } finally {
      setIsAdding(false)
    }
  }

  return (
    <form onSubmit={(event) => void submitLink(event)} className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <input
          type="text"
          inputMode="url"
          aria-label={label}
          placeholder="https://your-website.com/menu"
          value={linkText}
          onChange={(event) => setLinkText(event.target.value)}
          className={`${fieldControlClassNames} min-w-0 flex-1`}
        />
        <button type="submit" disabled={isAdding || linkText.trim() === ''} className={compactButtonClassNames('secondary', 'h-10')}>
          {buttonText}
        </button>
      </div>
      {validationMessage && <span className="text-[12px] text-danger">{validationMessage}</span>}
    </form>
  )
}
