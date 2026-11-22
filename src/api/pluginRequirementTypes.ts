/**
 * What an agent's workflow needs from graphrt plugins, shown inside the build chat so the
 * user approves, installs and configures plugins right where the agent is being built.
 * Mirrors `plugins::requirements::PluginRequirement` in the backend.
 */
/** Last known state of a session plugin's account (`check_plugin_session`). */
export type PluginSessionState = 'linked' | 'not_linked' | 'unknown'

export interface PluginRequirement {
  /** Plugin name, e.g. "whatsapp-api". */
  name: string
  /** What people see, e.g. "WhatsApp Cloud API" (curated, else the humanized name). */
  displayName: string
  /** Catalog description. */
  description: string
  /** Step titles of this agent that use the plugin, e.g. ["Send the promotion message"]. */
  usedBySteps: string[]
  /** What the plugin asks for; shown before installing. */
  permissions: { network: boolean; secrets: boolean; env: string[] }
  /** Needs Chromium (Playwright plugins such as google-maps-scraper, whatsapp-web). */
  needsBrowser: boolean
  /** The ToS / ban warning from the plugin's README, when it has one (e.g. whatsapp-web). */
  warning: string | null
  installed: boolean
  /** Only meaningful when installed; plugins that ask for secrets must be trusted to work. */
  trusted: boolean
  /** True when the plugin asks for no secrets, so trusting it is not needed. */
  trustNotNeeded: boolean
  /** Requested settings (env vars) that have no value yet. */
  missingConfig: string[]
  /** Chromium installed (always true when not needed). */
  browserReady: boolean
  /** Runs on Node.js, so it needs the plugin runtime (true for every catalog plugin). */
  needsNodeRuntime: boolean
  /** The plugin runtime is installed (always true when not needed). */
  nodeRuntimeReady: boolean
  /** Only works with a linked account session (whatsapp-web: linked by scanning a QR code). */
  needsSession: boolean
  /** The session is known to be linked (always true when not needed). Never checked counts as not linked. */
  sessionLinked: boolean
  /** Installed, trusted if needed, settings set, runtimes ready and session linked: the agent can run. */
  ready: boolean
}
