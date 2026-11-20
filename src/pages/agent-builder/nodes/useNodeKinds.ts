import { useMemo } from 'react'
import { getNodeKinds } from '@/api/agentGraph'
import type { NodeKindInfo } from '@/api/agentGraphTypes'
import { useAsyncData } from '@/hooks/useAsyncData'

export interface NodeKindsState {
  nodeKinds: NodeKindInfo[]
  /** Library entries by kind. */
  kindsByKind: Record<string, NodeKindInfo>
  /** App names by kind ("Ask a model"), for canvas subtitles. */
  kindNames: Record<string, string>
  error: Error | null
  reload: () => Promise<void>
}

/**
 * The node library (`get_node_kinds`), loaded once per mount; reload after a plugin install.
 *
 * @returns Kinds, lookups by kind, and reload (NodeKindsState)
 */
export function useNodeKinds(): NodeKindsState {
  const { data, error, reload } = useAsyncData(() => getNodeKinds(), [])
  return useMemo(() => {
    const nodeKinds = data ?? []
    return {
      nodeKinds,
      kindsByKind: Object.fromEntries(nodeKinds.map((kindInfo) => [kindInfo.kind, kindInfo])),
      kindNames: Object.fromEntries(nodeKinds.map((kindInfo) => [kindInfo.kind, kindInfo.displayName])),
      error,
      reload,
    }
  }, [data, error, reload])
}
