import { BackendError } from '../client'
import type {
  AgentSkills,
  AuthoredSkillInput,
  CatalogSkillEntry,
  InstalledSkill,
  SkillCatalog,
  SkillFinding,
  SkillInstallChoices,
  SkillReview,
  SkillSource,
  SkillToolRequest,
  ToolPermission,
} from '../skillTypes'
import { listStoredAgents } from './sampleAgentStore'
import { respondWith } from './sampleResponse'

/**
 * Sample skills backend for the browser preview and tests. It keeps the same rules as the
 * desktop backend: a review installs nothing, an install must name the review it follows, a
 * skill gets exactly the tools ticked (an update keeps none of the earlier ones), and a
 * finding that blocks needs the second confirmation.
 */

interface SampleSkillSeed {
  name: string
  displayName: string
  description: string
  version: string
  requestedTools: SkillToolRequest[]
  unsupportedTools: string[]
  hasScripts: boolean
  findings: SkillFinding[]
}

function tool(reference: string, providerLabel: string, actionLabel: string, available = true): SkillToolRequest {
  return { tool: reference, providerLabel, actionLabel, coversEverything: false, available }
}

const sheetsRead = tool('google-sheets/read_rows', 'Google Sheets', 'Read rows')
const whatsAppSend = tool('whatsapp-api/send_message', 'WhatsApp Cloud API', 'Send message', false)
const gmailSend = tool('gmail/send_email', 'Gmail', 'Send email', false)

const catalogSeeds: readonly SampleSkillSeed[] = [
  {
    name: 'refund-policy',
    displayName: 'Refund policy',
    description: 'Use when a customer asks for their money back. Checks the order date, explains the 14-day rule and offers a voucher first.',
    version: '1.2.0',
    requestedTools: [sheetsRead, whatsAppSend],
    unsupportedTools: [],
    hasScripts: false,
    findings: [{ severity: 'info', code: 'external_links', message: 'Mentions these web addresses: example.com.', file: 'SKILL.md', line: null }],
  },
  {
    name: 'friendly-tone',
    displayName: 'Friendly tone',
    description: 'Use for every reply to a customer. Short sentences, their first name, no jargon, and one clear next step.',
    version: '1.1.0',
    requestedTools: [sheetsRead],
    unsupportedTools: [],
    hasScripts: false,
    findings: [],
  },
  {
    name: 'invoice-follow-up',
    displayName: 'Invoice follow-up',
    description: 'Use when an invoice is more than 7 days late. Writes a polite reminder and escalates after the third one.',
    version: '0.9.0',
    requestedTools: [gmailSend],
    unsupportedTools: ['Bash'],
    hasScripts: true,
    findings: [
      { severity: 'blocking', code: 'download_and_run', message: 'Tells the reader to download something from the internet and run it.', file: 'references/setup.md', line: 12 },
      { severity: 'warning', code: 'skips_approval', message: 'Tells the agent to act without asking for approval.', file: 'SKILL.md', line: 31 },
      { severity: 'info', code: 'scripts_not_run', message: 'Contains 1 script file(s). Graphrt does not run scripts from skills.', file: null, line: null },
    ],
  },
]

interface SampleInstalledSkill {
  seed: SampleSkillSeed
  source: SkillSource
  version: string | null
  enabled: boolean
  permissions: ToolPermission[]
  installedAt: string
}

interface SampleSkillsState {
  installedByName: Map<string, SampleInstalledSkill>
  /** Skills per `agentId/stepId`. */
  skillsByStep: Map<string, string[]>
}

function createInitialState(): SampleSkillsState {
  const friendlyTone = catalogSeeds[1]
  const meetingNotes: SampleSkillSeed = {
    name: 'meeting-notes',
    displayName: 'Meeting notes',
    description: 'Use after a call with a customer. Lists decisions, owners and dates in five lines.',
    version: '',
    requestedTools: [],
    unsupportedTools: [],
    hasScripts: false,
    findings: [],
  }
  return {
    installedByName: new Map([
      // An older catalog version that asked for nothing: the catalog's newer one asks for a tool.
      ['friendly-tone', { seed: { ...friendlyTone, requestedTools: [] }, source: 'catalog', version: '1.0.0', enabled: true, permissions: [], installedAt: '2026-11-20T09:00:00Z' }],
      ['meeting-notes', { seed: meetingNotes, source: 'authored', version: null, enabled: true, permissions: [], installedAt: '2026-11-24T14:30:00Z' }],
    ]),
    skillsByStep: new Map([['catering-assistant/reply', ['friendly-tone']]]),
  }
}

let state = createInitialState()

/** Restores the sample skills to their seed (use in test `beforeEach`). */
export function resetSampleSkills(): void {
  state = createInitialState()
}

/** Agents of the sample data that have no step that can use skills. */
const agentsWithoutSkillSteps = new Set(['morning-digest'])

