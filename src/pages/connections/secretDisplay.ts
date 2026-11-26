import type { WorkflowSecretOverview } from '@/api/connectionTypes'
import { messages } from '@/i18n'

/** Same rule as the backend (`workflow_secrets/saved.rs`): `MY_SERVER_TOKEN`. */
const newSecretNamePattern = /^[A-Z][A-Z0-9_]*$/
const secretNameMaxLength = 64

/**
 * "Used by Maps leads to WhatsApp, MCP server github".
 *
 * @param secret - The secret and who uses it (WorkflowSecretOverview)
 * @returns The usage line, or "Not used yet" (string)
 */
export function describeSecretUsers(secret: WorkflowSecretOverview): string {
  const users = listSecretUsers(secret)
  return users ? messages().connections.usedByValue(users) : messages().connections.notUsedYet
}

/** The agents and MCP servers using a secret, comma separated, or "" when none. */
export function listSecretUsers(secret: WorkflowSecretOverview): string {
  return [...secret.agents.map((agent) => agent.agentName), ...secret.mcpServers.map((serverName) => messages().connections.mcpServerServername(serverName))].join(', ')
}

/**
 * Checks a name typed into "Add secret" before it is sent.
 *
 * @param name - The typed name (string)
 * @returns A plain explanation of what is wrong, or null when the name is fine (string | null)
 *
 * @example
 * describeSecretNameProblem('my token') // "Use capital letters, digits and underscores, like MY_SERVER_TOKEN"
 */
export function describeSecretNameProblem(name: string): string | null {
  const trimmedName = name.trim()
  if (!trimmedName) return messages().connections.giveTheSecretANameLike
  if (trimmedName.length > secretNameMaxLength) return messages().connections.keepTheNameToSecretnamemaxlengthCharacters(secretNameMaxLength)
  if (!/^[A-Za-z]/.test(trimmedName)) return messages().connections.startTheNameWithALetter
  if (!newSecretNamePattern.test(trimmedName)) return messages().connections.useCapitalLettersDigitsAndUnderscores
  return null
}

/**
 * Turns what the user typed into a valid-looking name: "my server token" → "MY_SERVER_TOKEN".
 *
 * @param typedName - Raw input (string)
 * @returns Upper-cased, with spaces and dashes as underscores (string)
 */
export function normalizeSecretName(typedName: string): string {
  return typedName.toUpperCase().replace(/[\s-]+/g, '_')
}

/** True when some agent or MCP server reads it but no value is saved. */
export function isSecretMissing(secret: WorkflowSecretOverview): boolean {
  return !secret.configured && secret.required
}
