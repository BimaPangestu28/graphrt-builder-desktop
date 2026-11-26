import type { AgentSkills, SkillFinding, SkillFindingSeverity, SkillSource, SkillToolRequest, SkillUpdateChanges } from '@/api/skillTypes'
import type { BadgeTone } from '@/components/ui'
import { messages } from '@/i18n'

/**
 * How skills are worded on screen. Everything here turns the backend's values into the
 * sentences a business owner reads: no file hashes, no technical tool references.
 */

/** "WhatsApp Cloud API · Send message", or "… · everything it can do" for a whole provider. */
export function describeToolRequest(request: SkillToolRequest): string {
  const t = messages().skills.tools
  return request.coversEverything ? t.everything(request.providerLabel) : t.toolName(request.providerLabel, request.actionLabel)
}

/** "From the Graphrt catalog · By graphrt", "Written here" or "Added another way". */
export function describeSkillSource(source: SkillSource, publisher: string | null): string {
  const t = messages().skills
  return source === 'catalog' && publisher ? `${t.source.catalog} · ${t.byPublisher(publisher)}` : t.source[source]
}

const severityRank: Record<SkillFindingSeverity, number> = { blocking: 0, warning: 1, info: 2 }

/** Findings with the ones that stop an install first, then warnings, then notes. */
export function sortFindings(findings: readonly SkillFinding[]): SkillFinding[] {
  return [...findings].sort((left, right) => severityRank[left.severity] - severityRank[right.severity])
}

export const findingSeverityTones: Record<SkillFindingSeverity, BadgeTone> = { blocking: 'danger', warning: 'amber', info: 'neutral' }

/**
 * A finding in the app's own words. The backend's English sentence is used only for a code
 * this version of the app does not know.
 */
export function describeFinding(finding: SkillFinding): string {
  const known: Record<string, string> = messages().skills.safety.finding
  return known[finding.code] ?? finding.message
}

/** "In SKILL.md, line 12", "In SKILL.md", or null when the finding names no file. */
export function describeFindingLocation(finding: SkillFinding): string | null {
  const t = messages().skills.safety
  if (!finding.file) return null
  return finding.line === null ? t.inFile(finding.file) : t.inFileLine(finding.file, finding.line)
}

/** The main instructions file of a skill; other files are its reference files. */
const instructionsFileName = 'SKILL.md'

/** What an update changes, one sentence per change (empty when nothing changed). */
export function describeUpdateChanges(update: SkillUpdateChanges): string[] {
  const t = messages().skills.about
  const otherFileCount =
    update.changedFiles.filter((file) => file !== instructionsFileName).length + update.addedFiles.length + update.removedFiles.length
  return [
    ...update.addedTools.map((request) => t.newTool(describeToolRequest(request))),
    ...update.removedTools.map((request) => t.droppedTool(describeToolRequest(request))),
    ...(update.changedFiles.includes(instructionsFileName) ? [t.instructionsChanged] : []),
    ...(otherFileCount > 0 ? [t.otherFilesChanged(otherFileCount)] : []),
  ]
}

/** How many agents have the skill on at least one step. */
export function countAgentsUsing(agents: readonly AgentSkills[], skillName: string): number {
  return agents.filter((agent) => agent.steps.some((step) => step.skills.includes(skillName))).length
}
