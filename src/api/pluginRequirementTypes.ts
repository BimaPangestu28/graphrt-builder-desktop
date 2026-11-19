/**
 * What an agent's workflow needs from graphrt plugins, shown inside the build chat so the
 * user approves, installs and configures plugins right where the agent is being built.
 * Mirrors `plugins::requirements::PluginRequirement` in the backend.
 */
export interface PluginRequirement {
  /** Plugin name, e.g. "whatsapp-api". */
  name: string
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
  /** Installed, trusted if needed, settings set and browser ready: the agent can run. */
  ready: boolean
}
