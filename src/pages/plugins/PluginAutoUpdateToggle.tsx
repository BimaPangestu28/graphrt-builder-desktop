import { useAppSettings } from '@/pages/settings/useAppSettings'
import { useT } from '@/i18n'

/**
 * "Update automatically" next to the Plugins tabs: the same preference as Settings ›
 * Updates › "Automatically update plugins". Hidden until the preferences load.
 */
export function PluginAutoUpdateToggle() {
  const t = useT().plugins
  const { appSettings, saveError, updateAppSetting } = useAppSettings()
  if (!appSettings) return null
  return (
    <div className="flex flex-col items-end gap-0.5">
      <label
        className="inline-flex h-[34px] cursor-pointer items-center gap-2 text-[13px] font-medium text-ink"
        title={t.autoUpdateHint}
      >
        <input
          type="checkbox"
          checked={appSettings.autoUpdatePlugins}
          onChange={(event) => void updateAppSetting('autoUpdatePlugins', event.target.checked)}
          className="size-4 accent-ink"
        />
        {t.updateAutomatically}
      </label>
      {saveError && (
        <span role="alert" className="text-[12px] text-danger">
          {t.couldNotSave(saveError)}
        </span>
      )}
    </div>
  )
}
