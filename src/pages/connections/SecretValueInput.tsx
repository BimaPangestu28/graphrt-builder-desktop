import { useState } from 'react'

interface SecretValueInputProps {
  /** Accessible name, e.g. "Value of MY_SERVER_TOKEN". */
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
}

/**
 * A password field with a Show / Hide toggle for typing a secret value. The value only
 * lives here until it is saved; it is never read back from the keychain.
 */
export function SecretValueInput({ label, value, onChange, placeholder, autoFocus }: SecretValueInputProps) {
  const [isValueVisible, setIsValueVisible] = useState(false)
  return (
    <span className="flex min-w-0 flex-[1_1_240px] items-center rounded-[9px] border border-line-strong bg-surface focus-within:border-ink">
      <input
        type={isValueVisible ? 'text' : 'password'}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        className="box-border h-9 min-w-0 flex-auto rounded-[9px] border-0 bg-transparent px-3 text-[14px] text-ink outline-none"
      />
      <button
        type="button"
        aria-label={isValueVisible ? `Hide ${label}` : `Show ${label}`}
        aria-pressed={isValueVisible}
        onClick={() => setIsValueVisible((wasVisible) => !wasVisible)}
        className="mr-1 h-7 shrink-0 cursor-pointer rounded-md border-0 bg-transparent px-2 text-[12px] font-medium text-ink-2 hover:bg-subtle"
      >
        {isValueVisible ? 'Hide' : 'Show'}
      </button>
    </span>
  )
}
