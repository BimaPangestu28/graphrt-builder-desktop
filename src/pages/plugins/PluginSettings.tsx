import type { InstalledPlugin } from '@/api/pluginTypes'
import type { PluginsState } from '@/hooks/usePlugins'
import { PluginConfigForm, toPluginConfigField, type PluginConfigField } from './PluginConfigForm'
import { messages } from '@/i18n'

interface PluginSettingsProps {
  installed: InstalledPlugin
  plugins: PluginsState
}

function PluginSettingsForm({ installed, plugins, fields }: PluginSettingsProps & { fields: PluginConfigField[] }) {
  return (
    <PluginConfigForm
      pluginLabel={installed.displayName}
      fields={fields}
      onSave={(variable, value) => plugins.saveConfig(installed.name, variable, value)}
      onClear={(variable) => plugins.clearConfig(installed.name, variable)}
    />
  )
}

/**
 * An installed plugin's settings: the ones it cannot work without in the open, the rest
 * (limits, extra folders, API version) folded under "Optional settings" since the defaults work.
 */
export function PluginSettings({ installed, plugins }: PluginSettingsProps) {
  const requiredFields = installed.config.filter((setting) => !setting.optional).map(toPluginConfigField)
  const optionalFields = installed.config.filter((setting) => setting.optional).map(toPluginConfigField)
  return (
    <>
      <PluginSettingsForm installed={installed} plugins={plugins} fields={requiredFields} />
      {optionalFields.length > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer font-medium text-ink-2 select-none">{messages().plugins.optionalSettings(optionalFields.length)}</summary>
          <div className="mt-2 flex flex-col gap-2.5">
            <span className="text-[12px] text-muted">{messages().plugins.defaultsWork}</span>
            <PluginSettingsForm installed={installed} plugins={plugins} fields={optionalFields} />
          </div>
        </details>
      )}
    </>
  )
}
