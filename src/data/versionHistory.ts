/**
 * Shapes used by screen 24 · Version history. The versions themselves come from
 * `listAgentVersions` (sample data in `src/api/sampleBackend/sampleAgentCatalog.ts`).
 */

export interface AgentStepSnapshot {
  /** Stable id (graphrt node id) so the same step can be matched across versions. */
  id: string
  name: string
  /** The node's description, e.g. "Uses the place name · max 2 sentences". */
  setting?: string
}
