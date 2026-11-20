import type { PluginPermissions } from '@/api/pluginTypes'
import { describePermissionChips, describePluginPermissions } from './pluginDisplay'

interface PluginPermissionProps {
  /** The plugin's display name, for the list label. */
  pluginLabel: string
  permissions: PluginPermissions
  needsBrowser: boolean
}

/** Compact chips (Internet, Secrets, 2 settings, Browser) for a plugin row. */
export function PluginPermissionChips({ pluginLabel, permissions, needsBrowser }: PluginPermissionProps) {
  const chipLabels = describePermissionChips(permissions, needsBrowser)
  if (chipLabels.length === 0) return null
  return (
    <ul aria-label={`${pluginLabel} needs`} className="m-0 flex list-none flex-wrap gap-1 p-0">
      {chipLabels.map((chipLabel) => (
        <li key={chipLabel} className="rounded-md bg-chip px-1.5 py-px text-[11px] font-medium text-ink-2">
          {chipLabel}
        </li>
      ))}
    </ul>
  )
}

/** What a plugin asks for (internet, secrets, settings, browser) in plain language, shown in its details. */
export function PluginPermissionList({ pluginLabel, permissions, needsBrowser }: PluginPermissionProps) {
  return (
    <ul aria-label={`What ${pluginLabel} asks for`} className="m-0 flex list-none flex-col gap-1 p-0 text-[12px] leading-normal text-body [overflow-wrap:anywhere]">
      {describePluginPermissions(permissions, needsBrowser).map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  )
}
