import type { JsonValue, NodeConfig } from '@/api/agentGraphTypes'
import { isJsonObject, readConfigFlag, readConfigList, readConfigNumber, readConfigObject, readConfigText, readConfigValue, writeConfigValue, type JsonObject } from '../configPaths'
import { AddButton, Field, hintClassName, InspectorSection, NumberInput, RadioCards, RemoveButton, SelectInput, TextInput, ToggleRow } from '../fields'
import { useInspector } from '../InspectorContext'
import { ModelField } from '../ModelField'
import { readSelector } from '../references'
import { SchemaPropertyField } from '../SchemaForm'
import { SelectorField } from '../SelectorField'
import { TemplateField } from '../TemplateField'
import { messages as currentMessages } from '@/i18n'
import { withLocalizedLabels } from '@/i18n/localized'

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
      {messages.length === 0 && <p className="m-0 text-[12px] text-danger">{currentMessages().nodes.addAtLeastOneMessageFor}</p>}
      <AddButton disabled={readOnly} onClick={() => write([...messages, { role: messages.length === 0 ? 'system' : 'user', text: '' }], currentMessages().nodes.addedAMessage)}>
        {currentMessages().nodes.addAMessageSystemUserOr}
      </AddButton>
    </div>
  )
}

const structuredTypes = withLocalizedLabels([
  { value: 'string' },
  { value: 'number' },
  { value: 'integer' },
  { value: 'boolean' },
  { value: 'object' },
  { value: 'array' },
], (option) => currentMessages().nodes.valueTypes[option.value] ?? option.value)

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
    writeProperties(renamed, required.map((name) => (name === oldName ? trimmed : name)), currentMessages().nodes.renamedFieldOldname(oldName))
  }
  const setEnabled = (enabled: boolean) =>
    updateConfig((config) => {
      const withFlag = writeConfigValue(config, ['structured_output_enabled'], enabled)
      return readConfigValue(config, ['structured_output']) === undefined && !enabled ? withFlag : writeConfigValue(withFlag, ['structured_output', 'enabled'], enabled)
    }, enabled ? currentMessages().nodes.turnedOnStructuredOutput : currentMessages().nodes.turnedOffStructuredOutput)
  return (
    <div className="flex flex-col gap-2">
      <ToggleRow label={currentMessages().nodes.structuredOutput} description={currentMessages().nodes.returnFieldsInsteadOfText} checked={isEnabled} disabled={readOnly} onChange={setEnabled} />
      {isEnabled && (
        <div className="flex flex-col gap-1.5 rounded-[10px] border border-line p-2">
          {Object.entries(properties).map(([name, property]) => {
            const propertyObject = isJsonObject(property) ? property : {}
            return (
              <div key={name} className="flex flex-col gap-1 border-b border-chip pb-1.5 last:border-b-0">
                <div className="grid grid-cols-[minmax(0,1fr)_96px_24px] items-center gap-1.5">
                  <TextInput ariaLabel={currentMessages().nodes.fieldNameName(name)} monospace value={name} disabled={readOnly} onCommit={(newName) => renameField(name, newName)} />
                  <SelectInput ariaLabel={currentMessages().nodes.fieldNameType(name)} value={readConfigText(propertyObject, ['type']) || 'string'} disabled={readOnly} options={structuredTypes} onChange={(type) => writeProperties({ ...properties, [name]: { ...propertyObject, type } }, required, currentMessages().nodes.setFieldNameType(name))} />
                  <RemoveButton
                    label={currentMessages().nodes.removeFieldName(name)}
                    disabled={readOnly}
                    onClick={() => {
                      const { [name]: _removed, ...rest } = properties
                      writeProperties(rest, required.filter((requiredName) => requiredName !== name), currentMessages().nodes.removedFieldName(name))
                    }}
                  />
                </div>
                <TextInput ariaLabel={currentMessages().nodes.fieldNameDescription(name)} placeholder={currentMessages().nodes.whatTheModelShouldPutHere} value={readConfigText(propertyObject, ['description'])} disabled={readOnly} onCommit={(description) => writeProperties({ ...properties, [name]: { ...propertyObject, description } }, required, currentMessages().nodes.describedFieldName(name))} />
              </div>
            )
          })}
          <AddButton
            disabled={readOnly}
            onClick={() => {
              let index = Object.keys(properties).length + 1
              while (`field_${index}` in properties) index += 1
              writeProperties({ ...properties, [`field_${index}`]: { type: 'string' } }, [...required, `field_${index}`], currentMessages().nodes.addedAStructuredOutputField)
            }}
          >
            {currentMessages().nodes.addAField}
          </AddButton>
          <SchemaPropertyField name="schema" property={{ title: currentMessages().nodes.editAsJsonSchema, type: 'object' }} value={schema} required={false} onChange={(value) => writeSchema(isJsonObject(value as JsonValue) ? (value as JsonObject) : {}, currentMessages().nodes.editedTheOutputSchema)} />
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
      <ToggleRow label={currentMessages().nodes.useKnowledge} description={currentMessages().nodes.passRetrievedPassagesInContextIn} checked={usesContext} disabled={readOnly} onChange={(enabled) => setConfigValue(['context', 'enabled'], enabled, enabled ? currentMessages().nodes.turnedOnKnowledge : currentMessages().nodes.turnedOffKnowledge)} />
      {usesContext && <SelectorField label={currentMessages().nodes.knowledgeFrom} path={readSelector(readConfigValue(config, ['context', 'variable_selector']))} onChange={(path) => setConfigValue(['context', 'variable_selector'], path ?? undefined, currentMessages().nodes.setTheKnowledgeSource)} hint={currentMessages().nodes.usuallyTheResultOfAKnowledge} />}
      <ToggleRow label={currentMessages().nodes.images} description={currentMessages().nodes.sendImageFilesToModelsThat} checked={usesVision} disabled={readOnly} onChange={(enabled) => setConfigValue(['vision', 'enabled'], enabled, enabled ? currentMessages().nodes.turnedOnImages : currentMessages().nodes.turnedOffImages)} />
      {usesVision && (
        <>
          <SelectorField label={currentMessages().nodes.imageFiles} path={readSelector(readConfigValue(config, ['vision', 'variable_selector']))} onChange={(path) => setConfigValue(['vision', 'variable_selector'], path ?? undefined, currentMessages().nodes.setTheImageFiles)} />
          <Field label={currentMessages().nodes.detail}>
            <SelectInput ariaLabel={currentMessages().nodes.imageDetail} value={readConfigText(config, ['vision', 'detail']) || 'auto'} disabled={readOnly} options={['auto', 'low', 'high'].map((detail) => ({ value: detail, label: detail }))} onChange={(detail) => setConfigValue(['vision', 'detail'], detail, currentMessages().nodes.setTheImageDetail)} />
          </Field>
        </>
      )}
      <ToggleRow label={currentMessages().nodes.rememberTheConversation} description={currentMessages().nodes.chatbotsIncludeEarlierTurns} checked={usesMemory} disabled={readOnly} onChange={(enabled) => setConfigValue(['memory', 'window', 'enabled'], enabled, enabled ? currentMessages().nodes.turnedOnMemory : currentMessages().nodes.turnedOffMemory)} />
      {usesMemory && (
        <Field label={currentMessages().nodes.turnsToRemember}>
          <NumberInput ariaLabel={currentMessages().nodes.turnsToRemember} value={readConfigNumber(config, ['memory', 'window', 'size'])} min={0} max={100} placeholder={currentMessages().nodes.all} disabled={readOnly} onCommit={(size) => setConfigValue(['memory', 'window', 'size'], size === null ? undefined : Math.round(size), currentMessages().nodes.setTheMemorySize)} />
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
      <InspectorSection title={currentMessages().nodes.modelAndMessages}>
        <ModelField showParams />
        <MessagesEditor />
      </InspectorSection>
      <InspectorSection title={currentMessages().nodes.knowledgeImagesAndMemory} defaultOpen={false}>
        <KnowledgeAndMemory />
      </InspectorSection>
      <InspectorSection title={currentMessages().nodes.structuredOutput} defaultOpen={readConfigFlag(node.config, ['structured_output_enabled'])}>
        <StructuredOutputEditor />
      </InspectorSection>
      <InspectorSection title={currentMessages().nodes.thinking} defaultOpen={reasoningFormat === 'separated'}>
        <RadioCards
          legend={currentMessages().nodes.thinking}
          name="reasoning-format"
          value={reasoningFormat}
          disabled={readOnly}
          onChange={(format) => setConfigValue(['reasoning_format'], format, format === 'separated' ? currentMessages().nodes.showedThinkingSeparately : currentMessages().nodes.keptThinkingInTheAnswer)}
          options={[
            { value: 'tagged', title: currentMessages().nodes.keepItInTheAnswer, description: currentMessages().nodes.defaultTaggedThinkingStaysInText },
            { value: 'separated', title: currentMessages().nodes.showItSeparately, description: currentMessages().nodes.separatedMovesItToTheReasoning },
          ]}
        />
        <p className={hintClassName}>{currentMessages().nodes.theTestRunShowsTheThinking}</p>
      </InspectorSection>
    </>
  )
}
