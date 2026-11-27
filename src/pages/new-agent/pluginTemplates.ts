import type { PluginTemplateInfo } from '@/api/pluginTypes'
import { messages } from '@/i18n'
import type { AgentTemplate } from './agentTemplates'

/**
 * The ready-made agents to show for the app's language. A plugin may ship the same agent in
 * several languages (`make-invoice` in English, `buat-invoice` in Indonesian): when one of a
 * plugin's agents is in the app's language, its agents in other languages are left out; a
 * plugin with none in the app's language shows all of them. Prompts are always shown.
 */
function forLanguage(templates: PluginTemplateInfo[], language: string): PluginTemplateInfo[] {
  const pluginsInLanguage = new Set(templates.filter((template) => template.readyToUse && template.language === language).map((template) => template.plugin))
  return templates.filter((template) => !template.readyToUse || !template.language || template.language === language || !pluginsInLanguage.has(template.plugin))
}

/**
 * Starter cards for the templates of installed plugins: a task agent that needs the plugin.
 * Ids are prefixed with the plugin name so they never collide with the built-in cards. A
 * template the plugin ships finished is tagged "Ready to use" and carries `readyAgent`.
 *
 * @param templates - From `list_plugin_templates` (PluginTemplateInfo[])
 * @param language - The app's language, e.g. "en" (string)
 * @returns Cards for the New agent screen (AgentTemplate[])
 */
export function pluginTemplateCards(templates: PluginTemplateInfo[], language: string): AgentTemplate[] {
  const t = messages().newAgent
  return forLanguage(templates, language).map((template) => {
    const card: AgentTemplate = {
      id: `plugin:${template.plugin}:${template.id}`,
      title: template.title,
      description: template.description,
      prompt: template.prompt,
      kind: 'task',
      meta: template.pluginDisplayName,
      needs: [template.pluginDisplayName],
      setupNote: t.fromThePlugin(template.pluginDisplayName),
    }
    if (!template.readyToUse) return card
    return { ...card, setupNote: t.readyToUseNote(template.pluginDisplayName), kindLabel: t.readyToUse, readyAgent: { plugin: template.plugin, templateId: template.id } }
  })
}
