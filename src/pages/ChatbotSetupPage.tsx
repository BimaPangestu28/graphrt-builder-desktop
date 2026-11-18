import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { setAgentStatus } from '@/api/agents'
import type { Agent } from '@/api/types'
import { AppShell } from '@/components/layout'
import { joinClassNames } from '@/components/ui'
import { useAgent } from '@/hooks/useAgent'
import { initialChatbotKnowledgeFiles, initialChatbotPersona, initialHandoffRules, type ChatbotKnowledgeFile, type HandoffRule } from '@/data/chatbotSetup'
import { agentPath } from '@/routes'
import { ChannelsSection, HandoffRulesSection, KnowledgeFilesSection, PersonaSection } from './chatbot-setup/ChatbotSetupSections'
import { TryItPanel } from './chatbot-setup/TryItPanel'
import { compactButtonClassNames } from './knowledge/FormControls'
import { detectSourceType } from './knowledge/SourceTypeTile'
import { useFilePicker } from './knowledge/useFilePicker'

function createKnowledgeFile(fileName: string, sequenceNumber: number): ChatbotKnowledgeFile {
  return { id: `added-${sequenceNumber}`, name: fileName, type: detectSourceType(fileName), progress: { kind: 'reading', percent: 0 } }
}

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
        <h1 className="m-0 text-[16px] font-semibold">{agent?.name ?? 'Chatbot'}</h1>
        <span className="rounded-full bg-brand-soft px-2 py-[3px] text-[12px] font-semibold text-brand-strong">Chatbot</span>
        <span role="status" className={joinClassNames('rounded-full px-2 py-[3px] text-[12px] font-medium', isLive ? 'bg-ok-soft text-ok-strong' : 'bg-selected text-ink-2')}>
          {isLive ? 'Live' : agent?.status === 'paused' ? 'Paused' : 'Not live yet'}
        </span>
      </div>
      <div className="flex gap-2">
        <Link to={agentPath('builder', agent?.id ?? defaultChatbotId)} className={compactButtonClassNames('secondary')}>
          Open steps
        </Link>
        <button type="button" onClick={onToggleLive} disabled={!agent || isSaving} className={compactButtonClassNames('primary')}>
          {isLive ? 'Pause' : 'Go live'}
        </button>
      </div>
    </header>
  )
}

/**
 * Screen 14 · Chatbot setup ("Catering assistant").
 * Left: the setup form (persona, knowledge files, channels, hand-off rules), all controlled locally.
 * Right: "Try it", a real test conversation with the chatbot (`?agentId=`, default "catering-assistant").
 * "Go live" / "Pause" set the agent status (active / paused); "Manage" opens the knowledge detail (18);
 * Telegram "Connect" opens Connections (21).
 */
export function ChatbotSetupPage() {
  const [searchParams] = useSearchParams()
  const agentId = searchParams.get('agentId') ?? defaultChatbotId
  const { data: agent, reload: reloadAgent } = useAgent(agentId)
  const [isSavingStatus, setIsSavingStatus] = useState(false)
  const [persona, setPersona] = useState(initialChatbotPersona)
  const [knowledgeFiles, setKnowledgeFiles] = useState<ChatbotKnowledgeFile[]>(initialChatbotKnowledgeFiles)
  const [isWhatsAppEnabled, setIsWhatsAppEnabled] = useState(true)
  const [handoffRules, setHandoffRules] = useState<HandoffRule[]>(initialHandoffRules)
  const { openFilePicker, filePickerInput } = useFilePicker(
    (fileNames) =>
      setKnowledgeFiles((previousFiles) => [...previousFiles, ...fileNames.map((fileName, index) => createKnowledgeFile(fileName, previousFiles.length + index))]),
    'Choose knowledge files',
  )

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

  function toggleHandoffRule(ruleId: string, isEnabled: boolean) {
    setHandoffRules((previousRules) => previousRules.map((rule) => (rule.id === ruleId ? { ...rule, isEnabled } : rule)))
  }

  return (
    <AppShell agents={{ kind: 'list', activeAgentId: agentId }} mainClassName="flex flex-col">
      <ChatbotSetupHeader agent={agent} onToggleLive={() => void toggleLive()} isSaving={isSavingStatus} />
      <div className="flex flex-auto flex-wrap">
        <form onSubmit={(event) => event.preventDefault()} className="box-border flex min-w-0 flex-[3_1_520px] flex-col gap-7 px-8 py-7">
          <PersonaSection persona={persona} onChange={setPersona} />
          <KnowledgeFilesSection
            knowledgeFiles={knowledgeFiles}
            onRemove={(fileId) => setKnowledgeFiles((previousFiles) => previousFiles.filter((knowledgeFile) => knowledgeFile.id !== fileId))}
            onAddFiles={openFilePicker}
          />
          {filePickerInput}
          <ChannelsSection isWhatsAppEnabled={isWhatsAppEnabled} onWhatsAppChange={setIsWhatsAppEnabled} />
          <HandoffRulesSection handoffRules={handoffRules} onToggle={toggleHandoffRule} />
        </form>
        <TryItPanel agentId={agentId} />
      </div>
    </AppShell>
  )
}
