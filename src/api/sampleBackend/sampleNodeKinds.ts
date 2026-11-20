import type { ExitRule, NodeKindGroup, NodeKindInfo, NodeKindOutput, NodeKindPlugin } from '../agentGraphTypes'

/**
 * The node library the sample backend returns: the desktop's builtin kinds (named as
 * the app names them) plus two installed plugins and one catalog plugin, in the
 * order `get_node_kinds` lists them. Config schemas are trimmed to the main fields.
 */

interface SampleKind {
  kind: string
  displayName: string
  group: NodeKindGroup
  description: string
  outputs?: Array<[name: string, valueType: string]>
  exits?: ExitRule
  configPath?: string
  required?: string[]
  properties?: Record<string, unknown>
  container?: boolean
  offered?: boolean
  sendsData?: boolean
  plugin?: NodeKindPlugin
}

function output([name, valueType]: [string, string]): NodeKindOutput {
  return { name, valueType, description: '', streaming: false }
}

function kindInfo(sample: SampleKind): NodeKindInfo {
  const hasInput = !['start', 'iteration-start', 'loop-start'].includes(sample.kind)
  return {
    kind: sample.kind,
    displayName: sample.displayName,
    group: sample.group,
    description: sample.description,
    icon: null,
    configSchema: { type: 'object', properties: sample.properties ?? {}, required: sample.required ?? [] },
    outputs: (sample.outputs ?? []).map(output),
    dynamicOutputs: false,
    ports: { hasInput, exits: sample.exits ?? 'single', fixedHandles: [], configPath: sample.configPath ?? null },
    container: sample.container ?? false,
    offered: sample.offered ?? true,
    sendsData: sample.sendsData ?? false,
    source: sample.plugin ? `plugin:${sample.plugin.name}` : 'builtin',
    plugin: sample.plugin ?? null,
  }
}

const googleMaps: NodeKindPlugin = { name: 'google-maps-scraper', displayName: 'Google Maps Scraper', installed: true }
const whatsAppWeb: NodeKindPlugin = { name: 'whatsapp-web', displayName: 'WhatsApp Web', installed: true }
const telegramBot: NodeKindPlugin = { name: 'telegram-bot', displayName: 'Telegram Bot', installed: false }

