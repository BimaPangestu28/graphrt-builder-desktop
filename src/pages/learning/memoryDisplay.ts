import type { MemoryFact, MemoryNote, MemoryPerson } from '@/api/abilitiesTypes'
import { formatDate } from '@/i18n/format'
import { messages } from '@/i18n'

/** Who a person is, in words: their name, else the owner or checks label, else their handle. */
export function describePerson(person: MemoryPerson): string {
  const t = messages().abilities.memoryTab
  if (person.name) return person.name
  if (person.kind === 'you' || person.kind === 'checks') return t.personKind[person.kind]
  return person.user
}

/** The second line of a person: what kind of person, their handle, and how many notes. */
export function describePersonDetails(person: MemoryPerson): string {
  const t = messages().abilities.memoryTab
  const parts = [t.personKind[person.kind]]
  if (person.name || person.kind === 'customer' || person.kind === 'other') parts.push(person.user)
  parts.push(t.counts(person.noteCount, person.waitingCount))
  return [...new Set(parts)].join(' · ')
}

function day(iso: string | null): string | null {
  if (!iso) return null
  const instant = new Date(iso)
  return Number.isNaN(instant.getTime()) ? null : formatDate(instant, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Kind, where it came from, when it was saved, how often it was used and when it lapses. */
export function describeNoteMeta(note: MemoryNote): string {
  const t = messages().abilities.memoryTab
  const saved = day(note.savedAt)
  const expires = day(note.expiresAt)
  const parts = [t.kind[note.kind], t.origin[note.origin], saved ? t.savedOn(saved) : null, note.uses > 0 ? t.used(note.uses) : null, expires ? t.expiresOn(expires) : null]
  return parts.filter((part): part is string => part !== null).join(' · ')
}

/** Waiting notes first (they need the owner), then the newest. */
export function sortNotes(notes: readonly MemoryNote[]): MemoryNote[] {
  return [...notes].sort((first, second) => {
    if (first.status !== second.status) return first.status === 'pending' ? -1 : 1
    return (second.updatedAt ?? '').localeCompare(first.updatedAt ?? '')
  })
}

/** A fact with its period: "Dana works at Acme · since 1 Jan 2024". */
export function describeFact(fact: MemoryFact): string {
  const t = messages().abilities.memoryTab
  const from = day(fact.validFrom)
  const to = day(fact.validTo)
  const period = [from ? t.graphSince(from) : null, to ? t.graphUntil(to) : null, fact.isClosed && !to ? t.graphEnded : null].filter((part): part is string => part !== null)
  return period.length === 0 ? fact.text : `${fact.text} · ${period.join(', ')}`
}
