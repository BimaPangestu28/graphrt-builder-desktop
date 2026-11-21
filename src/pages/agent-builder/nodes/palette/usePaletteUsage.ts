import { useMemo } from 'react'
import { useAgents } from '@/hooks/useAgents'
import { countKindUsage } from './paletteCatalog'

/**
 * How often each plugin action is used across your agents' current versions, for "Most
 * used" ordering. Counts from the agent list's flow YAML (already loaded for the sidebar),
 * so it costs one list call; empty while loading or when the list fails.
 *
 * @returns Uses per plugin kind (Record<string, number>)
 */
export function usePaletteUsage(): Record<string, number> {
  const { data: agents } = useAgents()
  return useMemo(() => countKindUsage((agents ?? []).map((agent) => agent.flowYaml)), [agents])
}
