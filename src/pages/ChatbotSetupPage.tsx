import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '@/components/layout'
import { joinClassNames } from '@/components/ui'
import { initialChatbotKnowledgeFiles, initialChatbotPersona, initialHandoffRules, type ChatbotKnowledgeFile, type HandoffRule } from '@/data/chatbotSetup'
import { routePaths } from '@/routes'
import { ChannelsSection, HandoffRulesSection, KnowledgeFilesSection, PersonaSection } from './chatbot-setup/ChatbotSetupSections'
import { TryItPanel } from './chatbot-setup/TryItPanel'
import { compactButtonClassNames } from './knowledge/FormControls'
import { detectSourceType } from './knowledge/SourceTypeTile'
import { useFilePicker } from './knowledge/useFilePicker'

function createKnowledgeFile(fileName: string, sequenceNumber: number): ChatbotKnowledgeFile {
  return { id: `added-${sequenceNumber}`, name: fileName, type: detectSourceType(fileName), progress: { kind: 'reading', percent: 0 } }
}

function ChatbotSetupHeader({ isLive, onToggleLive }: { isLive: boolean; onToggleLive: () => void }) {
  return (
    <header className="box-border flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3">
      <div className="flex items-center gap-2.5">
        <h1 className="m-0 text-[16px] font-semibold">Catering assistant</h1>
        <span className="rounded-full bg-brand-soft px-2 py-[3px] text-[12px] font-semibold text-brand-strong">Chatbot</span>
        <span role="status" className={joinClassNames('rounded-full px-2 py-[3px] text-[12px] font-medium', isLive ? 'bg-ok-soft text-ok-strong' : 'bg-selected text-ink-2')}>
          {isLive ? 'Live' : 'Not live yet'}
        </span>
      </div>
      <div className="flex gap-2">
        <Link to={routePaths.builder} className={compactButtonClassNames('secondary')}>
          Open steps
        </Link>
        <button type="button" onClick={onToggleLive} className={compactButtonClassNames('primary')}>
          {isLive ? 'Pause' : 'Go live'}
        </button>
      </div>
    </header>
  )
}

/**
 * Screen 14 · Chatbot setup ("Catering assistant").
 * Left: the setup form (persona, knowledge files, channels, hand-off rules), all controlled locally.
 * Right: "Try it", a WhatsApp-styled preview that answers from the mock knowledge.
 * "Go live" toggles the live badge; "Manage" opens the knowledge detail (18); Telegram "Connect" opens Connections (21).
 */
export function ChatbotSetupPage() {
  const [isLive, setIsLive] = useState(false)
  const [persona, setPersona] = useState(initialChatbotPersona)
  const [knowledgeFiles, setKnowledgeFiles] = useState<ChatbotKnowledgeFile[]>(initialChatbotKnowledgeFiles)
  const [isWhatsAppEnabled, setIsWhatsAppEnabled] = useState(true)
  const [handoffRules, setHandoffRules] = useState<HandoffRule[]>(initialHandoffRules)
  const { openFilePicker, filePickerInput } = useFilePicker(
    (fileNames) =>
      setKnowledgeFiles((previousFiles) => [...previousFiles, ...fileNames.map((fileName, index) => createKnowledgeFile(fileName, previousFiles.length + index))]),
    'Choose knowledge files',
  )

  function toggleHandoffRule(ruleId: string, isEnabled: boolean) {
    setHandoffRules((previousRules) => previousRules.map((rule) => (rule.id === ruleId ? { ...rule, isEnabled } : rule)))
  }

  return (
    <AppShell agents={{ kind: 'list', activeAgentId: 'catering-assistant' }} mainClassName="flex flex-col">
      <ChatbotSetupHeader isLive={isLive} onToggleLive={() => setIsLive((wasLive) => !wasLive)} />
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
        <TryItPanel />
      </div>
    </AppShell>
  )
}
