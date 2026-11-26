import type { Lesson, LessonHistoryEntry } from '@/api/learningTypes'
import { setLocale } from '@/i18n'
import { dictionaries } from '@/i18n/messages'
import { describeHistoryEntry, describeLessonOrigin, describeLessonScope, describeRiskReason, lessonsOfTab, needsCare, peopleRemembered } from './lessonDisplay'

function lesson(changes: Partial<Lesson> = {}): Lesson {
  return {
    id: 'l1',
    text: 'Greet people by their first name',
    kind: 'correction',
    status: 'proposed',
    trust: 'derived',
    risk: 'low',
    riskReasons: [],
    user: null,
    signal: 'feedback',
    runId: 'r1',
    author: null,
    evidence: null,
    createdAt: '2026-11-26T09:12:00Z',
    updatedAt: '2026-11-26T09:12:00Z',
    expiresAt: null,
    decidedBy: null,
    ...changes,
  }
}

function entry(changes: Partial<LessonHistoryEntry>): LessonHistoryEntry {
  return { at: '2026-11-26T09:12:00Z', actor: 'owner', action: 'approve', lessonId: 'l1', lessonText: 'x', ...changes }
}

describe('lesson wording', () => {
  it('sorts notes into waiting, in use and not used, high risk first among the waiting', () => {
    const lessons = [
      lesson({ id: 'low' }),
      lesson({ id: 'high', risk: 'high' }),
      lesson({ id: 'approved', status: 'approved' }),
      lesson({ id: 'rejected', status: 'rejected' }),
      lesson({ id: 'retired', status: 'retired' }),
    ]
    expect(lessonsOfTab(lessons, 'waiting').map((item) => item.id)).toEqual(['high', 'low'])
    expect(lessonsOfTab(lessons, 'inUse').map((item) => item.id)).toEqual(['approved'])
    expect(lessonsOfTab(lessons, 'notUsed').map((item) => item.id)).toEqual(['rejected', 'retired'])
  })

  it('marks unverified and high-risk notes as needing care', () => {
    expect(needsCare(lesson())).toBe(true)
    expect(needsCare(lesson({ trust: 'owner' }))).toBe(false)
    expect(needsCare(lesson({ trust: 'owner', risk: 'high' }))).toBe(true)
  })

  it('says where a note came from and who it applies to', () => {
    expect(describeLessonOrigin(lesson({ createdAt: null }))).toBe('From feedback on a run')
    expect(describeLessonOrigin(lesson({ createdAt: null, author: '+62 812' }))).toBe('From feedback on a run, by +62 812')
    expect(describeLessonOrigin(lesson({ createdAt: null, signal: 'manual', author: 'owner' }))).toBe('Written by you')
    expect(describeLessonOrigin(lesson())).toMatch(/^From feedback on a run · .*2026/)
    expect(describeLessonScope(lesson())).toBe('Applies to everyone')
    expect(describeLessonScope(lesson({ user: '+62 812' }))).toBe('Applies to +62 812 only')
  })

  it('explains risk reasons by code in the current language, keeping the runtime sentence for new codes', () => {
    expect(describeRiskReason({ code: 'money', message: 'It is about money (runtime).' })).toBe('It is about money.')
    expect(describeRiskReason({ code: 'new_code', message: 'Something new.' })).toBe('Something new.')
    setLocale('id')
    expect(describeRiskReason({ code: 'money', message: 'It is about money.' })).toBe('Ini soal uang.')
  })

  it('words the history by who did what', () => {
    expect(describeHistoryEntry(entry({}))).toBe('You approved a note')
    expect(describeHistoryEntry(entry({ actor: 'system', action: 'propose' }))).toBe('Graphrt suggested a note')
    expect(describeHistoryEntry(entry({ actor: '+62 812', action: 'propose' }))).toBe('+62 812 suggested a note')
    expect(describeHistoryEntry(entry({ action: 'something_new' }))).toBe('You changed something')
  })

  it('lists the people the agent holds notes about', () => {
    expect(peopleRemembered([lesson({ user: 'b' }), lesson({ user: 'a' }), lesson({ user: 'b' }), lesson()])).toEqual([
      { person: 'a', noteCount: 1 },
      { person: 'b', noteCount: 2 },
    ])
  })
})

describe('learning copy', () => {
  const technicalWords = /\b(sha-?256|hash|grants?|traits?|yaml|json|derived|distill\w*|policy|proposal|lesson|trust level|authenticated)\b/i

  function collectText(node: unknown): string[] {
    if (typeof node === 'string') return [node]
    if (typeof node === 'function') return [String((node as (...args: unknown[]) => unknown)(...Array.from({ length: node.length }, () => 'x')))]
    if (node && typeof node === 'object') return Object.values(node).flatMap(collectText)
    return []
  }

  it.each(['en', 'id'] as const)('uses no technical words in %s', (locale) => {
    expect(collectText(dictionaries[locale].learning).filter((text) => technicalWords.test(text))).toEqual([])
  })
})
