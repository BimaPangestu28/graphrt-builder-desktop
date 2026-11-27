import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { BackendError, isBackendErrorWithCode } from '@/api/client'
import type { Agent, BuildRequest, BuildStage, DraftPreview } from '@/api/types'
import { AppShell, splitPaneColumnClassName, splitPaneMainClassName, splitPaneScrollClassName } from '@/components/layout'
import { Button, joinClassNames } from '@/components/ui'
import { useFlowSummary } from '@/hooks/useFlowSummary'
import { useFollowNewContent } from '@/hooks/useFollowNewContent'
import { describeError } from '@/lib/agentDisplay'
import { agentOpenPath, connectionsTabPath, routePaths } from '@/routes'
import { BuildProgressChecklist, type BuildChecklistItem } from './agent-builder/BuildProgressChecklist'
import { readBuildRequest } from './agent-builder/buildRequestState'
import { PanelHeader, UserChatBubble } from './agent-builder/ChatBubbles'
import { StepNumberBadge } from './agent-builder/StepNumberBadge'
import { describeDraftActivity } from './agent-builder/draftActivity'
import { DraftStepCards, PoliteAnnouncement } from './agent-builder/DraftPreviewParts'
import { PluginRequirementsMessage } from './agent-builder/PluginRequirementsMessage'
import { usePluginSetup, type PluginSetupState } from './agent-builder/usePluginSetup'
import { buildChecklistStages, openBuilderDelayMs, useAgentBuild, type AgentBuildState } from './agent-builder/useAgentBuild'
import { messages } from '@/i18n'
import { localizedRecord } from '@/i18n/localized'

const placeholderStepCount = 4

/** Stages in which the model writes a draft (and explains it). */
const draftingStages: BuildStage[] = ['drafting', 'repairing']

/** Checklist titles per backend stage, and what a line says if the backend skipped it. */
const checklistTitles: Readonly<Record<BuildStage, { title: string; skippedDetail: string }>> = localizedRecord(() => {
  const checklist = messages().newAgent.checklist
  const entry = (stage: BuildStage) => ({ title: checklist[stage][0], skippedDetail: checklist[stage][1] })
  return { understanding: entry('understanding'), drafting: entry('drafting'), repairing: entry('repairing'), checking: entry('checking'), done: entry('done') }
})

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
  const draftProblem = isBackendErrorWithCode(buildError, 'draft_not_valid') ? (buildError.details?.problem ?? null) : null
  return (
    <div role="alert" className="flex max-w-[92%] flex-col items-start gap-2.5 rounded-[14px] border border-danger-line bg-danger-tint p-[18px]">
      <span className="font-semibold">{isMissingCredentials ? messages().newAgent.connectAModelToBuildAgents : messages().newAgent.couldNotBuildTheAgent}</span>
      <span className="leading-normal text-danger-deep">{describeError(buildError)}</span>
      {isMissingCredentials && (
        <span className="leading-normal text-body">{messages().newAgent.useClaudeCodeOrCodexOn}</span>
      )}
      {draftProblem !== null && (
        <>
          <details className="max-w-full text-[12.5px] text-muted">
            <summary className="cursor-pointer">{messages().newAgent.technicalDetails}</summary>
            <p className="mt-1.5 break-words leading-normal">{draftProblem}</p>
          </details>
          <Link to={connectionsTabPath('models')} className="font-medium">
            {messages().newAgent.chooseAModelInConnections}
          </Link>
        </>
      )}
      {isMissingCredentials ? (
        <Link to={connectionsTabPath('models')} className="font-medium">
          {messages().newAgent.chooseAModelInConnections}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onRetry}
          className="h-8 cursor-pointer rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-subtle"
        >
          {messages().newAgent.tryAgain}
        </button>
      )}
    </div>
  )
}

/**
 * Opens the saved agent shortly after the build finishes (a chatbot its setup, other kinds
 * the builder), unless a plugin it needs is not ready: then the chat holds on the setup cards
 * until the user continues. If the requirements cannot be read, it opens as before.
 *
 * @returns Whether the screen holds for plugin setup (boolean)
 */
function useOpenBuiltAgentWhenReady(builtAgent: Agent | null, pluginSetup: PluginSetupState): boolean {
  const navigate = useNavigate()
  const [isHeldForPlugins, setIsHeldForPlugins] = useState(false)
  const { isReady, loadError } = pluginSetup
  const openPath = builtAgent ? agentOpenPath(builtAgent.id, builtAgent.kind) : null
  const opensAtOnce = openPath !== null && !isHeldForPlugins && (isReady === true || loadError !== null)

  useEffect(() => {
    if (openPath && isReady === false) setIsHeldForPlugins(true)
  }, [openPath, isReady])

  useEffect(() => {
    if (!opensAtOnce || !openPath) return
    const timeoutId = window.setTimeout(() => navigate(openPath), openBuilderDelayMs)
    return () => window.clearTimeout(timeoutId)
  }, [opensAtOnce, openPath, navigate])

  return isHeldForPlugins
}

