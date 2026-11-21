import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { getAgentGraph, saveAgentGraph } from '@/api/agentGraph'
import type { NodeEdit } from '@/api/agentGraphTypes'
import type { InspectorSectionRequest } from '../../contracts'
import { NodeInspector } from '../../NodeInspector'
import { useAgentGraph, type AgentGraphController } from '../../useAgentGraph'
import { useNodeKinds } from '../../useNodeKinds'

/**
 * Renders the real inspector on the sample "maps-leads" agent with a live
 * `useAgentGraph` controller, so tests read the config the backend would save.
 */

export const agentId = 'maps-leads'

/** Nodes of every builtin kind the sample agent lacks, chained after Search Google Maps. */
export const fixtureNodes: NodeEdit[] = [
  { id: 'has_phone', kind: 'if-else', title: 'Has a phone number?', config: { cases: [{ case_id: 'case_1', logical_operator: 'and', conditions: [] }] } },
  { id: 'look_up_menu', kind: 'knowledge-retrieval', title: 'Look up the menu', config: { query_variable_selector: ['ask_input', 'offer'], dataset_ids: [] } },
  { id: 'add_to_crm', kind: 'http-request', title: 'Add the leads to our CRM', config: { method: 'get', url: 'https://api.example.com/leads', headers: 'Accept: application/json' } },
  { id: 'count_replies', kind: 'assigner', title: 'Count the replies', config: { items: [{ variable_selector: ['for_each_place', 'item'], operation: 'over-write', input_type: 'constant', value: '' }] } },
  { id: 'lead_agent', kind: 'agent', title: 'Find leads', config: { model: { provider: 'openai', name: 'gpt-4o-mini' }, tools: ['whatsapp-web/send_message'] } },
]

/** Saves the fixture nodes as a new version: search_maps → has_phone (case_1) → look_up_menu → … */
export async function addFixtureNodes(): Promise<void> {
  const graph = await getAgentGraph(agentId)
  const chain = ['search_maps', ...fixtureNodes.map((node) => node.id)]
  await saveAgentGraph(agentId, graph.version, {
    nodes: [...graph.nodes.map((node) => ({ id: node.id, kind: node.kind, title: node.title, parent: node.parent, config: node.config, onError: node.onError, retry: node.retry, timeoutMs: node.timeoutMs })), ...fixtureNodes],
    edges: [
      ...graph.edges.map((edge) => ({ documentId: edge.documentId, source: edge.source, sourceHandle: edge.sourceHandle, target: edge.target })),
      ...chain.slice(1).map((target, index) => ({ source: chain[index], sourceHandle: chain[index] === 'has_phone' ? 'case_1' : 'source', target })),
    ],
    description: 'test fixture',
  })
}

export const harness: { controller: AgentGraphController | null } = { controller: null }

function InspectorHarness({ nodeId, requestedSection = null }: { nodeId: string; requestedSection?: InspectorSectionRequest | null }) {
  const controller = useAgentGraph({ agentId, currentVersion: null })
  const { nodeKinds, kindsByKind } = useNodeKinds()
  harness.controller = controller
  const node = controller.graph?.nodes.find((candidate) => candidate.id === nodeId) ?? null
  if (!controller.graph || nodeKinds.length === 0 || !node) return null
  return (
    <NodeInspector
      node={node}
      graph={controller.graph}
      kindInfo={kindsByKind[node.kind] ?? null}
      nodeKinds={nodeKinds}
      problems={[]}
      readOnly={false}
      controller={controller}
      onClose={() => undefined}
      requestedSection={requestedSection}
    />
  )
}

/** Renders the inspector for `nodeId` and waits until it shows. */
export async function renderInspector(nodeId: string) {
  const view = render(
    <MemoryRouter>
      <InspectorHarness nodeId={nodeId} />
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByTestId('node-inspector')).toBeInTheDocument())
  let sequence = 0
  /** Sends a `requestedSection` (like the canvas menu or the problems list), optionally for another node. */
  const requestSection = (section: string, shownNodeId = nodeId, requestNodeId?: string) => {
    sequence += 1
    view.rerender(
      <MemoryRouter>
        <InspectorHarness nodeId={shownNodeId} requestedSection={{ section, sequence, nodeId: requestNodeId }} />
      </MemoryRouter>,
    )
  }
  return { ...view, requestSection }
}

/** The node as the controller holds it now. */
export function currentNode(nodeId: string) {
  const node = harness.controller?.graph?.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) throw new Error(`no node ${nodeId}`)
  return node
}
