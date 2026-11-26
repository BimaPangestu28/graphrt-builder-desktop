import { getCredentialStoreShortName } from '@/lib/platform'
import { messages } from '@/i18n'
import { localizedRecord } from '@/i18n/localized'

/**
 * The AI model cards of screen 21: names and descriptions per provider (their state comes from
 * the backend), and the section titles. Sample app accounts live in
 * `api/sampleBackend/appConnections.ts`. Secrets themselves live in the OS credential store
 * (macOS Keychain, Windows Credential Manager, Secret Service on Linux), never here.
 */
import type { Connection, ConnectionCategory } from '@/api/appConnectionTypes'
/** The cards in the current language (call it when rendering, not at module load). */
export function listModelCardTemplates(): Connection[] {
  return [
  {
    id: 'openai',
    name: 'OpenAI',
    category: 'models',
    state: 'default',
    connectedLabel: messages().connections.default,
    connectedDescription: messages().connections.keyInCredentialstoreshortname038This(getCredentialStoreShortName()),
    availableDescription: messages().connections.gptModels,
    setupActionLabel: messages().connections.addKey,
  },
  {
    id: 'ollama',
    name: 'Ollama',
    category: 'models',
    state: 'connected',
    connectedLabel: messages().connections.foundOnThisComputer,
    connectedDescription: messages().connections.qwen2514bFreeWorksOffline,
    availableDescription: messages().connections.localModels,
    setupActionLabel: messages().connections.addKey,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    category: 'models',
    state: 'available',
    connectedLabel: messages().connections.connected,
    connectedDescription: messages().connections.keyInCredentialstoreshortnameNotUsedYet(getCredentialStoreShortName()),
    availableDescription: messages().connections.claudeModels,
    setupActionLabel: messages().connections.addKey,
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    category: 'models',
    state: 'available',
    connectedLabel: messages().connections.connected,
    connectedDescription: messages().connections.keyInCredentialstoreshortnameNotUsedYet(getCredentialStoreShortName()),
    availableDescription: messages().connections.geminiModels,
    setupActionLabel: messages().connections.addKey,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    category: 'models',
    state: 'available',
    connectedLabel: messages().connections.connected,
    connectedDescription: messages().connections.keyInCredentialstoreshortnameNotUsedYet(getCredentialStoreShortName()),
    availableDescription: messages().connections.deepseekV3AndR1DeepseekChat,
    setupActionLabel: messages().connections.addKey,
  },
  {
    id: 'claude-code-cli',
    name: 'Claude Code (on this computer)',
    category: 'models',
    state: 'available',
    connectedLabel: messages().connections.turnedOn,
    connectedDescription: messages().connections.usesYourClaudeCodeSignIn,
    availableDescription: messages().connections.yourSignedInClaudeCodeApp,
    setupActionLabel: messages().connections.connect,
  },
  {
    id: 'codex-cli',
    name: 'Codex (on this computer)',
    category: 'models',
    state: 'available',
    connectedLabel: messages().connections.turnedOn,
    connectedDescription: messages().connections.usesYourCodexSignIn,
    availableDescription: messages().connections.yourSignedInCodexApp,
    setupActionLabel: messages().connections.connect,
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI (on this computer)',
    category: 'models',
    state: 'available',
    connectedLabel: messages().connections.turnedOn,
    connectedDescription: messages().connections.usesYourGeminiCliSignIn,
    availableDescription: messages().connections.yourSignedInGeminiCliApp,
    setupActionLabel: messages().connections.connect,
  },
  {
    id: 'cursor-cli',
    name: 'Cursor CLI (on this computer)',
    category: 'models',
    state: 'available',
    connectedLabel: messages().connections.turnedOn,
    connectedDescription: messages().connections.usesYourCursorCliSignIn,
    availableDescription: messages().connections.yourSignedInCursorCliApp,
    setupActionLabel: messages().connections.connect,
  },
  {
    id: 'copilot-cli',
    name: 'GitHub Copilot CLI (on this computer)',
    category: 'models',
    state: 'available',
    connectedLabel: messages().connections.turnedOn,
    connectedDescription: messages().connections.usesYourGithubCopilotCliSign,
    availableDescription: messages().connections.yourSignedInGithubCopilotCli,
    setupActionLabel: messages().connections.connect,
  },
  {
    id: 'opencode-cli',
    name: 'OpenCode (on this computer)',
    category: 'models',
    state: 'available',
    connectedLabel: messages().connections.turnedOn,
    connectedDescription: messages().connections.usesYourOpencodeSignIn,
    availableDescription: messages().connections.yourSignedInOpencodeApp,
    setupActionLabel: messages().connections.connect,
  },
  {
    id: 'qwen-code-cli',
    name: 'Qwen Code (on this computer)',
    category: 'models',
    state: 'available',
    connectedLabel: messages().connections.turnedOn,
    connectedDescription: messages().connections.usesYourQwenCodeSignIn,
    availableDescription: messages().connections.yourSignedInQwenCodeApp,
    setupActionLabel: messages().connections.connect,
  },
]
}

export const connectionCategoryTitles: Readonly<Record<ConnectionCategory, string>> = localizedRecord(() => messages().connections.categoryTitles)
