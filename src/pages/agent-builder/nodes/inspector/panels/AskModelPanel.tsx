import type { JsonValue, NodeConfig } from '@/api/agentGraphTypes'
import { isJsonObject, readConfigFlag, readConfigList, readConfigNumber, readConfigObject, readConfigText, readConfigValue, writeConfigValue, type JsonObject } from '../configPaths'
import { AddButton, Field, hintClassName, InspectorSection, NumberInput, RadioCards, RemoveButton, SelectInput, TextInput, ToggleRow } from '../fields'
import { useInspector } from '../InspectorContext'
import { ModelField } from '../ModelField'
import { readSelector } from '../references'
import { SchemaPropertyField } from '../SchemaForm'
import { SelectorField } from '../SelectorField'
import { TemplateField } from '../TemplateField'

/**
 * Ask a model (`llm`, spec B13 + B16): model with temperature and max tokens, messages
 * (`prompt_template: [{role, text}]`), knowledge (`context`), images (`vision`),
 * conversation memory (`memory.window`), structured output
 * (`structured_output_enabled` + `structured_output.schema`) and how thinking shows
 * (`reasoning_format`: tagged | separated).
 */

const roleOptions = [
  { value: 'system', label: 'System' },
  { value: 'user', label: 'User' },
  { value: 'assistant', label: 'Assistant' },
]

/** `prompt_template` as a list (graphrt also accepts one message object). */
export function readPromptMessages(config: NodeConfig): JsonObject[] {
  const raw = config.prompt_template
  if (isJsonObject(raw)) return [raw]
  return readConfigList(config, ['prompt_template']).filter(isJsonObject)
}

function MessagesEditor() {
  const { node, readOnly, setConfigValue } = useInspector()
  const messages = readPromptMessages(node.config)
  const write = (next: JsonObject[], what: string) => setConfigValue(['prompt_template'], next, what)
  return (
    <div className="flex flex-col gap-3">
      {messages.map((message, index) => {
        const role = readConfigText(message, ['role']) || 'user'
        return (
          <div key={index} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <SelectInput ariaLabel={`Message ${index + 1} role`} className="w-32" value={role} disabled={readOnly} options={roleOptions} onChange={(nextRole) => write(messages.map((item, itemIndex) => (itemIndex === index ? { ...item, role: nextRole } : item)), 'changed a message role')} />
              <span className="ml-auto">
                <RemoveButton label={`Remove message ${index + 1}`} disabled={readOnly} onClick={() => write(messages.filter((_unused, itemIndex) => itemIndex !== index), 'removed a message')} />
              </span>
            </div>
            <TemplateField
              label={roleOptions.find((option) => option.value === role)?.label ?? role}
              ariaLabel={`Message ${index + 1}`}
              multiline
              required={index === messages.length - 1 && role === 'user'}
              value={readConfigText(message, ['text'])}
              onCommit={(text) => write(messages.map((item, itemIndex) => (itemIndex === index ? { ...item, text } : item)), 'changed the prompt')}
            />
          </div>
        )
      })}
      {messages.length === 0 && <p className="m-0 text-[12px] text-danger">Add at least one message for the model.</p>}
      <AddButton disabled={readOnly} onClick={() => write([...messages, { role: messages.length === 0 ? 'system' : 'user', text: '' }], 'added a message')}>
        Add a message (system, user or assistant)
      </AddButton>
    </div>
  )
}

const structuredTypes = [
  { value: 'string', label: 'text' },
  { value: 'number', label: 'number' },
  { value: 'integer', label: 'whole number' },
  { value: 'boolean', label: 'yes/no' },
  { value: 'object', label: 'object' },
  { value: 'array', label: 'list' },
]

