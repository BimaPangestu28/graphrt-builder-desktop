/**
 * Connections, Secrets and MCP servers tabs: workflow secrets across every agent and MCP servers.
 * Mirrors `src-tauri/src/workflow_secrets.rs` and `src-tauri/src/mcp/definitions.rs`.
 */

/** An agent whose workflow declares a secret. */
export interface SecretAgentUse {
  agentId: string
  agentName: string
}

/** One `env.*` name across every agent and MCP server. Values are never sent to the UI. */
export interface WorkflowSecretOverview {
  name: string
  description: string | null
  isSecret: boolean
  /** Some agent or MCP server cannot run without it. */
  required: boolean
  configured: boolean
  agents: SecretAgentUse[]
  /** Names of the MCP servers that need it. */
  mcpServers: string[]
  /** The user's note, for a secret saved in the app. */
  note: string | null
  /** RFC 3339 time of the first save in the app; null when not recorded. */
  createdAt: string | null
  /** RFC 3339 time of the latest save in the app; null when not recorded. */
  updatedAt: string | null
}

/** A secret the user adds themselves (Connections, Secrets tab, Add secret). */
export interface NewWorkflowSecret {
  /** UPPER_SNAKE_CASE, 1–64 characters, e.g. `MY_SERVER_TOKEN`. */
  name: string
  value: string
  note: string | null
}

/** How the app reaches an MCP server: a local command (stdio) or a URL (Streamable HTTP). */
export type McpServerTransport = { kind: 'stdio'; command: string; args: string[] } | { kind: 'http'; url: string }

export interface McpToolInfo {
  name: string
  description: string
  /** JSON Schema of the tool's arguments from the last connection test; absent for older checks. */
  inputSchema?: Record<string, unknown>
}

/** Outcome of the latest "Test connection". */
export interface McpConnectionCheck {
  connected: boolean
  error: string | null
  /** RFC 3339 time of the check. */
  checkedAt: string
}

/** How the app authenticates to a URL server: nothing, a bearer token secret, or OAuth sign-in in the browser. */
export type McpAuthKind = 'none' | 'bearer' | 'oauth'

/** What the user enters to add a server. */
export interface McpServerInput {
  /** Provider id agents use: `<name>/<tool>`. Lowercase letters, digits, - and _. */
  name: string
  transport: McpServerTransport
  /** Workflow secrets passed to a command server as environment variables. */
  secretEnv: string[]
  /** Workflow secret sent as the bearer token to a URL server. */
  bearerTokenSecret: string | null
  /** Omitted: `bearer` when a bearer secret is named, else `none`. */
  auth?: McpAuthKind
}

/** Which tools run without the user approving each call. */
export interface McpApprovalPolicy {
  /** From an MCP preset plugin: tools (names or `prefix*`) that only read. */
  readOnly?: string[]
  /** From an MCP preset plugin: tools that always ask first. */
  askFirst?: string[]
  /** From an MCP preset plugin: every tool no pattern matches asks first. */
  defaultAsks?: boolean
  /** Tools the user lets run without asking. */
  withoutApproval?: string[]
}

/** Sign-in state of an OAuth server. */
export type McpSignInStatus =
  | { state: 'signedOut' }
  | { state: 'signedIn'; signedInAt: string | null }
  | { state: 'expired'; reason: string }

/** A stored server with what its last check found. */
export interface McpServerDefinition extends McpServerInput {
  /** The MCP preset plugin that added it (removed with the plugin). */
  plugin?: string
  approval?: McpApprovalPolicy
  knownTools: McpToolInfo[]
  lastCheck: McpConnectionCheck | null
  /** Sign-in state, for `auth: 'oauth'` servers only. */
  signIn?: McpSignInStatus | null
  /** For each known tool, whether a run asks before calling it (the server's approval policy). */
  toolApprovals?: McpToolApproval[]
}

export interface McpToolApproval {
  name: string
  asksFirst: boolean
}


/** App version and data folder (Settings > Privacy and data, About). */
export interface AppInfo {
  version: string
  /** Absolute path of the data folder. */
  dataFolderPath: string
  /** Shown after the version, e.g. "up to date"; null when the app cannot know. */
  updateStatus: string | null
}
