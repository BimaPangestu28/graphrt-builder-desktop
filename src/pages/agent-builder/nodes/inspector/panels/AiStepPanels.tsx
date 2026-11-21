import { useKnowledgeBases } from '@/hooks/useKnowledge'
import { isJsonObject, readConfigList, readConfigNumber, readConfigText, readConfigValue, writeConfigValue, type JsonObject } from '../configPaths'
import { ConditionsEditor, MatchChoice, metadataOperators } from '../ConditionsEditor'
import { uniqueBranchId } from '../branchEdits'
import { ExitRemoveButton } from '../ExitRemoveButton'
import { AddButton, Field, hintClassName, InspectorSection, NumberInput, RemoveButton, SegmentedChoice, SelectInput, TextInput } from '../fields'
import { useInspector } from '../InspectorContext'
import { ModelField } from '../ModelField'
import { readSelector } from '../references'
import { SelectorField } from '../SelectorField'
import { TemplateField } from '../TemplateField'

/**
 * Pull out details (`parameter-extractor`), Knowledge retrieval (`knowledge-retrieval`)
 * and Sort into categories (`question-classifier`), per spec B13 / B16.
 */

const parameterTypes = [
  { value: 'string', label: 'text' },
  { value: 'number', label: 'number' },
  { value: 'boolean', label: 'yes/no' },
  { value: 'object', label: 'object' },
  { value: 'select', label: 'one of a list' },
  { value: 'array[string]', label: 'list of text' },
  { value: 'array[number]', label: 'list of numbers' },
  { value: 'array[boolean]', label: 'list of yes/no' },
  { value: 'array[object]', label: 'list of objects' },
]

function ParametersEditor() {
  const { node, readOnly, setConfigValue } = useInspector()
  const parameters = readConfigList(node.config, ['parameters']).filter(isJsonObject)
  const write = (next: JsonObject[], what: string) => setConfigValue(['parameters'], next, what)
  const update = (index: number, changes: JsonObject, what: string) => write(parameters.map((parameter, itemIndex) => (itemIndex === index ? { ...parameter, ...changes } : parameter)), what)
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-medium text-ink-2">Details to pull out</span>
      {parameters.map((parameter, index) => {
        const name = readConfigText(parameter, ['name'])
        const type = readConfigText(parameter, ['type']) || 'string'
        return (
          <div key={index} className="flex flex-col gap-1.5 rounded-[9px] border border-line p-2">
            <div className="grid grid-cols-[minmax(0,1fr)_110px_auto_24px] items-center gap-1.5">
              <TextInput ariaLabel={`Detail ${index + 1} name`} monospace value={name} invalid={!name} disabled={readOnly} onCommit={(nextName) => update(index, { name: nextName.trim() }, 'renamed a detail')} />
              <SelectInput ariaLabel={`Detail ${index + 1} type`} value={type} disabled={readOnly} options={parameterTypes} onChange={(nextType) => update(index, { type: nextType }, 'changed a detail type')} />
              <label className="flex items-center gap-1 text-[12px] text-ink-2">
                <input type="checkbox" aria-label={`Detail ${index + 1} must be found`} checked={parameter.required === true} disabled={readOnly} onChange={(event) => update(index, { required: event.target.checked }, 'changed a required detail')} className="accent-ink" />
                Must
              </label>
              <RemoveButton label={`Remove detail ${index + 1}`} disabled={readOnly} onClick={() => write(parameters.filter((_unused, itemIndex) => itemIndex !== index), 'removed a detail')} />
            </div>
            <TextInput ariaLabel={`Detail ${index + 1} description`} placeholder="Description for the model" value={readConfigText(parameter, ['description'])} disabled={readOnly} onCommit={(description) => update(index, { description }, 'described a detail')} />
            {type === 'select' && (
              <TextInput
                ariaLabel={`Detail ${index + 1} options`}
                placeholder="Options, separated by commas"
                value={readConfigList(parameter, ['options']).filter((option): option is string => typeof option === 'string').join(', ')}
                disabled={readOnly}
                onCommit={(text) => update(index, { options: text.split(',').map((option) => option.trim()).filter(Boolean) }, 'set detail options')}
              />
            )}
          </div>
        )
      })}
      {parameters.length === 0 && <p className="m-0 text-[12px] text-danger">Add at least one detail.</p>}
      <AddButton disabled={readOnly} onClick={() => write([...parameters, { name: `detail_${parameters.length + 1}`, type: 'string', description: '', required: false }], 'added a detail')}>
        Add a detail
      </AddButton>
      <p className={hintClassName}>Each detail has a description for the model; “one of a list” takes options</p>
    </div>
  )
}

