import { useEffect, useMemo } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { BackendError } from '@/api/client'
import type { BuildRequest, BuildStage } from '@/api/types'
import { AppShell } from '@/components/layout'
import { joinClassNames } from '@/components/ui'
import { openBuilderDelayMs } from '@/data/mapsLeadsAgent'
import { useFlowSummary } from '@/hooks/useFlowSummary'
import { describeError } from '@/lib/agentDisplay'
import { agentPath, routePaths } from '@/routes'
import { BuildProgressChecklist, type BuildChecklistItem } from './agent-builder/BuildProgressChecklist'
import { readBuildRequest } from './agent-builder/buildRequestState'
import { PanelHeader, UserChatBubble } from './agent-builder/ChatBubbles'
import { StepNumberBadge } from './agent-builder/StepNumberBadge'
import { buildChecklistStages, useAgentBuild } from './agent-builder/useAgentBuild'

const placeholderStepCount = 4

/** Checklist titles per backend stage, and what a line says if the backend skipped it. */
const checklistTitles: Record<BuildStage, { title: string; skippedDetail: string }> = {
  understanding: { title: 'Understood the job', skippedDetail: 'Read your description' },
  drafting: { title: 'Picked the steps', skippedDetail: 'Steps drafted' },
  repairing: { title: 'Fixed problems', skippedDetail: 'Nothing to fix' },
  checking: { title: 'Checking it again', skippedDetail: 'No problems found' },
  done: { title: 'Check what it needs to connect', skippedDetail: 'Ready to connect' },
}

function createChecklistItems(stageMessages: Partial<Record<BuildStage, string>>): BuildChecklistItem[] {
  return buildChecklistStages.map((stage) => ({
    title: checklistTitles[stage].title,
    detail: stageMessages[stage] ?? checklistTitles[stage].skippedDetail,
    runningDetail: stageMessages[stage],
  }))
}

/** Steps of the saved agent, shown for a moment before the builder opens. */
function BuiltStepsPreview({ agentId }: { agentId: string }) {
  const { data: flowSummary } = useFlowSummary(agentId)
  if (!flowSummary) return <StepPlaceholders count={placeholderStepCount} />
  return (
    <ol className="m-0 flex list-none flex-col gap-2 p-0">
      {flowSummary.steps.map((flowStep, stepIndex) => (
        <li
          key={flowStep.id}
          className={joinClassNames('flex items-center gap-3.5 rounded-xl border border-line bg-surface px-4 py-3.5', flowStep.depth > 0 && 'ml-6')}
        >
          <StepNumberBadge number={stepIndex + 1} />
          <span className="font-semibold">{flowStep.title}</span>
        </li>
      ))}
    </ol>
  )
}

function StepPlaceholders({ count }: { count: number }) {
  return (
    <ol aria-hidden="true" className="m-0 flex list-none flex-col gap-2 p-0">
      {Array.from({ length: count }, (_, placeholderIndex) => (
        <li key={`placeholder-${placeholderIndex}`} className="h-[54px] animate-pulse rounded-xl bg-selected motion-reduce:animate-none" />
      ))}
    </ol>
  )
}

/** What went wrong, with the way out: Connections for a missing key, otherwise Try again. */
function BuildErrorNotice({ buildError, onRetry }: { buildError: Error; onRetry: () => void }) {
  const isMissingCredentials = buildError instanceof BackendError && buildError.code === 'missing_credentials'
  return (
    <div role="alert" className="flex max-w-[92%] flex-col items-start gap-2.5 rounded-[14px] border border-danger-line bg-danger-tint p-[18px]">
      <span className="font-semibold">{isMissingCredentials ? 'Add an AI key to build agents' : 'Could not build the agent'}</span>
      <span className="leading-normal text-danger-deep">{describeError(buildError)}</span>
      {isMissingCredentials ? (
        <Link to={routePaths.connections} className="font-medium">
          Open Connections
        </Link>
      ) : (
        <button
          type="button"
          onClick={onRetry}
          className="h-8 cursor-pointer rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-subtle"
        >
          Try again
        </button>
      )}
    </div>
  )
}

