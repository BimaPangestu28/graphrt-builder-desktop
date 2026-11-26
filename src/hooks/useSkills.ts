import { listAgentSkills, listInstalledSkills, listSkillCatalog } from '@/api/skills'
import type { AgentSkills, InstalledSkill, SkillCatalog } from '@/api/skillTypes'
import { toError } from '@/lib/errors'
import { useAsyncData, type AsyncDataState } from './useAsyncData'

/** What the Skills page shows: installed skills, the catalog (or why it is missing) and who uses what. */
export interface SkillInventory {
  installed: InstalledSkill[]
  catalog: SkillCatalog | null
  /** Why the catalog could not be loaded; installed skills still show. */
  catalogError: Error | null
  agents: AgentSkills[]
}

/**
 * Installed skills, the catalog's skills and the agents' skills in one load. A catalog that
 * cannot be fetched (offline, no saved copy) does not hide the installed skills.
 */
export function useSkillInventory(): AsyncDataState<SkillInventory> {
  return useAsyncData(async () => {
    const [installed, agents, catalogResult] = await Promise.all([
      listInstalledSkills(),
      listAgentSkills(),
      listSkillCatalog().then(
        (catalog) => ({ catalog, catalogError: null }),
        (error: unknown) => ({ catalog: null, catalogError: toError(error) }),
      ),
    ])
    return { installed, agents, ...catalogResult }
  }, [])
}
