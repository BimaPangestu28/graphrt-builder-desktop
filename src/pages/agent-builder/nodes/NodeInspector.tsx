import { useRef, useState } from 'react'
import type { AgentGraph, GraphProblem, NodeLayout } from '@/api/agentGraphTypes'
import { joinClassNames } from '@/components/ui'
import type { InspectorSectionRequest, NodeInspectorProps } from './contracts'
import { copyGraphNodes, pasteGraphNodes, type PasteResult } from './flow/clipboard'
import { updateGraphNode } from './graphEdits'
import { listNodeOutputs } from './inspector/availableValues'
import { ErrorHandlingSection } from './inspector/ErrorHandlingSection'
import { OutputsList } from './inspector/fields'
import { InspectorFooter, InspectorHeader } from './inspector/InspectorHeader'
import { InspectorProvider, useInspector } from './inspector/InspectorContext'
import { pickSettingsPanel } from './inspector/panelRegistry'
import { SectionRequestProvider, useFieldRequestFallback } from './inspector/sectionRequest'
import { messages } from '@/i18n'

/**
 * The settings of the selected step (spec B-boards B1–B17), on the right of the Nodes
 * view: header (icon, kind, editable title, description), the kind's settings panel
 * (dedicated for builtin kinds, plugin action form with Change action for plugin
 * kinds, a schema form otherwise), "When this step fails", the outputs, and Ask the
 * builder / Duplicate / Delete. Every change goes through `controller` (one undo step
 * each, with words for the version summary); ports and "unused" arrows follow.
 * `requestedSection` opens a section or field (see `inspector/sectionRequest.tsx`).
 * Building blocks live in `./inspector/`.
 */

/**
 * A copy of the step `nodeId` with fresh ids, its settings and " (copy)" in the title.
 * A For each / Repeat comes with its whole body (inner steps, arrows and positions,
 * references between them pointing at the copies), like Duplicate on the canvas.
 *
 * @param graph - Working graph (AgentGraph)
 * @param nodeId - The step to duplicate (string)
 * @param positions - Current positions, to place the copy beside the original (Record<string, NodeLayout>)
 * @returns The graph with the copy, the copy's id and positions (PasteResult & { copyId: string | null })
 */
export function duplicateInspectedNode(graph: AgentGraph, nodeId: string, positions: Record<string, NodeLayout>): PasteResult & { copyId: string | null } {
  const original = graph.nodes.find((node) => node.id === nodeId)
  const pasted = pasteGraphNodes(graph, copyGraphNodes(graph, [nodeId], positions))
  const copyId = pasted.idMap[nodeId] ?? null
  if (!original || !copyId) return { ...pasted, copyId }
  return { ...pasted, graph: updateGraphNode(pasted.graph, copyId, { title: `${original.displayTitle} (copy)` }), copyId }
}

function ProblemList({ problems }: { problems: GraphProblem[] }) {
  if (problems.length === 0) return null
  return (
    <ul aria-label={messages().nodes.problemsWithThisStep} className="m-0 flex list-none flex-col gap-1 p-0">
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
  const bodyRef = useRef<HTMLDivElement>(null)
  useFieldRequestFallback(bodyRef)
  const SettingsPanel = pickSettingsPanel(node, kindInfo)
  const outputs = listNodeOutputs(node, kindInfo ?? undefined).map((output) => ({ name: output.path.slice(1).join('.'), hint: output.typeHint }))
  const errorOutputs = node.onError.strategy !== 'fail' ? [{ name: 'error_message', hint: messages().nodes.textWhenItFailed }, { name: 'error_type', hint: messages().nodes.textWhenItFailed }] : []

  const duplicate = () => {
    const { layouts } = duplicateInspectedNode(graph, node.id, controller.positions)
    // The edit starts from the controller's latest graph; positions follow once it exists.
    controller.applyEdit((current) => duplicateInspectedNode(current, node.id, controller.positions).graph, messages().nodes.duplicatedDisplaytitle(node.displayTitle))
    if (layouts.length > 0) controller.moveNodes(layouts)
  }
  const remove = () => {
    controller.removeNodes([node.id], messages().nodes.removedDisplaytitle(node.displayTitle))
    onClose()
  }

  return (
    <div ref={bodyRef} className="contents">
      <InspectorHeader onClose={onClose} />
      <ProblemList problems={problems} />
      {readOnly && <p className="m-0 rounded-[10px] bg-subtle px-3 py-2 text-[12px] text-muted">{messages().nodes.theBuilderIsChangingThisAgent2}</p>}
      <SettingsPanel key={node.id} />
      <ErrorHandlingSection />
      <OutputsList outputs={[...outputs, ...errorOutputs]} />
      <InspectorFooter onDuplicate={duplicate} onDelete={remove} onAskBuilder={onAskBuilder} />
    </div>
  )
}

/**
 * The request meant for the node shown: one naming `nodeId`, or one that arrived while
 * this node was shown. Selecting another node later does not replay it.
 */
function useRequestForNode(requestedSection: InspectorSectionRequest | null | undefined, nodeId: string | null): InspectorSectionRequest | null {
  const [owner, setOwner] = useState<{ sequence: number; nodeId: string | null } | null>(null)
  if (requestedSection && requestedSection.sequence !== owner?.sequence) {
    // Remember which node it arrived for (state from the previous render, React's documented pattern).
    setOwner({ sequence: requestedSection.sequence, nodeId: requestedSection.nodeId ?? nodeId })
    return requestedSection.nodeId === undefined || requestedSection.nodeId === nodeId ? requestedSection : null
  }
  return requestedSection && owner?.nodeId === nodeId ? requestedSection : null
}

export function NodeInspector({ node, graph, kindInfo, nodeKinds, problems, readOnly, controller, onClose, onAskBuilder, requestedSection }: NodeInspectorProps) {
  const request = useRequestForNode(requestedSection, node?.id ?? null)
  if (!node) return null
  return (
    <aside aria-label={messages().nodes.stepSettings} className="box-border flex w-[340px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-surface p-4" data-testid="node-inspector">
      <InspectorProvider node={node} graph={graph} kindInfo={kindInfo} nodeKinds={nodeKinds} readOnly={readOnly} controller={controller}>
        <SectionRequestProvider request={request}>
          <InspectorBody key={node.id} problems={problems} onClose={onClose} onAskBuilder={onAskBuilder} />
        </SectionRequestProvider>
      </InspectorProvider>
    </aside>
  )
}
