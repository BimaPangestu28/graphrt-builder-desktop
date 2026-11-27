/**
 * A list input shown as rows: an input whose value is a list of simple records (the items of
 * an invoice: description, quantity, unit price) gets one row per record and one field per
 * column, instead of a text box of JSON.
 *
 * The columns come from the input's schema when the workflow gives one, else from the keys
 * of the value the form starts with (the last run's, else the default). A value that is not
 * a list of flat records (nested data, mixed types, too many columns) has no columns and
 * stays a JSON text box.
 */

export type ListColumnKind = 'text' | 'number' | 'checkbox'

export interface ListColumn {
  /** The record's key, e.g. `unit_price`. */
  key: string
  /** What people see, e.g. "Unit price". */
  label: string
  kind: ListColumnKind
}

/** One cell as the form holds it: text as typed (numbers too), or a checkbox. */
export type ListCell = string | boolean

export type ListRow = Record<string, ListCell>

type Scalar = string | number | boolean | null
type FlatRecord = Record<string, Scalar>

/** More columns than this do not fit a row; the input stays JSON. */
export const maxListColumns = 6

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isScalar(value: unknown): value is Scalar {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function isFlatRecord(value: unknown): value is FlatRecord {
  return isPlainObject(value) && Object.values(value).every(isScalar)
}

/** "unit_price" → "Unit price". */
export function columnLabel(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const kindBySchemaType: Record<string, ListColumnKind> = { string: 'text', number: 'number', integer: 'number', boolean: 'checkbox' }

/** The columns a JSON schema of the form `{ type: array, items: { type: object, properties } }` describes; null for any other schema. */
function columnsFromSchema(schema: unknown): ListColumn[] | null {
  if (!isPlainObject(schema) || schema.type !== 'array' || !isPlainObject(schema.items)) return null
  const properties = schema.items.properties
  if (!isPlainObject(properties)) return null
  const columns: ListColumn[] = []
  for (const [key, property] of Object.entries(properties)) {
    const kind = isPlainObject(property) && typeof property.type === 'string' ? kindBySchemaType[property.type] : undefined
    // A column the form has no field for (a nested list, say): leave the whole input as JSON.
    if (!kind) return null
    const title = isPlainObject(property) && typeof property.title === 'string' ? property.title.trim() : ''
    columns.push({ key, label: title || columnLabel(key), kind })
  }
  return columns
}

function kindOfValues(values: Scalar[]): ListColumnKind | null {
  const present = values.filter((value) => value !== null && value !== '')
  if (present.length === 0) return 'text'
  if (present.every((value) => typeof value === 'number')) return 'number'
  if (present.every((value) => typeof value === 'boolean')) return 'checkbox'
  // Numbers mixed with text would be changed by either field: not a shape the rows can keep.
  return present.every((value) => typeof value === 'string') ? 'text' : null
}

function columnsFromRecords(records: FlatRecord[]): ListColumn[] | null {
  const keys: string[] = []
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!keys.includes(key)) keys.push(key)
    }
  }
  const columns: ListColumn[] = []
  for (const key of keys) {
    const kind = kindOfValues(records.map((record) => record[key] ?? null))
    if (!kind) return null
    columns.push({ key, label: columnLabel(key), kind })
  }
  return columns
}

/**
 * The columns of a list input, or null when it is not a list of simple records.
 *
 * @param schema - The input's JSON schema, when the workflow gives one (unknown)
 * @param value - The value the form starts with: the last run's, else the default (unknown)
 * @returns The columns in display order, or null to keep the JSON text box (ListColumn[] | null)
 *
 * @example
 * listColumns(undefined, [{ description: 'Design', quantity: 3 }])
 * // [{ key: 'description', label: 'Description', kind: 'text' }, { key: 'quantity', label: 'Quantity', kind: 'number' }]
 */
export function listColumns(schema: unknown, value: unknown): ListColumn[] | null {
  const hasRecords = Array.isArray(value) && value.length > 0
  if (hasRecords && !value.every(isFlatRecord)) return null
  const columns = columnsFromSchema(schema) ?? (hasRecords ? columnsFromRecords(value.filter(isFlatRecord)) : null)
  if (!columns || columns.length === 0 || columns.length > maxListColumns) return null
  // With a schema, a record must not hold a key the rows would drop.
  const known = new Set(columns.map((column) => column.key))
  if (hasRecords && value.filter(isFlatRecord).some((record) => Object.keys(record).some((key) => !known.has(key)))) return null
  return columns
}

/** A row with every column empty (unticked), for "Add a row". */
export function emptyRow(columns: ListColumn[]): ListRow {
  return Object.fromEntries(columns.map((column) => [column.key, column.kind === 'checkbox' ? false : '']))
}

function cellFromValue(column: ListColumn, value: Scalar | undefined): ListCell {
  if (column.kind === 'checkbox') return value === true
  return value === null || value === undefined ? '' : String(value)
}

/**
 * The rows the form shows for `value`, one per record; a value that is not a list gives no rows.
 * Call it only with the columns {@link listColumns} gave for the same value.
 */
export function rowsFromValue(columns: ListColumn[], value: unknown): ListRow[] {
  if (!Array.isArray(value)) return []
  return value.filter(isFlatRecord).map((record) => Object.fromEntries(columns.map((column) => [column.key, cellFromValue(column, record[column.key])])))
}

function isEmptyRow(columns: ListColumn[], row: ListRow): boolean {
  return columns.every((column) => column.kind === 'checkbox' || String(row[column.key] ?? '').trim() === '')
}

/** What the rows amount to: the list to send, and the cells that cannot be read. */
export interface ListRowsValue {
  records: Array<Record<string, string | number | boolean>>
  /** One entry per cell that is not a number, to name in a message. */
  invalidNumbers: Array<{ rowNumber: number; label: string }>
}

/**
 * The list a run gets from the rows. A row with nothing typed is left out. An empty cell
 * leaves its key out of the record (never an empty string where a number belongs); a number
 * is sent as a number; a checkbox as true or false.
 *
 * @example
 * valueFromRows(columns, [{ description: 'Design', quantity: '3', unit: '' }]).records
 * // [{ description: 'Design', quantity: 3 }]
 */
export function valueFromRows(columns: ListColumn[], rows: ListRow[]): ListRowsValue {
  const records: ListRowsValue['records'] = []
  const invalidNumbers: ListRowsValue['invalidNumbers'] = []
  const filledRows = rows.filter((row) => !isEmptyRow(columns, row))
  filledRows.forEach((row, rowIndex) => {
    const record: Record<string, string | number | boolean> = {}
    for (const column of columns) {
      const cell = row[column.key]
      if (column.kind === 'checkbox') {
        record[column.key] = cell === true
        continue
      }
      const text = typeof cell === 'string' ? cell.trim() : ''
      if (text === '') continue
      if (column.kind === 'text') {
        record[column.key] = text
        continue
      }
      const numberValue = Number(text)
      if (Number.isFinite(numberValue)) record[column.key] = numberValue
      else invalidNumbers.push({ rowNumber: rowIndex + 1, label: column.label })
    }
    records.push(record)
  })
  return { records, invalidNumbers }
}
