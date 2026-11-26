import { useId, type ReactNode } from 'react'
import { Icon, StatusDot } from '@/components/ui'
import { getCredentialStoreName } from '@/lib/platform'
import { LockIcon } from '../agent-builder/LockIcon'
import { apiKeyProviderOptions, type ApiKeyProvider } from './welcomeSetup'
import type { ApiKeyCheck } from './welcomeWizard'
import { useT } from '@/i18n'

export const ollamaDownloadUrl = 'https://ollama.com/download'

/** A green "found" line with a check mark, e.g. "Signed in and ready". */
export function FoundLine({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-1.5 font-medium text-ok-strong">
      <Icon name="check" size={14} className="shrink-0" />
      {text}
    </span>
  )
}

/**
 * An amber line for something found that cannot be used yet, e.g. an AI tool that does not start.
 * Pass `showDot={false}` where the line sits under other text and must start at the same left edge.
 */
export function ProblemLine({ text, showDot = true }: { text: string; showDot?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-amber-strong">
      {showDot && <StatusDot tone="amber" />}
      {text}
    </span>
  )
}

/** "Not installed · How to install …" with the install page link. */
export function MissingLine({ text, link }: { text: string; link: ReactNode }) {
  return (
    <span className="flex flex-wrap items-center gap-x-1.5">
      <span className="text-muted">{text}</span>
      <span aria-hidden="true" className="text-muted">
        ·
      </span>
      {link}
    </span>
  )
}

/**
 * A closed "Technical details" disclosure: versions, Experimental notes and install
 * links stay out of the main path but one click away for whoever wants them.
 */
export function TechnicalDetails({ summary, children }: { summary?: string; children: ReactNode }) {
  const t = useT().welcome
  return (
    <details className="group rounded-[12px] border border-line bg-subtle">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-[13px] font-medium text-ink-2 [&::-webkit-details-marker]:hidden">
        <span className="text-muted transition-transform group-open:rotate-90" aria-hidden="true">
          <Icon name="chevronRight" size={14} />
        </span>
        {summary ?? t.technicalDetails}
      </summary>
      <div className="flex flex-col gap-2 px-4 pb-3 text-[12px] leading-normal text-body">{children}</div>
    </details>
  )
}

const fieldClassNames = 'box-border h-11 w-full rounded-[10px] border border-line-strong bg-surface text-[14px] text-ink'

interface ApiKeyFieldsProps {
  provider: ApiKeyProvider
  apiKey: string
  check: ApiKeyCheck
  onProviderChange: (provider: ApiKeyProvider) => void
  onApiKeyChange: (apiKey: string) => void
}

/** Provider picker, key field and the local check of the "company API key" step. */
export function ApiKeyFields({ provider, apiKey, check, onProviderChange, onApiKeyChange }: ApiKeyFieldsProps) {
  const t = useT().welcome
  const checkMessageId = useId()
  const suggestedProvider = check.status === 'warning' ? check.suggestedProvider : null
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">{t.whichCompany}</span>
          <select aria-label={t.providerLabel} value={provider} onChange={(event) => onProviderChange(event.target.value as ApiKeyProvider)} className={`${fieldClassNames} px-2.5`}>
            {apiKeyProviderOptions.map((option) => (
              <option key={option.provider} value={option.provider}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">{t.apiKey}</span>
          <input
            type="password"
            aria-label={t.apiKey}
            aria-invalid={check.status === 'invalid'}
            aria-describedby={checkMessageId}
            value={apiKey}
            placeholder={t.pasteApiKey}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onApiKeyChange(event.target.value)}
            className={`${fieldClassNames} px-3`}
          />
        </label>
      </div>
      <span id={checkMessageId} aria-live="polite" className="text-[13px] leading-normal">
        {check.status === 'invalid' && <span className="text-danger">{check.message}</span>}
        {check.status === 'warning' && (
          <span className="flex flex-wrap items-center gap-x-2 text-amber-strong">
            {check.message}
            {suggestedProvider && (
              <button type="button" onClick={() => onProviderChange(suggestedProvider)} className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-ink underline">
                {t.switchTo(apiKeyProviderOptions.find((option) => option.provider === suggestedProvider)?.label ?? suggestedProvider)}
              </button>
            )}
          </span>
        )}
        {check.status === 'ok' && <FoundLine text={t.looksGood} />}
      </span>
      <span className="flex items-center gap-1.5 text-[12px] text-ink-2">
        <LockIcon />
        {t.savedInKeychain(getCredentialStoreName())}
      </span>
    </div>
  )
}
