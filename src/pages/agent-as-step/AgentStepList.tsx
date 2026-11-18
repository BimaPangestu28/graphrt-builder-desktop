import { joinClassNames } from '@/components/ui'
import type { AgentStepInfo } from '@/api/chainTypes'
import type { FlowStep } from '@/api/types'

const monospaceChipClassNames = 'rounded-md bg-surface px-2 py-[3px] font-mono'
const agentToolPrefix = 'agents/'

function AgentLogoTile() {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-ink">
      <svg width="16" height="16" viewBox="0 0 28 28" aria-hidden="true">
        <path d="M20.5 10A7.5 7.5 0 1 0 21.5 15" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
        <circle cx="14" cy="14" r="3" fill="#2DD4BF" />
      </svg>
    </span>
  )
}

/** The agent a `tool` step runs, when it is one of the user's agents (`agents/<id>`). */
export function findCalledAgent(flowStep: FlowStep, catalog: AgentStepInfo[]): AgentStepInfo | undefined {
  if (flowStep.nodeType !== 'tool' || !flowStep.detail.startsWith(agentToolPrefix)) return undefined
  const agentId = flowStep.detail.slice(agentToolPrefix.length)
  return catalog.find((agent) => agent.agentId === agentId)
}

function FieldChips({ label, fields, className }: { label: string; fields: string[]; className?: string }) {
  if (fields.length === 0) return null
  return (
    <>
      <span className={joinClassNames('text-ink-2', className)}>{label}</span>
      {fields.map((field) => (
        <span key={`${label}-${field}`} className={monospaceChipClassNames}>
          {field}
        </span>
      ))}
    </>
  )
}

/** A step that runs another agent, highlighted in teal, with what it sends and gets back. */
function AgentStepCard({ flowStep, calledAgent, isNew }: { flowStep: FlowStep; calledAgent: AgentStepInfo; isNew: boolean }) {
  return (
    <li className={joinClassNames('mt-2 mr-2 mb-2 flex flex-col gap-3 rounded-xl border border-brand-line-2 bg-brand-tint p-4', flowStep.depth > 0 ? 'ml-11' : 'ml-2')}>
      <div className="flex items-center gap-3">
        <AgentLogoTile />
        <div className="flex flex-auto flex-col gap-0.5">
          <span className="font-semibold">{flowStep.title}</span>
          <span className="text-[13px] text-body">
            Runs your agent {calledAgent.name} · v{calledAgent.currentVersion}
          </span>
        </div>
        <span className="rounded-full border border-brand-line-2 bg-surface px-2 py-[3px] text-[12px] font-semibold text-brand-strong">{isNew ? 'New' : 'Agent'}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <FieldChips label="Sends" fields={calledAgent.inputs.map((input) => input.name)} />
        <FieldChips label="Gets back" fields={calledAgent.outputs} className={calledAgent.inputs.length > 0 ? 'ml-2' : undefined} />
      </div>
      <span className="text-[12px] text-body">Always uses the newest version of {calledAgent.name}</span>
    </li>
  )
}

function PlainStepRow({ flowStep, number, isChanged }: { flowStep: FlowStep; number: number; isChanged: boolean }) {
  return (
    <li className={joinClassNames('flex items-center gap-3.5 border-b border-chip py-3.5 pr-4 last:border-b-0', flowStep.depth > 0 ? 'pl-[60px]' : 'pl-4')}>
      {flowStep.depth === 0 && <span className="w-[22px] text-center text-[12px] font-semibold text-muted">{number}</span>}
      <span className="flex-auto font-medium">{flowStep.title}</span>
      {isChanged && <span className="text-[12px] text-muted">Changed</span>}
      {flowStep.needsApproval && <span className="rounded-full bg-amber-soft px-2 py-[3px] text-[12px] font-medium text-amber-strong">Approval</span>}
    </li>
  )
}

interface AgentStepListProps {
  agentName: string
  steps: FlowStep[]
  catalog: AgentStepInfo[]
  changedStepIds: string[]
  placementStepId: string
  onPlacementChange: (stepId: string) => void
}

/** Left side of screen 12: the target agent's steps, where to add the new one, and steps that run other agents. */
export function AgentStepList({ agentName, steps, catalog, changedStepIds, placementStepId, onPlacementChange }: AgentStepListProps) {
  return (
    <section aria-label="Steps" className="box-border flex min-w-0 flex-[2_1_480px] flex-col gap-5 px-8 py-7">
      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-[22px] font-semibold tracking-[-0.3px]">{agentName}</h1>
        <label className="flex flex-wrap items-center gap-2 text-body">
          Add the step after
          <select
            value={placementStepId}
            onChange={(event) => onPlacementChange(event.target.value)}
            className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink"
          >
            {steps.map((flowStep) => (
              <option key={flowStep.id} value={flowStep.id}>
                {flowStep.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ol className="m-0 list-none rounded-[14px] border border-line p-0">
        {steps.map((flowStep, stepIndex) => {
          const calledAgent = findCalledAgent(flowStep, catalog)
          const isChanged = changedStepIds.includes(flowStep.id)
          return calledAgent ? (
            <AgentStepCard key={flowStep.id} flowStep={flowStep} calledAgent={calledAgent} isNew={isChanged} />
          ) : (
            <PlainStepRow key={flowStep.id} flowStep={flowStep} number={stepIndex + 1} isChanged={isChanged} />
          )
        })}
      </ol>
    </section>
  )
}