/** Settings of Pull out details. */
export function ParameterExtractorPanel() {
  const { node, readOnly, setConfigValue } = useInspector()
  return (
    <>
      <InspectorSection title="Model and input">
        <ModelField />
        <SelectorField label="Read from" required path={readSelector(node.config.query)} onChange={(path) => setConfigValue(['query'], path ?? undefined, 'set what to read')} />
        <ParametersEditor />
      </InspectorSection>
      <InspectorSection title="How" defaultOpen={false}>
        <TemplateField label="Extra instructions" multiline placeholder="Optional" value={readConfigText(node.config, ['instruction'])} onCommit={(instruction) => setConfigValue(['instruction'], instruction || undefined, 'set the instructions')} />
        <Field label="Method">
          <SelectInput
            ariaLabel="Method"
            value={readConfigText(node.config, ['reasoning_mode']) || 'function_call'}
            disabled={readOnly}
            options={[
              { value: 'function_call', label: 'function calling (default)' },
              { value: 'prompt', label: 'JSON prompt' },
            ]}
            onChange={(mode) => setConfigValue(['reasoning_mode'], mode, 'set the extraction method')}
          />
        </Field>
      </InspectorSection>
    </>
  )
}

function KnowledgeBasesPicker() {
  const { node, readOnly, setConfigValue } = useInspector()
  const { data: knowledgeBases } = useKnowledgeBases()
  const selectedIds = readConfigList(node.config, ['dataset_ids']).filter((id): id is string => typeof id === 'string')
  const nameOf = (id: string) => knowledgeBases?.find((knowledgeBase) => knowledgeBase.id === id)?.name ?? id
  const available = (knowledgeBases ?? []).filter((knowledgeBase) => !selectedIds.includes(knowledgeBase.id))
  const write = (ids: string[], what: string) => setConfigValue(['dataset_ids'], ids, what)
  return (
    <Field label="Knowledge bases" required error={selectedIds.length === 0 ? 'Add a knowledge base' : null} hint="From Knowledge. Searched on this computer">
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {selectedIds.map((id) => (
          <li key={id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-2 py-1 text-[13px]">
            <span className="truncate">{nameOf(id)}</span>
            <RemoveButton label={`Remove ${nameOf(id)}`} disabled={readOnly} onClick={() => write(selectedIds.filter((selectedId) => selectedId !== id), `removed knowledge base ${nameOf(id)}`)} />
          </li>
        ))}
      </ul>
      {available.length > 0 && (
        <SelectInput
          ariaLabel="Add a knowledge base"
          value=""
          disabled={readOnly}
          options={available.map((knowledgeBase) => ({ value: knowledgeBase.id, label: knowledgeBase.name }))}
          onChange={(id) => id && write([...selectedIds, id], `added knowledge base ${nameOf(id)}`)}
        />
      )}
    </Field>
  )
}

/** Settings of Knowledge retrieval (no re-ranking: the app's knowledge bases have no reranker). */
export function KnowledgeRetrievalPanel() {
  const { node, readOnly, setConfigValue, updateConfig } = useInspector()
  const config = node.config
  const filterMode = readConfigText(config, ['metadata_filtering_mode']) || 'disabled'
  const filterConditions = readConfigList(config, ['metadata_filtering_conditions', 'conditions'])
  return (
    <>
      <InspectorSection title="Search">
        <SelectorField label="Search for" required path={readSelector(config.query_variable_selector)} onChange={(path) => setConfigValue(['query_variable_selector'], path ?? undefined, 'set what to search for')} />
        <KnowledgeBasesPicker />
      </InspectorSection>
      <InspectorSection title="Results">
        <Field label="How many passages">
          <NumberInput ariaLabel="Top results" value={readConfigNumber(config, ['multiple_retrieval_config', 'top_k'])} placeholder="4" min={1} max={100} step={1} suffix="passages (1 to 100)" disabled={readOnly} onCommit={(topK) => setConfigValue(['multiple_retrieval_config', 'top_k'], topK === null ? undefined : Math.round(topK), 'set the number of passages')} />
        </Field>
        <Field label="Minimum score">
          <NumberInput ariaLabel="Minimum score" value={readConfigNumber(config, ['multiple_retrieval_config', 'score_threshold'])} min={0} max={1} step={0.05} suffix="empty = any" disabled={readOnly} onCommit={(score) => setConfigValue(['multiple_retrieval_config', 'score_threshold'], score ?? undefined, 'set the minimum score')} />
        </Field>
        <p className={hintClassName}>Re-ranking isn’t offered: the app’s knowledge bases have no reranker, and graphrt rejects reranking for them</p>
        <Field label="Search mode">
          <SelectInput
            ariaLabel="Search mode"
            value={readConfigText(config, ['retrieval_mode']) || 'multiple'}
            disabled={readOnly}
            options={[
              { value: 'multiple', label: 'across all bases (multiple)' },
              { value: 'single', label: 'pick one base (single)' },
            ]}
            onChange={(mode) => setConfigValue(['retrieval_mode'], mode, 'set the search mode')}
          />
        </Field>
      </InspectorSection>
      <InspectorSection title="Filter by document details" defaultOpen={filterMode === 'manual'}>
        <SegmentedChoice
          label="Filter by document details"
          value={filterMode === 'manual' ? 'manual' : 'disabled'}
          disabled={readOnly}
          options={[
            { value: 'manual', label: 'manual conditions' },
            { value: 'disabled', label: 'off' },
          ]}
          onChange={(mode) => setConfigValue(['metadata_filtering_mode'], mode, mode === 'manual' ? 'turned on the metadata filter' : 'turned off the metadata filter')}
        />
        {filterMode === 'manual' && (
          <>
            <span className="text-[12px] font-medium text-ink-2">Keep passages that match</span>
            <MatchChoice value={readConfigText(config, ['metadata_filtering_conditions', 'logical_operator'])} onChange={(operator) => setConfigValue(['metadata_filtering_conditions', 'logical_operator'], operator, 'set the filter match')} />
            <ConditionsEditor
              label="Metadata conditions"
              subject="metadata"
              operators={metadataOperators}
              conditions={filterConditions}
              onChange={(conditions, what) => updateConfig((current) => writeConfigValue(current, ['metadata_filtering_conditions', 'conditions'], conditions), what)}
            />
            <p className={hintClassName}>Details the app writes when it adds a file: source_id, source_name, heading, chunk_index. Dotted names reach nested details</p>
          </>
        )}
      </InspectorSection>
    </>
  )
}

/** Settings of Sort into categories: each category is a port. */
export function ClassifierPanel() {
  const { node, readOnly, setConfigValue } = useInspector()
  const classes = readConfigList(node.config, ['classes']).filter(isJsonObject)
  const writeClasses = (next: JsonObject[], what: string) => setConfigValue(['classes'], next, what)
  const queryPath = readSelector(readConfigValue(node.config, ['query_variable_selector']) ?? readConfigValue(node.config, ['query']))
  const queryKey = node.config.query_variable_selector === undefined && node.config.query !== undefined ? 'query' : 'query_variable_selector'
  return (
    <>
      <InspectorSection title="Model and input">
        <ModelField />
        <SelectorField label="Sort this" required path={queryPath} onChange={(path) => setConfigValue([queryKey], path ?? undefined, 'set what to sort')} />
      </InspectorSection>
      <InspectorSection title="Categories">
        {classes.map((category, index) => {
          const id = readConfigText(category, ['id'])
          const nameKey = typeof category.name === 'string' || category.label === undefined ? 'name' : 'label'
          return (
            <div key={id || index} className="flex flex-col gap-1.5 rounded-[9px] border border-line p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold text-ink-2">Category {index + 1}</span>
                <ExitRemoveButton handleId={id} itemName={`Category ${index + 1}`} nextConfig={writeConfigValue(node.config, ['classes'], classes.filter((_unused, itemIndex) => itemIndex !== index))} />
              </div>
              <TextInput ariaLabel={`Category ${index + 1} name`} value={readConfigText(category, [nameKey])} disabled={readOnly} onCommit={(name) => writeClasses(classes.map((item, itemIndex) => (itemIndex === index ? { ...item, [nameKey]: name } : item)), 'renamed a category')} />
              <TextInput ariaLabel={`Category ${index + 1} description`} placeholder="When it applies (optional)" value={readConfigText(category, ['description'])} disabled={readOnly} onCommit={(description) => writeClasses(classes.map((item, itemIndex) => (itemIndex === index ? { ...item, description } : item)), 'described a category')} />
            </div>
          )
        })}
        {classes.length === 0 && <p className="m-0 text-[12px] text-danger">Add at least one category.</p>}
        <AddButton
          disabled={readOnly}
          onClick={() => {
            const id = uniqueBranchId(classes.map((category) => readConfigText(category, ['id'])), 'class')
            writeClasses([...classes, { id, name: `Category ${classes.length + 1}` }], 'added a category')
          }}
        >
          Add a category
        </AddButton>
        <p className={hintClassName}>The model picks one category; each category is a port. Drag from its port to connect it</p>
        <TemplateField label="Extra instructions" multiline placeholder="Optional" value={readConfigText(node.config, ['instruction'])} onCommit={(instruction) => setConfigValue(['instruction'], instruction || undefined, 'set the instructions')} />
      </InspectorSection>
    </>
  )
}
