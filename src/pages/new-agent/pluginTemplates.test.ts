import { describe, expect, it } from 'vitest'
import type { PluginTemplateInfo } from '@/api/pluginTypes'
import { pluginTemplateCards } from './pluginTemplates'

function readyAgent(plugin: string, id: string, language: string | null): PluginTemplateInfo {
  return { plugin, pluginDisplayName: 'Document Templates', id, title: id, description: 'An invoice as a PDF', prompt: '', readyToUse: true, language }
}

describe('pluginTemplateCards', () => {
  it('turns plugin templates into task cards that need the plugin', () => {
    const cards = pluginTemplateCards([{ plugin: 'upwork', pluginDisplayName: 'Upwork', id: 'morning-jobs', title: 'Morning jobs', description: 'Find jobs', prompt: 'Every morning…' }], 'en')
    expect(cards).toEqual([
      { id: 'plugin:upwork:morning-jobs', title: 'Morning jobs', description: 'Find jobs', prompt: 'Every morning…', kind: 'task', meta: 'Upwork', needs: ['Upwork'], setupNote: 'From the Upwork plugin' },
    ])
  })

  it('tags an agent the plugin ships finished and says which one to make', () => {
    const [card] = pluginTemplateCards([readyAgent('document-templates', 'make-invoice', 'en')], 'en')
    expect(card.kindLabel).toBe('Ready to use')
    expect(card.readyAgent).toEqual({ plugin: 'document-templates', templateId: 'make-invoice' })
    expect(card.setupNote).toBe('the Document Templates plugin, nothing else. Click to make it')
  })

  it("shows a plugin's ready-made agents in the app's language, or all of them when it has none", () => {
    const templates = [readyAgent('document-templates', 'make-invoice', 'en'), readyAgent('document-templates', 'buat-invoice', 'id'), readyAgent('other', 'general', null)]
    const ids = (language: string) => pluginTemplateCards(templates, language).map((card) => card.id)
    expect(ids('id')).toEqual(['plugin:document-templates:buat-invoice', 'plugin:other:general'])
    expect(ids('en')).toEqual(['plugin:document-templates:make-invoice', 'plugin:other:general'])
    expect(ids('fr')).toHaveLength(3)
  })
})