function reviewIdOf(seed: SampleSkillSeed): string {
  return `review:${seed.name}:${seed.version}:${seed.description.length}:${seed.requestedTools.length}`
}

function installedView(record: SampleInstalledSkill): InstalledSkill {
  const { seed } = record
  return {
    name: seed.name,
    displayName: seed.displayName,
    description: seed.description,
    enabled: record.enabled,
    source: record.source,
    publisher: record.source === 'catalog' ? 'graphrt' : null,
    verified: record.source === 'catalog',
    version: record.version,
    installedAt: record.installedAt,
    requestedTools: seed.requestedTools,
    permissions: record.permissions,
    unsupportedTools: seed.unsupportedTools,
    hasScripts: seed.hasScripts,
    findings: seed.findings,
  }
}

function requireInstalled(name: string): SampleInstalledSkill {
  const record = state.installedByName.get(name)
  if (!record) throw new BackendError('not_found', `skill ${name} not found`)
  return record
}

function requireCatalogSeed(name: string): SampleSkillSeed {
  const seed = catalogSeeds.find((candidate) => candidate.name === name)
  if (!seed) throw new BackendError('not_found', `skill ${name} in the catalog not found`)
  return seed
}

function reviewOf(seed: SampleSkillSeed, source: SkillSource, instructions: string | null): SkillReview {
  const installed = state.installedByName.get(seed.name)
  const installedTools = installed?.seed.requestedTools ?? []
  const isSameTool = (left: SkillToolRequest) => (right: SkillToolRequest) => left.tool === right.tool
  const nothingChanged = installed !== undefined && reviewIdOf(installed.seed) === reviewIdOf(seed)
  return {
    name: seed.name,
    displayName: seed.displayName,
    description: seed.description,
    source,
    publisher: source === 'catalog' ? 'graphrt' : null,
    version: seed.version || null,
    reviewId: reviewIdOf(seed),
    requestedTools: seed.requestedTools,
    unsupportedTools: seed.unsupportedTools,
    hasScripts: seed.hasScripts,
    findings: seed.findings,
    needsExtraConfirmation: seed.findings.some((finding) => finding.severity === 'blocking'),
    update: installed
      ? {
          addedTools: seed.requestedTools.filter((requested) => !installedTools.some(isSameTool(requested))),
          removedTools: installedTools.filter((requested) => !seed.requestedTools.some(isSameTool(requested))),
          changedFiles: nothingChanged ? [] : ['SKILL.md'],
          addedFiles: [],
          removedFiles: [],
          nothingChanged,
        }
      : null,
    instructions,
  }
}

function install(seed: SampleSkillSeed, source: SkillSource, choices: SkillInstallChoices): InstalledSkill {
  if (choices.reviewId !== reviewIdOf(seed)) {
    throw new BackendError('conflict', 'this skill changed since you looked at it; nothing was installed. Review it again')
  }
  const installed = state.installedByName.get(seed.name)
  if (installed && installed.source !== source) {
    throw new BackendError('conflict', `another skill named ${seed.displayName} is already installed; remove it first`)
  }
  const notRequested = choices.permissions.find((permission) => !seed.requestedTools.some((requested) => requested.tool === permission.tool))
  if (notRequested) throw new BackendError('invalid_input', `invalid input: this skill does not ask for ${notRequested.tool}`)
  if (seed.findings.some((finding) => finding.severity === 'blocking') && !choices.acceptFindings) {
    throw new BackendError('invalid_input', 'invalid input: the safety check found something that must be confirmed first')
  }
  // Exactly what was ticked now: an update keeps nothing the earlier copy was allowed.
  const record: SampleInstalledSkill = {
    seed,
    source,
    version: seed.version || null,
    enabled: true,
    permissions: choices.permissions.map((permission) => ({ ...permission })),
    installedAt: new Date().toISOString(),
  }
  state.installedByName.set(seed.name, record)
  return installedView(record)
}

