import type { BadgeTone, StatusDotTone } from '@/components/ui'
import { onlineDeployNotAvailableMessage, type CliInfo, type DeployEvent, type DeployMode, type DeploymentStatus, type DeployStep, type ServerArea, type StepStatus } from '@/api/deployTypes'

/** Plain words for every "Put it online" state; no technical terms outside Advanced. */

export const deployStepOrder: DeployStep[] = ['preparing', 'secrets', 'starting', 'checking']

export const deployStepLabels: Record<DeployStep, string> = {
  preparing: 'Preparing',
  secrets: 'Copying your keys safely',
  starting: 'Starting your agent',
  checking: 'Checking it works',
}

export const serverAreaLabels: Record<ServerArea, string> = {
  asia: 'Closest to Asia',
  europe: 'Closest to Europe',
  us: 'Closest to the US',
}

export const deployModeLabels: Record<DeployMode, { title: string; detail: string }> = {
  always_on: { title: 'Always ready', detail: 'Answers instantly. It runs all the time, so it costs more.' },
  scale_to_zero: { title: 'Saves money', detail: 'Wakes up when needed — a few seconds slower to start.' },
}

interface StatusDisplay {
  /** After "Online · ". */
  label: string
  tone: BadgeTone
  dot: StatusDotTone
}

const statusDisplays: Record<DeploymentStatus, StatusDisplay> = {
  deploying: { label: 'going online', tone: 'brand', dot: 'brand' },
  working: { label: 'working', tone: 'ok', dot: 'ok' },
  paused: { label: 'paused', tone: 'neutral', dot: 'paused' },
  needs_attention: { label: 'needs attention', tone: 'amber', dot: 'amber' },
  failed: { label: 'not online', tone: 'danger', dot: 'danger' },
}

/**
 * The badge text and colors of an online agent.
 *
 * @example
 * describeDeploymentStatus('paused') // { label: 'paused', tone: 'neutral', dot: 'paused' }
 */
export function describeDeploymentStatus(status: DeploymentStatus): StatusDisplay {
  return statusDisplays[status]
}

/** Each step's state after the events so far (missing = not started). */
export type StepStates = Partial<Record<DeployStep, StepStatus>>

/** Folds one deploy event into the step states. */
export function applyDeployEvent(states: StepStates, event: DeployEvent): StepStates {
  if (event.kind !== 'step') return states
  return { ...states, [event.step]: event.status }
}

/**
 * How far the bar is: done steps count fully, a running one half.
 *
 * @returns 0–100 (number)
 */
export function deployProgressPercent(states: StepStates): number {
  const score = deployStepOrder.reduce((total, step) => total + (states[step] === 'done' ? 1 : states[step] === 'running' ? 0.5 : 0), 0)
  return Math.round((score / deployStepOrder.length) * 100)
}

/** The step to name above the bar: the running one, else the last finished. */
export function currentDeployStep(states: StepStates): DeployStep {
  return deployStepOrder.find((step) => states[step] === 'running' || states[step] === 'failed') ?? [...deployStepOrder].reverse().find((step) => states[step] === 'done') ?? 'preparing'
}

/** "9 MB" from bytes; null when unknown. */
export function formatDownloadSize(bytes: number | null): string | null {
  if (bytes === null || bytes <= 0) return null
  return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`
}

/** The one line about the graphrt tools on Review. */
export function describeCliNeed(cli: CliInfo): string {
  if (cli.status === 'not_available') return onlineDeployNotAvailableMessage
  if (cli.status === 'installed') return 'The graphrt tools are ready on this computer.'
  const size = formatDownloadSize(cli.downloadSizeBytes)
  return `Online deploy needs the graphrt tools${size ? ` (download ~${size})` : ''}. First time only, from GitHub, checked before use.`
}

const technicalPrefixes = /^(invalid input|not set up yet|credential store error|workflow error|internal error): /i

/**
 * A backend error as one plain sentence: without "invalid input: " and the like.
 *
 * @example
 * plainErrorMessage(new Error('invalid input: Paste your key')) // "Paste your key"
 */
export function plainErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Something went wrong'
  const plain = message.replace(technicalPrefixes, '')
  return plain.charAt(0).toUpperCase() + plain.slice(1)
}

/** "2 hours ago" style text for an RFC 3339 time. */
export function describeTimeAgo(isoTime: string | null, now: Date = new Date()): string {
  if (!isoTime) return 'not yet'
  const elapsedMinutes = Math.max(0, Math.round((now.getTime() - new Date(isoTime).getTime()) / 60_000))
  if (Number.isNaN(elapsedMinutes)) return 'not yet'
  if (elapsedMinutes < 1) return 'just now'
  if (elapsedMinutes < 60) return `${elapsedMinutes} minute${elapsedMinutes === 1 ? '' : 's'} ago`
  const hours = Math.round(elapsedMinutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