function StructuredOutputEditor() {
  const { node, readOnly, updateConfig } = useInspector()
  const isEnabled = readConfigFlag(node.config, ['structured_output_enabled'], readConfigFlag(node.config, ['structured_output', 'enabled']))
  const schema = readConfigObject(node.config, ['structured_output', 'schema'])
  const properties = readConfigObject(schema, ['properties'])
  const required = readConfigList(schema, ['required']).filter((name): name is string => typeof name === 'string')
  const writeSchema = (nextSchema: JsonObject, what: string) => updateConfig((config) => writeConfigValue(config, ['structured_output', 'schema'], nextSchema), what)
  const writeProperties = (nextProperties: JsonObject, nextRequired: string[], what: string) => writeSchema({ ...schema, type: 'object', properties: nextProperties, required: nextRequired }, what)
  const renameField = (oldName: string, newName: string) => {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === oldName || trimmed in properties) return
    const renamed = Object.fromEntries(Object.entries(properties).map(([name, property]) => (name === oldName ? [trimmed, property] : [name, property])))
    writeProperties(renamed, required.map((name) => (name === oldName ? trimmed : name)), `renamed field ${oldName}`)
  }
  const setEnabled = (enabled: boolean) =>
    updateConfig((config) => {
      const withFlag = writeConfigValue(config, ['structured_output_enabled'], enabled)
      return readConfigValue(config, ['structured_output']) === undefined && !enabled ? withFlag : writeConfigValue(withFlag, ['structured_output', 'enabled'], enabled)
    }, enabled ? 'turned on structured output' : 'turned off structured output')
  return (
    <div className="flex flex-col gap-2">
      <ToggleRow label="Structured output" description="Return fields instead of text" checked={isEnabled} disabled={readOnly} onChange={setEnabled} />
      {isEnabled && (
        <div className="flex flex-col gap-1.5 rounded-[10px] border border-line p-2">
          {Object.entries(properties).map(([name, property]) => {
            const propertyObject = isJsonObject(property) ? property : {}
            return (
              <div key={name} className="flex flex-col gap-1 border-b border-chip pb-1.5 last:border-b-0">
                <div className="grid grid-cols-[minmax(0,1fr)_96px_24px] items-center gap-1.5">
                  <TextInput ariaLabel={`Field ${name} name`} monospace value={name} disabled={readOnly} onCommit={(newName) => renameField(name, newName)} />
                  <SelectInput ariaLabel={`Field ${name} type`} value={readConfigText(propertyObject, ['type']) || 'string'} disabled={readOnly} options={structuredTypes} onChange={(type) => writeProperties({ ...properties, [name]: { ...propertyObject, type } }, required, `set field ${name} type`)} />
                  <RemoveButton
                    label={`Remove field ${name}`}
                    disabled={readOnly}
                    onClick={() => {
                      const { [name]: _removed, ...rest } = properties
                      writeProperties(rest, required.filter((requiredName) => requiredName !== name), `removed field ${name}`)
                    }}
                  />
                </div>
                <TextInput ariaLabel={`Field ${name} description`} placeholder="What the model should put here" value={readConfigText(propertyObject, ['description'])} disabled={readOnly} onCommit={(description) => writeProperties({ ...properties, [name]: { ...propertyObject, description } }, required, `described field ${name}`)} />
              </div>
            )
          })}
          <AddButton
            disabled={readOnly}
            onClick={() => {
              let index = Object.keys(properties).length + 1
              while (`field_${index}` in properties) index += 1
              writeProperties({ ...properties, [`field_${index}`]: { type: 'string' } }, [...required, `field_${index}`], 'added a structured output field')
            }}
          >
            Add a field
          </AddButton>
          <SchemaPropertyField name="schema" property={{ title: 'Edit as JSON Schema', type: 'object' }} value={schema} required={false} onChange={(value) => writeSchema(isJsonObject(value as JsonValue) ? (value as JsonObject) : {}, 'edited the output schema')} />
        </div>
      )}
    </div>
  )
}

