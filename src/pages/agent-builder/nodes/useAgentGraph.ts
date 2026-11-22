import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { conflictLatestVersion, getAgentGraph, getNodeLayout, invalidGraphProblems, saveAgentGraph, saveNodeLayout } from '@/api/agentGraph'
import type { AgentGraph, CanvasViewport, EdgeEdit, GraphNode, GraphProblem, NodeLayout, SaveGraphResult } from '@/api/agentGraphTypes'
import { isBackendErrorWithCode } from '@/api/client'
import { toError } from '@/lib/errors'
import { addGraphEdge, addGraphNode, isSameGraph, removeGraphEdges, removeGraphNodes, toGraphEdit, updateGraphNode, type NodeChanges } from './graphEdits'
import { emptyGraphHistory, graphHistoryReducer } from './sync/graphHistory'
import { mergeGraphEdits, type ConflictChoice, type NodeMergeConflict } from './sync/graphMerge'
import { useBuilderLock } from './sync/useBuilderLock'
import { layoutFor, useNodePositions } from './sync/useNodePositions'

/**
 * Local edit state of the Nodes view: the saved graph, a working copy with undo /
 * redo, node positions, and saving with the backend's conflict and builder-lock
 * rules. The contract every Nodes component builds on; see `README.md` in this folder.
 */

/** Where saving stands. */
export type GraphSaveStatus =
  /** Nothing saved since the graph loaded. */
  | 'idle'
  | 'saving'
  /** The last save added a version (see `lastSave`). */
  | 'saved'
  /** The agent moved on and my edits touch steps it changed too: Keep mine / Keep the builder's per step (`conflict.nodes`). */
  | 'conflict'
  /** The builder is changing the agent; the edit stays local until it is done. */
  | 'builder-busy'
  /** The edit has blocking problems (`saveProblems`); nothing was saved. */
  | 'invalid'
  /** Any other failure (`saveError`). */
  | 'failed'

export interface UseAgentGraphOptions {
  agentId: string
  /**
   * The agent's current version as the builder page knows it. When it moves (a chat
   * change or Undo landed) the graph reloads, or, with unsaved edits, the edits are merged onto
   * it per step (see `sync/graphMerge.ts`); `conflict` is set for steps both sides changed.
   */
  currentVersion: number | null
  /** Called after a save added a version (reload the agent, steps and chat there). */
  onSaved?: (result: SaveGraphResult) => void
}

export interface AgentGraphState {
  /** The graph as last loaded or saved (null while the first load runs). */
  savedGraph: AgentGraph | null
  /** The working copy with local edits; render this one. */
  graph: AgentGraph | null
  isLoading: boolean
  loadError: Error | null
  /** Local edits differ from `savedGraph`. */
  isDirty: boolean
  canUndo: boolean
  canRedo: boolean
  /** Words for each edit since the last save ("moved Write the run report"). */
  pendingDescriptions: string[]
  /** Positions by node id: saved ones plus local moves. Nodes not listed get auto-layout. */
  positions: Record<string, NodeLayout>
  viewport: CanvasViewport | null
  /** Positions changed since they were last saved. */
  isLayoutDirty: boolean
  builderBusy: boolean
  status: GraphSaveStatus
  /** Set while `status` is `conflict`. */
  conflict: GraphConflict | null
  /** The last time my edits were merged onto a newer version (the queue re-applied); null before. */
  lastMerge: { latestVersion: number; reappliedNodeIds: string[] } | null
  /** Blocking problems of the last refused save (`status` `invalid`). */
  saveProblems: GraphProblem[]
  saveError: Error | null
  lastSave: SaveGraphResult | null
}

/** My edits and a newer version touch the same steps. */
export interface GraphConflict {
  latestVersion: number
  /** Steps both changed, still to decide (Keep mine / Keep the builder's per step). */
  nodes: NodeMergeConflict[]
}

