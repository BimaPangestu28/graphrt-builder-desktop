import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { setAgentStatus } from '@/api/agents'
import type { Agent } from '@/api/types'
import { AppShell } from '@/components/layout'
import { TrustedHostsSection } from '@/components/TrustedHostsSection'
import { joinClassNames } from '@/components/ui'
import { useAgent } from '@/hooks/useAgent'
import { agentPath } from '@/routes'
import { ChannelsSection, HandoffRulesSection, PersonaSection } from './chatbot-setup/ChatbotSetupSections'
import { KnowledgeSection } from './chatbot-setup/KnowledgeSection'
import { TryItPanel } from './chatbot-setup/TryItPanel'
import { useChatbotSetupForm, type ChatbotSetupForm } from './chatbot-setup/useChatbotSetupForm'
import { compactButtonClassNames } from './knowledge/FormControls'
import { messages } from '@/i18n'

/** Chatbot opened when the URL names none (the sample "Catering assistant"). */
const defaultChatbotId = 'catering-assistant'

interface ChatbotSetupHeaderProps {
  agent: Agent | null
  onToggleLive: () => void
  isSaving: boolean
}

function ChatbotSetupHeader({ agent, onToggleLive, isSaving }: ChatbotSetupHeaderProps) {
  const isLive = agent?.status === 'active'
  return (
    <header className="box-border flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3">
      <div className="flex items-center gap-2.5">
        <h1 className="m-0 text-[16px] font-semibold">{agent?.name ?? messages().chatbot.chatbot}</h1>
        <span className="rounded-full bg-brand-soft px-2 py-[3px] text-[12px] font-semibold text-brand-strong">{messages().chatbot.chatbot}</span>
        <span role="status" className={joinClassNames('rounded-full px-2 py-[3px] text-[12px] font-medium', isLive ? 'bg-ok-soft text-ok-strong' : 'bg-selected text-ink-2')}>
          {isLive ? messages().chatbot.live : agent?.status === 'paused' ? messages().chatbot.paused : messages().chatbot.notLiveYet}
        </span>
      </div>
      <div className="flex gap-2">
        <Link to={agentPath('builder', agent?.id ?? defaultChatbotId)} className={compactButtonClassNames('secondary')}>
          {messages().chatbot.openSteps}
        </Link>
        <button type="button" onClick={onToggleLive} disabled={!agent || isSaving} className={compactButtonClassNames('primary')}>
          {isLive ? messages().chatbot.pause : messages().chatbot.goLive}
        </button>
      </div>
    </header>
  )
}

function SaveBar({ form }: { form: ChatbotSetupForm }) {
  const status = form.hasJustSaved
    ? messages().chatbot.savedTheBotUsesItFrom
    : form.savedSetup?.isSaved === false
      ? messages().chatbot.notSavedYetUntilThenThe
      : null
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={!form.isDirty || form.isBusy} className={compactButtonClassNames('primary')}>
        {form.isBusy ? messages().chatbot.saving : messages().chatbot.saveChanges}
      </button>
      {status && (
        <span role="status" className="text-[13px] text-muted">
          {status}
        </span>
      )}
    </div>
  )
}

function ChatbotSetupFormView({ form }: { form: ChatbotSetupForm }) {
  const { draft, savedSetup } = form
  if (!draft || !savedSetup) return form.error ? null : <p className="m-0 text-muted">{messages().chatbot.loadingTheSetup}</p>
  const toggleChannel = (channelId: string, isEnabled: boolean) => {
    const others = draft.disabledChannels.filter((disabledId) => disabledId !== channelId)
    form.setDraft({ ...draft, disabledChannels: isEnabled ? others : [...others, channelId] })
  }
  return (
    <>
      <PersonaSection persona={draft.persona} onChange={(persona) => form.setDraft({ ...draft, persona })} />
      <KnowledgeSection
        attached={form.attachedKnowledge}
        available={form.availableKnowledge}
        isBusy={form.isBusy}
        onAttach={(knowledgeBaseId) => void form.attach(knowledgeBaseId)}
        onDetach={(knowledgeBaseId) => void form.detach(knowledgeBaseId)}
      />
      <ChannelsSection channels={savedSetup.channels} disabledChannels={draft.disabledChannels} onToggle={toggleChannel} />
      <HandoffRulesSection
        handoffRules={draft.handoffRules}
        onToggle={(ruleKey, isEnabled) => form.setDraft({ ...draft, handoffRules: { ...draft.handoffRules, [ruleKey]: isEnabled } })}
      />
      <SaveBar form={form} />
    </>
  )
}

/**
 * Screen 14 · Chatbot setup ("Catering assistant").
 * Left: the setup form. Persona, channels and hand-off rules are saved with "Save changes";
 * knowledge bases are attached or removed at once. The saved setup is applied to every bot
 * reply (see `src-tauri/src/chatbot_setup`). Right: "Try it", a real test conversation with
 * the chatbot (`?agentId=`, default "catering-assistant"). "Go live" / "Pause" set the agent
 * status; unconnected channels link to Connections → Plugins. Below the form, the sites the
 * chatbot may look things up on (a chat cannot wait for an approval), saved at once.
 */
export function ChatbotSetupPage() {
  const [searchParams] = useSearchParams()
  const agentId = searchParams.get('agentId') ?? defaultChatbotId
  const { data: agent, reload: reloadAgent } = useAgent(agentId)
  const [isSavingStatus, setIsSavingStatus] = useState(false)
  const form = useChatbotSetupForm(agentId)

  async function toggleLive() {
    if (!agent) return
    setIsSavingStatus(true)
    try {
      await setAgentStatus(agent.id, agent.status === 'active' ? 'paused' : 'active')
      await reloadAgent()
    } catch (statusError) {
      console.error('Could not change the chatbot status', statusError)
    } finally {
      setIsSavingStatus(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void form.save()
  }

  return (
    <AppShell agents={{ kind: 'list', activeAgentId: agentId }} mainClassName="flex flex-col">
      <ChatbotSetupHeader agent={agent} onToggleLive={() => void toggleLive()} isSaving={isSavingStatus} />
      <div className="flex flex-auto flex-wrap">
        <div className="box-border flex min-w-0 flex-[3_1_520px] flex-col gap-7 px-8 py-7">
          <form onSubmit={handleSubmit} className="flex flex-col gap-7">
            {form.error && (
              <p role="alert" className="m-0 rounded-[10px] bg-amber-tint px-3.5 py-2.5 text-[13px] text-amber-strong">
                {form.error}
              </p>
            )}
            <ChatbotSetupFormView form={form} />
          </form>
          <TrustedHostsSection agentId={agentId} note={messages().chatbot.aChatCannotStopToAsk} />
        </div>
        <TryItPanel agentId={agentId} />
      </div>
    </AppShell>
  )
}
