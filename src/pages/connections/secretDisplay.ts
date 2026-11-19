import type { WorkflowSecretOverview } from '@/api/connectionTypes'

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
  const users = [...secret.agents.map((agent) => agent.agentName), ...secret.mcpServers.map((serverName) => `MCP server ${serverName}`)]
  return users.length > 0 ? `Used by ${users.join(', ')}` : 'Not used yet'
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
  if (!trimmedName) return 'Give the secret a name, like MY_SERVER_TOKEN'
  if (trimmedName.length > secretNameMaxLength) return `Keep the name to ${secretNameMaxLength} characters or fewer`
  if (!/^[A-Za-z]/.test(trimmedName)) return 'Start the name with a letter'
  if (!newSecretNamePattern.test(trimmedName)) return 'Use capital letters, digits and underscores, like MY_SERVER_TOKEN'
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

/**
 * The summary on the Secrets row: "2 saved · 1 missing".
 *
 * @param secrets - Every secret (WorkflowSecretOverview[])
 * @returns The counts, or a hint when there are none (string)
 */
export function summarizeSecrets(secrets: WorkflowSecretOverview[]): string {
  if (secrets.length === 0) return 'None yet'
  const savedCount = secrets.filter((secret) => secret.configured).length
  const missingCount = secrets.filter(isSecretMissing).length
  return missingCount > 0 ? `${savedCount} saved · ${missingCount} missing` : `${savedCount} saved`
}
