import { useCallback, useEffect, useRef, useState } from 'react'
import { getCredentialStoreName } from '@/lib/platform'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { getAgent } from '@/api/agents'
import type { AgentKind } from '@/api/types'
import { Icon } from '@/components/ui'
import { useBrowserRuntime } from '@/hooks/useBrowserRuntime'
import { usePlugins } from '@/hooks/usePlugins'
import { agentPath, routePaths } from '@/routes'
import { BuilderBackdropSkeleton } from './connect-whatsapp/BuilderBackdropSkeleton'
import { BusinessApiSetup } from './connect-whatsapp/BusinessApiSetup'
import { PersonalWhatsAppSetup } from './connect-whatsapp/PersonalWhatsAppSetup'
import { WhatsAppOptionPicker } from './connect-whatsapp/WhatsAppOptionPicker'
import { findChannelOption, type ChannelOptionId } from './connect-whatsapp/channelOptions'
import { SlackSetup } from './connect-whatsapp/SlackSetup'
import { TeamsSetup } from './connect-whatsapp/TeamsSetup'
import { TelegramSetup } from './connect-whatsapp/TelegramSetup'
import { PersonalWhatsAppChannel, WhatsAppBusinessChannel } from './connect-whatsapp/WhatsAppChatbotChannels'
import { LockIcon } from './agent-builder/LockIcon'
import { messages } from '@/i18n'

/** The kind of the agent in the route, once loaded (`null` while loading or unknown). */
function useAgentKind(agentId: string | undefined): AgentKind | null {
  const [kind, setKind] = useState<AgentKind | null>(null)
  useEffect(() => {
    if (!agentId) return
    let isCurrent = true
    getAgent(agentId).then(
      (agent) => isCurrent && setKind(agent.kind),
      () => isCurrent && setKind(null),
    )
    return () => {
      isCurrent = false
    }
  }, [agentId])
  return kind
}

interface SelectedOptionSetupProps {
  selectedOption: ChannelOptionId | null
  agentId: string | undefined
  agentKind: AgentKind | null
}

/** The chosen option's setup steps; a chatbot also gets the steps that let it answer customers. */
function SelectedOptionSetup({ selectedOption, agentId, agentKind }: SelectedOptionSetupProps) {
  const plugins = usePlugins()
  const browserRuntime = useBrowserRuntime()
  const chatbotId = agentKind === 'chatbot' ? agentId : undefined
  if (selectedOption === 'telegram') {
    if (chatbotId) return <TelegramSetup agentId={chatbotId} />
    return <p className="m-0 text-[13px] text-body">{messages().channels.onlyForChatbots}</p>
  }
  if (selectedOption === 'slack') {
    if (chatbotId) return <SlackSetup agentId={chatbotId} />
    return <p className="m-0 text-[13px] text-body">{messages().channels.onlyForChatbots}</p>
  }
  if (selectedOption === 'teams') {
    if (chatbotId) return <TeamsSetup agentId={chatbotId} />
    return <p className="m-0 text-[13px] text-body">{messages().channels.onlyForChatbots}</p>
  }
  if (selectedOption === 'business') {
    return (
      <div className="flex flex-col gap-5">
        {chatbotId && <WhatsAppBusinessChannel agentId={chatbotId} />}
        <BusinessApiSetup plugins={plugins} />
      </div>
    )
  }
  if (selectedOption === 'personal') {
    return (
      <div className="flex flex-col gap-5">
        <PersonalWhatsAppSetup plugins={plugins} browserRuntime={browserRuntime} />
        {chatbotId && <PersonalWhatsAppChannel agentId={chatbotId} />}
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 text-[13px] text-ink-2">
      <LockIcon />
      {messages().chatbot.tokensStayIn}{' '}{getCredentialStoreName()} {messages().chatbot.andTheWhatsappSessionStaysOn}
    </div>
  )
}

/**
 * Screen 05 · Connect a channel. Modal opened from the builder's "Connect" button and from a
 * chatbot's "Where it answers" (`?channel=telegram|whatsapp|whatsapp-web` picks the card):
 * - Telegram: a bot token from @BotFather, tested, then connected (chatbots);
 * - WhatsApp Business (`whatsapp-api` plugin: install, trust, token and phone number ID,
 *   check connection); a chatbot also answers customers on it from its online copy;
 * - a personal number linked by QR code (`whatsapp-web` plugin: Terms of Service warning,
 *   install, trust, browser runtime, QR code); a chatbot can answer it.
 * Close (or Escape) returns to the builder (04).
 */
export function ConnectWhatsAppPage() {
  const navigate = useNavigate()
  const { agentId } = useParams()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [searchParams] = useSearchParams()
  const [selectedOption, setSelectedOption] = useState<ChannelOptionId | null>(() => findChannelOption(searchParams.get('channel')))
  const agentKind = useAgentKind(agentId)
  // Back to the builder of the agent in the route (`/agents/:agentId/connect-whatsapp`).
  const closeDialog = useCallback(() => navigate(agentId ? agentPath('builder', agentId) : routePaths.home), [navigate, agentId])

  useEffect(() => {
    closeButtonRef.current?.focus()
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeDialog()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeDialog])

  return (
    <div className="relative box-border flex min-h-screen w-full flex-wrap bg-canvas text-[14px] text-ink">
      <BuilderBackdropSkeleton />
      <div className="absolute inset-0 box-border flex items-center justify-center bg-[rgba(24,24,27,0.45)] p-6">
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="wa-title"
          className="box-border flex max-h-full w-full max-w-[1040px] flex-col gap-5 overflow-y-auto rounded-[20px] bg-surface p-8 shadow-[0_24px_64px_rgba(0,0,0,0.18)]"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 id="wa-title" className="m-0 text-[24px] font-semibold">
              {messages().channels.connectAChannel}
            </h2>
            <button
              ref={closeButtonRef}
              type="button"
              aria-label={messages().chatbot.close}
              onClick={closeDialog}
              className="flex size-9 cursor-pointer items-center justify-center rounded-lg border-0 bg-canvas text-ink-2 hover:bg-selected"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          <WhatsAppOptionPicker selectedOption={selectedOption} onSelect={setSelectedOption} />
          <SelectedOptionSetup selectedOption={selectedOption} agentId={agentId} agentKind={agentKind} />
        </section>
      </div>
    </div>
  )
}