/** Under the setup cards on screen 03: always lets the user go on (to the steps, or a chatbot's setup). */
function ContinueButton({ agent, isReady }: { agent: Agent; isReady: boolean }) {
  const navigate = useNavigate()
  const continueLabel = agent.kind === 'chatbot' ? messages().newAgent.continueToChatbotSetup : messages().newAgent.continueToSteps
  return (
    <div className="flex">
      <Button size="sm" variant={isReady ? 'primary' : 'secondary'} onClick={() => navigate(agentOpenPath(agent.id, agent.kind))}>
        {isReady ? continueLabel : messages().newAgent.continueWithoutThem}
      </Button>
    </div>
  )
}

function describeAgentColumnStatus(builtAgent: Agent | null, isHeldForPlugins: boolean): string {
  if (!builtAgent) return messages().newAgent.stepsAppearHereAsTheyAre
  if (isHeldForPlugins) return messages().newAgent.allStepsReadySetUpIts
  return builtAgent.kind === 'chatbot' ? messages().newAgent.chatbotReadyOpeningItsSetup : messages().newAgent.allStepsReadyOpeningTheBuilder
}

/** Screen 03 opened without a request (screen index, reload): nothing to build, so point back to 02. */
function MissingBuildRequestNotice() {
  return (
    <AppShell agents={{ kind: 'list' }} mainClassName="flex flex-col items-center px-8 pt-[72px] pb-12">
      <section aria-labelledby="generating-nothing" className="flex max-w-[520px] flex-col items-center gap-3 text-center">
        <h1 id="generating-nothing" className="m-0 text-[22px] font-semibold">
          {messages().newAgent.nothingToBuildYet}
        </h1>
        <p className="m-0 leading-normal text-body">{messages().newAgent.describeWhatYourAgentShouldDo}</p>
        <Link to={routePaths.newAgent} className="font-medium">
          {messages().newAgent.describeANewAgent}
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
  const isHeldForPlugins = useOpenBuiltAgentWhenReady(builtAgent, pluginSetup)
  const sidebarStatus = buildError ? messages().newAgent.buildStopped : builtAgent ? messages().newAgent.ready : messages().newAgent.building

  return (
    <AppShell agents={{ kind: 'draft', name: builtAgent?.name ?? messages().lib.newAgentName, status: sidebarStatus, agentId: builtAgent?.id }} runnerStatus={messages().newAgent.onlineOpenaiConnected} mainClassName={splitPaneMainClassName}>
      <section aria-label={messages().newAgent.chat} className={`box-border flex min-w-0 flex-[1_1_380px] flex-col border-r border-line bg-surface ${splitPaneColumnClassName}`}>
        <PanelHeader>
          <span className="font-semibold">{messages().newAgent.buildWithChat}</span>
        </PanelHeader>
        <div ref={chatBodyRef} className={`flex flex-col gap-5 p-6 ${splitPaneScrollClassName}`}>
          <UserChatBubble>{buildRequest.description}</UserChatBubble>
          <BuildProgressChecklist items={createChecklistItems(buildState)} runningItemIndex={runningItemIndex} />
          <BuilderExplanationReply buildState={buildState} />
          {buildError && <BuildErrorNotice buildError={buildError} onRetry={retry} />}
          {builtAgent && (
            <PluginRequirementsMessage
              setup={pluginSetup}
              footer={isHeldForPlugins && <ContinueButton agent={builtAgent} isReady={pluginSetup.isReady === true} />}
            />
          )}
        </div>
      </section>

      <section aria-label={messages().newAgent.agent} className={`box-border flex min-w-0 flex-[1_1_440px] flex-col bg-subtle ${splitPaneColumnClassName}`}>
        <PanelHeader>
          <span className="text-body">{describeAgentColumnStatus(builtAgent, isHeldForPlugins)}</span>
        </PanelHeader>
        <div className={`flex flex-col gap-6 p-6 ${splitPaneScrollClassName}`}>
          <h1 className="m-0 text-[22px] font-semibold">{builtAgent?.name ?? messages().newAgent.newAgent}</h1>
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
 * approvals, downloads and settings; when they are all ready it opens the builder (04), or
 * a chatbot's setup (14) where a business owner sets its persona, knowledge and channels,
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
