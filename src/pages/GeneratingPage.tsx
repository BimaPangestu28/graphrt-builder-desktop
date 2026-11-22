import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { BackendError } from '@/api/client'
import type { BuildRequest, BuildStage, DraftPreview } from '@/api/types'
import { AppShell, splitPaneColumnClassName, splitPaneMainClassName, splitPaneScrollClassName } from '@/components/layout'
import { Button, joinClassNames } from '@/components/ui'
import { useFlowSummary } from '@/hooks/useFlowSummary'
import { useFollowNewContent } from '@/hooks/useFollowNewContent'
import { describeError } from '@/lib/agentDisplay'
import { agentPath, connectionsTabPath, routePaths } from '@/routes'
import { BuildProgressChecklist, type BuildChecklistItem } from './agent-builder/BuildProgressChecklist'
import { readBuildRequest } from './agent-builder/buildRequestState'
import { PanelHeader, UserChatBubble } from './agent-builder/ChatBubbles'
import { StepNumberBadge } from './agent-builder/StepNumberBadge'
import { describeDraftActivity } from './agent-builder/draftActivity'
import { DraftStepCards, PoliteAnnouncement } from './agent-builder/DraftPreviewParts'
import { PluginRequirementsMessage } from './agent-builder/PluginRequirementsMessage'
import { usePluginSetup, type PluginSetupState } from './agent-builder/usePluginSetup'
import { buildChecklistStages, openBuilderDelayMs, useAgentBuild, type AgentBuildState } from './agent-builder/useAgentBuild'

const placeholderStepCount = 4

/** Stages in which the model writes a draft (and explains it). */
const draftingStages: BuildStage[] = ['drafting', 'repairing']

/** Checklist titles per backend stage, and what a line says if the backend skipped it. */
const checklistTitles: Record<BuildStage, { title: string; skippedDetail: string }> = {
  understanding: { title: 'Understood the job', skippedDetail: 'Read your description' },
  drafting: { title: 'Picked the steps', skippedDetail: 'Steps drafted' },
  repairing: { title: 'Fixed problems', skippedDetail: 'Nothing to fix' },
  checking: { title: 'Checking it again', skippedDetail: 'No problems found' },
  done: { title: 'Check what it needs to connect', skippedDetail: 'Ready to connect' },
}

/** The draft being written right now, if its stage is the one running (none once the round is over). */
function readActiveDraft(buildState: AgentBuildState): { stage: BuildStage; draft: DraftPreview } | null {
  const { draft, draftStage, runningItemIndex, builtAgent, buildError } = buildState
  if (!draft || !draftStage || builtAgent || buildError) return null
  return buildChecklistStages[runningItemIndex] === draftStage ? { stage: draftStage, draft } : null
}

function createChecklistItems(buildState: AgentBuildState): BuildChecklistItem[] {
  const activeDraft = readActiveDraft(buildState)
  return buildChecklistStages.map((stage) => ({
    title: checklistTitles[stage].title,
    detail: buildState.stageMessages[stage] ?? checklistTitles[stage].skippedDetail,
    runningDetail: buildState.stageMessages[stage],
    activity: activeDraft?.stage === stage ? describeDraftActivity(stage, activeDraft.draft.outputTokens) : undefined,
  }))
}

/**
 * The builder's own words under the checklist: what the agent does (drafting) and what it
 * fixed (repairing), growing as the model writes. Screen readers hear each paragraph once
 * its round is over instead of every streamed word.
 */
function BuilderExplanationReply({ buildState }: { buildState: AgentBuildState }) {
  const paragraphs = draftingStages.map((stage) => ({ stage, text: buildState.explanations[stage]?.trim() ?? '' })).filter(({ text }) => text)
  const finishedText = paragraphs
    .filter(({ stage }) => buildState.runningItemIndex > buildChecklistStages.indexOf(stage))
    .map(({ text }) => text)
    .join(' ')
  return (
    <>
      {paragraphs.length > 0 && (
        <div className="flex max-w-[92%] flex-col gap-2">
          {paragraphs.map(({ stage, text }) => (
            <p key={stage} className="m-0 leading-[1.55]">
              {text}
            </p>
          ))}
        </div>
      )}
      <PoliteAnnouncement text={finishedText} />
    </>
  )
}

