import { useId, useState } from 'react'
import type { LocalCliProvider, ProviderStatus, WelcomeChoice } from '@/api/types'
import { InstallPageLink } from '@/components/InstallPageLink'
import { Icon, joinClassNames } from '@/components/ui'
import { describeLocalCliUsageNote, localCliShortNames, moreLocalCliProviders } from '@/data/settings'
import { describeLocalCliSignIn } from '@/lib/localCliDisplay'

interface MoreLocalCliToolsProps {
  /** Provider statuses, or null while detection runs. */
  statuses: ProviderStatus[] | null
  selectedChoice: WelcomeChoice | null
  onSelect: (choice: WelcomeChoice) => void
}

/** "1 found", "none found" or "looking…" for the disclosure's summary line. */
function describeFoundCount(statuses: ProviderStatus[] | null): string {
  if (!statuses) return 'looking…'
  const foundCount = moreLocalCliProviders.filter((provider) => findStatus(statuses, provider)?.localCli?.installed).length
  return foundCount === 0 ? 'none found' : `${foundCount} found`
}

function findStatus(statuses: ProviderStatus[] | null, provider: LocalCliProvider): ProviderStatus | undefined {
  return statuses?.find((status) => status.provider === provider)
}

interface ToolRowProps {
  provider: LocalCliProvider
  status: ProviderStatus | undefined
  isSelected: boolean
  onSelect: (choice: WelcomeChoice) => void
}

/** One compact radio row: name, then "Found · version" or "Not installed · How to install". */
function ToolRow({ provider, status, isSelected, onSelect }: ToolRowProps) {
  const titleId = useId()
  const shortName = localCliShortNames[provider]
  const localCli = status?.localCli
  const isInstalled = localCli?.installed ?? false
  const signInHint = localCli && isSelected ? describeLocalCliSignIn(provider, localCli) : null
  return (
    <li
      onClick={() => isInstalled && onSelect(provider)}
      className={joinClassNames(
        'flex gap-3 rounded-[10px] px-3 py-2.5',
        isSelected ? 'bg-subtle outline outline-2 outline-ink' : '',
        isInstalled ? 'cursor-pointer hover:bg-subtle' : 'cursor-default',
      )}
    >
      <input
        type="radio"
        name="welcome-choice"
        value={provider}
        checked={isSelected}
        disabled={!isInstalled}
        onChange={() => onSelect(provider)}
        aria-labelledby={titleId}
        className="mt-[2px] size-4 shrink-0 cursor-pointer accent-brand disabled:cursor-not-allowed"
      />
      <span className="flex min-w-0 flex-auto flex-col gap-0.5 text-[13px] leading-normal">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span id={titleId} className={joinClassNames('font-semibold', !isInstalled && 'text-muted')}>
            Use {shortName} on this computer
          </span>
          {!localCli && <span className="text-muted">Looking…</span>}
          {localCli?.installed && (
            <span className="flex items-center gap-1 font-medium text-ok-strong">
              <Icon name="check" size={12} />
              {localCli.version ? `Found · ${localCli.version}` : 'Found'}
            </span>
          )}
          {localCli && !localCli.installed && (
            <span className="flex flex-wrap items-baseline gap-x-1.5 text-muted">
              Not installed
              <span aria-hidden="true">·</span>
              <InstallPageLink provider={provider} url={localCli.installUrl} label={`How to install ${shortName}`} />
            </span>
          )}
        </span>
        {signInHint && signInHint.tone !== 'ok' && <span className="text-ink-2">{signInHint.text}</span>}
        {isSelected && <span className="text-[12px] text-muted">{describeLocalCliUsageNote(provider)}</span>}
      </span>
    </li>
  )
}

/**
 * The Welcome screen's compact "More AI tools on this computer" disclosure: Gemini CLI,
 * Cursor CLI, GitHub Copilot CLI, OpenCode and Qwen Code, each with what detection
 * found (version, or "Not installed" with its official install page). A found one can be
 * picked like the cards above; the plan-usage note shows for the picked one. Closed by
 * default so the page stays short.
 */
export function MoreLocalCliTools({ statuses, selectedChoice, onSelect }: MoreLocalCliToolsProps) {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <details open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)} className="group rounded-[14px] border border-line-strong bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[13px] [&::-webkit-details-marker]:hidden">
        <span className="text-muted transition-transform group-open:rotate-90" aria-hidden="true">
          <Icon name="chevronRight" size={14} />
        </span>
        <span className="font-semibold">More AI tools on this computer</span>
        <span className="text-muted">· {describeFoundCount(statuses)}</span>
      </summary>
      <div className="flex flex-col gap-1 px-2 pb-3">
        <p className="m-0 px-3 pb-1 text-[12px] leading-normal text-muted">
          Experimental · Gemini CLI, Cursor, GitHub Copilot, OpenCode or Qwen Code, with the sign-in they already have. Each runs with no tools and counts against its own plan
        </p>
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {moreLocalCliProviders.map((provider) => (
            <ToolRow key={provider} provider={provider} status={findStatus(statuses, provider)} isSelected={selectedChoice === provider} onSelect={onSelect} />
          ))}
        </ul>
      </div>
    </details>
  )
}
