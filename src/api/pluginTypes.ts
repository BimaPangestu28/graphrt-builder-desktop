import { messages } from '@/i18n'
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

/**
 * Where a plugin comes from. `official`: built by graphrt (also when the catalog does not say);
 * `community`: a third-party plugin reviewed and mirrored by the graphrt maintainers;
 * `local`: installed from a folder or archive on this computer (Developer mode), not reviewed.
 */
export type PluginSource = 'official' | 'community' | 'local'

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
  /** `official` or `community` (the catalog never lists `local` plugins). */
  source: PluginSource
  /** Who maintains it, e.g. "graphrt" or "Acme Inc.", when the catalog says. */
  publisher: string | null
  /** HTTPS link to its source repository; open it with {@link openPluginRepository}. */
  repositoryUrl: string | null
  /** Installed version, or null when not installed (or installed from this computer). */
  installedVersion: string | null
  /** Installed and the catalog has a different version. */
  updateAvailable: boolean
  /**
   * The update asks for more than the installed version (more settings or plaintext secrets):
   * it never installs automatically, and installing it means trusting the plugin again.
   */
  updateNeedsApproval: boolean
  /** An MCP preset plugin: the server it adds to Connections > MCP servers (newer catalogs only). */
  mcpServer?: McpServerSummary | null
  /**
   * This app is too old for the catalog's version of the plugin: it cannot be installed (or
   * updated to that version) until the app is updated. Null or missing when the app is new enough.
   */
  needsNewerApp?: NewerAppNeeded | null
}

/** A plugin needs a newer version of the app than this one. */
export interface NewerAppNeeded {
  /** The oldest app version that can use the plugin, e.g. "0.3.0"; null when only "a newer one" is known. */
  minVersion: string | null
}

/** The remote MCP server an MCP preset plugin adds (no code runs on this computer). */
export interface McpServerSummary {
  url: string
  /** How the app signs in to it. */
  auth: 'none' | 'bearer' | 'oauth'
}

/** A starter from an installed plugin, shown on the New agent screen: a prompt, or a ready-made agent. */
export interface PluginTemplateInfo {
  plugin: string
  pluginDisplayName: string
  id: string
  title: string
  description: string
  /** The text for the "describe the job" box; empty for a ready-made agent. */
  prompt: string
  /** The plugin ships the finished workflow: picking it makes the agent at once, without a model. */
  readyToUse?: boolean
  /** The language a ready-made agent is written in (`en`, `id`), when the plugin says so. */
  language?: string | null
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
  /** Updates left alone because they ask for more permissions (automatic updates also leave community plugins here). */
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
  /** For a saved copy: why the online catalog was not used (offline, or a missing or invalid signature). */
  fetchError: string | null
}

/**
 * What kind of value a setting holds (declared by the plugin, else guessed from its name).
 * Only a `secret` is hidden once saved; a `folder` or `file` gets a picker.
 */
export type PluginSettingKind = 'text' | 'secret' | 'number' | 'folder' | 'file'

/**
 * One setting a plugin requests: what it is and whether it has a value in the keychain.
 * Everything after `optional` comes from the plugin's own description of its settings and is
 * missing for a setting it says nothing about.
 */
export interface PluginConfigStatus {
  name: string
  configured: boolean
  /** The plugin works without it (it has a default), so it never blocks running. */
  optional: boolean
  /** What people see instead of the variable name, e.g. "Folder for finished documents". */
  label?: string | null
  /** One or two sentences on what the setting is for. */
  help?: string | null
  /** Missing means `secret`: the value is never shown again. */
  kind?: PluginSettingKind
  /** What the plugin uses when the setting has no value. */
  defaultValue?: string | null
  /** The value is a comma-separated list (several folders or files). */
  multiple?: boolean
  /** The saved value of a setting that is not a secret; always null for a secret. */
  value?: string | null
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
  /** Runs on Node.js, so it needs the plugin runtime (downloaded on demand, see {@link PluginRuntimeInfo}). */
  needsNodeRuntime: boolean
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
  /** Where it was installed from; `local` plugins are never updated from the catalog. */
  source: PluginSource
  /** Who maintains it (from the catalog at install time), or null. */
  publisher: string | null
  /** Its source repository (from the catalog at install time), or null. */
  repositoryUrl: string | null
  /** For a `local` plugin: the folder or archive it was installed from (display only). */
  localPath: string | null
  /** An MCP preset plugin: the server it added to Connections > MCP servers. */
  mcpServer?: McpServerSummary | null
}

export type BrowserRuntimeStatus = 'not_installed' | 'installing' | 'installed'

/** Whether the plugin runtime (Node.js, which plugins run on) is installed. */
export type PluginRuntimeStatus = BrowserRuntimeStatus

/** Where the app's Node.js comes from: `downloaded` in release builds; `development` / `system` only in debug builds. */
export type PluginRuntimeSource = 'downloaded' | 'development' | 'system' | 'missing'

/** Download size of the plugin runtime, shown before the user starts it (the archives are 26-36 MB). */
export function pluginRuntimeDownloadSizeNote(): string {
  return messages().platform.runtimeDownloadSize
}

/**
 * The plugin runtime and browser runtime (`node_runtime_info`). graphrt no longer bundles
 * Node.js: it downloads the pinned official release from nodejs.org the first time the
 * user installs or sets up a plugin, and checks it against a checksum built into the app.
 */
export interface PluginRuntimeInfo {
  status: PluginRuntimeStatus
  /** `node --version` output such as "v22.23.5"; null when missing or it fails to run. */
  version: string | null
  /** The version the app downloads, e.g. "22.23.5". */
  pinnedVersion: string
  path: string | null
  source: PluginRuntimeSource
  /** The downloaded runtime can be removed (Settings). */
  removable: boolean
  /** The app can download Node.js for this computer. */
  downloadable: boolean
  browserStatus: BrowserRuntimeStatus
  browsersPath: string
}

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
 * Payload of the Tauri event `node-runtime-event`: install progress of the browser runtime
 * (`browser_install_*` types, with a `line` of installer output) and of the plugin runtime
 * (`node_install_*` types, with `message` and `percent`). Only those fields are read.
 */
export interface BrowserRuntimeEvent {
  type?: string
  message?: string
  /** One line of the browser installer's output. */
  line?: string
  /** 0 to 100. */
  percent?: number | null
  [field: string]: unknown
}

/** True for a `node-runtime-event` about the plugin runtime (Node.js) rather than the browser. */
export function isPluginRuntimeEvent(runtimeEvent: BrowserRuntimeEvent): boolean {
  return typeof runtimeEvent.type === 'string' && runtimeEvent.type.startsWith('node_install_')
}

/** Tauri event name for {@link BrowserRuntimeEvent}. */
export const BROWSER_RUNTIME_EVENT_NAME = 'node-runtime-event'
