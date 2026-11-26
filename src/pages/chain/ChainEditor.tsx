import { useState } from 'react'
import { Link } from 'react-router-dom'
import { joinClassNames } from '@/components/ui'
import { setChainStatus, testChain, updateChain } from '@/api/chains'
import type { AgentStepInfo, Chain, ChainStep } from '@/api/chainTypes'
import type { Run } from '@/api/types'
import { agentPath, routePaths } from '@/routes'
import { ChainFlow } from './ChainFlow'
import { LinkSettingsPanel } from './LinkSettingsPanel'
import { buildAppendedStep, removeChainStep } from './chainEditing'
import { toErrorMessage as describeError } from '@/lib/errors'
import { messages } from '@/i18n'

const headerButtonClassNames = 'flex h-9 cursor-pointer items-center rounded-lg px-3.5 text-[13px] font-medium'

interface ChainHeaderProps {
  chain: Chain
  isBusy: boolean
  onTest: () => void
  onToggleActive: () => void
}

/** Breadcrumb with the chain's status, plus Test chain and Activate / Pause actions. */
function ChainHeader({ chain, isBusy, onTest, onToggleActive }: ChainHeaderProps) {
  const isActive = chain.status === 'active'
  return (
    <header className="box-border flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3">
      <div className="flex items-center gap-2 text-muted">
        <Link to={routePaths.home} className="no-underline !text-muted hover:!text-ink">
          {messages().team.chains}
        </Link>
        <span aria-hidden="true">/</span>
        <h1 className="m-0 text-[14px] font-semibold text-ink">{chain.name}</h1>
        <span className={joinClassNames('rounded-full px-2 py-[3px] text-[12px] font-medium', isActive ? 'bg-ok-soft text-ok-strong' : 'bg-selected text-ink-2')}>
          {isActive ? messages().team.active : messages().team.paused}
        </span>
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={isBusy || chain.steps.length === 0} onClick={onTest} className={`${headerButtonClassNames} border border-line-strong bg-surface text-ink hover:bg-subtle disabled:cursor-default disabled:text-muted`}>
          {messages().team.testChain}
        </button>
        <button type="button" disabled={isBusy} onClick={onToggleActive} className={`${headerButtonClassNames} border-0 bg-ink text-white hover:bg-ink-2`}>
          {isActive ? messages().team.pause : messages().team.activate}
        </button>
      </div>
    </header>
  )
}

type ChainNotice = { kind: 'error'; text: string } | { kind: 'started'; run: Run; agentName: string } | null

function ChainNoticeBar({ notice }: { notice: ChainNotice }) {
  if (!notice) return null
  if (notice.kind === 'error') {
    return (
      <p role="alert" className="m-0 border-b border-line bg-amber-tint px-6 py-2.5 text-[13px] text-amber-strong">
        {notice.text}
      </p>
    )
  }
  return (
    <p role="status" className="m-0 border-b border-line bg-subtle px-6 py-2.5 text-[13px]">
      {messages().team.started}{' '}{notice.agentName}{messages().team.theNextAgentsFollowWhenIt}{' '}
      <Link to={agentPath('testRun', notice.run.agentId, { runId: notice.run.id })}>{messages().team.openTheRun}</Link>
    </p>
  )
}

interface ChainEditorProps {
  initialChain: Chain
  agents: AgentStepInfo[]
}

/**
 * The chain editor of screen 11: flow on the left, the selected link's settings on the right.
 * Link edits stay local until "Save link"; adding or removing an agent saves right away.
 */
export function ChainEditor({ initialChain, agents }: ChainEditorProps) {
  const [chain, setChain] = useState(initialChain)
  const [steps, setSteps] = useState<ChainStep[]>(initialChain.steps)
  const [selectedPosition, setSelectedPosition] = useState(1)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [notice, setNotice] = useState<ChainNotice>(null)

  const findAgent = (agentId: string | undefined) => agents.find((agent) => agent.agentId === agentId)
  const linkPosition = Math.min(Math.max(selectedPosition, 1), steps.length - 1)
  const selectedStep = steps[linkPosition] as ChainStep | undefined

  const runAction = async (action: () => Promise<void>) => {
    setIsBusy(true)
    setNotice(null)
    try {
      await action()
    } catch (rawError) {
      setNotice({ kind: 'error', text: describeError(rawError) })
    } finally {
      setIsBusy(false)
    }
  }

  const saveSteps = (nextSteps: ChainStep[]) =>
    runAction(async () => {
      const savedChain = await updateChain(chain.id, { name: chain.name, steps: nextSteps })
      setChain(savedChain)
      setSteps(savedChain.steps)
      setHasUnsavedChanges(false)
    })

  const updateSelectedStep = (updatedStep: ChainStep) => {
    setSteps((current) => current.map((step, position) => (position === linkPosition ? updatedStep : step)))
    setHasUnsavedChanges(true)
  }

  const addAgent = (agentId: string) => {
    const addedAgent = findAgent(agentId)
    if (!addedAgent) return
    const nextSteps = [...steps, buildAppendedStep(addedAgent, findAgent(steps[steps.length - 1]?.agentId))]
    setSelectedPosition(nextSteps.length - 1)
    void saveSteps(nextSteps)
  }

  const toggleActive = () =>
    runAction(async () => {
      setChain(await setChainStatus(chain.id, chain.status === 'active' ? 'paused' : 'active'))
    })

  const startTest = () =>
    runAction(async () => {
      const run = await testChain(chain.id)
      setNotice({ kind: 'started', run, agentName: findAgent(run.agentId)?.name ?? messages().team.theFirstAgent })
    })

  return (
    <>
      <ChainHeader chain={chain} isBusy={isBusy} onTest={startTest} onToggleActive={toggleActive} />
      <ChainNoticeBar notice={notice} />
      <div className="flex flex-auto flex-wrap">
        <ChainFlow
          steps={steps}
          agents={agents}
          selectedPosition={linkPosition}
          onSelectLink={setSelectedPosition}
          onAddAgent={addAgent}
          onRemoveAgent={(position) => void saveSteps(removeChainStep(steps, position))}
        />
        {selectedStep ? (
          <LinkSettingsPanel
            step={selectedStep}
            linkNumber={linkPosition}
            targetAgent={findAgent(selectedStep.agentId)}
            previousAgent={findAgent(steps[linkPosition - 1]?.agentId)}
            hasUnsavedChanges={hasUnsavedChanges}
            isSaving={isBusy}
            onChange={updateSelectedStep}
            onSave={() => void saveSteps(steps)}
          />
        ) : (
          <aside className="box-border flex min-w-0 flex-[1_1_340px] flex-col gap-2 border-l border-line p-6 text-body">
            <h2 className="m-0 text-[18px] font-semibold text-ink">{messages().team.links}</h2>
            <p className="m-0 leading-normal">{messages().team.addAtLeastTwoAgentsEach}</p>
          </aside>
        )}
      </div>
    </>
  )
}
