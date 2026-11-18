import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AppShell } from '@/components/layout'
import { joinClassNames } from '@/components/ui'
import {
  buildItemDurationMs,
  buildProgressItems,
  initialRunningBuildItemIndex,
  mapsLeadsAgentName,
  mapsLeadsJobDescription,
  mapsLeadsSteps,
  openBuilderDelayMs,
} from '@/data/mapsLeadsAgent'
import { routePaths } from '@/routes'
import { BuildProgressChecklist } from './agent-builder/BuildProgressChecklist'
import { PanelHeader, UserChatBubble } from './agent-builder/ChatBubbles'
import { StepNumberBadge } from './agent-builder/StepNumberBadge'

/** Advances the mocked build one item at a time and opens the builder once every item is done. */
function useMockedBuildProgress() {
  const navigate = useNavigate()
  const [runningItemIndex, setRunningItemIndex] = useState(initialRunningBuildItemIndex)
  const isBuildDone = runningItemIndex >= buildProgressItems.length

  useEffect(() => {
    const timeoutId = isBuildDone
      ? window.setTimeout(() => navigate(routePaths.builder), openBuilderDelayMs)
      : window.setTimeout(() => setRunningItemIndex((index) => index + 1), buildItemDurationMs)
    return () => window.clearTimeout(timeoutId)
  }, [isBuildDone, navigate, runningItemIndex])

  return { runningItemIndex, isBuildDone }
}

function getRevealedStepCount(runningItemIndex: number) {
  const lastDoneItem = buildProgressItems[runningItemIndex - 1]
  return lastDoneItem ? lastDoneItem.revealedStepCount : 0
}

/** Right column: steps fade in as they are generated, grey placeholders stand in for the rest. */
function GeneratedStepsPreview({ revealedStepCount }: { revealedStepCount: number }) {
  const placeholderCount = mapsLeadsSteps.length - revealedStepCount
  return (
    <ol className="m-0 flex list-none flex-col gap-2 p-0">
      {mapsLeadsSteps.slice(0, revealedStepCount).map((step) => (
        <li
          key={step.number}
          className={joinClassNames('flex items-center gap-3.5 rounded-xl border border-line bg-surface px-4 py-3.5', step.isInsideLoop && 'ml-6')}
        >
          <StepNumberBadge number={step.number} />
          <span className="font-semibold">{step.title}</span>
        </li>
      ))}
      {Array.from({ length: placeholderCount }, (_, placeholderIndex) => (
        <li key={`placeholder-${placeholderIndex}`} aria-hidden="true" className="ml-6 h-[54px] animate-pulse rounded-xl bg-selected motion-reduce:animate-none" />
      ))}
    </ol>
  )
}

/**
 * Screen 03 · Generating. Shown right after "Build agent": the chat column replays the job
 * and a live checklist of what graphrt is doing, while the agent column fills in step by step.
 * When the mocked build finishes it opens the builder (04) automatically.
 */
export function GeneratingPage() {
  const location = useLocation()
  const jobDescription = (location.state as { jobDescription?: string } | null)?.jobDescription ?? mapsLeadsJobDescription
  const { runningItemIndex, isBuildDone } = useMockedBuildProgress()

  return (
    <AppShell agents={{ kind: 'draft', name: 'New agent', status: isBuildDone ? 'Ready' : 'Building…' }} runnerStatus="Online · OpenAI connected" mainClassName="flex flex-wrap">
      <section aria-label="Chat" className="box-border flex min-w-0 flex-[1_1_380px] flex-col border-r border-line bg-surface">
        <PanelHeader>
          <span className="font-semibold">Build with chat</span>
        </PanelHeader>
        <div className="flex flex-col gap-5 p-6">
          <UserChatBubble>{jobDescription}</UserChatBubble>
          <BuildProgressChecklist items={buildProgressItems} runningItemIndex={runningItemIndex} />
        </div>
      </section>

      <section aria-label="Agent" className="box-border flex min-w-0 flex-[1_1_440px] flex-col bg-subtle">
        <PanelHeader>
          <span className="text-body">{isBuildDone ? 'All steps ready. Opening the builder' : 'Steps appear here as they are ready'}</span>
        </PanelHeader>
        <div className="flex flex-col gap-6 p-6">
          <h1 className="m-0 text-[22px] font-semibold">{mapsLeadsAgentName}</h1>
          <GeneratedStepsPreview revealedStepCount={getRevealedStepCount(runningItemIndex)} />
        </div>
      </section>
    </AppShell>
  )
}
