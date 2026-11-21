import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { AgentGraph, GraphNode, JsonValue, NodeConfig, NodeKindInfo } from '@/api/agentGraphTypes'
import type { NodeChanges } from '../graphEdits'
import type { AgentGraphController } from '../useAgentGraph'
import { listAvailableValues, type ValueGroup } from './availableValues'
import { writeConfigValue, type ConfigPath } from './configPaths'

/**
 * What every inspector panel reads and how it edits: the node, the graph around it, the
 * values it may reference, and edit helpers that go through `useAgentGraph` (one undo
 * step per edit, with plain words for the version summary).
 */
export interface InspectorContextValue {
  node: GraphNode
  graph: AgentGraph
  kindInfo: NodeKindInfo | null
  nodeKinds: NodeKindInfo[]
  kindsByKind: Record<string, NodeKindInfo>
  readOnly: boolean
  /** Picker groups for this node (Start inputs, earlier steps, loop item…). */
  valueGroups: ValueGroup[]
  controller: AgentGraphController
  /** Writes one config value; `what` names it in the summary ("set Max tokens on Write"). */
  setConfigValue: (path: ConfigPath, value: JsonValue | undefined, what: string) => void
  /** Replaces the config from the current one (several keys at once). */
  updateConfig: (change: (config: NodeConfig) => NodeConfig, what: string) => void
  updateNode: (changes: NodeChanges, what: string) => void
}

const InspectorContext = createContext<InspectorContextValue | null>(null)

interface InspectorProviderProps {
  node: GraphNode
  graph: AgentGraph
  kindInfo: NodeKindInfo | null
  nodeKinds: NodeKindInfo[]
  readOnly: boolean
  controller: AgentGraphController
  children: ReactNode
}

/** Provides {@link InspectorContextValue} to the panels of one selected node. */
export function InspectorProvider({ node, graph, kindInfo, nodeKinds, readOnly, controller, children }: InspectorProviderProps) {
  const kindsByKind = useMemo(() => Object.fromEntries(nodeKinds.map((info) => [info.kind, info])), [nodeKinds])
  const valueGroups = useMemo(() => listAvailableValues(graph, node.id, kindsByKind), [graph, node.id, kindsByKind])
  const value = useMemo<InspectorContextValue>(() => {
    const describe = (what: string) => `${what} on ${node.displayTitle}`
    const updateNode = (changes: NodeChanges, what: string) => {
      if (readOnly) return
      controller.updateNode(node.id, changes, describe(what))
    }
    return {
      node,
      graph,
      kindInfo,
      nodeKinds,
      kindsByKind,
      readOnly,
      valueGroups,
      controller,
      updateNode,
      setConfigValue: (path, configValue, what) => updateNode({ config: writeConfigValue(node.config, path, configValue) }, what),
      updateConfig: (change, what) => updateNode({ config: change(node.config) }, what),
    }
  }, [node, graph, kindInfo, nodeKinds, kindsByKind, readOnly, valueGroups, controller])
  return <InspectorContext.Provider value={value}>{children}</InspectorContext.Provider>
}

/** The selected node's inspector context; panels render only inside {@link InspectorProvider}. */
export function useInspector(): InspectorContextValue {
  const context = useContext(InspectorContext)
  if (!context) throw new Error('useInspector must be used inside InspectorProvider')
  return context
}
