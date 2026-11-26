import { useEffect, useId, useState } from 'react'
import type { JsonValue } from '@/api/agentGraphTypes'
import { isEmptyConfigValue, isJsonObject, writeConfigValue, type JsonObject } from './configPaths'
import { AddButton, Field, NumberInput, RemoveButton, SelectInput, TextInput, ToggleRow } from './fields'
import { useInspector } from './InspectorContext'
import { readSelector } from './references'
import { fieldPathAttribute } from './sectionRequest'
import { SelectorField } from './SelectorField'
import { TemplateField } from './TemplateField'
import { messages } from '@/i18n'

/**
 * The generic settings form, built from a kind's config JSON Schema (`get_node_kinds`):
 * text (with value chips), numbers with their limits, yes/no, choices, value selectors,
 * lists of texts and of simple objects as editable rows, and a JSON box for anything else. Used for plugin actions and any kind without a
 * dedicated panel. Required fields that are empty say so inline.
 */

type JsonSchema = Record<string, unknown>

/** The properties of an object schema, in their declared order. */
export function schemaProperties(schema: JsonSchema | null | undefined): Array<[string, JsonSchema]> {
  const properties = isJsonObject(schema?.properties as JsonValue) ? (schema?.properties as Record<string, unknown>) : {}
  const declared = Object.entries(properties).filter((entry): entry is [string, JsonSchema] => typeof entry[1] === 'object' && entry[1] !== null)
  // A required input the schema does not describe is still an input (plugin manifests list some only as required).
  const undeclared = schemaRequired(schema).filter((name) => !(name in properties)).map((name): [string, JsonSchema] => [name, { type: 'string' }])
  return [...declared, ...undeclared]
}

/** Required property names of an object schema. */
export function schemaRequired(schema: JsonSchema | null | undefined): string[] {
  return Array.isArray(schema?.required) ? (schema.required as unknown[]).filter((name): name is string => typeof name === 'string') : []
}

/** The kind of input a property gets. */
export type SchemaFieldKind = 'selector' | 'choice' | 'text' | 'number' | 'integer' | 'boolean' | 'string-list' | 'object-list' | 'json'

/** Item kinds an object-list row can edit inline (anything else keeps the JSON box). */
const simpleItemKinds = new Set<SchemaFieldKind>(['selector', 'choice', 'text', 'number', 'integer', 'boolean', 'string-list'])

/** A row can hold it: a simple input, or an untyped value (`default: {}`) as a small JSON box. */
function isSimpleItemProperty(property: JsonSchema): boolean {
  const kind = schemaFieldKind(property)
  if (simpleItemKinds.has(kind)) return true
  return kind === 'json' && schemaType(property) === null && property.properties === undefined && property.items === undefined
}

function itemSchemaOf(property: JsonSchema): JsonSchema | null {
  return typeof property.items === 'object' && property.items !== null && !Array.isArray(property.items) ? (property.items as JsonSchema) : null
}

/** The list kind of an array property: rows of text, rows of simple objects, or null (JSON). */
function listFieldKind(property: JsonSchema): 'string-list' | 'object-list' | null {
  const items = itemSchemaOf(property)
  if (!items) return null
  const itemType = schemaType(items)
  if (itemType === 'string' && !Array.isArray(items.enum)) return 'string-list'
  if (itemType !== 'object') return null
  const itemProperties = schemaProperties(items)
  if (itemProperties.length === 0 || itemProperties.length > 8) return null
  return itemProperties.every(([, itemProperty]) => isSimpleItemProperty(itemProperty)) ? 'object-list' : null
}

function schemaType(property: JsonSchema): string | null {
  if (typeof property.type === 'string') return property.type
  if (Array.isArray(property.type)) return (property.type as unknown[]).find((type): type is string => typeof type === 'string' && type !== 'null') ?? null
  return null
}

/** Which input renders a property (graphrt's selector schema is `oneOf` list / dotted string). */
export function schemaFieldKind(property: JsonSchema): SchemaFieldKind {
  const variants = Array.isArray(property.oneOf) ? (property.oneOf as JsonSchema[]) : []
  const isSelector =
    (variants.some((variant) => variant.type === 'array') && variants.some((variant) => variant.type === 'string' && typeof variant.pattern === 'string')) ||
    (typeof property.description === 'string' && property.description.startsWith('Variable selector'))
  if (isSelector) return 'selector'
  if (Array.isArray(property.enum)) return 'choice'
  const type = schemaType(property)
  if (type === 'string') return 'text'
  if (type === 'integer') return 'integer'
  if (type === 'number') return 'number'
  if (type === 'boolean') return 'boolean'
  if (type === 'array') return listFieldKind(property) ?? 'json'
  return 'json'
}