/** Mirrors the backend's naming of a skill written in the app ("Refund policy (EU)" gives `refund-policy-eu`). */
function technicalName(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function draftSeed(input: AuthoredSkillInput): { seed: SampleSkillSeed; instructions: string } {
  const title = input.title.trim().replace(/\s+/g, ' ')
  const whenToUse = input.whenToUse.trim().replace(/\s+/g, ' ')
  const steps = input.steps.map((step) => step.trim().replace(/\s+/g, ' ')).filter(Boolean)
  if (!title) throw new BackendError('invalid_input', 'invalid input: Give the skill a name')
  const name = technicalName(title)
  if (!name) throw new BackendError('invalid_input', 'invalid input: Use at least one letter (a to z) or digit in the name')
  if (!whenToUse) throw new BackendError('invalid_input', 'invalid input: Say when the agent should use this skill')
  if (steps.length === 0) throw new BackendError('invalid_input', 'invalid input: Add at least one step')
  const instructions = `# ${title}\n\n## When to use\n\n${whenToUse}\n\n## Steps\n\n${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}\n`
  const findings: SkillFinding[] = /\|\s*(sh|bash)\b/.test(instructions)
    ? [{ severity: 'blocking', code: 'download_and_run', message: 'Tells the reader to download something from the internet and run it.', file: 'SKILL.md', line: null }]
    : []
  const seed: SampleSkillSeed = { name, displayName: title, description: whenToUse, version: '', requestedTools: [], unsupportedTools: [], hasScripts: false, findings }
  // Two different forms with the same name must not share a review.
  return { seed: { ...seed, description: whenToUse, version: String(instructions.length) }, instructions }
}

function stepKey(agentId: string, stepId: string): string {
  return `${agentId}/${stepId}`
}

function agentSkillsOf(agentId: string, agentName: string): AgentSkills {
  if (agentsWithoutSkillSteps.has(agentId)) return { agentId, agentName, steps: [] }
  const stepId = 'reply'
  return { agentId, agentName, steps: [{ stepId, title: 'Decide what to do', skills: state.skillsByStep.get(stepKey(agentId, stepId)) ?? [] }] }
}

export const sampleSkillsBackend = {
  listInstalledSkills: (): Promise<InstalledSkill[]> =>
    respondWith(() =>
      [...state.installedByName.values()].map(installedView).sort((left, right) => left.displayName.localeCompare(right.displayName)),
    ),

  listSkillCatalog: (): Promise<SkillCatalog> =>
    respondWith(() => ({
      fromCache: false,
      skills: catalogSeeds.map((seed): CatalogSkillEntry => {
        const installed = state.installedByName.get(seed.name)
        return {
          name: seed.name,
          displayName: seed.displayName,
          description: seed.description,
          version: seed.version,
          publisher: 'graphrt',
          installed: installed !== undefined,
          updateAvailable: installed !== undefined && installed.source === 'catalog' && installed.version !== seed.version,
        }
      }),
    })),

  reviewCatalogSkill: (name: string): Promise<SkillReview> => respondWith(() => reviewOf(requireCatalogSeed(name), 'catalog', null)),

  installCatalogSkill: (name: string, choices: SkillInstallChoices): Promise<InstalledSkill> =>
    respondWith(() => install(requireCatalogSeed(name), 'catalog', choices)),

  reviewAuthoredSkill: (input: AuthoredSkillInput): Promise<SkillReview> =>
    respondWith(() => {
      const { seed, instructions } = draftSeed(input)
      return { ...reviewOf(seed, 'authored', instructions), version: null }
    }),

  installAuthoredSkill: (input: AuthoredSkillInput, choices: SkillInstallChoices): Promise<InstalledSkill> =>
    respondWith(() => {
      const installed = install(draftSeed(input).seed, 'authored', choices)
      const record = requireInstalled(installed.name)
      record.version = null
      return installedView(record)
    }),

  setSkillPermissions: (name: string, permissions: ToolPermission[]): Promise<InstalledSkill> =>
    respondWith(() => {
      const record = requireInstalled(name)
      const notRequested = permissions.find((permission) => !record.seed.requestedTools.some((requested) => requested.tool === permission.tool))
      if (notRequested) throw new BackendError('invalid_input', `invalid input: this skill does not ask for ${notRequested.tool}`)
      record.permissions = permissions.map((permission) => ({ ...permission }))
      return installedView(record)
    }),

  setSkillEnabled: (name: string, enabled: boolean): Promise<InstalledSkill> =>
    respondWith(() => {
      const record = requireInstalled(name)
      record.enabled = enabled
      return installedView(record)
    }),

  removeSkill: (name: string): Promise<void> =>
    respondWith(() => {
      requireInstalled(name)
      for (const [key, skills] of state.skillsByStep) {
        state.skillsByStep.set(
          key,
          skills.filter((skill) => skill !== name),
        )
      }
      state.installedByName.delete(name)
    }),

  listAgentSkills: (): Promise<AgentSkills[]> => respondWith(() => listStoredAgents().map((agent) => agentSkillsOf(agent.id, agent.name))),

  setAgentStepSkills: (agentId: string, stepId: string, skills: string[]): Promise<AgentSkills> =>
    respondWith(() => {
      const agent = listStoredAgents().find((candidate) => candidate.id === agentId)
      if (!agent || agentsWithoutSkillSteps.has(agentId) || stepId !== 'reply') throw new BackendError('not_found', 'a step that can use skills not found')
      const missing = skills.find((skill) => !state.installedByName.has(skill))
      if (missing) throw new BackendError('not_found', `skill ${missing} not found`)
      state.skillsByStep.set(stepKey(agentId, stepId), [...new Set(skills)])
      return agentSkillsOf(agent.id, agent.name)
    }),
}
