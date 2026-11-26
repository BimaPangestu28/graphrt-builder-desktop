import type { ReactNode } from 'react'
import { Badge, Button, Icon, joinClassNames } from '@/components/ui'
import { messages } from '@/i18n'

export type RunPlace = 'local' | 'online' | 'own_server'

interface PlaceOptionProps {
  place: RunPlace
  selectedPlace: RunPlace
  onSelect: (place: RunPlace) => void
  title: string
  badges?: ReactNode
  detail: string
  icon: ReactNode
}

function PlaceOption({ place, selectedPlace, onSelect, title, badges, detail, icon }: PlaceOptionProps) {
  const isSelected = place === selectedPlace
  return (
    <label
      className={joinClassNames(
        'flex cursor-pointer items-start gap-3.5 rounded-[14px] border bg-surface px-4 py-4',
        isSelected ? 'border-ink shadow-[0_0_0_1px_var(--color-ink)]' : 'border-line hover:border-line-strong',
      )}
    >
      <input type="radio" name="run-place" value={place} checked={isSelected} onChange={() => onSelect(place)} className="mt-1 accent-[var(--color-ink)]" />
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-subtle text-ink-2">{icon}</span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2 font-semibold">
          {title}
          {badges}
        </span>
        <span className="text-[13px] leading-normal text-body">{detail}</span>
      </span>
    </label>
  )
}

const cloudIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 18a5 5 0 0 1-.6-9.96A6 6 0 0 1 17.8 9.1 4.5 4.5 0 0 1 17.5 18H7z" />
  </svg>
)

const serverIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <rect x="4" y="4" width="16" height="7" rx="1.5" />
    <rect x="4" y="13" width="16" height="7" rx="1.5" />
    <path d="M8 7.5h.01M8 16.5h.01" strokeLinecap="round" />
  </svg>
)

interface WhereStepProps {
  agentName: string
  selectedPlace: RunPlace
  onSelect: (place: RunPlace) => void
  connectedServerCount: number
  onNext: () => void
  onCancel: () => void
}

/** "Where should it run?": This computer (default), Online (Beta), and My own server under "For IT teams". */
export function WhereStep({ agentName, selectedPlace, onSelect, connectedServerCount, onNext, onCancel }: WhereStepProps) {
  return (
    <section aria-label={messages().deploy.whereShouldItRun} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-[20px] font-semibold tracking-[-0.2px]">{messages().deploy.whereShouldItRun}</h2>
        <span className="text-body">{agentName} {messages().deploy.youCanChangeThisLater}</span>
      </div>
      <div role="radiogroup" aria-label={messages().deploy.whereItRuns} className="flex flex-col gap-2">
        <PlaceOption
          place="local"
          selectedPlace={selectedPlace}
          onSelect={onSelect}
          title={messages().deploy.thisComputer}
          badges={<Badge>{messages().deploy.default}</Badge>}
          detail={messages().deploy.runsWhileYourComputerIsOn}
          icon={<Icon name="monitor" size={20} />}
        />
        <PlaceOption
          place="online"
          selectedPlace={selectedPlace}
          onSelect={onSelect}
          title={messages().deploy.online2}
          badges={
            <>
              <Badge tone="brand">{messages().deploy.recommendedFor247Agents}</Badge>
              <Badge tone="amber">{messages().deploy.beta}</Badge>
            </>
          }
          detail={messages().deploy.keepThisAgentRunningOnlineEven}
          icon={cloudIcon}
        />
        <details open={selectedPlace === 'own_server'} className="rounded-[14px]">
          <summary className="cursor-pointer py-1.5 text-[13px] font-semibold text-ink-2">{messages().deploy.forItTeams}</summary>
          <div className="mt-2">
            <PlaceOption
              place="own_server"
              selectedPlace={selectedPlace}
              onSelect={onSelect}
              title={messages().deploy.myOwnServer}
              badges={connectedServerCount > 0 ? <Badge tone="ok">{connectedServerCount} {messages().deploy.server}{connectedServerCount === 1 ? '' : 's'} {messages().deploy.connected3}</Badge> : undefined}
              detail={messages().deploy.runItOnAServerYour}
              icon={serverIcon}
            />
          </div>
        </details>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onNext}>{messages().deploy.next}</Button>
        <Button variant="ghost" onClick={onCancel}>
          {messages().deploy.cancel}
        </Button>
        <span className="text-[13px] text-muted">{messages().deploy.nothingGoesOnlineUntilYouReview}</span>
      </div>
    </section>
  )
}