export interface AgentGraphActions {
  /** Applies any change to the working copy as one undoable step. */
  applyEdit: (change: (graph: AgentGraph) => AgentGraph, description?: string) => void
  updateNode: (nodeId: string, changes: NodeChanges, description?: string) => void
  addNode: (node: GraphNode, description?: string) => void
  removeNodes: (nodeIds: string[], description?: string) => void
  addEdge: (edge: EdgeEdit, description?: string) => void
  removeEdges: (edgeIds: string[], description?: string) => void
  undo: () => void
  redo: () => void
  /** Drops every local edit and goes back to `savedGraph`. */
  discardChanges: () => void
  /**
   * Saves the working copy as a new version. Resolves with the result, or null when
   * nothing was sent (no edits, builder busy) or the save was refused (see `status`).
   */
  save: (description?: string) => Promise<SaveGraphResult | null>
  /**
   * Decides every open conflicting step at once, then saves the merged edits onto the latest
   * version (`keep-theirs` with nothing else of mine left just loads the latest).
   */
  resolveConflict: (choice: ConflictChoice) => Promise<void>
  /** Decides one conflicting step; the merge is saved once every step is decided. */
  resolveNodeConflict: (nodeId: string, choice: ConflictChoice) => Promise<void>
  /** Loads the current version again (local edits are dropped). */
  reload: () => Promise<void>
  /** Records new positions locally (not undoable, adds no version). */
  moveNodes: (layouts: NodeLayout[]) => void
  setViewport: (viewport: CanvasViewport) => void
  /** Saves the positions (and viewport) for the saved version. */
  saveLayout: () => Promise<void>
}

export type AgentGraphController = AgentGraphState & AgentGraphActions

/** The three graphs of an open merge and the per-step decisions made so far. */
interface PendingMerge {
  base: AgentGraph
  mine: AgentGraph
  theirs: AgentGraph
  choices: Record<string, ConflictChoice>
}

/**
 * Loads an agent's graph and positions and keeps the local edit state for the Nodes view.
 *
 * The working copy and its undo / redo history live in one reducer (`sync/graphHistory.ts`),
 * so edits dispatched in the same tick all apply; positions (`sync/useNodePositions.ts`) and
 * the builder lock (`sync/useBuilderLock.ts`) are their own hooks. This hook adds loading,
 * saving, and merging my edits onto a version saved elsewhere.
 *
 * @param options.agentId - Agent to edit (string)
 * @param options.currentVersion - The agent's current version from the page (number | null)
 * @param options.onSaved - Called after a save added a version
 * @returns State and actions (AgentGraphController)
 *
 * @example
 * const nodes = useAgentGraph({ agentId, currentVersion: agent.currentVersion, onSaved: reloadAgent })
 * nodes.updateNode('send', { retry: { maxRetries: 2, intervalMs: 2000, backoff: 2 } }, 'set Retry 2× on Send')
 * await nodes.save()
 */
