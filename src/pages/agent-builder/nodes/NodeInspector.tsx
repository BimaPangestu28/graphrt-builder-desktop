import type { GraphNode, GraphProblem } from '@/api/agentGraphTypes'
import { joinClassNames } from '@/components/ui'
import type { NodeInspectorProps } from './contracts'
import { createGraphNode, uniqueNodeId } from './graphEdits'
import { listNodeOutputs } from './inspector/availableValues'
import { ErrorHandlingSection } from './inspector/ErrorHandlingSection'
import { OutputsList } from './inspector/fields'
import { InspectorFooter, InspectorHeader } from './inspector/InspectorHeader'
import { InspectorProvider, useInspector } from './inspector/InspectorContext'
import { pickSettingsPanel } from './inspector/panelRegistry'

/**
 * The settings of the selected step (spec B-boards B1–B17), on the right of the Nodes
 * view: header (icon, kind, editable title, description), the kind's settings panel
 * (dedicated for builtin kinds, plugin action form with Change action for plugin
 * kinds, a schema form otherwise), "When this step fails", the outputs, and Ask the
 * builder / Duplicate / Delete. Every change goes through `controller` (one undo step
 * each, with words for the version summary); ports and "unused" arrows follow.
 * Building blocks live in `./inspector/`.
 */

/** A copy of `node` with a fresh id, its settings and " (copy)" in the title. */
export function duplicateGraphNode(node: GraphNode, takenIdsGraph: Parameters<typeof uniqueNodeId>[0], kindDisplayName?: string): GraphNode {
  return createGraphNode(
    {
      id: uniqueNodeId(takenIdsGraph, node.id),
      kind: node.kind,
      title: `${node.displayTitle} (copy)`,
      parent: node.parent,
      config: structuredClone(node.config),
      onError: structuredClone(node.onError),
      retry: { ...node.retry },
      timeoutMs: node.timeoutMs,
    },
    kindDisplayName,
  )
}

function ProblemList({ problems }: { problems: GraphProblem[] }) {
  if (problems.length === 0) return null
  return (
    <ul aria-label="Problems with this step" className="m-0 flex list-none flex-col gap-1 p-0">
      {problems.map((problem) => (
        <li
          key={`${problem.code}-${problem.edgeId ?? ''}-${problem.message}`}
          className={joinClassNames('rounded-lg px-2.5 py-1.5 text-[12px]', problem.severity === 'error' ? 'bg-danger-tint text-danger' : 'bg-amber-tint text-amber-strong')}
        >
          {problem.message}
        </li>
      ))}
    </ul>
  )
}

interface InspectorBodyProps {
  problems: GraphProblem[]
  onClose: () => void
  onAskBuilder?: (text: string) => void
}

function InspectorBody({ problems, onClose, onAskBuilder }: InspectorBodyProps) {
  const { node, graph, kindInfo, controller, readOnly } = useInspector()
  const SettingsPanel = pickSettingsPanel(node, kindInfo)
  const outputs = listNodeOutputs(node, kindInfo ?? undefined).map((output) => ({ name: output.path.slice(1).join('.'), hint: output.typeHint }))
  const errorOutputs = node.onError.strategy !== 'fail' ? [{ name: 'error_message', hint: 'text · when it failed' }, { name: 'error_type', hint: 'text · when it failed' }] : []

  const duplicate = () => {
    const copy = duplicateGraphNode(node, graph, kindInfo?.displayName)
    controller.addNode(copy, `duplicated ${node.displayTitle}`)
    const position = controller.positions[node.id]
    if (position) controller.moveNodes([{ ...position, nodeId: copy.id, x: position.x + 40, y: position.y + 40 }])
  }
  const remove = () => {
    controller.removeNodes([node.id], `removed ${node.displayTitle}`)
    onClose()
  }

  return (
    <>
      <InspectorHeader onClose={onClose} />
      <ProblemList problems={problems} />
      {readOnly && <p className="m-0 rounded-[10px] bg-subtle px-3 py-2 text-[12px] text-muted">The builder is changing this agent. Settings are read-only until it is done.</p>}
      <SettingsPanel key={node.id} />
      <ErrorHandlingSection />
      <OutputsList outputs={[...outputs, ...errorOutputs]} />
      <InspectorFooter onDuplicate={duplicate} onDelete={remove} onAskBuilder={onAskBuilder} />
    </>
  )
}

export function NodeInspector({ node, graph, kindInfo, nodeKinds, problems, readOnly, controller, onClose, onAskBuilder }: NodeInspectorProps) {
  if (!node) return null
  return (
    <aside aria-label="Step settings" className="box-border flex w-[340px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-surface p-4" data-testid="node-inspector">
      <InspectorProvider node={node} graph={graph} kindInfo={kindInfo} nodeKinds={nodeKinds} readOnly={readOnly} controller={controller}>
        <InspectorBody key={node.id} problems={problems} onClose={onClose} onAskBuilder={onAskBuilder} />
      </InspectorProvider>
    </aside>
  )
}
