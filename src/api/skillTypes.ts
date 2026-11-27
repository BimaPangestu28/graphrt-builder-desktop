/**
 * Agent skills as the Skills screens read them (the Rust `skills::models` and
 * `agent_graph::skills` views). A skill is a set of instructions an agent picks up when a task
 * needs it. It never runs code, and it may use a tool only when the person allowed it.
 */

/** Where an installed skill came from. */
export type SkillSource = 'catalog' | 'authored' | 'other'

/** `ask`: every use waits for the person's OK (the default). `allow`: no question. */
export type ToolPermissionMode = 'ask' | 'allow'

/** One tool the person allows a skill to use. A tool that is not listed is not allowed. */
export interface ToolPermission {
  /** The tool as the skill asks for it; only ever handed back, never shown. */
  tool: string
  mode: ToolPermissionMode
}

/** A tool a skill asks for, with the names people know. */
export interface SkillToolRequest {
  tool: string
  /** The plugin or connection that provides it, e.g. "WhatsApp Cloud API". */
  providerLabel: string
  /** What it does, e.g. "Send message". Empty when `coversEverything`. */
  actionLabel: string
  /** Everything the provider can do is asked for. */
  coversEverything: boolean
  /** Whether this computer has the plugin or connection that provides it. */
  available: boolean
}

export type SkillFindingSeverity = 'info' | 'warning' | 'blocking'

/** Something the safety check noticed in a skill's text. */
export interface SkillFinding {
  severity: SkillFindingSeverity
  /** Stable code the UI translates, e.g. `hides_from_user`. */
  code: string
  /** The runtime's English sentence, shown only for codes the UI does not know. */
  message: string
  file: string | null
  line: number | null
  /**
   * What exactly was found, for the app to word itself: `hosts` and `more` for
   * `external_links`, `count` for `scripts_not_run`, `tools` for `unsupported_tools`.
   */
  details?: Record<string, string[]>
}

/** What an update changes compared with the installed copy. */
export interface SkillUpdateChanges {
  addedTools: SkillToolRequest[]
  removedTools: SkillToolRequest[]
  changedFiles: string[]
  addedFiles: string[]
  removedFiles: string[]
  nothingChanged: boolean
}

/** A skill before it is installed: everything the confirmation screens show. */
export interface SkillReview {
  name: string
  displayName: string
  description: string
  source: SkillSource
  publisher: string | null
  version: string | null
  /** Identifies exactly what was reviewed; the install sends it back. Never displayed. */
  reviewId: string
  requestedTools: SkillToolRequest[]
  /** Tools of other products the skill mentions; they cannot be used here. */
  unsupportedTools: string[]
  hasScripts: boolean
  findings: SkillFinding[]
  /** A finding stops the install until the person confirms once more. */
  needsExtraConfirmation: boolean
  /** Set when a skill of this name is installed: what installing changes. */
  update: SkillUpdateChanges | null
  /** For a skill written in the app: the instructions that will be saved. */
  instructions: string | null
}

export interface InstalledSkill {
  name: string
  displayName: string
  description: string
  enabled: boolean
  source: SkillSource
  /** Whether it was written in the app, so its wording can be changed there. */
  canEdit: boolean
  publisher: string | null
  /** Whether it came from the signed catalog. */
  verified: boolean
  version: string | null
  installedAt: string | null
  requestedTools: SkillToolRequest[]
  permissions: ToolPermission[]
  unsupportedTools: string[]
  hasScripts: boolean
  findings: SkillFinding[]
}

export interface CatalogSkillEntry {
  name: string
  displayName: string
  description: string
  version: string | null
  publisher: string | null
  installed: boolean
  updateAvailable: boolean
}

export interface SkillCatalog {
  skills: CatalogSkillEntry[]
  /** The catalog could not be fetched; this is the last saved copy. */
  fromCache: boolean
}

/** "Create a skill": the draft as the person left it after reading and editing it. */
export interface AuthoredSkillInput {
  /** Set when this changes a skill written here earlier (only ever handed back). A new skill has none. */
  name?: string | null
  /** The skill's name as people say it, e.g. "Refund policy". */
  title: string
  /** When the agent should use it, in one or two sentences. */
  description: string
  /** What the agent should do. */
  instructions: string
  /** Tools the draft asks for (references, only ever handed back). Asking allows nothing. */
  requestedTools: string[]
}

/** What a draft is written from: the person's own words, or a pasted example conversation. */
export type SkillDraftSource = { kind: 'description'; text: string } | { kind: 'conversation'; text: string }

/** A draft the model wrote, for the person to read and edit. Same shape as what they send back. */
export type SkillDraft = AuthoredSkillInput

/** What the person decided on the confirmation screens. */
export interface SkillInstallChoices {
  reviewId: string
  permissions: ToolPermission[]
  acceptFindings: boolean
}

/** A step of an agent that can use skills. */
export interface SkillStep {
  stepId: string
  title: string
  /** Technical names of the skills it has. */
  skills: string[]
}

/** An agent and its steps that can use skills (none: it cannot use skills as built). */
export interface AgentSkills {
  agentId: string
  agentName: string
  steps: SkillStep[]
}
