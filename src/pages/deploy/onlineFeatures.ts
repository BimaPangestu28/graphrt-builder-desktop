import type { OnlineFeatures, OnlineTarget } from '@/api/deployTypes'

/** The server's own limits for chat visitors (graphrt serve defaults, never changed by the app). */
export const guestMessagesPerMinute = 10
export const allGuestsMessagesPerMinute = 120

/**
 * Why the chat page and the phone page can be chosen or not.
 * - `ready`: the installed graphrt tools know them
 * - `needs_tools`: the tools are not downloaded yet
 * - `needs_newer_tools`: the tools this app version can download are too old
 */
export type FeaturesAvailability = 'ready' | 'needs_tools' | 'needs_newer_tools'

/** Whether the online copy keeps paired phones, which costs a small storage space. */
export function needsStorage(features: OnlineFeatures): boolean {
  return features.phone || features.notifications || features.whatsapp
}

export function anyFeatureOn(features: OnlineFeatures): boolean {
  return features.chat || features.phone || features.notifications || features.answerWhenTimeRunsOut || features.whatsapp
}

/**
 * The features after one change, keeping them consistent: notifications arrive on the phone
 * page, so they go off with it.
 *
 * @example
 * withFeatureChange({ ...all, phone: true, notifications: true }, { phone: false }).notifications // false
 */
export function withFeatureChange(features: OnlineFeatures, change: Partial<OnlineFeatures>): OnlineFeatures {
  const next = { ...features, ...change }
  return next.phone ? next : { ...next, notifications: false }
}

/** A Unix time in milliseconds as an ISO string, for the "time ago" helper. */
export function isoFromMs(timeMs: number | null): string | null {
  return timeMs === null ? null : new Date(timeMs).toISOString()
}

/** A stable key of a target, for effects that reload when it changes. */
export function onlineTargetKey(target: OnlineTarget): string {
  if (target.kind === 'computer') return 'computer'
  return target.kind === 'agent' ? `agent:${target.agentId}` : `server:${target.serverId}`
}
