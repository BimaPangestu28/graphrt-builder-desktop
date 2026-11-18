import { useState } from 'react'
import { AppShell } from '@/components/layout'
import { mapsLeadsAgentName } from '@/data/mapsLeadsAgent'
import { BuilderAgentPanel } from './agent-builder/BuilderAgentPanel'
import { BuilderChatPanel } from './agent-builder/BuilderChatPanel'

/**
 * Screen 04 · Builder. The generated draft agent: chat on the left to ask for changes
 * (with Undo for the last one), and on the right the steps, the connections it needs,
 * and the History / Schedule / Test actions. "Connect" opens the WhatsApp pairing dialog (05).
 */
export function BuilderPage() {
  const [isLastChangeUndone, setIsLastChangeUndone] = useState(false)

  return (
    <AppShell
      agents={{ kind: 'draft', name: mapsLeadsAgentName, status: 'Draft · not tested yet' }}
      runnerStatus="Online · OpenAI connected"
      mainClassName="flex flex-wrap"
    >
      <BuilderChatPanel isLastChangeUndone={isLastChangeUndone} onToggleUndo={() => setIsLastChangeUndone((isUndone) => !isUndone)} />
      <BuilderAgentPanel showsLatestChange={!isLastChangeUndone} />
    </AppShell>
  )
}