/** Opens the builder for the saved agent shortly after the build finishes. */
function useOpenBuilderWhenBuilt(builtAgentId: string | null) {
  const navigate = useNavigate()
  useEffect(() => {
    if (!builtAgentId) return
    const timeoutId = window.setTimeout(() => navigate(agentPath('builder', builtAgentId)), openBuilderDelayMs)
    return () => window.clearTimeout(timeoutId)
  }, [builtAgentId, navigate])
}

/** Screen 03 opened without a request (screen index, reload): nothing to build, so point back to 02. */
function MissingBuildRequestNotice() {
  return (
    <AppShell agents={{ kind: 'list' }} mainClassName="flex flex-col items-center px-8 pt-[72px] pb-12">
      <section aria-labelledby="generating-nothing" className="flex max-w-[520px] flex-col items-center gap-3 text-center">
        <h1 id="generating-nothing" className="m-0 text-[22px] font-semibold">
          Nothing to build yet
        </h1>
        <p className="m-0 leading-normal text-body">Describe what your agent should do on the New agent screen, then press Build agent.</p>
        <Link to={routePaths.newAgent} className="font-medium">
          Describe a new agent
        </Link>
      </section>
    </AppShell>
  )
}

/** The build itself: chat column with the live checklist, agent column filling in. */
function AgentBuildScreen({ buildRequest }: { buildRequest: BuildRequest }) {
  const { runningItemIndex, stageMessages, builtAgent, buildError, retry } = useAgentBuild(buildRequest)
  useOpenBuilderWhenBuilt(builtAgent?.id ?? null)
  const sidebarStatus = buildError ? 'Build stopped' : builtAgent ? 'Ready' : 'Building…'

  return (
    <AppShell agents={{ kind: 'draft', name: builtAgent?.name ?? 'New agent', status: sidebarStatus, agentId: builtAgent?.id }} runnerStatus="Online · OpenAI connected" mainClassName="flex flex-wrap">
      <section aria-label="Chat" className="box-border flex min-w-0 flex-[1_1_380px] flex-col border-r border-line bg-surface">
        <PanelHeader>
          <span className="font-semibold">Build with chat</span>
        </PanelHeader>
        <div className="flex flex-col gap-5 p-6">
          <UserChatBubble>{buildRequest.description}</UserChatBubble>
          <BuildProgressChecklist items={createChecklistItems(stageMessages)} runningItemIndex={runningItemIndex} />
          {buildError && <BuildErrorNotice buildError={buildError} onRetry={retry} />}
        </div>
      </section>

      <section aria-label="Agent" className="box-border flex min-w-0 flex-[1_1_440px] flex-col bg-subtle">
        <PanelHeader>
          <span className="text-body">{builtAgent ? 'All steps ready. Opening the builder' : 'Steps appear here as they are ready'}</span>
        </PanelHeader>
        <div className="flex flex-col gap-6 p-6">
          <h1 className="m-0 text-[22px] font-semibold">{builtAgent?.name ?? 'New agent'}</h1>
          {builtAgent ? <BuiltStepsPreview agentId={builtAgent.id} /> : <StepPlaceholders count={placeholderStepCount} />}
        </div>
      </section>
    </AppShell>
  )
}

/**
 * Screen 03 · Generating. Shown right after "Build agent": the chat column replays the job
 * and a live checklist driven by `buildAgent` progress, while the agent column fills in
 * once the agent is saved. Then it opens the builder (04) for that agent. A missing key
 * links to Connections; other failures offer Try again. Opened without a build request
 * (`{ buildRequest }` router state), it builds nothing and links back to New agent.
 */
export function GeneratingPage() {
  const location = useLocation()
  const buildRequest = useMemo(() => readBuildRequest(location.state), [location.state])
  if (!buildRequest) return <MissingBuildRequestNotice />
  return <AgentBuildScreen buildRequest={buildRequest} />
}
