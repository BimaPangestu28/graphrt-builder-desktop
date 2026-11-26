import type { PluginRequirement } from '@/api/pluginRequirementTypes'
import { messages } from '@/i18n'

/**
 * Plain-language text for the plugin setup card in the build chat (screens 03, 04, 06):
 * the summary line, what each plugin asks for, its state and which approval it needs.
 */

/** The plugin runtime (Node.js) still has to be downloaded for this plugin. */
export function needsPluginRuntimeDownload(requirement: PluginRequirement): boolean {
  return requirement.needsNodeRuntime && !requirement.nodeRuntimeReady
}

/** Download size of the browser runtime, shown before the user starts it. */
export function browserDownloadSizeNote(): string {
  return messages().builder.browserDownloadSize
}

/**
 * The line on top of the card.
 *
 * @example
 * summarizePluginRequirements([readyRequirement, missingRequirement]) // "This agent needs 2 plugins · 1 ready"
 */
export function summarizePluginRequirements(requirements: PluginRequirement[]): string {
  const readyCount = requirements.filter((requirement) => requirement.ready).length
  const readyLabel = readyCount === requirements.length && readyCount > 1 ? messages().builder.allReady : messages().builder.readycountReady(readyCount)
  return messages().builder.agentNeedsPlugins(requirements.length, readyLabel)
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
  if (requirement.installed) return messages().builder.trust
  return requirement.trustNotNeeded ? messages().builder.install : messages().builder.installTrust
}

/** What the plugin asks for, in plain words, shown before the user approves it. */
export function describeRequirementPermissions(requirement: PluginRequirement): string[] {
  const { permissions } = requirement
  const lines = [permissions.network ? messages().builder.usesTheInternet : messages().builder.worksWithoutTheInternet]
  if (permissions.secrets) {
    const settingNames = permissions.env.length > 0 ? `: ${permissions.env.join(', ')}` : ''
    lines.push(messages().builder.asksForSecretsOrTokensSettingnames(settingNames))
  } else if (permissions.env.length > 0) {
    lines.push(messages().builder.readsSettingsOptionalValue(permissions.env.join(', ')))
  }
  if (requirement.needsBrowser) lines.push(messages().builder.opensWebPagesInABrowser)
  return lines
}

/** Short state shown in the card header. */
export function describeRequirementState(requirement: PluginRequirement): string {
  if (requirement.ready) return messages().builder.ready
  if (!requirement.installed) return messages().builder.notInstalled
  if (!requirement.trusted && !requirement.trustNotNeeded) return messages().builder.needsYourTrust
  if (requirement.missingConfig.length > 0) return messages().builder.needsSettings(requirement.missingConfig.length)
  if (needsPluginRuntimeDownload(requirement)) return messages().builder.needsThePluginRuntime
  if (!requirement.browserReady) return messages().builder.needsTheBrowser
  return messages().builder.notLinked
}

/**
 * True when linking the account session (whatsapp-web: scanning the QR code) is all that is
 * left: installed, trusted if needed, settings set and the browser ready, but not linked.
 */
export function needsOnlySessionLink(requirement: PluginRequirement): boolean {
  if (!requirement.needsSession || requirement.sessionLinked) return false
  return !needsPluginApproval(requirement) && requirement.missingConfig.length === 0 && requirement.browserReady && !needsPluginRuntimeDownload(requirement)
}
