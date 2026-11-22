import { useCallback, useMemo, useState } from 'react'
import type { AgentGraph, EdgeEdit } from '@/api/agentGraphTypes'
import { checkConnection, SOURCE_HANDLE, type ConnectionCheck } from '@/lib/agentGraphRules'
import { reconnectGraphEdge, removeGraphEdges } from '../graphEdits'
import { describeNodeList } from './canvasCommands'
import type { Connection, OnConnectStartParams } from './flowLibrary'
import type { StepFlowEdge } from './toFlowElements'

/**
 * Drawing arrows on the Nodes canvas: by dragging from a port, or from the keyboard (Enter
 * on a port, then Enter on the target step). While an arrow is drawn every other step gets
 * the check for it, so cards can show where it may land and why not. Refused connections
 * are announced instead of applied.
 */

export interface ConnectingFrom {
  nodeId: string
  handleId: string
  viaKeyboard: boolean
}

export interface ConnectModeOptions {
  graph: AgentGraph
  readOnly: boolean
  canEdit: boolean
  onConnect?: (edge: EdgeEdit) => void
  onApplyEdit?: (change: (graph: AgentGraph) => AgentGraph, description?: string) => void
  announce: (message: string) => void
}

export interface ConnectMode {
  connectingFrom: ConnectingFrom | null
  /** The check for each possible target while an arrow is drawn; null otherwise. */
  connectionChecks: Record<string, ConnectionCheck> | null
  connect: (ends: { source: string; sourceHandle: string | null; target: string }) => void
  startKeyboardConnect: (nodeId: string, handleId: string) => void
  /** Ends a keyboard connection on `targetNodeId`; false when none is being drawn. */
  finishKeyboardConnect: (targetNodeId: string) => boolean
  /** Esc: stops drawing; false when nothing was being drawn. */
  cancelConnect: () => boolean
  handleConnectStart: (event: unknown, params: OnConnectStartParams) => void
  /** A drag ended: a keyboard connection keeps going, a dragged one stops. */
  handleConnectEnd: () => void
  stopConnecting: () => void
  handleReconnect: (oldEdge: StepFlowEdge, connection: Connection) => void
}

/**
 * @param options - Graph, edit rights and the canvas callbacks (ConnectModeOptions)
 * @returns The arrow being drawn and the handlers for React Flow and the keyboard (ConnectMode)
 */
export function useConnectMode({ graph, readOnly, canEdit, onConnect, onApplyEdit, announce }: ConnectModeOptions): ConnectMode {
  const [connectingFrom, setConnectingFrom] = useState<ConnectingFrom | null>(null)

  const connectionChecks = useMemo<Record<string, ConnectionCheck> | null>(() => {
    if (!connectingFrom) return null
    const ends = { source: connectingFrom.nodeId, sourceHandle: connectingFrom.handleId }
    return Object.fromEntries(graph.nodes.filter((node) => !node.hidden && node.id !== connectingFrom.nodeId).map((node) => [node.id, checkConnection(graph, { ...ends, target: node.id })]))
  }, [graph, connectingFrom])

  const connect = useCallback(
    (ends: { source: string; sourceHandle: string | null; target: string }) => {
      if (readOnly || !onConnect) return
      const check = checkConnection(graph, ends)
      if (!check.allowed) {
        announce(check.reason)
        return
      }
      onConnect({ source: ends.source, sourceHandle: ends.sourceHandle || SOURCE_HANDLE, target: ends.target })
      announce(`Connected ${describeNodeList(graph, [ends.source])} to ${describeNodeList(graph, [ends.target])}`)
    },
    [readOnly, onConnect, graph, announce],
  )

  const startKeyboardConnect = useCallback(
    (nodeId: string, handleId: string) => {
      if (readOnly || !onConnect) return
      setConnectingFrom({ nodeId, handleId, viaKeyboard: true })
      announce('Choose the step to connect to: Tab to it and press Enter. Esc cancels')
    },
    [readOnly, onConnect, announce],
  )

  function finishKeyboardConnect(targetNodeId: string): boolean {
    if (!connectingFrom?.viaKeyboard) return false
    connect({ source: connectingFrom.nodeId, sourceHandle: connectingFrom.handleId, target: targetNodeId })
    setConnectingFrom(null)
    return true
  }

  function cancelConnect(): boolean {
    if (!connectingFrom) return false
    setConnectingFrom(null)
    announce('Stopped connecting')
    return true
  }

  function handleConnectStart(_event: unknown, params: OnConnectStartParams) {
    if (params.handleType !== 'source' || !params.nodeId) return
    setConnectingFrom({ nodeId: params.nodeId, handleId: params.handleId ?? SOURCE_HANDLE, viaKeyboard: false })
  }

  function handleReconnect(oldEdge: StepFlowEdge, connection: Connection) {
    if (!canEdit) return
    const ends = { source: connection.source, sourceHandle: connection.sourceHandle || SOURCE_HANDLE, target: connection.target }
    const check = checkConnection(removeGraphEdges(graph, [oldEdge.id]), ends)
    if (!check.allowed) {
      announce(check.reason)
      return
    }
    onApplyEdit?.((current) => reconnectGraphEdge(current, oldEdge.id, ends), `moved the arrow from ${describeNodeList(graph, [ends.source])}`)
  }

  return {
    connectingFrom,
    connectionChecks,
    connect,
    startKeyboardConnect,
    finishKeyboardConnect,
    cancelConnect,
    handleConnectStart,
    handleConnectEnd: () => setConnectingFrom((current) => (current?.viaKeyboard ? current : null)),
    stopConnecting: () => setConnectingFrom(null),
    handleReconnect,
  }
}
