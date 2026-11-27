import type { SkillFinding, SkillToolRequest, SkillUpdateChanges } from '@/api/skillTypes'
import { setLocale } from '@/i18n'
import { dictionaries } from '@/i18n/messages'
import { countAgentsUsing, describeFinding, describeFindingDetail, describeFindingLocation, describeSkillSource, describeToolRequest, describeUpdateChanges, sortFindings } from './skillDisplay'

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
  it('spells out what a finding is about in the person’s language, from the details the backend sends', () => {
    const links = finding({ severity: 'info', code: 'external_links', details: { hosts: ['pay.example', 'docs.example'], more: ['3'] } })
    const scripts = finding({ severity: 'info', code: 'scripts_not_run', details: { count: ['2'] } })
    const tools = finding({ severity: 'info', code: 'unsupported_tools', details: { tools: ['Bash', 'WebFetch'] } })
    setLocale('en')
    expect(describeFindingDetail(links)).toBe('Addresses it mentions: pay.example, docs.example and 3 more')
    expect(describeFindingDetail(scripts)).toBe('2 script files')
    expect(describeFindingDetail(finding({ code: 'scripts_not_run', details: { count: ['1'] } }))).toBe('1 script file')
    expect(describeFindingDetail(tools)).toBe('Tools it mentions: Bash, WebFetch')
    setLocale('id')
    try {
      expect(describeFindingDetail(links)).toBe('Alamat yang disebut pay.example, docs.example dan 3 lainnya')
      expect(describeFindingDetail(scripts)).toBe('2 berkas skrip')
      expect(describeFindingDetail(tools)).toBe('Tool yang disebut Bash, WebFetch')
    } finally {
      setLocale('en')
    }
  })

  it('counts what does not fit instead of listing everything, and says nothing without details', () => {
    const hosts = Array.from({ length: 8 }, (_, index) => `site${index + 1}.example`)
    expect(describeFindingDetail(finding({ code: 'external_links', details: { hosts } }))).toBe(`Addresses it mentions: ${hosts.slice(0, 6).join(', ')} and 2 more`)
    expect(describeFindingDetail(finding({ code: 'external_links' }))).toBeNull()
    expect(describeFindingDetail(finding({ code: 'hides_from_user', details: { hosts: ['x.example'] } }))).toBeNull()
    expect(describeFindingDetail(finding({ code: 'scripts_not_run', details: { count: ['many'] } }))).toBeNull()
  })
})
