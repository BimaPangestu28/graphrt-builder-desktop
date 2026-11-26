import type { PluginTemplateInfo } from '@/api/pluginTypes'
import { messages } from '@/i18n'
import type { AgentTemplate } from './agentTemplates'

/**
 * Starter cards for the templates of installed plugins: a task agent that needs the plugin.
 * Ids are prefixed with the plugin name so they never collide with the built-in cards.
 *
 * @param templates - From `list_plugin_templates` (PluginTemplateInfo[])
 * @returns Cards for the New agent screen (AgentTemplate[])
 */
export function pluginTemplateCards(templates: PluginTemplateInfo[]): AgentTemplate[] {
  return templates.map((template) => ({
    id: `plugin:${template.plugin}:${template.id}`,
    title: template.title,
    description: template.description,
    prompt: template.prompt,
    kind: 'task',
    meta: template.pluginDisplayName,
    needs: [template.pluginDisplayName],
    setupNote: messages().newAgent.fromThePlugin(template.pluginDisplayName),
  }))
}
