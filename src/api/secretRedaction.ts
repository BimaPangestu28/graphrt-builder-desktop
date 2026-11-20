/**
 * Hides secret-looking values in tool call arguments before they are shown, the same way
 * `redact_secrets` in `src-tauri/src/engine/approval_pauses.rs` does when a pause is stored.
 */

/** Shown instead of a hidden value. */
export const redactedText = '[hidden]'

const secretKeyParts = ['password', 'passwd', 'secret', 'token', 'api_key', 'apikey', 'api-key', 'authorization', 'credential', 'cookie']
const secretValuePrefixes = ['Bearer ', 'Basic ', 'sk-', 'sk_', 'ghp_', 'gho_', 'xoxb-', 'xoxp-', 'AKIA']

function isSecretName(name: string): boolean {
  const lowercaseName = name.toLowerCase()
  return secretKeyParts.some((part) => lowercaseName.includes(part))
}

/**
 * A copy of `value` with values under secret-looking names, and token-looking strings, replaced.
 *
 * @param value - Any JSON value (unknown)
 * @returns The same shape with secrets replaced by {@link redactedText} (unknown)
 *
 * @example
 * redactSecrets({ phone: '+62', api_key: 'abc' }) // { phone: '+62', api_key: '[hidden]' }
 */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets)
  if (typeof value === 'string') return secretValuePrefixes.some((prefix) => value.startsWith(prefix)) ? redactedText : value
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([name, fieldValue]) => [
      name,
      isSecretName(name) && fieldValue !== null && fieldValue !== undefined ? redactedText : redactSecrets(fieldValue),
    ]),
  )
}