/** Steps of the saved agent, shown for a moment before the builder opens. */
function BuiltStepsPreview({ agentId, loadingFallback }: { agentId: string; loadingFallback: ReactNode }) {
  const { data: flowSummary } = useFlowSummary(agentId)
  if (!flowSummary) return <>{loadingFallback}</>
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

/** What went wrong, with the way out: Connections for a missing key, otherwise Try again. */
function BuildErrorNotice({ buildError, onRetry }: { buildError: Error; onRetry: () => void }) {
  const isMissingCredentials = buildError instanceof BackendError && buildError.code === 'missing_credentials'
  return (
    <div role="alert" className="flex max-w-[92%] flex-col items-start gap-2.5 rounded-[14px] border border-danger-line bg-danger-tint p-[18px]">
      <span className="font-semibold">{isMissingCredentials ? 'Connect a model to build agents' : 'Could not build the agent'}</span>
      <span className="leading-normal text-danger-deep">{describeError(buildError)}</span>
      {isMissingCredentials && (
        <span className="leading-normal text-body">Use Claude Code or Codex on this computer, a local model with Ollama, or an API key</span>
      )}
      {isMissingCredentials ? (
        <Link to={connectionsTabPath('models')} className="font-medium">
          Choose a model in Connections
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

/**
 * Opens the builder for the saved agent shortly after the build finishes, unless a plugin
 * it needs is not ready: then the chat holds on the setup cards until the user continues.
 * If the requirements cannot be read, the builder opens as before.
 *
 * @returns Whether the screen holds for plugin setup (boolean)
 */
function useOpenBuilderWhenReady(builtAgentId: string | null, pluginSetup: PluginSetupState): boolean {
  const navigate = useNavigate()
  const [isHeldForPlugins, setIsHeldForPlugins] = useState(false)
  const { isReady, loadError } = pluginSetup
  const opensAtOnce = builtAgentId !== null && !isHeldForPlugins && (isReady === true || loadError !== null)

  useEffect(() => {
    if (builtAgentId && isReady === false) setIsHeldForPlugins(true)
  }, [builtAgentId, isReady])

  useEffect(() => {
    if (!opensAtOnce || !builtAgentId) return
    const timeoutId = window.setTimeout(() => navigate(agentPath('builder', builtAgentId)), openBuilderDelayMs)
    return () => window.clearTimeout(timeoutId)
  }, [opensAtOnce, builtAgentId, navigate])

  return isHeldForPlugins
}

/** Under the setup cards on screen 03: always lets the user go on to the steps. */
function ContinueToStepsButton({ agentId, isReady }: { agentId: string; isReady: boolean }) {
  const navigate = useNavigate()
  return (
    <div className="flex">
      <Button size="sm" variant={isReady ? 'primary' : 'secondary'} onClick={() => navigate(agentPath('builder', agentId))}>
        {isReady ? 'Continue to steps' : 'Continue without them'}
      </Button>
    </div>
  )
}

function describeAgentColumnStatus(isBuilt: boolean, isHeldForPlugins: boolean): string {
  if (!isBuilt) return 'Steps appear here as they are ready'
  return isHeldForPlugins ? 'All steps ready. Set up its plugins in the chat' : 'All steps ready. Opening the builder'
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
  const chatBodyRef = useFollowNewContent()
  const { retry, ...buildState } = useAgentBuild(buildRequest)
  const { runningItemIndex, builtAgent, buildError } = buildState
  const draftStepCards = (
    <DraftStepCards stepTitles={buildState.draft?.stepTitles ?? []} minimumCardCount={placeholderStepCount} isWriting={readActiveDraft(buildState) !== null} />
  )
  const pluginSetup = usePluginSetup(builtAgent?.id ?? null)
  const isHeldForPlugins = useOpenBuilderWhenReady(builtAgent?.id ?? null, pluginSetup)
  const sidebarStatus = buildError ? 'Build stopped' : builtAgent ? 'Ready' : 'Building…'

  return (
    <AppShell agents={{ kind: 'draft', name: builtAgent?.name ?? 'New agent', status: sidebarStatus, agentId: builtAgent?.id }} runnerStatus="Online · OpenAI connected" mainClassName={splitPaneMainClassName}>
      <section aria-label="Chat" className={`box-border flex min-w-0 flex-[1_1_380px] flex-col border-r border-line bg-surface ${splitPaneColumnClassName}`}>
        <PanelHeader>
          <span className="font-semibold">Build with chat</span>
        </PanelHeader>
        <div ref={chatBodyRef} className={`flex flex-col gap-5 p-6 ${splitPaneScrollClassName}`}>
          <UserChatBubble>{buildRequest.description}</UserChatBubble>
          <BuildProgressChecklist items={createChecklistItems(buildState)} runningItemIndex={runningItemIndex} />
          <BuilderExplanationReply buildState={buildState} />
          {buildError && <BuildErrorNotice buildError={buildError} onRetry={retry} />}
          {builtAgent && (
            <PluginRequirementsMessage
              setup={pluginSetup}
              footer={isHeldForPlugins && <ContinueToStepsButton agentId={builtAgent.id} isReady={pluginSetup.isReady === true} />}
            />
          )}
        </div>
      </section>

      <section aria-label="Agent" className={`box-border flex min-w-0 flex-[1_1_440px] flex-col bg-subtle ${splitPaneColumnClassName}`}>
        <PanelHeader>
          <span className="text-body">{describeAgentColumnStatus(builtAgent !== null, isHeldForPlugins)}</span>
        </PanelHeader>
        <div className={`flex flex-col gap-6 p-6 ${splitPaneScrollClassName}`}>
          <h1 className="m-0 text-[22px] font-semibold">{builtAgent?.name ?? 'New agent'}</h1>
          {builtAgent ? <BuiltStepsPreview agentId={builtAgent.id} loadingFallback={draftStepCards} /> : draftStepCards}
        </div>
      </section>
    </AppShell>
  )
}

/**
 * Screen 03 · Generating. Shown right after "Build agent": the chat column replays the job
 * and a live checklist driven by `buildAgent` progress, while the agent column fills in
 * once the agent is saved. Then the chat shows the plugins the agent needs with their
 * approvals, downloads and settings; when they are all ready it opens the builder (04),
 * otherwise it waits for "Continue to steps" / "Continue without them". A missing key
 * links to Connections; other failures offer Try again. Opened without a build request
 * (`{ buildRequest }` router state), it builds nothing and links back to New agent.
 */
export function GeneratingPage() {
  const location = useLocation()
  const buildRequest = useMemo(() => readBuildRequest(location.state), [location.state])
  if (!buildRequest) return <MissingBuildRequestNotice />
  return <AgentBuildScreen buildRequest={buildRequest} />
}
