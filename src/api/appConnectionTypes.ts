/**
 * A card on the Connections screen (21): an app account or an AI model provider.
 */

export type ConnectionCategory = 'apps' | 'models'

/**
 * - connected: working, shows a green status
 * - default: the default AI model (connected, drawn with a dark 2px border)
 * - signedOut: needs the user to sign in again (red)
 * - available: not set up yet, shows a Connect / Add key button
 */
export type ConnectionState = 'connected' | 'default' | 'signedOut' | 'available'

export interface Connection {
  id: string
  name: string
  category: ConnectionCategory
  state: ConnectionState
  /** Label shown top-right when connected, e.g. "Connected" or "Found on this computer". */
  connectedLabel: string
  /** Second line while connected or signed out. */
  connectedDescription: string
  /** Second line and button label while not set up yet. */
  availableDescription: string
  /** Shown on the setup button ("Connect", "Add key"), in the UI language. */
  setupActionLabel: string
}