const sampleKinds: SampleKind[] = [
  { kind: 'start', displayName: 'Start', group: 'start-and-finish', description: 'Where a run begins. Checks the run inputs and passes them on', properties: { variables: { type: 'array' } } },
  { kind: 'end', displayName: 'End', group: 'start-and-finish', description: 'Collects the values the app shows after a run', exits: 'none', properties: { outputs: { type: 'array' } } },
  { kind: 'answer', displayName: 'Reply', group: 'start-and-finish', description: 'Writes the reply a chatbot sends, with values filled in', outputs: [['answer', 'string'], ['files', 'array[file]']], required: ['answer'] },
  { kind: 'llm', displayName: 'Ask a model', group: 'ai', description: 'Sends a prompt to a model; can return structured fields', outputs: [['text', 'string'], ['structured_output', 'object'], ['usage', 'object']], required: ['model'], properties: { model: { type: 'object' }, prompt_template: { type: 'array' } } },
  { kind: 'agent', displayName: 'Run an agent', group: 'ai', description: 'A model that can call tools in a loop, optionally asking you first', outputs: [['text', 'string'], ['tool_calls', 'array[object]'], ['iterations', 'integer']], required: ['model'] },
  { kind: 'question-classifier', displayName: 'Sort into categories', group: 'ai', description: 'The model picks one category; one port per category', outputs: [['class_id', 'string'], ['class_name', 'string']], exits: 'dynamic', configPath: 'classes[].id', required: ['model', 'classes'] },
  { kind: 'parameter-extractor', displayName: 'Pull out details', group: 'ai', description: 'The model fills named fields from text', outputs: [['__is_success', 'boolean']], required: ['model'] },
  { kind: 'knowledge-retrieval', displayName: 'Knowledge retrieval', group: 'ai', description: 'Searches your knowledge bases', outputs: [['result', 'array[object]']] },
  { kind: 'http-request', displayName: 'HTTP request', group: 'connect', description: 'Calls a web address; private networks are blocked', outputs: [['status_code', 'integer'], ['body', 'string'], ['json', 'any'], ['headers', 'object']], required: ['url'], properties: { method: { type: 'string' }, url: { type: 'string' } } },
  { kind: 'tool', displayName: 'Use a tool', group: 'connect', description: 'Runs one tool, or another of your agents', outputs: [['text', 'string'], ['json', 'any'], ['is_error', 'boolean']], required: ['provider_id', 'tool_name'] },
  { kind: 'if-else', displayName: 'Check a condition', group: 'decide-and-wait', description: 'Takes the first case that matches, else the Else port', outputs: [['result', 'boolean'], ['selected_case_id', 'string']], exits: 'dynamic', configPath: 'cases[].case_id + "false"' },
  { kind: 'human-input', displayName: 'Ask me before continuing', group: 'decide-and-wait', description: 'Pauses with a form; each button is a port (default: submit)', outputs: [['action', 'string']], exits: 'dynamic', configPath: 'actions[].id (default: submit)' },
  { kind: 'iteration', displayName: 'For each item', group: 'repeat', description: 'Runs the steps inside once per list item', outputs: [['output', 'array[any]'], ['errors', 'array[object]']], container: true, required: ['iterator_selector'] },
  { kind: 'loop', displayName: 'Repeat', group: 'repeat', description: 'Repeats the steps inside until a condition holds or N rounds', outputs: [['loop_round', 'integer']], container: true },
  { kind: 'loop-end', displayName: 'Stop repeating', group: 'repeat', description: 'Inside Repeat: ends it after this round', exits: 'none' },
  { kind: 'template-transform', displayName: 'Format text', group: 'data', description: 'Fills a text template (Jinja) with values', outputs: [['output', 'string']], required: ['template'] },
  { kind: 'list-operator', displayName: 'Filter a list', group: 'data', description: 'Filters, sorts, picks and limits list items', outputs: [['result', 'array[any]'], ['first_record', 'any'], ['last_record', 'any']], required: ['variable'] },
  { kind: 'variable-aggregator', displayName: 'Combine results', group: 'data', description: 'Takes the first value that is set, e.g. after a branch', outputs: [['output', 'any']] },
  { kind: 'assigner', displayName: 'Remember a value', group: 'data', description: 'Writes a loop or conversation value (not secrets)' },
  { kind: 'variable-assigner', displayName: 'Remember a value', group: 'data', description: 'Assigner or Combine results, by config shape', offered: false },
  { kind: 'google-maps-scraper.search', displayName: 'Google Maps search', group: 'plugin', description: 'Searches Google Maps and returns places with their phone numbers', outputs: [['results', 'any'], ['phones', 'any'], ['count', 'any']], required: ['query'], properties: { query: { type: 'string' }, max_results: { type: 'integer' } }, plugin: googleMaps },
  { kind: 'whatsapp-web.get_status', displayName: 'WhatsApp status', group: 'plugin', description: 'Whether WhatsApp is linked on this computer', outputs: [['linked', 'any']], plugin: whatsAppWeb },
  { kind: 'whatsapp-web.send_message', displayName: 'Send WhatsApp message', group: 'plugin', description: 'Sends a WhatsApp message from your own number', outputs: [['data', 'any']], required: ['phone', 'text'], sendsData: true, plugin: whatsAppWeb },
  { kind: 'telegram-bot.send_message', displayName: 'Send Telegram message', group: 'plugin', description: 'Sends a message from your Telegram bot', outputs: [['message_id', 'any']], required: ['chat_id', 'text'], sendsData: true, plugin: telegramBot },
  { kind: 'iteration-start', displayName: 'Iteration Start', group: 'hidden', description: 'Entry marker of an iteration body', offered: false },
  { kind: 'loop-start', displayName: 'Loop Start', group: 'hidden', description: 'Entry marker of a loop body', offered: false },
]

export const sampleNodeKinds: NodeKindInfo[] = sampleKinds.map(kindInfo)
