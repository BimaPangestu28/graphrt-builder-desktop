import type { SkillFinding, SkillToolRequest, SkillUpdateChanges } from '@/api/skillTypes'
import { setLocale } from '@/i18n'
import { dictionaries } from '@/i18n/messages'
import { countAgentsUsing, describeFinding, describeFindingLocation, describeSkillSource, describeToolRequest, describeUpdateChanges, sortFindings } from './skillDisplay'

function request(changes: Partial<SkillToolRequest> = {}): SkillToolRequest {
  return { tool: 'whatsapp-api/send_message', providerLabel: 'WhatsApp Cloud API', actionLabel: 'Send message', coversEverything: false, available: true, ...changes }
}

function finding(changes: Partial<SkillFinding> = {}): SkillFinding {
  return { severity: 'warning', code: 'hides_from_user', message: 'Tells the agent to keep something from the person it works for.', file: 'SKILL.md', line: 4, ...changes }
}

describe('skill wording', () => {
  it('names a tool by what people know, never by its reference', () => {
    expect(describeToolRequest(request())).toBe('WhatsApp Cloud API · Send message')
    expect(describeToolRequest(request({ tool: 'gmail/*', providerLabel: 'Gmail', actionLabel: '', coversEverything: true }))).toBe('Gmail · everything it can do')
  })

  it('says where a skill came from', () => {
    expect(describeSkillSource('catalog', 'graphrt')).toBe('From the Graphrt catalog · By graphrt')
    expect(describeSkillSource('catalog', null)).toBe('From the Graphrt catalog')
    expect(describeSkillSource('authored', null)).toBe('Written here')
  })

  it('explains known findings in the current language and keeps the runtime sentence for new ones', () => {
    expect(describeFinding(finding())).toBe('Tells the agent to keep something from you.')
    expect(describeFinding(finding({ code: 'brand_new_check', message: 'Something new.' }))).toBe('Something new.')
    expect(describeFindingLocation(finding())).toBe('In SKILL.md, line 4')
    expect(describeFindingLocation(finding({ line: null }))).toBe('In SKILL.md')
    expect(describeFindingLocation(finding({ file: null, line: null }))).toBeNull()
    setLocale('id')
    expect(describeFinding(finding())).toBe('Menyuruh agent merahasiakan sesuatu dari Anda.')
    expect(describeFindingLocation(finding())).toBe('Di SKILL.md, baris 4')
  })

  it('puts findings that stop an install first', () => {
    const sorted = sortFindings([finding({ severity: 'info' }), finding({ severity: 'blocking' }), finding({ severity: 'warning' })])
    expect(sorted.map((entry) => entry.severity)).toEqual(['blocking', 'warning', 'info'])
  })

  it('lists what an update changes in sentences', () => {
    const update: SkillUpdateChanges = {
      addedTools: [request()],
      removedTools: [request({ providerLabel: 'Gmail', actionLabel: 'Send email' })],
      changedFiles: ['SKILL.md', 'references/prices.md'],
      addedFiles: ['references/new.md'],
      removedFiles: [],
      nothingChanged: false,
    }
    expect(describeUpdateChanges(update)).toEqual([
      'Asks for a new tool, WhatsApp Cloud API · Send message',
      'No longer asks for Gmail · Send email',
      'Its instructions changed',
      '2 reference files changed',
    ])
  })

  it('counts an agent once however many of its steps use the skill', () => {
    const agents = [
      { agentId: 'a', agentName: 'A', steps: [{ stepId: 's1', title: 'One', skills: ['tone'] }, { stepId: 's2', title: 'Two', skills: ['tone'] }] },
      { agentId: 'b', agentName: 'B', steps: [{ stepId: 's1', title: 'One', skills: [] }] },
    ]
    expect(countAgentsUsing(agents, 'tone')).toBe(1)
    expect(countAgentsUsing(agents, 'other')).toBe(0)
  })
})

describe('skills copy', () => {
  /** Words of the implementation that a business owner should never have to read. */
  const technicalWords = /\b(sha-?256|hash|digest|grants?|granted|traits?|yaml|json|manifest|frontmatter|allowed-tools|minisign|tarball|checksum|provider)\b/i

  function collectText(node: unknown): string[] {
    if (typeof node === 'string') return [node]
    if (typeof node === 'function') {
      const samples = Array.from({ length: node.length }, () => 'x')
      return [String((node as (...args: unknown[]) => unknown)(...samples))]
    }
    if (node && typeof node === 'object') return Object.values(node).flatMap(collectText)
    return []
  }

  it.each(['en', 'id'] as const)('uses no technical words in %s', (locale) => {
    const offending = collectText(dictionaries[locale].skills).filter((text) => technicalWords.test(text))
    expect(offending).toEqual([])
  })
})
