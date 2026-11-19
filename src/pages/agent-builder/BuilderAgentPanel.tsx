import { splitPaneColumnClassName, splitPaneScrollClassName } from '@/components/layout'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Agent, FlowSummary } from '@/api/types'
import { joinClassNames } from '@/components/ui'
import { agentPath } from '@/routes'
import { AgentIdentityHeader } from './AgentIdentityHeader'
import { AgentRequirementsList, type BuilderRequirement } from './AgentRequirementsList'
import { BuilderStepCard } from './BuilderStepCard'

const builderTabs = [
  { key: 'steps', label: 'Steps' },
  { key: 'runs', label: 'Runs' },
  { key: 'source', label: 'Source' },
] as const

type BuilderTabKey = (typeof builderTabs)[number]['key']

const headerLinkBaseClassNames = 'flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium no-underline'
const outlineHeaderLinkClassNames = `${headerLinkBaseClassNames} border border-line-strong bg-surface !text-ink hover:bg-subtle`

/** Segmented Steps / Runs / Source switcher. */
function BuilderTabList({ activeTab, onSelect }: { activeTab: BuilderTabKey; onSelect: (tab: BuilderTabKey) => void }) {
  return (
    <div role="tablist" aria-label="Agent views" className="flex gap-1 rounded-[10px] bg-selected p-1">
      {builderTabs.map((tab) => {
        const isActive = tab.key === activeTab
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`builder-tab-${tab.key}`}
            aria-selected={isActive}
            aria-controls={`builder-panel-${tab.key}`}
            onClick={() => onSelect(tab.key)}
            className={joinClassNames(
              'h-8 cursor-pointer rounded-[7px] border-0 px-3.5 text-[13px]',
              isActive ? 'bg-surface font-semibold text-ink' : 'bg-transparent font-medium text-body hover:text-ink',
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

const testPlayIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M7 4.5v15l13-7.5z" />
  </svg>
)

/**
 * History, Schedule and the primary "Test with 1 place" action. While plugins are not
 * ready (`onTestBlocked` set), Test is a button that brings the chat's setup card up instead.
 */
function BuilderHeaderActions({ agentId, onTestBlocked }: { agentId: string; onTestBlocked?: () => void }) {
  const testClassNames = `${headerLinkBaseClassNames} bg-ink !text-white hover:bg-ink-2`
  return (
    <div className="flex gap-2">
      <Link to={agentPath('versionHistory', agentId)} className={outlineHeaderLinkClassNames}>
        History
      </Link>
      <Link to={agentPath('scheduleAgent', agentId)} className={outlineHeaderLinkClassNames}>
        Schedule
      </Link>
      {onTestBlocked ? (
        <>
          <button type="button" aria-describedby="test-needs-plugins" onClick={onTestBlocked} className={joinClassNames(testClassNames, 'cursor-pointer border-0')}>
            {testPlayIcon}
            Test with 1 place
          </button>
          <span id="test-needs-plugins" className="sr-only">
            Set up the plugins it needs in the chat first
          </span>
        </>
      ) : (
        <Link to={agentPath('testRun', agentId)} className={testClassNames}>
          {testPlayIcon}
          Test with 1 place
        </Link>
      )}
    </div>
  )
}

interface StepsTabContentProps {
  flowSummary: FlowSummary | null
  flowSummaryError: Error | null
  highlightedStepIds: Set<string>
  requirements: BuilderRequirement[]
  onSaveSecret?: (secretName: string, value: string) => Promise<void>
  onShowPluginSetup?: () => void
  onPluginSessionChange?: () => unknown
}

function StepsTabContent({ flowSummary, flowSummaryError, highlightedStepIds, requirements, onSaveSecret, onShowPluginSetup, onPluginSessionChange }: StepsTabContentProps) {
  if (flowSummaryError) return <p className="m-0 text-muted">Could not read the steps: {flowSummaryError.message}</p>
  if (!flowSummary) return <p className="m-0 text-muted">Loading steps…</p>
  return (
    <>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {flowSummary.steps.map((flowStep, stepIndex) => (
          <BuilderStepCard key={flowStep.id} flowStep={flowStep} number={stepIndex + 1} isChanged={highlightedStepIds.has(flowStep.id)} />
        ))}
      </ol>
      <AgentRequirementsList requirements={requirements} onSaveSecret={onSaveSecret} onShowPluginSetup={onShowPluginSetup} onPluginSessionChange={onPluginSessionChange} />
    </>
  )
}

function RunsTabContent({ agentId }: { agentId: string }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-line-strong bg-surface p-6">
      <span className="font-semibold">No runs yet</span>
      <span className="text-body">Test it with one place first. Every run shows up here with what each step did</span>
      <Link to={agentPath('testRun', agentId)} className="font-medium">
        Test with 1 place
      </Link>
    </div>
  )
}

/** The graphrt workflow document of the current version, as stored. */
function SourceTabContent({ flowYaml }: { flowYaml: string }) {
  return (
    <pre className="m-0 overflow-x-auto rounded-xl border border-line bg-surface p-4 font-mono text-[12px] leading-[1.6] text-ink-2">{flowYaml}</pre>
  )
}

interface BuilderAgentPanelProps {
  agent: Agent
  flowSummary: FlowSummary | null
  flowSummaryError: Error | null
  highlightedStepIds: Set<string>
  requirements: BuilderRequirement[]
  /** Saves a workflow secret pasted in the "Needs" box. */
  onSaveSecret?: (secretName: string, value: string) => Promise<void>
  /** Shows the plugin setup card in the chat ("Set up in chat" and Test while plugins are not ready). */
  onShowPluginSetup?: () => void
  /** Reloads the plugin requirements after the WhatsApp QR link in the "Needs" box ends. */
  onPluginSessionChange?: () => unknown
  /** False while a plugin the agent needs is not ready: Test then shows the setup card instead of starting. */
  arePluginsReady?: boolean
  /** Reloads the agent after it was renamed. */
  onAgentRenamed?: () => Promise<void> | void
}

/** Right column of screen 04: tabs, actions, the agent's steps and what it needs connected. */
export function BuilderAgentPanel({
  agent,
  flowSummary,
  flowSummaryError,
  highlightedStepIds,
  requirements,
  onSaveSecret,
  onShowPluginSetup,
  onPluginSessionChange,
  arePluginsReady,
  onAgentRenamed,
}: BuilderAgentPanelProps) {
  const [activeTab, setActiveTab] = useState<BuilderTabKey>('steps')

  return (
    <section aria-label="Agent" className={`box-border flex min-w-0 flex-[1_1_440px] flex-col bg-subtle ${splitPaneColumnClassName}`}>
      <header className="box-border flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3">
        <BuilderTabList activeTab={activeTab} onSelect={setActiveTab} />
        <BuilderHeaderActions agentId={agent.id} onTestBlocked={arePluginsReady === false ? onShowPluginSetup : undefined} />
      </header>

      <div role="tabpanel" id={`builder-panel-${activeTab}`} aria-labelledby={`builder-tab-${activeTab}`} className={`flex flex-col gap-6 p-6 ${splitPaneScrollClassName}`}>
        <div className="flex flex-col gap-1">
          <AgentIdentityHeader agent={agent} onRenamed={onAgentRenamed ?? (() => undefined)} />
          <span className="text-body">Runs on this computer · started by hand</span>
        </div>
        {activeTab === 'steps' && (
          <StepsTabContent
            flowSummary={flowSummary}
            flowSummaryError={flowSummaryError}
            highlightedStepIds={highlightedStepIds}
            requirements={requirements}
            onSaveSecret={onSaveSecret}
            onShowPluginSetup={onShowPluginSetup}
            onPluginSessionChange={onPluginSessionChange}
          />
        )}
        {activeTab === 'runs' && <RunsTabContent agentId={agent.id} />}
        {activeTab === 'source' && <SourceTabContent flowYaml={agent.flowYaml} />}
      </div>
    </section>
  )
}
