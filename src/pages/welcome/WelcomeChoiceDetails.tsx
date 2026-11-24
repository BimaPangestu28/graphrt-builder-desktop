import type { ReactNode } from 'react'
import type { LocalCliProvider, ProviderStatus } from '@/api/types'
import { InstallPageLink } from '@/components/InstallPageLink'
import { Icon, StatusDot } from '@/components/ui'
import { describeLocalCliUsageNote, localCliShortNames } from '@/lib/settings'
import { getCredentialStoreName } from '@/lib/platform'
import { describeLocalCliSignIn } from '@/lib/localCliDisplay'
import { LockIcon } from '../agent-builder/LockIcon'
import { apiKeyProviderOptions, type ApiKeyProvider } from './welcomeSetup'

const ollamaDownloadUrl = 'https://ollama.com/download'

/** A green "found" line with a check mark, e.g. "Found · 2.1.330 (Claude Code)". */
function FoundLine({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-1.5 font-medium text-ok-strong">
      <Icon name="check" size={14} />
      {text}
    </span>
  )
}

/** An amber line for a CLI that was found but does not start, e.g. "Found, but it does not start. …". */
function ProblemLine({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-1.5 text-ink-2">
      <StatusDot tone="amber" />
      {text}
    </span>
  )
}

/** "Not installed · How to install …" with the install docs link. */
function MissingLine({ text, link }: { text: string; link: ReactNode }) {
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

interface LocalCliChoiceDetailsProps {
  provider: LocalCliProvider
  /** Its status, or undefined while detection runs. */
  status: ProviderStatus | undefined
}

/** What Welcome detected about Claude Code / Codex, its sign-in and the plan-usage note. */
export function LocalCliChoiceDetails({ provider, status }: LocalCliChoiceDetailsProps) {
  const shortName = localCliShortNames[provider]
  const localCli = status?.localCli
  const signInHint = localCli ? describeLocalCliSignIn(provider, localCli) : null
  return (
    <>
      {!localCli && <span className="text-muted">Looking for {shortName}…</span>}
      {localCli?.installed && localCli.problem && <ProblemLine text={localCli.problem} />}
      {localCli?.installed && !localCli.problem && <FoundLine text={localCli.version ? `Found · ${localCli.version}` : 'Found on this computer'} />}
      {localCli && !localCli.installed && (
        <MissingLine text="Not installed" link={<InstallPageLink provider={provider} url={localCli.installUrl} label={`How to install ${shortName}`} />} />
      )}
      {signInHint && signInHint.tone !== 'ok' && (
        <span className="flex items-center gap-1.5 text-ink-2">
          <StatusDot tone={signInHint.tone === 'amber' ? 'amber' : 'paused'} />
          {signInHint.text}
        </span>
      )}
      <span className="text-[12px] text-muted">{describeLocalCliUsageNote(provider)}</span>
    </>
  )
}

/** Whether Ollama answered, with the download link when it did not. */
export function OllamaChoiceDetails({ isRunning }: { isRunning: boolean | null }) {
  return (
    <>
      <span>Free, private models that run on this computer, even offline</span>
      {isRunning === null && <span className="text-muted">Looking for Ollama…</span>}
      {isRunning === true && <FoundLine text="Running on this computer" />}
      {isRunning === false && <MissingLine text="Not running" link={<InstallPageLink provider="ollama" url={ollamaDownloadUrl} label="Download Ollama" />} />}
    </>
  )
}

const fieldClassNames = 'box-border h-10 w-full rounded-[10px] border border-line-strong bg-surface text-[14px] text-ink'

interface ApiKeyFieldsProps {
  provider: ApiKeyProvider
  apiKey: string
  onProviderChange: (provider: ApiKeyProvider) => void
  onApiKeyChange: (apiKey: string) => void
}

/** Provider picker and key field of the selected "Add an API key" choice. */
export function ApiKeyFields({ provider, apiKey, onProviderChange, onApiKeyChange }: ApiKeyFieldsProps) {
  return (
    <span className="mt-1 flex flex-col gap-2.5">
      <span className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink-2">Provider</span>
          <select aria-label="Provider" value={provider} onChange={(event) => onProviderChange(event.target.value as ApiKeyProvider)} className={`${fieldClassNames} px-2.5`}>
            {apiKeyProviderOptions.map((option) => (
              <option key={option.provider} value={option.provider}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink-2">API key</span>
          <input
            type="password"
            aria-label="API key"
            value={apiKey}
            placeholder="Paste your API key"
            onChange={(event) => onApiKeyChange(event.target.value)}
            className={`${fieldClassNames} px-3`}
          />
        </label>
      </span>
      <span className="flex items-center gap-1.5 text-[12px] text-ink-2">
        <LockIcon />
        Saved in {getCredentialStoreName()}, never sent to graphrt
      </span>
    </span>
  )
}
