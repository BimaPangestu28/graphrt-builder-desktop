import { useEffect, useId, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { getAgent } from '@/api/agents'
import { getWhatsAppBusinessSetup, getTeamsSetup } from '@/api/channels'
import type { ChatAudience, OnlineFeatures } from '@/api/deployTypes'
import { joinClassNames } from '@/components/ui'
import { messages } from '@/i18n'
import { allGuestsMessagesPerMinute, guestMessagesPerMinute, withFeatureChange, type FeaturesAvailability } from './onlineFeatures'

interface OnlineFeaturesFormProps {
  value: OnlineFeatures
  onChange: (features: OnlineFeatures) => void
  /** Who bills the storage of paired phones; absent for a server the IT team runs. */
  providerName?: string
  availability?: FeaturesAvailability
  /** The phone page was on in the online copy: say what turning it off removes. */
  phoneWasOn?: boolean
}

/** Whether a channel of the online copy can be offered: only for a chatbot, and ready once its values are saved. */
type ChannelOffer = 'ready' | 'needs_values' | null

/** The WhatsApp Business and Teams offers for the chatbot in the route (`null` for other agents). */
function useChannelOffers(): { whatsApp: ChannelOffer; teams: ChannelOffer } {
  const { agentId } = useParams()
  const [offers, setOffers] = useState<{ whatsApp: ChannelOffer; teams: ChannelOffer }>({ whatsApp: null, teams: null })
  useEffect(() => {
    if (!agentId) return
    let isCurrent = true
    const offerOf = (saved: boolean): ChannelOffer => (saved ? 'ready' : 'needs_values')
    getAgent(agentId)
      .then(async (agent) => {
        if (agent.kind !== 'chatbot') return { whatsApp: null, teams: null }
        const [whatsApp, teams] = await Promise.all([getWhatsAppBusinessSetup(agentId), getTeamsSetup(agentId)])
        return { whatsApp: offerOf(whatsApp.saved), teams: offerOf(teams.saved) }
      })
      .then(
        (next) => isCurrent && setOffers(next),
        () => isCurrent && setOffers({ whatsApp: null, teams: null }),
      )
    return () => {
      isCurrent = false
    }
  }, [agentId])
  return offers
}

const fieldClassName = 'box-border h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[14px] text-ink disabled:opacity-60'

function FeatureCard({ title, detail, checked, onToggle, disabled, children }: { title: string; detail: string; checked: boolean; onToggle: (checked: boolean) => void; disabled: boolean; children?: ReactNode }) {
  return (
    <div className={joinClassNames('flex flex-col gap-3 rounded-[14px] border bg-surface p-4', checked ? 'border-ink' : 'border-line')}>
      <label className={joinClassNames('flex items-start gap-2.5', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onToggle(event.target.checked)} className="mt-1 size-4 accent-[var(--color-ink)]" />
        <span className="flex flex-col">
          <span className="font-semibold">{title}</span>
          <span className="text-[13px] leading-normal text-body">{detail}</span>
        </span>
      </label>
      {checked && children}
    </div>
  )
}

function RadioOption({ name, title, detail, checked, onSelect, disabled }: { name: string; title: string; detail: string; checked: boolean; onSelect: () => void; disabled: boolean }) {
  return (
    <label className={joinClassNames('flex cursor-pointer items-start gap-2.5 rounded-[10px] border px-3 py-2.5', checked ? 'border-ink' : 'border-line')}>
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onSelect} className="mt-1 accent-[var(--color-ink)]" />
      <span className="flex flex-col">
        <span className="font-medium">{title}</span>
        <span className="text-[13px] leading-normal text-body">{detail}</span>
      </span>
    </label>
  )
}

/**
 * The choices of an online agent, as three wide cards: a chat page (who may chat, the website
 * for the chat bubble), following it from a phone (with notifications) and what happens to a
 * request nobody answers in time. Everything is off by default. The cost of the phone page is
 * said before it is turned on.
 */
export function OnlineFeaturesForm({ value, onChange, providerName, availability = 'ready', phoneWasOn = false }: OnlineFeaturesFormProps) {
  const text = messages().deploy.sharing
  const audienceName = useId()
  const expiryName = useId()
  const siteId = useId()
  const emailId = useId()
  const isDisabled = availability !== 'ready'
  const change = (next: Partial<OnlineFeatures>) => onChange(withFeatureChange(value, next))
  const { whatsApp: whatsAppOffer, teams: teamsOffer } = useChannelOffers()
  const channels = messages().channels
  const audiences: Array<{ audience: ChatAudience; title: string; detail: string }> = [
    { audience: 'guests', title: text.audienceGuestsTitle, detail: text.audienceGuestsDetail(guestMessagesPerMinute, allGuestsMessagesPerMinute) },
    { audience: 'key', title: text.audienceKeyTitle, detail: text.audienceKeyDetail },
  ]
  return (
    <section aria-label={text.sectionTitle} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="m-0 text-[14px] font-semibold">{text.sectionTitle}</h3>
        <span className="text-[13px] text-body">{text.sectionHint}</span>
      </div>
      {availability !== 'ready' && (
        <p role="status" className="m-0 rounded-[12px] border border-line bg-subtle px-4 py-3 text-[13px] leading-normal text-ink-2">
          {availability === 'needs_newer_tools' ? text.needNewerTools : text.downloadToolsFirst}
        </p>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-3">
        <FeatureCard title={text.chatTitle} detail={text.chatDetail} checked={value.chat} disabled={isDisabled} onToggle={(chat) => change({ chat })}>
          <div role="radiogroup" aria-label={text.whoMayChat} className="flex flex-col gap-2">
            {audiences.map((option) => (
              <RadioOption key={option.audience} name={audienceName} title={option.title} detail={option.detail} checked={value.chatAudience === option.audience} disabled={isDisabled} onSelect={() => change({ chatAudience: option.audience })} />
            ))}
          </div>
          <label htmlFor={siteId} className="flex flex-col gap-1.5 text-[13px] text-ink-2">
            {text.embedSiteLabel}
            <input
              id={siteId}
              value={value.embedSite ?? ''}
              disabled={isDisabled}
              onChange={(event) => change({ embedSite: event.target.value || null })}
              placeholder={text.embedSitePlaceholder}
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
              className={fieldClassName}
            />
            <span className="text-[12px] text-muted">{text.embedSiteHint}</span>
          </label>
        </FeatureCard>
        <div className="flex flex-col gap-2">
          <FeatureCard title={text.phoneTitle} detail={text.phoneDetail} checked={value.phone} disabled={isDisabled} onToggle={(phone) => change({ phone })}>
            <label className={joinClassNames('flex items-start gap-2.5', isDisabled ? 'opacity-60' : 'cursor-pointer')}>
              <input type="checkbox" checked={value.notifications} disabled={isDisabled} onChange={(event) => change({ notifications: event.target.checked })} className="mt-1 size-4 accent-[var(--color-ink)]" />
              <span className="flex flex-col">
                <span className="font-medium">{text.notificationsTitle}</span>
                <span className="text-[13px] leading-normal text-body">{text.notificationsDetail}</span>
              </span>
            </label>
            {value.notifications && (
              <label htmlFor={emailId} className="flex flex-col gap-1.5 text-[13px] text-ink-2">
                {text.notifyEmailLabel}
                <input
                  id={emailId}
                  type="email"
                  value={value.notifyEmail ?? ''}
                  disabled={isDisabled}
                  onChange={(event) => change({ notifyEmail: event.target.value || null })}
                  placeholder={text.notifyEmailPlaceholder}
                  autoComplete="email"
                  className={fieldClassName}
                />
                <span className="text-[12px] text-muted">{text.notifyEmailHint}</span>
              </label>
            )}
          </FeatureCard>
          {/* The cost is said before the box is ticked, not after. */}
          <span className="px-1 text-[12px] leading-normal text-muted">{providerName ? text.phoneCost(providerName) : text.phoneCostOwnServer}</span>
          {phoneWasOn && !value.phone && (
            <span role="status" className="px-1 text-[12px] leading-normal text-amber-strong">
              {text.phoneTurningOff}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-4">
          <span className="font-semibold">{text.expiryTitle}</span>
          <div role="radiogroup" aria-label={text.expiryTitle} className="flex flex-col gap-2">
            <RadioOption name={expiryName} title={text.expiryWait} detail={text.expiryWaitDetail} checked={!value.answerWhenTimeRunsOut} disabled={isDisabled} onSelect={() => change({ answerWhenTimeRunsOut: false })} />
            <RadioOption name={expiryName} title={text.expiryAct} detail={text.expiryActDetail} checked={value.answerWhenTimeRunsOut} disabled={isDisabled} onSelect={() => change({ answerWhenTimeRunsOut: true })} />
          </div>
        </div>
        {whatsAppOffer !== null && (
          <div className="flex flex-col gap-2">
            <FeatureCard
              title={channels.onlineWhatsAppTitle}
              detail={channels.onlineWhatsAppDetail}
              checked={value.whatsapp}
              disabled={isDisabled || (whatsAppOffer === 'needs_values' && !value.whatsapp)}
              onToggle={(whatsapp) => change({ whatsapp })}
            />
            {whatsAppOffer === 'needs_values' && <span className="px-1 text-[12px] leading-normal text-muted">{channels.onlineWhatsAppNeedsValues}</span>}
          </div>
        )}
        {teamsOffer !== null && (
          <div className="flex flex-col gap-2">
            <FeatureCard
              title={channels.onlineTeamsTitle}
              detail={channels.onlineTeamsDetail}
              checked={value.teams}
              disabled={isDisabled || (teamsOffer === 'needs_values' && !value.teams)}
              onToggle={(teams) => change({ teams })}
            />
            {teamsOffer === 'needs_values' && <span className="px-1 text-[12px] leading-normal text-muted">{channels.onlineTeamsNeedsValues}</span>}
          </div>
        )}
      </div>
    </section>
  )
}