/** `max_results` → "Max results" (the schema's `title` wins). */
export function propertyLabel(name: string, property: JsonSchema): string {
  if (typeof property.title === 'string' && property.title.trim()) return property.title
  const words = name.replace(/[_-]+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : name
}

const multilineNames = /(text|prompt|message|template|content|caption|body|instruction|description|query)/i

export function JsonBox({ label, value, onCommit, required, error, hint }: { label: string; value: JsonValue | undefined; onCommit: (value: JsonValue | undefined) => void; required?: boolean; error?: string | null; hint?: string }) {
  const { readOnly } = useInspector()
  const id = useId()
  const text = value === undefined ? '' : JSON.stringify(value, null, 2)
  const [draft, setDraft] = useState(text)
  const [parseError, setParseError] = useState<string | null>(null)
  useEffect(() => setDraft(text), [text])
  return (
    <Field label={label} htmlFor={id} required={required} hint={hint ?? 'JSON'} error={parseError ?? error}>
      <textarea
        id={id}
        value={draft}
        rows={Math.min(8, Math.max(2, draft.split('\n').length))}
        disabled={readOnly}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft === text) return
          if (draft.trim() === '') {
            setParseError(null)
            onCommit(undefined)
            return
          }
          try {
            onCommit(JSON.parse(draft) as JsonValue)
            setParseError(null)
          } catch (rawError) {
            setParseError(messages().nodes.notValidJsonReason(rawError instanceof Error ? rawError.message : String(rawError)))
          }
        }}
        className="box-border w-full resize-y rounded-lg border border-line-strong bg-surface px-2 py-1.5 font-mono text-[12px] outline-none focus:border-ink"
      />
    </Field>
  )
}

function readStringList(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))) : []
}

/** A list of texts as rows (add, edit, remove). */
function StringListField({ label, value, onChange, required, error, hint }: { label: string; value: JsonValue | undefined; onChange: (value: JsonValue | undefined) => void; required?: boolean; error?: string | null; hint?: string }) {
  const { readOnly } = useInspector()
  const items = readStringList(value)
  const write = (next: string[]) => onChange(next.length === 0 && !required ? undefined : next)
  return (
    <Field label={label} required={required} hint={hint} error={error}>
      <div role="group" aria-label={label} className="flex flex-col gap-1.5">
        {items.map((item, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <TextInput ariaLabel={`${label} ${index + 1}`} value={item} disabled={readOnly} onCommit={(text) => write(items.map((current, itemIndex) => (itemIndex === index ? text : current)))} />
            <RemoveButton label={messages().nodes.removeLowercaseValue(label.toLowerCase(), index + 1)} disabled={readOnly} onClick={() => write(items.filter((_unused, itemIndex) => itemIndex !== index))} />
          </div>
        ))}
        <AddButton disabled={readOnly} onClick={() => write([...items, ''])}>
          {messages().nodes.add}
        </AddButton>
      </div>
    </Field>
  )
}

/** A list of small objects as cards, one input per item property; unknown item keys are kept. */
function ObjectListField({ label, property, value, onChange, required, error, hint }: { label: string; property: JsonSchema; value: JsonValue | undefined; onChange: (value: JsonValue | undefined) => void; required?: boolean; error?: string | null; hint?: string }) {
  const { readOnly } = useInspector()
  const itemSchema = itemSchemaOf(property) ?? {}
  const itemRequired = schemaRequired(itemSchema)
  const itemProperties = schemaProperties(itemSchema)
  const items = Array.isArray(value) ? value : []
  const write = (next: JsonValue[]) => onChange(next.length === 0 && !required ? undefined : next)
  const updateItem = (index: number, name: string, next: JsonValue | undefined) =>
    write(items.map((item, itemIndex) => (itemIndex === index ? writeConfigValue(isJsonObject(item) ? item : {}, [name], next) : item)))
  const newItem = (): JsonObject => Object.fromEntries(itemProperties.flatMap(([name, itemProperty]) => (itemProperty.default !== undefined ? [[name, itemProperty.default as JsonValue]] : itemRequired.includes(name) && schemaFieldKind(itemProperty) === 'text' ? [[name, '']] : [])))
  return (
    <Field label={label} required={required} hint={hint} error={error}>
      <ol aria-label={label} className="m-0 flex list-none flex-col gap-1.5 p-0">
        {items.map((item, index) => {
          const object = isJsonObject(item) ? item : {}
          return (
            <li key={index} className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-muted">
                  {label} {index + 1}
                </span>
                <RemoveButton label={messages().nodes.removeLowercaseValue(label.toLowerCase(), index + 1)} disabled={readOnly} onClick={() => write(items.filter((_unused, itemIndex) => itemIndex !== index))} />
              </div>
              {itemProperties.map(([name, itemProperty]) => (
                <SchemaPropertyInput key={name} name={name} property={itemProperty} value={object[name]} required={itemRequired.includes(name)} onChange={(next) => updateItem(index, name, next)} />
              ))}
            </li>
          )
        })}
      </ol>
      <AddButton disabled={readOnly} onClick={() => write([...items, newItem()])}>
        {messages().nodes.add}
      </AddButton>
    </Field>
  )
}

