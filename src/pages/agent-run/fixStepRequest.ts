import { agentPath, builderAskParam } from '@/routes'
import type { RunStepView } from './runSteps'

/** Longest error text quoted in the request, so the chat box stays readable. */
export const fixStepErrorMaxLength = 500

/**
 * Values that look like credentials (bearer tokens, `key=value` secrets, provider API keys).
 * The runner masks declared secrets already; this is a second guard for anything it missed,
 * since the request ends up in a URL and in the builder's prompt.
 */
const keyValueSecretPattern = /\b((?:api[_-]?key|access[_-]?token|token|secret|password|passwd|authorization)["']?\s*[:=]\s*["']?)[^\s"'&,;]+/gi
const bareSecretPatterns: RegExp[] = [/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}/g, /\bgh[pousr]_[A-Za-z0-9]{20,}/g]

function redactSecrets(text: string): string {
  const withoutBareSecrets = bareSecretPatterns.reduce((redacted, pattern) => redacted.replace(pattern, '[hidden]'), text)
  return withoutBareSecrets.replace(keyValueSecretPattern, (_match, prefix: string) => `${prefix}[hidden]`)
}

function shortenError(errorMessage: string): string {
  const singleLine = errorMessage.replace(/\s+/g, ' ').trim().replace(/\.+$/, '')
  if (singleLine.length <= fixStepErrorMaxLength) return singleLine
  return `${singleLine.slice(0, fixStepErrorMaxLength - 1).trimEnd()}…`
}

/**
 * The chat request "Ask the builder to fix this step" prefills in the builder: the step's
 * title and id, its error (secrets hidden, shortened to ~500 characters) and the ask.
 *
 * @param step - The failed step (RunStepView)
 * @returns Request text for the builder's chat box (string)
 *
 * @example
 * describeFixStepRequest(step)
 * // 'The step "Send WhatsApp" (send_whatsapp) failed with: dns error. Please fix this step.'
 */
export function describeFixStepRequest(step: Pick<RunStepView, 'id' | 'label' | 'errorMessage'>): string {
  const stepName = step.label && step.label !== step.id ? `"${step.label}" (${step.id})` : `"${step.id}"`
  const errorText = step.errorMessage ? shortenError(redactSecrets(step.errorMessage)) : ''
  if (!errorText) return `The step ${stepName} failed. Please fix this step.`
  return `The step ${stepName} failed with: ${errorText}. Please fix this step.`
}

/**
 * Builder link for "Ask the builder to fix this step", with the request ready in its chat box.
 *
 * @param agentId - Agent the failed run belongs to (string)
 * @param step - The failed step (RunStepView)
 * @returns Builder path with the `ask` search param (string)
 */
export function buildFixStepPath(agentId: string, step: Pick<RunStepView, 'id' | 'label' | 'errorMessage'>): string {
  return agentPath('builder', agentId, { [builderAskParam]: describeFixStepRequest(step) })
}
