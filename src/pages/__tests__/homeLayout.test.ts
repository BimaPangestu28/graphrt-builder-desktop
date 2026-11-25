import type { Agent } from '@/api/types'
import { describeGreetingSubtitle, homeTemplateCount, pickHomeLayout, pickHomeTemplates } from '@/pages/home-dashboard/homeLayout'
import { agentTemplates, mapsWhatsAppTemplateId } from '@/pages/new-agent/agentTemplates'

const agent = { id: 'digest', name: 'Inbox digest' } as Agent

describe('pickHomeLayout', () => {
  it('shows the first agent hero only once the agent list loaded empty', () => {
    expect(pickHomeLayout([], null)).toBe('firstAgent')
    expect(pickHomeLayout([agent], null)).toBe('dashboard')
  })

  it('keeps the dashboard while agents load or fail to load', () => {
    expect(pickHomeLayout(null, null)).toBe('dashboard')
    expect(pickHomeLayout(null, new Error('database is locked'))).toBe('dashboard')
    expect(pickHomeLayout([], new Error('database is locked'))).toBe('dashboard')
  })
})

describe('pickHomeTemplates', () => {
  it('offers two rows of three, flagship first', () => {
    const templates = pickHomeTemplates()
    expect(templates).toHaveLength(homeTemplateCount)
    expect(templates[0].id).toBe(mapsWhatsAppTemplateId)
  })

  it('offers every template when there are fewer', () => {
    expect(pickHomeTemplates(agentTemplates.slice(0, 2))).toHaveLength(2)
  })
})

describe('describeGreetingSubtitle', () => {
  it('points a fresh install at the first agent', () => {
    expect(describeGreetingSubtitle('firstAgent', 'Nothing needs you', 'no runs scheduled')).toBe("Let's build your first agent. Describe a job or pick a template")
  })

  it('joins what needs the user and the next run once each is in', () => {
    expect(describeGreetingSubtitle('dashboard', '2 things need you', 'next run tomorrow 07:00')).toBe('2 things need you · next run tomorrow 07:00')
    expect(describeGreetingSubtitle('dashboard', null, 'next run tomorrow 07:00')).toBe('next run tomorrow 07:00')
    expect(describeGreetingSubtitle('dashboard', null, null)).toBe('')
  })
})
