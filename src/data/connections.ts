import { getCredentialStoreShortName } from '@/lib/platform'

/**
 * Connection shapes for screen 21 and the AI model card templates (names and descriptions;
 * their state comes from the backend). Sample app accounts live in
 * `api/sampleBackend/appConnections.ts`. Secrets themselves live in the OS credential store (macOS Keychain, Windows Credential Manager, Secret Service on Linux), never here.
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
  setupActionLabel: 'Connect' | 'Add key'
}

export const initialConnections: Connection[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    category: 'models',
    state: 'default',
    connectedLabel: 'Default',
    connectedDescription: `Key in ${getCredentialStoreShortName()} · $0.38 this month`,
    availableDescription: 'GPT models',
    setupActionLabel: 'Add key',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    category: 'models',
    state: 'connected',
    connectedLabel: 'Found on this computer',
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
    connectedDescription: `Key in ${getCredentialStoreShortName()} · not used yet`,
    availableDescription: 'Claude models',
    setupActionLabel: 'Add key',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    category: 'models',
    state: 'available',
    connectedLabel: 'Connected',
    connectedDescription: `Key in ${getCredentialStoreShortName()} · not used yet`,
    availableDescription: 'Gemini models',
    setupActionLabel: 'Add key',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    category: 'models',
    state: 'available',
    connectedLabel: 'Connected',
    connectedDescription: `Key in ${getCredentialStoreShortName()} · not used yet`,
    availableDescription: 'DeepSeek V3 and R1 (deepseek-chat, deepseek-reasoner)',
    setupActionLabel: 'Add key',
  },
]

export interface AdvancedConnection {
  id: string
  name: string
  description: string
  /**
   * Which panel the row's Manage button opens: MCP servers or plugins. Both show a live
   * count from the backend after the description.
   */
  kind: 'mcp' | 'plugins'
}

/** The fixed rows under Advanced; the Secrets list above them comes from the backend. */
export const advancedConnections: AdvancedConnection[] = [
  { id: 'mcp-servers', name: 'MCP servers', description: 'Give agents tools from any MCP server', kind: 'mcp' },
  { id: 'plugins', name: 'Plugins', description: 'Steps written in Python, TypeScript, Rust or WebAssembly', kind: 'plugins' },
]

export const connectionCategoryTitles: Record<ConnectionCategory, string> = {
  apps: 'Apps',
  models: 'AI models',
}
