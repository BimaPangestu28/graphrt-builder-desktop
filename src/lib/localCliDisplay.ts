import type { LocalCliProvider, LocalCliStatus } from '@/api/types'
import { localCliCommands } from '@/lib/settings'
import { messages } from '@/i18n'

/** Plain-language text about a local CLI (Claude Code, Codex) for Welcome and Connections. */

export type LocalCliHintTone = 'ok' | 'amber' | 'muted'

export interface LocalCliHint {
  text: string
  tone: LocalCliHintTone
}

/**
 * What the CLI's own status command says about its sign-in.
 *
 * @param provider - The CLI (LocalCliProvider)
 * @param localCli - Its detected status (LocalCliStatus)
 * @returns The hint, or null when it is not installed or does not start (LocalCliHint | null)
 *
 * @example
 * describeLocalCliSignIn('claude-code-cli', status) // { text: 'Not signed in: run `claude` in Terminal', tone: 'amber' }
 */
export function describeLocalCliSignIn(provider: LocalCliProvider, localCli: LocalCliStatus): LocalCliHint | null {
  if (!localCli.installed || localCli.problem) return null
  if (localCli.signIn === 'signed_in') return { text: messages().connections.signedIn, tone: 'ok' }
  if (localCli.signIn === 'signed_out') return { text: messages().connections.notSignedInRunValueIn(localCliCommands[provider]), tone: 'amber' }
  return { text: messages().connections.signInNotConfirmedYet, tone: 'muted' }
}

/**
 * "Installed · 2.1.330 (Claude Code)", "Not installed", or why the found CLI does not start.
 *
 * @param localCli - Its detected status (LocalCliStatus)
 * @returns One short line (string)
 */
export function describeLocalCliDetection(localCli: LocalCliStatus): string {
  if (!localCli.installed) return messages().connections.notInstalled
  if (localCli.problem) return localCli.problem
  return localCli.version ? messages().connections.installedVersion(localCli.version) : messages().connections.installed
}