export function useAgentGraph({ agentId, currentVersion, onSaved }: UseAgentGraphOptions): AgentGraphController {
  const [history, dispatchHistory] = useReducer(graphHistoryReducer, emptyGraphHistory)
  const { savedGraph, graph, past, future, pendingDescriptions } = history
  const layout = useNodePositions()
  const { positions, viewport, showSavedLayout, addLatestPositions, markLayoutSaved } = layout
  const [builderBusy, setBuilderBusy] = useBuilderLock(agentId)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<Error | null>(null)
  const [status, setStatus] = useState<GraphSaveStatus>('idle')
  const [conflict, setConflict] = useState<GraphConflict | null>(null)
  const [lastMerge, setLastMerge] = useState<AgentGraphState['lastMerge']>(null)
  const pendingMergeRef = useRef<PendingMerge | null>(null)
  const catchingUpRef = useRef<number | null>(null)
  const [saveProblems, setSaveProblems] = useState<GraphProblem[]>([])
  const [saveError, setSaveError] = useState<Error | null>(null)
  const [lastSave, setLastSave] = useState<SaveGraphResult | null>(null)
  const latestLoadRef = useRef(0)
  const onSavedRef = useRef(onSaved)
  onSavedRef.current = onSaved

  const isDirty = useMemo(() => Boolean(graph && savedGraph && !isSameGraph(graph, savedGraph)), [graph, savedGraph])

  const showSavedGraph = useCallback((loaded: AgentGraph) => dispatchHistory({ type: 'show-saved', graph: loaded }), [])

  const reload = useCallback(async () => {
    latestLoadRef.current += 1
    const loadId = latestLoadRef.current
    setIsLoading(true)
    try {
      const [loadedGraph, loadedLayout] = await Promise.all([getAgentGraph(agentId), getNodeLayout(agentId)])
      if (loadId !== latestLoadRef.current) return
      showSavedGraph(loadedGraph)
      showSavedLayout(loadedLayout)
      setLoadError(null)
      setConflict(null)
      pendingMergeRef.current = null
      setSaveProblems([])
      setStatus('idle')
    } catch (rawError) {
      if (loadId === latestLoadRef.current) setLoadError(toError(rawError))
    } finally {
      if (loadId === latestLoadRef.current) setIsLoading(false)
    }
  }, [agentId, showSavedGraph, showSavedLayout])

  useEffect(() => {
    void reload()
  }, [reload])

  // Stable: each edit is applied to the state current when React processes it, not to this render's graph.
  const applyEdit = useCallback(
    (change: (current: AgentGraph) => AgentGraph, description?: string) => dispatchHistory({ type: 'edit', change, description }),
    [],
  )
  const undo = useCallback(() => dispatchHistory({ type: 'undo' }), [])
  const redo = useCallback(() => dispatchHistory({ type: 'redo' }), [])

  const recordSaveFailure = useCallback(
    (rawError: unknown) => {
      if (isBackendErrorWithCode(rawError, 'builder_busy')) {
        setBuilderBusy(true)
        setStatus('builder-busy')
        return
      }
      const problems = invalidGraphProblems(rawError)
      if (problems.length > 0) {
        setSaveProblems(problems)
        setStatus('invalid')
        return
      }
      setSaveError(toError(rawError))
      setStatus('failed')
    },
    [setBuilderBusy],
  )

  const saveOnto = useCallback(
    async (baseVersion: number, description?: string, graphToSave: AgentGraph | null = graph): Promise<SaveGraphResult | null> => {
      if (!graphToSave) return null
      if (builderBusy) {
        setStatus('builder-busy')
        return null
      }
      setStatus('saving')
      setSaveError(null)
      setSaveProblems([])
      const summaryWords = description ?? (pendingDescriptions.length > 0 ? pendingDescriptions.join(', ') : null)
      try {
        const result = await saveAgentGraph(agentId, baseVersion, toGraphEdit(graphToSave, { description: summaryWords, layout: layoutFor(graphToSave, positions) }))
        showSavedGraph(result.graph)
        setConflict(null)
        pendingMergeRef.current = null
        markLayoutSaved()
        setLastSave(result)
        setStatus(result.saved ? 'saved' : 'idle')
        if (result.saved) onSavedRef.current?.(result)
        return result
      } catch (rawError) {
        const latestVersion = conflictLatestVersion(rawError)
        if (latestVersion !== null) {
          setStatus('idle')
          await catchUpRef.current(latestVersion)
          return null
        }
        recordSaveFailure(rawError)
        return null
      }
    },
    [agentId, graph, builderBusy, pendingDescriptions, positions, showSavedGraph, markLayoutSaved, recordSaveFailure],
  )

  /** Shows a merge: the merged working copy over the latest version, conflicts if any. */
  const showMerge = useCallback((merge: PendingMerge) => {
    const result = mergeGraphEdits(merge.base, merge.mine, merge.theirs, merge.choices)
    dispatchHistory({ type: 'show-merge', savedGraph: merge.theirs, graph: result.merged })
    if (result.conflicts.length > 0) {
      pendingMergeRef.current = merge
      setConflict({ latestVersion: merge.theirs.version, nodes: result.conflicts })
      setStatus('conflict')
    } else {
      pendingMergeRef.current = null
      setConflict(null)
      setStatus('idle')
    }
    return result
  }, [])

  /** Loads the latest version and merges my unsaved edits onto it, step by step. */
  const catchUpWithLatest = useCallback(
    async (latestVersion: number) => {
      if (!graph || !savedGraph || catchingUpRef.current === latestVersion) return
      catchingUpRef.current = latestVersion
      try {
        const [latest, latestLayout] = await Promise.all([getAgentGraph(agentId), getNodeLayout(agentId)])
        addLatestPositions(latestLayout.nodes)
        const result = showMerge({ base: savedGraph, mine: graph, theirs: latest, choices: {} })
        setLastMerge({ latestVersion: latest.version, reappliedNodeIds: result.reappliedNodeIds })
      } catch (rawError) {
        setSaveError(toError(rawError))
        setStatus('failed')
      } finally {
        catchingUpRef.current = null
      }
    },
    [agentId, graph, savedGraph, showMerge, addLatestPositions],
  )
  const catchUpRef = useRef(catchUpWithLatest)
  catchUpRef.current = catchUpWithLatest

  // A version saved elsewhere (chat change, Undo, another window).
  useEffect(() => {
    if (currentVersion === null || !savedGraph || currentVersion <= savedGraph.version || status === 'conflict') return
    if (isDirty) {
      void catchUpWithLatest(currentVersion)
      return
    }
    void reload()
  }, [currentVersion, savedGraph, isDirty, status, reload, catchUpWithLatest])

  const save = useCallback(
    async (description?: string) => {
      if (!savedGraph || !isDirty) return null
      return saveOnto(savedGraph.version, description)
    },
    [savedGraph, isDirty, saveOnto],
  )

  /** Applies decisions; once none is open, saves the merge (or just shows the latest when nothing of mine is left). */
  const decideConflicts = useCallback(
    async (choices: Record<string, ConflictChoice>) => {
      const merge = pendingMergeRef.current
      if (!merge) {
        await reload()
        return
      }
      const result = showMerge({ ...merge, choices: { ...merge.choices, ...choices } })
      if (result.conflicts.length > 0) return
      if (isSameGraph(result.merged, merge.theirs)) {
        showSavedGraph(merge.theirs)
        return
      }
      await saveOnto(merge.theirs.version, undefined, result.merged)
    },
    [reload, showMerge, showSavedGraph, saveOnto],
  )

  const resolveConflict = useCallback(
    async (choice: ConflictChoice) => {
      const openNodeIds = conflict?.nodes.map((node) => node.nodeId) ?? []
      await decideConflicts(Object.fromEntries(openNodeIds.map((nodeId) => [nodeId, choice])))
    },
    [conflict, decideConflicts],
  )

  const resolveNodeConflict = useCallback((nodeId: string, choice: ConflictChoice) => decideConflicts({ [nodeId]: choice }), [decideConflicts])

  const saveLayout = useCallback(async () => {
    if (!savedGraph) return
    const saved = await saveNodeLayout(agentId, savedGraph.version, layoutFor(graph ?? savedGraph, positions), viewport)
    markLayoutSaved(saved.nodes)
  }, [agentId, savedGraph, graph, positions, viewport, markLayoutSaved])

  const discardChanges = useCallback(() => {
    if (savedGraph) showSavedGraph(savedGraph)
  }, [savedGraph, showSavedGraph])

  return {
    savedGraph,
    graph,
    isLoading,
    loadError,
    isDirty,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    pendingDescriptions,
    positions,
    viewport,
    isLayoutDirty: layout.isLayoutDirty,
    builderBusy,
    status,
    conflict,
    lastMerge,
    saveProblems,
    saveError,
    lastSave,
    applyEdit,
    updateNode: (nodeId, changes, description) => applyEdit((current) => updateGraphNode(current, nodeId, changes), description),
    addNode: (node, description) => applyEdit((current) => addGraphNode(current, node), description),
    removeNodes: (nodeIds, description) => applyEdit((current) => removeGraphNodes(current, nodeIds), description),
    addEdge: (edge, description) => applyEdit((current) => addGraphEdge(current, edge), description),
    removeEdges: (edgeIds, description) => applyEdit((current) => removeGraphEdges(current, edgeIds), description),
    undo,
    redo,
    discardChanges,
    save,
    resolveConflict,
    resolveNodeConflict,
    reload,
    moveNodes: layout.moveNodes,
    setViewport: layout.setViewport,
    saveLayout,
  }
}
