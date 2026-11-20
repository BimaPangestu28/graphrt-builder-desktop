import { memo } from 'react'
import type { NodePort } from '@/api/agentGraphTypes'
import { joinClassNames } from '@/components/ui'
import { Handle, Position, type NodeProps } from './flowLibrary'
import type { StepFlowNode } from './toFlowElements'

/**
 * Canvas renderers for the three node types: a step card, a container (For each /
 * Repeat) with its body inside, and the hidden body marker. Read-only views of the
 * node; the inspector (phase 2) edits it.
 */

function OutputHandles({ outputs }: { outputs: NodePort[] }) {
  return (
    <>
      {outputs.map((outputPort, portIndex) => (
        <Handle
          key={outputPort.id}
          id={outputPort.id}
          type="source"
          position={Position.Right}
          title={outputPort.label || undefined}
          style={{ top: `${((portIndex + 1) / (outputs.length + 1)) * 100}%`, background: outputPort.role === 'fail-branch' ? 'var(--color-danger)' : undefined }}
        />
      ))}
    </>
  )
}

function NodeHeading({ data }: { data: StepFlowNode['data'] }) {
  const { node, kindName, problems } = data
  const hasError = problems.some((problem) => problem.severity === 'error')
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-[13px] font-semibold text-ink">{node.displayTitle}</span>
      <span className="truncate text-[11px] text-muted">
        {kindName ?? node.kind}
        {node.detail ? ` · ${node.detail}` : ''}
      </span>
      {problems.length > 0 && (
        <span className={joinClassNames('text-[11px] font-medium', hasError ? 'text-danger' : 'text-amber')}>
          {problems.length === 1 ? '1 problem' : `${problems.length} problems`}
        </span>
      )}
    </div>
  )
}

/** One step card with its input on the left and one handle per exit on the right. */
export const StepNodeCard = memo(function StepNodeCard({ data, selected }: NodeProps<StepFlowNode>) {
  const { node } = data
  return (
    <div
      data-testid={`node-${node.id}`}
      className={joinClassNames(
        'box-border flex h-[76px] w-[240px] items-center rounded-xl border bg-surface px-3.5 py-2.5 shadow-sm',
        selected ? 'border-brand' : 'border-line-strong',
      )}
    >
      {node.ports.inputs.length > 0 && <Handle id="target" type="target" position={Position.Left} />}
      <NodeHeading data={data} />
      <OutputHandles outputs={node.ports.outputs} />
    </div>
  )
})

/** A For each / Repeat step: header on top, its body's steps inside. */
export const ContainerNodeCard = memo(function ContainerNodeCard({ data, selected }: NodeProps<StepFlowNode>) {
  const { node } = data
  return (
    <div
      data-testid={`node-${node.id}`}
      className={joinClassNames('box-border h-full w-full rounded-2xl border border-dashed bg-brand-tint/60 px-3.5 py-2.5', selected ? 'border-brand' : 'border-brand-line-2')}
    >
      {node.ports.inputs.length > 0 && <Handle id="target" type="target" position={Position.Left} style={{ top: 28 }} />}
      <NodeHeading data={data} />
      <OutputHandles outputs={node.ports.outputs} />
    </div>
  )
})

/** The hidden entry of a loop body: a small dot the body's first arrows leave from. */
export const MarkerNodeDot = memo(function MarkerNodeDot({ data }: NodeProps<StepFlowNode>) {
  return (
    <div data-testid={`marker-${data.node.id}`} aria-hidden="true" className="h-3 w-3 rounded-full bg-brand">
      <OutputHandles outputs={data.node.ports.outputs} />
    </div>
  )
})

export const flowNodeTypes = { step: StepNodeCard, container: ContainerNodeCard, marker: MarkerNodeDot }
