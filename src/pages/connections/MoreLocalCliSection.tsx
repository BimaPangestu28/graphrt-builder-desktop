import type { ReactNode } from 'react'
import { Icon } from '@/components/ui'
import { isLocalCliProvider, localCliShortNames } from '@/lib/settings'
import type { ModelConnection } from './modelConnections'
import { messages } from '@/i18n'

interface MoreLocalCliSectionProps {
  /** The other local CLIs' connections (Gemini CLI, Cursor CLI, …), in the backend's order. */
  connections: ModelConnection[]
  /** Renders one CLI card (the same `LocalCliCard` Claude Code and Codex use). */
  renderCard: (connection: ModelConnection) => ReactNode
}

/** "Cursor CLI" rather than "Cursor CLI (on this computer)". */
function describeShortName(connection: ModelConnection): string {
  return isLocalCliProvider(connection.provider) ? localCliShortNames[connection.provider] : connection.name
}

const cardGridClassNames = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] gap-3'

/**
 * The AI models tab's "More AI tools on this computer" group: a card for every other CLI
 * graphrt found (Gemini CLI, Cursor CLI, GitHub Copilot CLI, OpenCode, Qwen Code), and
 * the ones that are not installed collapsed under "Other AI tools you can use", each with
 * its official install page and Detect again.
 */
export function MoreLocalCliSection({ connections, renderCard }: MoreLocalCliSectionProps) {
  if (connections.length === 0) return null
  const detected = connections.filter((connection) => connection.localCli?.installed)
  const notInstalled = connections.filter((connection) => !connection.localCli?.installed)
  return (
    <div role="group" aria-labelledby="connections-more-local-cli-h" className="flex min-w-0 flex-col gap-3 pt-2">
      <div className="flex flex-col gap-0.5">
        <h3 id="connections-more-local-cli-h" className="m-0 text-[14px] font-semibold">
          {messages().connections.moreAiToolsOnThisComputer}
        </h3>
        <p className="m-0 text-[13px] leading-normal text-muted">
          {detected.length > 0
            ? messages().connections.experimentalLikeTheOnesAboveEach
            : messages().connections.noneOfTheseWereFoundOn}
        </p>
      </div>
      {detected.length > 0 && <div className={cardGridClassNames}>{detected.map(renderCard)}</div>}
      {notInstalled.length > 0 && (
        <details className="group flex flex-col rounded-[14px] border border-line bg-subtle">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[13px] [&::-webkit-details-marker]:hidden">
            <span className="text-muted transition-transform group-open:rotate-90" aria-hidden="true">
              <Icon name="chevronRight" size={14} />
            </span>
            <span className="font-semibold">{messages().connections.otherAiToolsYouCanUse}</span>
            <span className="text-muted">· {notInstalled.map(describeShortName).join(', ')}</span>
          </summary>
          <div className={`${cardGridClassNames} px-3 pb-3`}>{notInstalled.map(renderCard)}</div>
        </details>
      )}
    </div>
  )
}
