import type { InstalledPlugin } from '@/api/pluginTypes'
import type { PluginsState } from '@/hooks/usePlugins'
import { PluginConfigForm, type PluginConfigField } from './PluginConfigForm'

interface PluginSettingsProps {
  installed: InstalledPlugin
  plugins: PluginsState
}

function PluginSettingsForm({ installed, plugins, fields }: PluginSettingsProps & { fields: PluginConfigField[] }) {
  return (
    <PluginConfigForm
      pluginName={installed.name}
      fields={fields}
      onSave={(variable, value) => plugins.saveConfig(installed.name, variable, value)}
      onClear={(variable) => plugins.clearConfig(installed.name, variable)}
    />
  )
}

/**
 * An installed plugin's settings: required ones in the open, optional tuning (limits,
 * folders, API version) folded under "Optional settings" since the defaults work.
 */
export function PluginSettings({ installed, plugins }: PluginSettingsProps) {
  const toField = (setting: InstalledPlugin['config'][number]): PluginConfigField => ({ variable: setting.name, configured: setting.configured })
  const requiredFields = installed.config.filter((setting) => !setting.optional).map(toField)
  const optionalFields = installed.config.filter((setting) => setting.optional).map(toField)
  return (
    <>
      <PluginSettingsForm installed={installed} plugins={plugins} fields={requiredFields} />
      {optionalFields.length > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer font-medium text-ink-2 select-none">Optional settings ({optionalFields.length})</summary>
          <div className="mt-2 flex flex-col gap-2.5">
            <span className="text-[12px] text-muted">Defaults work for most people</span>
            <PluginSettingsForm installed={installed} plugins={plugins} fields={optionalFields} />
          </div>
        </details>
      )}
    </>
  )
}
