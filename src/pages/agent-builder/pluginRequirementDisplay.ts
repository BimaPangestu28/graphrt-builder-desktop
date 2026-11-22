import type { PluginRequirement } from '@/api/pluginRequirementTypes'

/**
 * Plain-language text for the plugin setup card in the build chat (screens 03, 04, 06):
 * the summary line, what each plugin asks for, its state and which approval it needs.
 */

/** The plugin runtime (Node.js) still has to be downloaded for this plugin. */
export function needsPluginRuntimeDownload(requirement: PluginRequirement): boolean {
  return requirement.needsNodeRuntime && !requirement.nodeRuntimeReady
}

/** Download size of the browser runtime, shown before the user starts it. */
export const browserDownloadSizeNote = 'about 150 MB download, once for all browser plugins'

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/**
 * The line on top of the card.
 *
 * @example
 * summarizePluginRequirements([readyRequirement, missingRequirement]) // "This agent needs 2 plugins · 1 ready"
 */
export function summarizePluginRequirements(requirements: PluginRequirement[]): string {
  const readyCount = requirements.filter((requirement) => requirement.ready).length
  const readyLabel = readyCount === requirements.length && readyCount > 1 ? 'all ready' : `${readyCount} ready`
  return `This agent needs ${pluralize(requirements.length, 'plugin', 'plugins')} · ${readyLabel}`
}

/** True when every plugin can run (also for an agent that uses none). */
export function arePluginRequirementsReady(requirements: PluginRequirement[]): boolean {
  return requirements.every((requirement) => requirement.ready)
}

/** Still needs the install / trust approval: not installed, or installed but untrusted while it asks for secrets. */
export function needsPluginApproval(requirement: PluginRequirement): boolean {
  return !requirement.installed || (!requirement.trusted && !requirement.trustNotNeeded)
}

/** Label of the approval button: what one click will do. */
export function describeApprovalAction(requirement: PluginRequirement): string {
  if (requirement.installed) return 'Trust'
  return requirement.trustNotNeeded ? 'Install' : 'Install & trust'
}

/** What the plugin asks for, in plain words, shown before the user approves it. */
export function describeRequirementPermissions(requirement: PluginRequirement): string[] {
  const { permissions } = requirement
  const lines = [permissions.network ? 'Uses the internet' : 'Works without the internet']
  if (permissions.secrets) {
    const settingNames = permissions.env.length > 0 ? `: ${permissions.env.join(', ')}` : ''
    lines.push(`Asks for secrets or tokens${settingNames}`)
  } else if (permissions.env.length > 0) {
    lines.push(`Reads settings (optional): ${permissions.env.join(', ')}`)
  }
  if (requirement.needsBrowser) lines.push('Opens web pages in a browser (Chromium) on this computer')
  return lines
}

/** Short state shown in the card header. */
export function describeRequirementState(requirement: PluginRequirement): string {
  if (requirement.ready) return 'Ready'
  if (!requirement.installed) return 'Not installed'
  if (!requirement.trusted && !requirement.trustNotNeeded) return 'Needs your trust'
  if (requirement.missingConfig.length > 0) return `Needs ${pluralize(requirement.missingConfig.length, 'setting', 'settings')}`
  if (needsPluginRuntimeDownload(requirement)) return 'Needs the plugin runtime'
  if (!requirement.browserReady) return 'Needs the browser'
  return 'Not linked'
}

/**
 * True when linking the account session (whatsapp-web: scanning the QR code) is all that is
 * left: installed, trusted if needed, settings set and the browser ready, but not linked.
 */
export function needsOnlySessionLink(requirement: PluginRequirement): boolean {
  if (!requirement.needsSession || requirement.sessionLinked) return false
  return !needsPluginApproval(requirement) && requirement.missingConfig.length === 0 && requirement.browserReady && !needsPluginRuntimeDownload(requirement)
}
