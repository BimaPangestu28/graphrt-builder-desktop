import type { BadgeTone, StatusDotTone } from '@/components/ui'
import { onlineDeployNotAvailableMessage, type CliInfo, type DeployEvent, type DeployMode, type DeploymentStatus, type DeployStep, type ServerArea, type StepStatus } from '@/api/deployTypes'
import { messages } from '@/i18n'
import { localizedRecord } from '@/i18n/localized'

/** Plain words for every "Put it online" state; no technical terms outside Advanced. */

export const deployStepOrder: DeployStep[] = ['preparing', 'secrets', 'starting', 'checking']

export const deployStepLabels: Readonly<Record<DeployStep, string>> = localizedRecord(() => messages().deploy.deploySteps)

export const serverAreaLabels: Readonly<Record<ServerArea, string>> = localizedRecord(() => messages().deploy.serverAreas)

export const deployModeLabels: Readonly<Record<DeployMode, { title: string; detail: string }>> = localizedRecord(() => ({
  always_on: { title: messages().deploy.modeAlwaysOnTitle, detail: messages().deploy.modeAlwaysOnDetail },
  scale_to_zero: { title: messages().deploy.modeScaleTitle, detail: messages().deploy.modeScaleDetail },
}))

interface StatusDisplay {
  /** After "Online · ". */
  label: string
  tone: BadgeTone
  dot: StatusDotTone
}

const statusTones: Record<DeploymentStatus, Omit<StatusDisplay, 'label'>> = {
  deploying: { tone: 'brand', dot: 'brand' },
  working: { tone: 'ok', dot: 'ok' },
  paused: { tone: 'neutral', dot: 'paused' },
  needs_attention: { tone: 'amber', dot: 'amber' },
  failed: { tone: 'danger', dot: 'danger' },
}

/**
 * The badge text and colors of an online agent.
 *
 * @example
 * describeDeploymentStatus('paused') // { label: 'paused', tone: 'neutral', dot: 'paused' }
 */
export function describeDeploymentStatus(status: DeploymentStatus): StatusDisplay {
  return { label: messages().deploy.statusLabels[status], ...statusTones[status] }
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
  if (cli.status === 'not_available') return onlineDeployNotAvailableMessage()
  if (cli.status === 'installed') return messages().deploy.theGraphrtToolsAreReadyOn
  const size = formatDownloadSize(cli.downloadSizeBytes)
  return messages().deploy.cliNeed(size)
}

const technicalPrefixes = /^(invalid input|not set up yet|credential store error|workflow error|internal error): /i

/**
 * A backend error as one plain sentence: without "invalid input: " and the like.
 *
 * @example
 * plainErrorMessage(new Error('invalid input: Paste your key')) // "Paste your key"
 */
export function plainErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : messages().deploy.somethingWentWrong
  const plain = message.replace(technicalPrefixes, '')
  return plain.charAt(0).toUpperCase() + plain.slice(1)
}

/** "2 hours ago" style text for an RFC 3339 time. */
export function describeTimeAgo(isoTime: string | null, now: Date = new Date()): string {
  if (!isoTime) return messages().deploy.notYet
  const elapsedMinutes = Math.max(0, Math.round((now.getTime() - new Date(isoTime).getTime()) / 60_000))
  if (Number.isNaN(elapsedMinutes)) return messages().deploy.notYet
  if (elapsedMinutes < 1) return messages().deploy.justNow
  if (elapsedMinutes < 60) return messages().deploy.elapsedminutesMinuteValueAgo(elapsedMinutes, elapsedMinutes === 1 ? '' : 's')
  const hours = Math.round(elapsedMinutes / 60)
  if (hours < 24) return messages().deploy.hoursHourValueAgo(hours, hours === 1 ? '' : 's')
  const days = Math.round(hours / 24)
  return messages().deploy.daysDayValueAgo(days, days === 1 ? '' : 's')
}
