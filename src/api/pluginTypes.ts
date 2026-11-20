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

/** `stable`: verified end to end; `beta`: official API, unit-tested; `experimental`: may break. */
export type PluginMaturity = 'stable' | 'beta' | 'experimental'

export type PluginTosRisk = 'none' | 'low' | 'medium' | 'high'

/** One plugin of the online catalog, with its install state on this computer. */
export interface PluginCatalogEntry {
  /** Technical name, the identifier (install calls, routes, node kinds), e.g. "whatsapp-api". */
  name: string
  /** What people see, e.g. "WhatsApp Cloud API": the catalog's curated name, else the humanized name. */
  displayName: string
  version: string
  description: string
  permissions: PluginPermissions
  /** Needs the browser runtime (Chromium for Playwright) to work. */
  needsBrowser: boolean
  nodes: PluginNodeInfo[]
  tools: string[]
  readmeUrl: string | null
  /**
   * HTTPS link to the plugin's SVG icon, or null when the catalog has none. Never load it
   * directly (the CSP allows no remote images): {@link getPluginIcon} returns a cached data URL.
   */
  iconUrl: string | null
  /** Terms-of-service / ban warning from the plugin's README (e.g. whatsapp-web), or null. */
  warning: string | null
  /** Maturity label, when the catalog says (older catalogs do not). */
  status: PluginMaturity | null
  /** How likely using it breaks the service's terms, when the catalog says. */
  tosRisk: PluginTosRisk | null
  sizeBytes: number
  /** Installed version, or null when not installed. */
  installedVersion: string | null
  /** Installed and the catalog has a different version. */
  updateAvailable: boolean
  /**
   * The update asks for more than the installed version (more settings or plaintext secrets):
   * it never installs automatically, and installing it means trusting the plugin again.
   */
  updateNeedsApproval: boolean
}

/** One plugin moved between versions. */
export interface PluginVersionChange {
  name: string
  fromVersion: string
  toVersion: string
}

/** An update graphrt installed by itself ("Automatically update plugins"). */
export interface PluginAutoUpdate extends PluginVersionChange {
  /** RFC 3339 UTC. */
  updatedAt: string
}

/** What "Update all" did. */
export interface PluginBulkUpdateSummary {
  updated: PluginVersionChange[]
  /** Updates left alone because they ask for more permissions. */
  needsApproval: string[]
  failed: Array<{ name: string; message: string }>
}

export interface PluginCatalog {
  plugins: PluginCatalogEntry[]
  /** When the catalog was published (RFC 3339), if it says. */
  generatedAt: string | null
  /** The catalog could not be fetched and this is the last saved copy. */
  fromCache: boolean
  /** When the app last fetched the catalog this session (RFC 3339), or null for a saved copy. */
  fetchedAt: string | null
}

/** Whether a setting the plugin requests has a value in the keychain. Values are never returned. */
export interface PluginConfigStatus {
  name: string
  configured: boolean
  /** The plugin has a default (limits, folders, API version), so it never blocks running. */
  optional: boolean
}

/** A plugin installed under the app data folder. */
export interface InstalledPlugin {
  /** Technical name, the identifier. */
  name: string
  /** What people see: the curated catalog name (kept from install time, so it shows offline), else the humanized name. */
  displayName: string
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
  /** The catalog's icon link when it was installed, or null. See {@link PluginCatalogEntry.iconUrl}. */
  iconUrl: string | null
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
