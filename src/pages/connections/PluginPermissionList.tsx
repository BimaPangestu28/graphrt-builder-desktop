import type { PluginPermissions } from '@/api/pluginTypes'
import { describePluginPermissions } from './pluginDisplay'

interface PluginPermissionListProps {
  pluginName: string
  permissions: PluginPermissions
  needsBrowser: boolean
}

/** What a plugin asks for (internet, secrets, settings, browser), shown before and after install. */
export function PluginPermissionList({ pluginName, permissions, needsBrowser }: PluginPermissionListProps) {
  return (
    <ul aria-label={`What ${pluginName} asks for`} className="m-0 flex list-disc flex-col gap-0.5 pl-5 text-[12px] text-body">
      {describePluginPermissions(permissions, needsBrowser).map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  )
}
