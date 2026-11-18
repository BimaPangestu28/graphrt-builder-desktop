/**
 * Mock connections for screen 21: apps, AI model providers and advanced keys/tools
 * the runner uses. Secrets themselves live in macOS Keychain, never here.
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
  /** Label shown top-right when connected, e.g. "Connected" or "Found on this Mac". */
  connectedLabel: string
  /** Second line while connected or signed out. */
  connectedDescription: string
  /** Second line and button label while not set up yet. */
  availableDescription: string
  setupActionLabel: 'Connect' | 'Add key'
}

export const initialConnections: Connection[] = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    category: 'apps',
    state: 'connected',
    connectedLabel: 'Connected',
    connectedDescription: '+62 8•• •••• 1204 · used by 2 agents',
    availableDescription: 'Send and receive messages',
    setupActionLabel: 'Connect',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    category: 'apps',
    state: 'signedOut',
    connectedLabel: 'Connected',
    connectedDescription: 'Used by Morning email digest',
    availableDescription: 'Read and send email',
    setupActionLabel: 'Connect',
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    category: 'apps',
    state: 'connected',
    connectedLabel: 'Connected',
    connectedDescription: 'Used by Lead tracker, Knowledge',
    availableDescription: 'Read and write spreadsheets',
    setupActionLabel: 'Connect',
  },
  {
    id: 'telegram',
    name: 'Telegram',
    category: 'apps',
    state: 'available',
    connectedLabel: 'Connected',
    connectedDescription: 'Not used by any agent yet',
    availableDescription: 'Send and receive messages',
    setupActionLabel: 'Connect',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    category: 'models',
    state: 'default',
    connectedLabel: 'Default',
    connectedDescription: 'Key in Keychain · $0.38 this month',
    availableDescription: 'GPT models',
    setupActionLabel: 'Add key',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    category: 'models',
    state: 'connected',
    connectedLabel: 'Found on this Mac',
    connectedDescription: 'qwen2.5:14b · free, works offline',
    availableDescription: 'Local models',
    setupActionLabel: 'Add key',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    category: 'models',
    state: 'available',
    connectedLabel: 'Connected',
    connectedDescription: 'Key in Keychain · not used yet',
    availableDescription: 'Claude models',
    setupActionLabel: 'Add key',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    category: 'models',
    state: 'available',
    connectedLabel: 'Connected',
    connectedDescription: 'Key in Keychain · not used yet',
    availableDescription: 'Gemini models',
    setupActionLabel: 'Add key',
  },
]

export interface AdvancedConnection {
  id: string
  name: string
  description: string
  /**
   * A static "Connected" status, a Manage button (to Settings), or the plugins row whose
   * Manage button opens the Plugins panel (its installed count comes from the backend).
   */
  kind: 'status' | 'manage' | 'plugins'
}

export const advancedConnections: AdvancedConnection[] = [
  { id: 'google-places', name: 'Google Places API key', description: 'Used by Maps leads to WhatsApp', kind: 'status' },
  { id: 'mcp-servers', name: 'MCP servers', description: 'Give agents tools from any MCP server · 1 added', kind: 'manage' },
  { id: 'plugins', name: 'Plugins', description: 'Steps written in Python, TypeScript, Rust or WebAssembly', kind: 'plugins' },
]

export const connectionCategoryTitles: Record<ConnectionCategory, string> = {
  apps: 'Apps',
  models: 'AI models',
}
