import { Link } from 'react-router-dom'
import type { ChatbotChannel, ChatbotPersona, HandoffRules } from '@/api/chatbotSetupTypes'
import { joinClassNames } from '@/components/ui'
import { chatbotToneOptions, describeTone, handoffRuleOptions } from '@/pages/chatbot-setup/chatbotSetupOptions'
import { agentPath } from '@/routes'
import { CheckboxRow, LabeledField, SectionHeading, fieldControlClassNames } from '../knowledge/FormControls'
import { messages } from '@/i18n'

/**
 * Persona, channels and hand-off rules of the chatbot setup form (screen 14). Each is
 * controlled by the page; the knowledge section lives in `KnowledgeSection`.
 */

export const listRowClassNames = 'flex items-center gap-3 px-3.5 py-3'

/** The tone choices, keeping a saved tone that is not one of them. */
function toneChoices(currentTone: string): string[] {
  const choices: string[] = [...chatbotToneOptions]
  if (currentTone && !choices.includes(currentTone)) choices.push(currentTone)
  return choices
}

export function PersonaSection({ persona, onChange }: { persona: ChatbotPersona; onChange: (persona: ChatbotPersona) => void }) {
  return (
    <section aria-labelledby="p-h" className="flex flex-col gap-3">
      <SectionHeading id="p-h">{messages().chatbot.persona}</SectionHeading>
      <div className="grid grid-cols-2 gap-2.5">
        <LabeledField label={messages().chatbot.nameCustomersSee}>
          <input type="text" value={persona.displayName} onChange={(event) => onChange({ ...persona, displayName: event.target.value })} className={fieldControlClassNames} />
        </LabeledField>
        <LabeledField label={messages().chatbot.tone}>
          <select value={persona.tone} onChange={(event) => onChange({ ...persona, tone: event.target.value })} className={joinClassNames(fieldControlClassNames, 'px-2.5')}>
            {persona.tone === '' && <option value="">{messages().chatbot.chooseATone}</option>}
            {toneChoices(persona.tone).map((toneOption) => (
              <option key={toneOption} value={toneOption}>
                {describeTone(toneOption)}
              </option>
            ))}
          </select>
        </LabeledField>
      </div>
      <LabeledField label={messages().chatbot.whatItShouldDo}>
        <textarea
          rows={3}
          value={persona.instructions}
          placeholder={messages().chatbot.forExampleAnswerQuestionsAboutOur}
          onChange={(event) => onChange({ ...persona, instructions: event.target.value })}
          className="resize-y rounded-[10px] border border-line-strong px-3 py-2.5 text-[14px] leading-[1.55] text-ink outline-none focus:border-brand"
        />
      </LabeledField>
    </section>
  )
}

interface ChannelsSectionProps {
  agentId: string
  channels: ChatbotChannel[]
  disabledChannels: string[]
  onToggle: (channelId: string, isEnabled: boolean) => void
  /** Its online copy serves a chat page, so the website bubble already works. */
  hasOnlineChatPage?: boolean
}

/** The connect step (screen 05) with this channel's card chosen. */
function connectPath(agentId: string, channelId: string): string {
  return `${agentPath('connectWhatsApp', agentId)}?channel=${encodeURIComponent(channelId)}`
}

interface ChannelRowProps {
  agentId: string
  channel: ChatbotChannel
  isEnabled: boolean
  onToggle: (isEnabled: boolean) => void
}

function ChannelRow({ agentId, channel, isEnabled, onToggle }: ChannelRowProps) {
  if (!channel.connected) {
    return (
      <div className={joinClassNames(listRowClassNames, 'border-b border-chip')}>
        <span className="flex flex-auto flex-col">
          <span className="font-medium">{channel.name}</span>
          <span className="text-[12px] text-muted">{messages().chatbot.notConnected}</span>
        </span>
        <Link
          to={connectPath(agentId, channel.id)}
          aria-label={messages().chatbot.connectName(channel.name)}
          className="inline-flex h-8 items-center rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium no-underline !text-ink hover:bg-subtle"
        >
          {messages().chatbot.connect}
        </Link>
      </div>
    )
  }
  return (
    <label className={joinClassNames(listRowClassNames, 'cursor-pointer border-b border-chip')}>
      <span className="flex flex-auto flex-col">
        <span className="font-medium">{channel.name}</span>
        <span className="text-[12px] text-muted">{channel.detail ?? messages().chatbot.connected}</span>
      </span>
      <input type="checkbox" checked={isEnabled} onChange={(event) => onToggle(event.target.checked)} className="size-[18px] accent-brand" />
    </label>
  )
}

export function ChannelsSection({ agentId, channels, disabledChannels, onToggle, hasOnlineChatPage = false }: ChannelsSectionProps) {
  return (
    <section aria-labelledby="c-h" className="flex flex-col gap-3">
      <SectionHeading id="c-h">{messages().chatbot.whereItAnswers}</SectionHeading>
      <div className="rounded-xl border border-line">
        {channels.map((channel) => (
          <ChannelRow
            key={channel.id}
            agentId={agentId}
            channel={channel}
            isEnabled={!disabledChannels.includes(channel.id)}
            onToggle={(isEnabled) => onToggle(channel.id, isEnabled)}
          />
        ))}
        <div className={listRowClassNames}>
          <span className="flex flex-auto flex-col">
            <span className="font-medium">{messages().chatbot.websiteChatBubble}</span>
            <span className="text-[12px] text-muted">
              {hasOnlineChatPage ? messages().chatbot.onItsOnlineChatPage : messages().chatbot.worksWhenGraphrtRunsOnA}
            </span>
          </span>
          {hasOnlineChatPage ? (
            <Link
              to={agentPath('builder', agentId)}
              className="inline-flex h-8 shrink-0 items-center rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium no-underline !text-ink hover:bg-subtle"
            >
              {messages().chatbot.getTheLink}
            </Link>
          ) : (
            <span className="shrink-0 rounded-full bg-selected px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-ink-2">{messages().chatbot.needsAServer}</span>
          )}
        </div>
      </div>
    </section>
  )
}

export function HandoffRulesSection({ handoffRules, onToggle }: { handoffRules: HandoffRules; onToggle: (ruleKey: keyof HandoffRules, isEnabled: boolean) => void }) {
  return (
    <section aria-labelledby="h-h" className="flex flex-col gap-2.5">
      <SectionHeading id="h-h">{messages().chatbot.passTheChatToMeWhen}</SectionHeading>
      {handoffRuleOptions.map((rule) => (
        <CheckboxRow key={rule.key} checked={handoffRules[rule.key]} onChange={(isEnabled) => onToggle(rule.key, isEnabled)}>
          {rule.label}
        </CheckboxRow>
      ))}
    </section>
  )
}
