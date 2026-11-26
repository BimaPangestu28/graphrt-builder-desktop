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
import { messages } from '@/i18n'
import { withLocalizedLabels } from '@/i18n/localized'

/**
 * Pull out details (`parameter-extractor`), Knowledge retrieval (`knowledge-retrieval`)
 * and Sort into categories (`question-classifier`), per spec B13 / B16.
 */

const parameterTypes = withLocalizedLabels(
  ['string', 'number', 'boolean', 'object', 'select', 'array[string]', 'array[number]', 'array[boolean]', 'array[object]'].map((value) => ({ value })),
  (option) => messages().nodes.valueTypes[option.value] ?? option.value,
)

function ParametersEditor() {
  const { node, readOnly, setConfigValue } = useInspector()
  const parameters = readConfigList(node.config, ['parameters']).filter(isJsonObject)
  const write = (next: JsonObject[], what: string) => setConfigValue(['parameters'], next, what)
  const update = (index: number, changes: JsonObject, what: string) => write(parameters.map((parameter, itemIndex) => (itemIndex === index ? { ...parameter, ...changes } : parameter)), what)
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-medium text-ink-2">{messages().nodes.detailsToPullOut}</span>
      {parameters.map((parameter, index) => {
        const name = readConfigText(parameter, ['name'])
        const type = readConfigText(parameter, ['type']) || 'string'
        return (
          <div key={index} className="flex flex-col gap-1.5 rounded-[9px] border border-line p-2">
            <div className="grid grid-cols-[minmax(0,1fr)_110px_auto_24px] items-center gap-1.5">
              <TextInput ariaLabel={messages().nodes.detailValueName(index + 1)} monospace value={name} invalid={!name} disabled={readOnly} onCommit={(nextName) => update(index, { name: nextName.trim() }, messages().nodes.renamedADetail)} />
              <SelectInput ariaLabel={messages().nodes.detailValueType(index + 1)} value={type} disabled={readOnly} options={parameterTypes} onChange={(nextType) => update(index, { type: nextType }, messages().nodes.changedADetailType)} />
              <label className="flex items-center gap-1 text-[12px] text-ink-2">
                <input type="checkbox" aria-label={messages().nodes.detailValueMustBeFound(index + 1)} checked={parameter.required === true} disabled={readOnly} onChange={(event) => update(index, { required: event.target.checked }, messages().nodes.changedARequiredDetail)} className="accent-ink" />
                {messages().nodes.must}
              </label>
              <RemoveButton label={messages().nodes.removeDetailValue(index + 1)} disabled={readOnly} onClick={() => write(parameters.filter((_unused, itemIndex) => itemIndex !== index), messages().nodes.removedADetail)} />
            </div>
            <TextInput ariaLabel={messages().nodes.detailValueDescription(index + 1)} placeholder={messages().nodes.descriptionForTheModel} value={readConfigText(parameter, ['description'])} disabled={readOnly} onCommit={(description) => update(index, { description }, messages().nodes.describedADetail)} />
            {type === 'select' && (
              <TextInput
                ariaLabel={messages().nodes.detailValueOptions(index + 1)}
                placeholder={messages().nodes.optionsSeparatedByCommas}
                value={readConfigList(parameter, ['options']).filter((option): option is string => typeof option === 'string').join(', ')}
                disabled={readOnly}
                onCommit={(text) => update(index, { options: text.split(',').map((option) => option.trim()).filter(Boolean) }, messages().nodes.setDetailOptions)}
              />
            )}
          </div>
        )
      })}
      {parameters.length === 0 && <p className="m-0 text-[12px] text-danger">{messages().nodes.addAtLeastOneDetail}</p>}
      <AddButton disabled={readOnly} onClick={() => write([...parameters, { name: `detail_${parameters.length + 1}`, type: 'string', description: '', required: false }], messages().nodes.addedADetail)}>
        {messages().nodes.addADetail}
      </AddButton>
      <p className={hintClassName}>{messages().nodes.eachDetailHasADescriptionFor}</p>
    </div>
  )
}

