import type { GraphrtEvent } from '@/api/types'
import { isRecord } from './runEventValues'

/**
 * The words of an "Ask me before continuing" answer. graphrt reports the chosen button by its
 * id (`outputs.action: "create"`); the button's title ("Buat invoice", in the language the
 * button was written in) comes with the question, in `node_paused.reason.data.actions`.
 */

/**
 * Button id → title of the question a `node_paused` event asks (empty when its buttons have no
 * titles), or null for a pause that is no question (a tool approval).
 */
export function readPauseActionTitles(event: GraphrtEvent): ReadonlyMap<string, string> | null {
  const reason = isRecord(event.reason) ? event.reason : null
  const kind = reason?.kind ?? event.kind
  if (kind !== 'human_input' && kind !== 'human-input') return null
  const data = reason && isRecord(reason.data) ? reason.data : isRecord(event.data) ? event.data : null
  const actions = data && Array.isArray(data.actions) ? data.actions : []
  const titles = new Map<string, string>()
  for (const action of actions) {
    if (!isRecord(action) || typeof action.id !== 'string') continue
    const title = typeof action.title === 'string' ? action.title.trim() : ''
    if (title) titles.set(action.id, title)
  }
  return titles
}

/** The button id an answered question resumed with (`outputs.action`, else the branch taken). */
export function readChosenActionId(event: GraphrtEvent): string | null {
  const outputs = isRecord(event.outputs) ? event.outputs : null
  if (outputs && typeof outputs.action === 'string' && outputs.action) return outputs.action
  return typeof event.branch === 'string' && event.branch ? event.branch : null
}

/**
 * What to show for a chosen button: its title, the id only when the question had no title for it.
 *
 * @example
 * describeChosenAction('create', new Map([['create', 'Buat invoice']])) // 'Buat invoice'
 * describeChosenAction('create', new Map()) // 'create'
 */
export function describeChosenAction(actionId: string, titles: ReadonlyMap<string, string> | undefined): string {
  return titles?.get(actionId) ?? actionId
}
