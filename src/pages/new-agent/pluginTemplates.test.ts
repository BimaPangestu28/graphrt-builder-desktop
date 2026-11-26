import { describe, expect, it } from 'vitest'
import { pluginTemplateCards } from './pluginTemplates'

describe('pluginTemplateCards', () => {
  it('turns plugin templates into task cards that need the plugin', () => {
    const cards = pluginTemplateCards([
      { plugin: 'upwork', pluginDisplayName: 'Upwork', id: 'morning-jobs', title: 'Morning jobs', description: 'Find jobs', prompt: 'Every morning…' },
    ])
    expect(cards).toEqual([
      { id: 'plugin:upwork:morning-jobs', title: 'Morning jobs', description: 'Find jobs', prompt: 'Every morning…', kind: 'task', meta: 'Upwork', needs: ['Upwork'], setupNote: 'From the Upwork plugin' },
    ])
  })
})
