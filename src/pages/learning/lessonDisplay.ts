import type { Lesson, LessonHistoryEntry, LessonRiskReason } from '@/api/learningTypes'
import { formatDate, formatDateTime, messages } from '@/i18n'

/**
 * How lessons are worded on screen: where a note came from, who it applies to and why it is
 * risky, in the person's language. The backend sends codes; the sentences are built here.
 */

export type LessonTab = 'waiting' | 'inUse' | 'notUsed' | 'history'

/** The notes of one tab: proposals wait, approved ones are in use, the rest are not used. */
export function lessonsOfTab(lessons: readonly Lesson[], tab: Exclude<LessonTab, 'history'>): Lesson[] {
  if (tab === 'waiting') return sortWaiting(lessons.filter((lesson) => lesson.status === 'proposed'))
  if (tab === 'inUse') return lessons.filter((lesson) => lesson.status === 'approved')
  return lessons.filter((lesson) => lesson.status === 'rejected' || lesson.status === 'retired')
}

/** High-risk proposals first, so they are never below the fold; otherwise the order given. */
function sortWaiting(lessons: Lesson[]): Lesson[] {
  return [...lessons].sort((left, right) => Number(right.risk === 'high') - Number(left.risk === 'high'))
}

/** A note that needs a careful look: high risk, or nobody verified where it came from. */
export function needsCare(lesson: Lesson): boolean {
  return lesson.risk === 'high' || lesson.trust === 'derived'
}

/** "From feedback on a run · 26 Nov 2026", "Written by you", "From feedback on a run, by +62…". */
export function describeLessonOrigin(lesson: Lesson): string {
  const t = messages().learning
  const base = t.origin[lesson.signal]
  const namedAuthor = lesson.author && lesson.author !== 'owner' ? lesson.author : null
  const withAuthor = namedAuthor ? t.originBy(base, namedAuthor) : base
  return lesson.createdAt ? t.originOn(withAuthor, formatDate(new Date(lesson.createdAt))) : withAuthor
}

/** "Applies to everyone" or "Applies to +62… only". */
export function describeLessonScope(lesson: Lesson): string {
  const t = messages().learning
  return lesson.user ? t.forPerson(lesson.user) : t.forEveryone
}

/** A risk reason in the app's own words; the runtime's sentence only for an unknown code. */
export function describeRiskReason(reason: LessonRiskReason): string {
  const known: Record<string, string> = messages().learning.riskReason
  return known[reason.code] ?? reason.message
}

/** "You approved a note", "Graphrt suggested a note", "+62… suggested a note". */
export function describeHistoryEntry(entry: LessonHistoryEntry): string {
  const t = messages().learning.history
  const who = entry.actor === 'owner' ? t.you : entry.actor === 'system' ? t.system : entry.actor
  const actions: Record<string, string> = t.action
  return t.line(who, actions[entry.action] ?? t.otherAction)
}

export function describeHistoryTime(entry: LessonHistoryEntry): string {
  return entry.at ? formatDateTime(new Date(entry.at)) : ''
}

/** The people the agent holds notes about, with how many notes each. */
export function peopleRemembered(lessons: readonly Lesson[]): Array<{ person: string; noteCount: number }> {
  const counts = new Map<string, number>()
  for (const lesson of lessons) {
    if (lesson.user) counts.set(lesson.user, (counts.get(lesson.user) ?? 0) + 1)
  }
  return [...counts].map(([person, noteCount]) => ({ person, noteCount })).sort((left, right) => left.person.localeCompare(right.person))
}
