import type { ComponentType } from 'react'
import type { GraphNode, NodeKindInfo } from '@/api/agentGraphTypes'
import { isJsonObject, type JsonObject } from './configPaths'
import { InspectorSection } from './fields'
import { useInspector } from './InspectorContext'
import { ClassifierPanel, KnowledgeRetrievalPanel, ParameterExtractorPanel } from './panels/AiStepPanels'
import { AskModelPanel } from './panels/AskModelPanel'
import { AgentPanel, HttpRequestPanel, ToolPanel } from './panels/ConnectPanels'
import { AggregatorPanel, AnswerPanel, AssignerPanel, EndPanel, ListOperatorPanel, TemplateTransformPanel } from './panels/DataPanels'
import { HumanInputPanel, IfElsePanel, IterationPanel, LoopPanel } from './panels/FlowPanels'
import { PluginActionPanel } from './panels/PluginActionPanel'
import { SchemaForm, SchemaPropertyField, schemaProperties } from './SchemaForm'

/**
 * Which settings panel a node gets: a dedicated one per builtin kind (spec B4–B17), the
 * plugin action panel for plugin kinds, else the generic schema form.
 */

const dedicatedPanels: Record<string, ComponentType> = {
  llm: AskModelPanel,
  'parameter-extractor': ParameterExtractorPanel,
  'knowledge-retrieval': KnowledgeRetrievalPanel,
  'question-classifier': ClassifierPanel,
  'if-else': IfElsePanel,
  iteration: IterationPanel,
  loop: LoopPanel,
  'human-input': HumanInputPanel,
  'http-request': HttpRequestPanel,
  agent: AgentPanel,
  tool: ToolPanel,
  assigner: AssignerPanel,
  'list-operator': ListOperatorPanel,
  'template-transform': TemplateTransformPanel,
  'variable-aggregator': AggregatorPanel,
  answer: AnswerPanel,
  end: EndPanel,
}

/** `variable-assigner` acts as Combine results when its config has `variables` (graphrt detects by shape). */
function variableAssignerPanel(node: GraphNode): ComponentType {
  return 'variables' in node.config || 'advanced_settings' in node.config ? AggregatorPanel : AssignerPanel
}

/** Any kind without a dedicated panel: its schema form, or each config key when it has no schema. */
export function GenericSettingsPanel() {
  const { node, kindInfo, setConfigValue } = useInspector()
  const hasSchema = schemaProperties(kindInfo?.configSchema).length > 0
  return (
    <InspectorSection title="Settings">
      {hasSchema || Object.keys(node.config).length === 0 ? (
        <SchemaForm schema={kindInfo?.configSchema} config={node.config as JsonObject} onChange={(name, value) => setConfigValue([name], value, `set ${name}`)} />
      ) : (
        Object.entries(node.config).map(([name, value]) => (
          <SchemaPropertyField key={name} name={name} property={typeof value === 'string' ? { type: 'string' } : isJsonObject(value) || Array.isArray(value) ? {} : { type: typeof value }} value={value} required={false} onChange={(next) => setConfigValue([name], next, `set ${name}`)} />
        ))
      )}
    </InspectorSection>
  )
}

/** The panel component for a node. */
export function pickSettingsPanel(node: GraphNode, kindInfo: NodeKindInfo | null): ComponentType {
  if (node.kind === 'variable-assigner') return variableAssignerPanel(node)
  if (dedicatedPanels[node.kind]) return dedicatedPanels[node.kind]
  if (kindInfo?.plugin || node.plugin) return PluginActionPanel
  return GenericSettingsPanel
}
