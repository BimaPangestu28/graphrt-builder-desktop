/** Plugin triggers (`src-tauri/src/plugin_triggers`), camelCase JSON. */

/** One trigger of a plugin: `<plugin>.<trigger>`. */
export interface TriggerRef {
  plugin: string
  trigger: string
}

/** A trigger of an installed plugin, for the Schedule screen. */
export interface AvailablePluginTrigger extends TriggerRef {
  pluginDisplayName: string
  /** "When a meeting is recorded". */
  title: string
  description: string
  /** Field names of each event: the agent's run inputs. */
  eventFields: string[]
  /** Why it cannot run now (plugin not loaded or not trusted), or null. */
  problem: string | null
}