/** Settings of Pull out details. */
export function ParameterExtractorPanel() {
  const { node, readOnly, setConfigValue } = useInspector()
  return (
    <>
      <InspectorSection title={messages().nodes.modelAndInput}>
        <ModelField />
        <SelectorField label={messages().nodes.readFrom} required path={readSelector(node.config.query)} onChange={(path) => setConfigValue(['query'], path ?? undefined, messages().nodes.setWhatToRead)} />
        <ParametersEditor />
      </InspectorSection>
      <InspectorSection title={messages().nodes.how} defaultOpen={false}>
        <TemplateField label={messages().nodes.extraInstructions} multiline placeholder={messages().nodes.optional} value={readConfigText(node.config, ['instruction'])} onCommit={(instruction) => setConfigValue(['instruction'], instruction || undefined, messages().nodes.setTheInstructions)} />
        <Field label={messages().nodes.method}>
          <SelectInput
            ariaLabel={messages().nodes.method}
            value={readConfigText(node.config, ['reasoning_mode']) || 'function_call'}
            disabled={readOnly}
            options={[
              { value: 'function_call', label: messages().nodes.functionCallingDefault },
              { value: 'prompt', label: messages().nodes.jsonPrompt },
            ]}
            onChange={(mode) => setConfigValue(['reasoning_mode'], mode, messages().nodes.setTheExtractionMethod)}
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
    <Field label={messages().nodes.knowledgeBases} required error={selectedIds.length === 0 ? messages().nodes.addAKnowledgeBase : null} hint={messages().nodes.fromKnowledgeSearchedOnThisComputer}>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {selectedIds.map((id) => (
          <li key={id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-2 py-1 text-[13px]">
            <span className="truncate">{nameOf(id)}</span>
            <RemoveButton label={messages().nodes.removeValue(nameOf(id))} disabled={readOnly} onClick={() => write(selectedIds.filter((selectedId) => selectedId !== id), messages().nodes.removedKnowledgeBaseValue(nameOf(id)))} />
          </li>
        ))}
      </ul>
      {available.length > 0 && (
        <SelectInput
          ariaLabel={messages().nodes.addAKnowledgeBase}
          value=""
          disabled={readOnly}
          options={available.map((knowledgeBase) => ({ value: knowledgeBase.id, label: knowledgeBase.name }))}
          onChange={(id) => id && write([...selectedIds, id], messages().nodes.addedKnowledgeBaseValue(nameOf(id)))}
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
      <InspectorSection title={messages().nodes.search}>
        <SelectorField label={messages().nodes.searchFor} required path={readSelector(config.query_variable_selector)} onChange={(path) => setConfigValue(['query_variable_selector'], path ?? undefined, messages().nodes.setWhatToSearchFor)} />
        <KnowledgeBasesPicker />
      </InspectorSection>
      <InspectorSection title={messages().nodes.results2}>
        <Field label={messages().nodes.howManyPassages}>
          <NumberInput ariaLabel={messages().nodes.topResults} value={readConfigNumber(config, ['multiple_retrieval_config', 'top_k'])} placeholder="4" min={1} max={100} step={1} suffix={messages().nodes.passages1To100} disabled={readOnly} onCommit={(topK) => setConfigValue(['multiple_retrieval_config', 'top_k'], topK === null ? undefined : Math.round(topK), messages().nodes.setTheNumberOfPassages)} />
        </Field>
        <Field label={messages().nodes.minimumScore}>
          <NumberInput ariaLabel={messages().nodes.minimumScore} value={readConfigNumber(config, ['multiple_retrieval_config', 'score_threshold'])} min={0} max={1} step={0.05} suffix={messages().nodes.emptyAny} disabled={readOnly} onCommit={(score) => setConfigValue(['multiple_retrieval_config', 'score_threshold'], score ?? undefined, messages().nodes.setTheMinimumScore)} />
        </Field>
        <p className={hintClassName}>{messages().nodes.reRankingIsntOfferedTheApps}</p>
        <Field label={messages().nodes.searchMode}>
          <SelectInput
            ariaLabel={messages().nodes.searchMode}
            value={readConfigText(config, ['retrieval_mode']) || 'multiple'}
            disabled={readOnly}
            options={[
              { value: 'multiple', label: messages().nodes.acrossAllBasesMultiple },
              { value: 'single', label: messages().nodes.pickOneBaseSingle },
            ]}
            onChange={(mode) => setConfigValue(['retrieval_mode'], mode, messages().nodes.setTheSearchMode)}
          />
        </Field>
      </InspectorSection>
      <InspectorSection title={messages().nodes.filterByDocumentDetails} defaultOpen={filterMode === 'manual'}>
        <SegmentedChoice
          label={messages().nodes.filterByDocumentDetails}
          value={filterMode === 'manual' ? 'manual' : 'disabled'}
          disabled={readOnly}
          options={[
            { value: 'manual', label: messages().nodes.manualConditions },
            { value: 'disabled', label: 'off' },
          ]}
          onChange={(mode) => setConfigValue(['metadata_filtering_mode'], mode, mode === 'manual' ? messages().nodes.turnedOnTheMetadataFilter : messages().nodes.turnedOffTheMetadataFilter)}
        />
        {filterMode === 'manual' && (
          <>
            <span className="text-[12px] font-medium text-ink-2">{messages().nodes.keepPassagesThatMatch}</span>
            <MatchChoice value={readConfigText(config, ['metadata_filtering_conditions', 'logical_operator'])} onChange={(operator) => setConfigValue(['metadata_filtering_conditions', 'logical_operator'], operator, messages().nodes.setTheFilterMatch)} />
            <ConditionsEditor
              label={messages().nodes.metadataConditions}
              subject="metadata"
              operators={metadataOperators}
              conditions={filterConditions}
              onChange={(conditions, what) => updateConfig((current) => writeConfigValue(current, ['metadata_filtering_conditions', 'conditions'], conditions), what)}
            />
            <p className={hintClassName}>{messages().nodes.detailsTheAppWritesWhenIt}</p>
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
      <InspectorSection title={messages().nodes.modelAndInput}>
        <ModelField />
        <SelectorField label={messages().nodes.sortThis} required path={queryPath} onChange={(path) => setConfigValue([queryKey], path ?? undefined, messages().nodes.setWhatToSort)} />
      </InspectorSection>
      <InspectorSection title={messages().nodes.categories}>
        {classes.map((category, index) => {
          const id = readConfigText(category, ['id'])
          const nameKey = typeof category.name === 'string' || category.label === undefined ? 'name' : 'label'
          return (
            <div key={id || index} className="flex flex-col gap-1.5 rounded-[9px] border border-line p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold text-ink-2">{messages().nodes.category}{' '}{index + 1}</span>
                <ExitRemoveButton handleId={id} itemName={messages().nodes.categoryValue(index + 1)} nextConfig={writeConfigValue(node.config, ['classes'], classes.filter((_unused, itemIndex) => itemIndex !== index))} />
              </div>
              <TextInput ariaLabel={messages().nodes.categoryValueName(index + 1)} value={readConfigText(category, [nameKey])} disabled={readOnly} onCommit={(name) => writeClasses(classes.map((item, itemIndex) => (itemIndex === index ? { ...item, [nameKey]: name } : item)), messages().nodes.renamedACategory)} />
              <TextInput ariaLabel={messages().nodes.categoryValueDescription(index + 1)} placeholder={messages().nodes.whenItAppliesOptional} value={readConfigText(category, ['description'])} disabled={readOnly} onCommit={(description) => writeClasses(classes.map((item, itemIndex) => (itemIndex === index ? { ...item, description } : item)), messages().nodes.describedACategory)} />
            </div>
          )
        })}
        {classes.length === 0 && <p className="m-0 text-[12px] text-danger">{messages().nodes.addAtLeastOneCategory}</p>}
        <AddButton
          disabled={readOnly}
          onClick={() => {
            const id = uniqueBranchId(classes.map((category) => readConfigText(category, ['id'])), 'class')
            writeClasses([...classes, { id, name: `Category ${classes.length + 1}` }], messages().nodes.addedACategory)
          }}
        >
          {messages().nodes.addACategory}
        </AddButton>
        <p className={hintClassName}>{messages().nodes.theModelPicksOneCategoryEach}</p>
        <TemplateField label={messages().nodes.extraInstructions} multiline placeholder={messages().nodes.optional} value={readConfigText(node.config, ['instruction'])} onCommit={(instruction) => setConfigValue(['instruction'], instruction || undefined, messages().nodes.setTheInstructions)} />
      </InspectorSection>
    </>
  )
}
