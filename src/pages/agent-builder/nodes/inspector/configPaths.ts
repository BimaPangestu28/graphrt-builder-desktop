import type { JsonValue, NodeConfig } from '@/api/agentGraphTypes'

/**
 * Immutable reads and writes of nested node config values by path
 * (`['multiple_retrieval_config', 'top_k']`). The inspector changes only the keys it
 * edits; every other key (unknown ones included) is kept, so the backend writes the
 * YAML back unchanged around the edit.
 */

/** One step of a config path: an object key or an array index. */
export type ConfigPathSegment = string | number
export type ConfigPath = ConfigPathSegment[]

export type JsonObject = { [key: string]: JsonValue }

/** True for a plain JSON object (not an array, not null). */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The value at `path`, or undefined when any step is missing.
 *
 * @example
 * readConfigValue({ timeout: { read: 30 } }, ['timeout', 'read']) // 30
 */
export function readConfigValue(config: JsonValue | undefined, path: ConfigPath): JsonValue | undefined {
  let current: JsonValue | undefined = config
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return undefined
      current = current[segment]
    } else {
      if (!isJsonObject(current)) return undefined
      current = current[segment]
    }
  }
  return current
}

function writeAt(container: JsonValue | undefined, path: ConfigPath, value: JsonValue | undefined): JsonValue | undefined {
  if (path.length === 0) return value
  const [segment, ...rest] = path
  if (typeof segment === 'number') {
    const items = Array.isArray(container) ? [...container] : []
    const nextValue = writeAt(items[segment], rest, value)
    if (nextValue === undefined) items.splice(segment, 1)
    else items[segment] = nextValue
    return items
  }
  const object: JsonObject = isJsonObject(container) ? { ...container } : {}
  const nextValue = writeAt(object[segment], rest, value)
  if (nextValue === undefined) delete object[segment]
  else object[segment] = nextValue
  return object
}

/**
 * A copy of `config` with `value` at `path` (missing objects are created). `undefined`
 * removes the key (or the array item).
 *
 * @example
 * writeConfigValue({ a: 1 }, ['timeout', 'read'], 30) // { a: 1, timeout: { read: 30 } }
 * writeConfigValue({ a: 1, b: 2 }, ['b'], undefined) // { a: 1 }
 */
export function writeConfigValue(config: NodeConfig, path: ConfigPath, value: JsonValue | undefined): NodeConfig {
  const written = writeAt(config, path, value)
  return isJsonObject(written) ? written : {}
}

/** The array at `path`, or an empty one when it is missing or not a list. */
export function readConfigList(config: JsonValue | undefined, path: ConfigPath): JsonValue[] {
  const value = readConfigValue(config, path)
  return Array.isArray(value) ? value : []
}

/** The object at `path`, or an empty one. */
export function readConfigObject(config: JsonValue | undefined, path: ConfigPath): JsonObject {
  const value = readConfigValue(config, path)
  return isJsonObject(value) ? value : {}
}

/** The text at `path`; numbers and booleans as text; '' otherwise. */
export function readConfigText(config: JsonValue | undefined, path: ConfigPath): string {
  const value = readConfigValue(config, path)
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/** The number at `path` (numeric text included), or null. */
export function readConfigNumber(config: JsonValue | undefined, path: ConfigPath): number | null {
  const value = readConfigValue(config, path)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

/** The boolean at `path`, or `fallback` when it is not set. */
export function readConfigFlag(config: JsonValue | undefined, path: ConfigPath, fallback = false): boolean {
  const value = readConfigValue(config, path)
  return typeof value === 'boolean' ? value : fallback
}

/** True when a value counts as "not filled in" for a required field. */
export function isEmptyConfigValue(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  if (isJsonObject(value)) return Object.keys(value).length === 0
  return false
}
