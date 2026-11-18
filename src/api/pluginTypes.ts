/**
 * graphrt plugin types, mirroring `src-tauri/src/plugins/models.rs`
 * (serialized camelCase; enums are snake_case strings).
 */

/** What a plugin asks for. Shown to the user before install. */
export interface PluginPermissions {
  /** The plugin talks to the internet. */
  network: boolean
  /** The plugin wants plaintext secret values (granted only when trusted). */
  secrets: boolean
  /** Settings (environment variables) the plugin reads, e.g. `WHATSAPP_ACCESS_TOKEN`. */
  env: string[]
}

/** One node kind (step type) a plugin adds, e.g. `whatsapp-api.send_text`. */
export interface PluginNodeInfo {
  kind: string
  title: string
  description: string
}

/** One plugin of the online catalog, with its install state on this computer. */
export interface PluginCatalogEntry {
  name: string
  version: string
  description: string
  permissions: PluginPermissions
  /** Needs the browser runtime (Chromium for Playwright) to work. */
  needsBrowser: boolean
  nodes: PluginNodeInfo[]
  tools: string[]
  readmeUrl: string | null
  sizeBytes: number
  /** Installed version, or null when not installed. */
  installedVersion: string | null
  /** Installed and the catalog has a different version. */
  updateAvailable: boolean
}

export interface PluginCatalog {
  plugins: PluginCatalogEntry[]
  /** When the catalog was published (RFC 3339), if it says. */
  generatedAt: string | null
  /** The catalog could not be fetched and this is the last saved copy. */
  fromCache: boolean
}

/** Whether a setting the plugin requests has a value in the keychain. Values are never returned. */
export interface PluginConfigStatus {
  name: string
  configured: boolean
}

/** A plugin installed under the app data folder. */
export interface InstalledPlugin {
  name: string
  version: string
  description: string
  /** Requested permissions (from the plugin's manifest). */
  permissions: PluginPermissions
  /** The user trusts it: it receives its settings and plaintext secrets. */
  trusted: boolean
  needsBrowser: boolean
  nodes: PluginNodeInfo[]
  tools: string[]
  /** One entry per `permissions.env` variable. */
  config: PluginConfigStatus[]
  /** Why the plugin could not be loaded (bad manifest, checksum mismatch...); null when loaded. */
  loadError: string | null
  /** Notes from graphrt, e.g. requested permissions that were not granted. */
  warnings: string[]
  readmeUrl: string | null
}

export type BrowserRuntimeStatus = 'not_installed' | 'installing' | 'installed'

/** Result of a one-off plugin action (e.g. `whatsapp-web.login`): the node's outputs. */
export interface PluginActionResult {
  outputs: Record<string, unknown>
}

export type PluginInstallStage = 'downloading' | 'verifying' | 'extracting' | 'loading' | 'done' | 'failed'

/** Payload of the Tauri event `plugin-event`. */
export type PluginEvent =
  | {
      type: 'install_progress'
      name: string
      stage: PluginInstallStage
      receivedBytes: number | null
      totalBytes: number | null
      message: string | null
    }
  | { type: 'load_error'; name: string; message: string }
  | { type: 'plugins_changed' }

/** Tauri event name for {@link PluginEvent}. */
export const PLUGIN_EVENT_NAME = 'plugin-event'

/**
 * Payload of the Tauri event `node-runtime-event` (browser runtime install progress).
 * Owned by the Node runtime side: the app only reads `message` and `percent` when present.
 */
export interface BrowserRuntimeEvent {
  message?: string
  /** 0 to 100. */
  percent?: number
  [field: string]: unknown
}

/** Tauri event name for {@link BrowserRuntimeEvent}. */
export const BROWSER_RUNTIME_EVENT_NAME = 'node-runtime-event'
