import { describeError } from '@/lib/agentDisplay'

/** The backend's error kinds as they prefix a message ("invalid input: …"), which a business user does not need. */
const technicalPrefixes = /^(invalid input|not set up yet|credential store error|workflow error): /

/**
 * The sentence to show for a failed channel action: the backend's plain sentence without its
 * technical prefix.
 *
 * @example
 * plainError(new Error('invalid input: Telegram does not know this token')) // 'Telegram does not know this token'
 */
export function plainError(error: unknown): string {
  const message = describeError(error).replace(technicalPrefixes, '')
  return message.charAt(0).toUpperCase() + message.slice(1)
}