interface SchemaPropertyFieldProps {
  name: string
  property: JsonSchema
  value: JsonValue | undefined
  required: boolean
  onChange: (value: JsonValue | undefined) => void
  /** Replaces "Required" for empty required fields ("Needed by Send WhatsApp file"). */
  requiredMessage?: string
  /** Extra line under the field ("Kept: both actions use it"). */
  note?: string
  /** Path a `requestedSection` names it by; defaults to `name` (tool inputs use `tool_parameters.<name>`). */
  fieldPath?: string
}

/** One schema property as an input, findable by a `requestedSection` naming its config path. */
export function SchemaPropertyField(props: SchemaPropertyFieldProps) {
  return (
    <div className="contents" {...{ [fieldPathAttribute]: props.fieldPath ?? props.name }}>
      <SchemaPropertyInput {...props} />
    </div>
  )
}

function SchemaPropertyInput({ name, property, value, required, onChange, requiredMessage, note }: SchemaPropertyFieldProps) {
  const { readOnly } = useInspector()
  const label = propertyLabel(name, property)
  const description = typeof property.description === 'string' ? property.description : undefined
  const hint = [note, description].filter(Boolean).join(' · ') || undefined
  const missing = required && isEmptyConfigValue(value) ? (requiredMessage ?? messages().nodes.required2) : null
  switch (schemaFieldKind(property)) {
    case 'selector':
      return <SelectorField label={label} path={readSelector(value)} required={required} hint={hint} error={missing} onChange={(path) => onChange(path ?? undefined)} />
    case 'choice': {
      const choices = (property.enum as unknown[]).map((choice) => String(choice))
      const fallback = property.default === undefined ? '' : String(property.default)
      return (
        <Field label={label} required={required} hint={hint} error={missing}>
          <SelectInput ariaLabel={label} value={value === undefined || value === null ? fallback : String(value)} disabled={readOnly} options={choices.map((choice) => ({ value: choice, label: choice }))} onChange={(choice) => onChange(choice)} />
        </Field>
      )
    }
    case 'text':
      return (
        <TemplateField
          label={label}
          value={typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value)}
          multiline={multilineNames.test(name)}
          required={required}
          error={missing}
          hint={hint}
          onCommit={(text) => onChange(text === '' && !required ? undefined : text)}
        />
      )
    case 'number':
    case 'integer': {
      const numberValue = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null
      const isInteger = schemaFieldKind(property) === 'integer'
      return (
        <Field label={label} required={required} hint={hint} error={missing}>
          <NumberInput
            ariaLabel={label}
            wide
            value={numberValue}
            min={typeof property.minimum === 'number' ? property.minimum : undefined}
            max={typeof property.maximum === 'number' ? property.maximum : undefined}
            step={isInteger ? 1 : undefined}
            placeholder={property.default === undefined ? undefined : String(property.default)}
            disabled={readOnly}
            onCommit={(next) => onChange(next === null ? undefined : isInteger ? Math.round(next) : next)}
          />
        </Field>
      )
    }
    case 'string-list':
      return <StringListField label={label} value={value} required={required} error={missing} hint={hint} onChange={onChange} />
    case 'object-list':
      return <ObjectListField label={label} property={property} value={value} required={required} error={missing} hint={hint} onChange={onChange} />
    case 'boolean':
      return <ToggleRow label={label} description={hint} disabled={readOnly} checked={typeof value === 'boolean' ? value : property.default === true} onChange={(checked) => onChange(checked)} />
    default:
      return <JsonBox label={label} value={value} required={required} error={missing} hint={description} onCommit={onChange} />
  }
}

interface SchemaFormProps {
  schema: JsonSchema | null | undefined
  config: JsonObject
  onChange: (name: string, value: JsonValue | undefined) => void
  requiredMessage?: string
  notes?: Record<string, string>
  /** Properties a dedicated panel already shows. */
  skip?: string[]
}

/** Every property of `schema` as inputs, required ones first. */
export function SchemaForm({ schema, config, onChange, requiredMessage, notes = {}, skip = [] }: SchemaFormProps) {
  const required = schemaRequired(schema)
  const properties = schemaProperties(schema).filter(([name]) => !skip.includes(name))
  const ordered = [...properties.filter(([name]) => required.includes(name)), ...properties.filter(([name]) => !required.includes(name))]
  if (ordered.length === 0) return <p className="m-0 text-[12px] text-muted">{messages().nodes.thisStepHasNoSettings}</p>
  return (
    <>
      {ordered.map(([name, property]) => (
        <SchemaPropertyField
          key={name}
          name={name}
          property={property}
          value={config[name]}
          required={required.includes(name)}
          requiredMessage={requiredMessage}
          note={notes[name]}
          onChange={(value) => onChange(name, value)}
        />
      ))}
    </>
  )
}