function KnowledgeAndMemory() {
  const { node, readOnly, setConfigValue } = useInspector()
  const config = node.config
  const usesContext = readConfigFlag(config, ['context', 'enabled'])
  const usesVision = readConfigFlag(config, ['vision', 'enabled'])
  const usesMemory = readConfigFlag(config, ['memory', 'window', 'enabled'])
  return (
    <>
      <ToggleRow label="Use knowledge" description="Pass retrieved passages in; {{#context#}} in a message inserts them" checked={usesContext} disabled={readOnly} onChange={(enabled) => setConfigValue(['context', 'enabled'], enabled, enabled ? 'turned on knowledge' : 'turned off knowledge')} />
      {usesContext && <SelectorField label="Knowledge from" path={readSelector(readConfigValue(config, ['context', 'variable_selector']))} onChange={(path) => setConfigValue(['context', 'variable_selector'], path ?? undefined, 'set the knowledge source')} hint="Usually the result of a Knowledge retrieval step" />}
      <ToggleRow label="Images" description="Send image files to models that can see" checked={usesVision} disabled={readOnly} onChange={(enabled) => setConfigValue(['vision', 'enabled'], enabled, enabled ? 'turned on images' : 'turned off images')} />
      {usesVision && (
        <>
          <SelectorField label="Image files" path={readSelector(readConfigValue(config, ['vision', 'variable_selector']))} onChange={(path) => setConfigValue(['vision', 'variable_selector'], path ?? undefined, 'set the image files')} />
          <Field label="Detail">
            <SelectInput ariaLabel="Image detail" value={readConfigText(config, ['vision', 'detail']) || 'auto'} disabled={readOnly} options={['auto', 'low', 'high'].map((detail) => ({ value: detail, label: detail }))} onChange={(detail) => setConfigValue(['vision', 'detail'], detail, 'set the image detail')} />
          </Field>
        </>
      )}
      <ToggleRow label="Remember the conversation" description="Chatbots: include earlier turns" checked={usesMemory} disabled={readOnly} onChange={(enabled) => setConfigValue(['memory', 'window', 'enabled'], enabled, enabled ? 'turned on memory' : 'turned off memory')} />
      {usesMemory && (
        <Field label="Turns to remember">
          <NumberInput ariaLabel="Turns to remember" value={readConfigNumber(config, ['memory', 'window', 'size'])} min={0} max={100} placeholder="all" disabled={readOnly} onCommit={(size) => setConfigValue(['memory', 'window', 'size'], size === null ? undefined : Math.round(size), 'set the memory size')} />
        </Field>
      )}
    </>
  )
}

/** Settings of Ask a model. */
export function AskModelPanel() {
  const { node, readOnly, setConfigValue } = useInspector()
  const reasoningFormat = readConfigText(node.config, ['reasoning_format']) || 'tagged'
  return (
    <>
      <InspectorSection title="Model and messages">
        <ModelField showParams />
        <MessagesEditor />
      </InspectorSection>
      <InspectorSection title="Knowledge, images and memory" defaultOpen={false}>
        <KnowledgeAndMemory />
      </InspectorSection>
      <InspectorSection title="Structured output" defaultOpen={readConfigFlag(node.config, ['structured_output_enabled'])}>
        <StructuredOutputEditor />
      </InspectorSection>
      <InspectorSection title="Thinking" defaultOpen={reasoningFormat === 'separated'}>
        <RadioCards
          legend="Thinking"
          name="reasoning-format"
          value={reasoningFormat}
          disabled={readOnly}
          onChange={(format) => setConfigValue(['reasoning_format'], format, format === 'separated' ? 'showed thinking separately' : 'kept thinking in the answer')}
          options={[
            { value: 'tagged', title: 'Keep it in the answer', description: 'Default (tagged). Thinking stays in text between think tags' },
            { value: 'separated', title: 'Show it separately', description: '(separated) Moves it to the reasoning output; text is only the answer' },
          ]}
        />
        <p className={hintClassName}>The test run shows the thinking folded under the step while it streams, then the answer.</p>
      </InspectorSection>
    </>
  )
}
