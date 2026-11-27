import { callBackend, isDesktopApp } from './client'
import { sampleSkillsBackend } from './sampleBackend/skills'
import type { AgentSkills, AuthoredSkillInput, InstalledSkill, SkillCatalog, SkillDraft, SkillDraftSource, SkillInstallChoices, SkillReview, ToolPermission } from './skillTypes'

/**
 * Agent skills: the catalog's, the ones written in the app, what each may use and which
 * agents use them. Outside the desktop app every call goes to the sample skills backend.
 */

export function listInstalledSkills(): Promise<InstalledSkill[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleSkillsBackend.listInstalledSkills()
  return callBackend('list_installed_skills')
}

/**
 * The catalog's skills with their install state.
 *
 * @param refresh - Fetch the catalog again instead of using this session's copy (boolean)
 */
export function listSkillCatalog(refresh = false): Promise<SkillCatalog> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleSkillsBackend.listSkillCatalog()
  return callBackend('list_skill_catalog', { refresh })
}

/**
 * Downloads and checks a catalog skill for the confirmation screens. Installs nothing.
 *
 * @throws BackendError - `not_found` when the catalog has no such skill, `invalid_input` when
 *   the download does not match the catalog or is not a valid skill
 */
export function reviewCatalogSkill(name: string): Promise<SkillReview> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleSkillsBackend.reviewCatalogSkill(name)
  return callBackend('review_catalog_skill', { name })
}

/**
 * Installs a catalog skill as reviewed, with exactly the tools in `choices.permissions`.
 *
 * @throws BackendError - `conflict` when the skill is no longer the one reviewed,
 *   `invalid_input` for a finding that was not confirmed
 */
export function installCatalogSkill(name: string, choices: SkillInstallChoices): Promise<InstalledSkill> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleSkillsBackend.installCatalogSkill(name, choices)
  return callBackend('install_catalog_skill', { name, ...choices })
}

/**
 * Asks the person's default model to draft a skill from plain words or an example
 * conversation. Installs nothing: the draft is for the person to read and edit.
 *
 * @throws BackendError - `missing_credentials` when no model is connected, `model` when the
 *   model fails or does not answer with a skill, `invalid_input` for an empty source
 */
export function draftSkill(source: SkillDraftSource): Promise<SkillDraft> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleSkillsBackend.draftSkill(source)
  return callBackend('draft_skill', { source })
}

/**
 * Asks the person's default model to write one skill from the notes an agent learned about
 * how to do its work. Installs nothing.
 *
 * @returns The draft, or `null` when the agent has too few such notes
 * @throws BackendError - `missing_credentials` when no model is connected, `model` when the
 *   model fails or does not answer with a skill
 */
export function draftSkillFromNotes(agentId: string): Promise<SkillDraft | null> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleSkillsBackend.draftSkillFromNotes(agentId)
  return callBackend('draft_skill_from_notes', { agentId })
}

/**
 * A skill written in the app as its editor shows it, to change it and save it again.
 *
 * @throws BackendError - `not_found` when it is not installed, `invalid_input` when it was
 *   not written in the app
 */
export function getAuthoredSkillDraft(name: string): Promise<SkillDraft> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleSkillsBackend.getAuthoredSkillDraft(name)
  return callBackend('get_authored_skill_draft', { name })
}

/**
 * Checks the draft as the person left it, for the confirmation screens. Installs nothing.
 *
 * @throws BackendError - `invalid_input` when the draft cannot be a skill
 */
export function reviewAuthoredSkill(input: AuthoredSkillInput): Promise<SkillReview> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleSkillsBackend.reviewAuthoredSkill(input)
  return callBackend('review_authored_skill', { input })
}

/** Installs the draft, as reviewed. */
export function installAuthoredSkill(input: AuthoredSkillInput, choices: SkillInstallChoices): Promise<InstalledSkill> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleSkillsBackend.installAuthoredSkill(input, choices)
  return callBackend('install_authored_skill', { input, ...choices })
}

/** Replaces what an installed skill may use. */
export function setSkillPermissions(name: string, permissions: ToolPermission[]): Promise<InstalledSkill> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleSkillsBackend.setSkillPermissions(name, permissions)
  return callBackend('set_skill_permissions', { name, permissions })
}

/** Turns a skill on or off. A skill that is off is offered to no agent. */
export function setSkillEnabled(name: string, enabled: boolean): Promise<InstalledSkill> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleSkillsBackend.setSkillEnabled(name, enabled)
  return callBackend('set_skill_enabled', { name, enabled })
}

/** Takes the skill off every agent that uses it, then removes it. */
export function removeSkill(name: string): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleSkillsBackend.removeSkill(name)
  return callBackend('remove_skill', { name })
}

/** Every agent with its steps that can use skills. */
export function listAgentSkills(): Promise<AgentSkills[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleSkillsBackend.listAgentSkills()
  return callBackend('list_agent_skills')
}

/**
 * Sets the skills of one step of an agent (saved as a new version of the agent).
 *
 * @throws BackendError - `builder_busy` while the builder is changing the agent
 */
export function setAgentStepSkills(agentId: string, stepId: string, skills: string[]): Promise<AgentSkills> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleSkillsBackend.setAgentStepSkills(agentId, stepId, skills)
  return callBackend('set_agent_step_skills', { agentId, stepId, skills })
}
