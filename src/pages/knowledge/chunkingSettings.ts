import type { ChunkingSettings, SeparatorKind, SeparatorSetting } from '@/api/knowledgeTypes'
import { messages } from '@/i18n'

/**
 * Chunking settings on the screen: defaults, limits and the checks the backend repeats
 * (`src-tauri/src/knowledge/chunking.rs`, which stays the source of truth).
 */

export const MIN_MAX_TOKENS = 50
export const MAX_MAX_TOKENS = 2000
export const MAX_SEPARATORS = 12
export const MAX_SEPARATOR_VALUE_CHARS = 100
/** Characters per token used for every size estimate (graphrt's rule of thumb). */
export const CHARS_PER_TOKEN = 4

/** Separators that need no value, in their default order. */
export const PRESET_SEPARATOR_KINDS = ['paragraph', 'line', 'sentence', 'clause', 'word'] as const satisfies readonly SeparatorKind[]

/** The defaults, equal to graphrt's: 250 tokens, 25 overlap, the five presets, headings respected. */
export function defaultChunkingSettings(): ChunkingSettings {
  return {
    maxTokens: 250,
    overlapTokens: 25,
    minTokens: 0,
    separators: PRESET_SEPARATOR_KINDS.map((kind) => ({ kind })),
    respectHeadings: true,
    splitPages: false,
  }
}

function separatorsEqual(first: SeparatorSetting, second: SeparatorSetting): boolean {
  if (first.kind !== second.kind) return false
  const firstValue = 'value' in first ? first.value : null
  const secondValue = 'value' in second ? second.value : null
  return firstValue === secondValue
}

export function chunkingSettingsEqual(first: ChunkingSettings, second: ChunkingSettings): boolean {
  return (
    first.maxTokens === second.maxTokens &&
    first.overlapTokens === second.overlapTokens &&
    first.minTokens === second.minTokens &&
    first.respectHeadings === second.respectHeadings &&
    first.splitPages === second.splitPages &&
    first.separators.length === second.separators.length &&
    first.separators.every((separator, index) => {
      const other = second.separators[index]
      return other !== undefined && separatorsEqual(separator, other)
    })
  )
}

/**
 * The first problem with the settings, as a sentence for the screen, or null when they can be saved.
 * Patterns use Rust's syntax (e.g. `(?m)^Pasal`), which JavaScript cannot check: the backend does.
 *
 * @param settings - The settings being edited
 * @returns A message, or null (string | null)
 */
export function chunkingProblem(settings: ChunkingSettings): string | null {
  const t = messages().knowledgeIndexing
  if (!Number.isInteger(settings.maxTokens) || settings.maxTokens < MIN_MAX_TOKENS || settings.maxTokens > MAX_MAX_TOKENS) {
    return t.problemMaxTokens(MIN_MAX_TOKENS, MAX_MAX_TOKENS)
  }
  if (!Number.isInteger(settings.overlapTokens) || settings.overlapTokens < 0 || settings.overlapTokens > Math.floor(settings.maxTokens / 2)) {
    return t.problemOverlap
  }
  if (!Number.isInteger(settings.minTokens) || settings.minTokens < 0 || settings.minTokens > settings.maxTokens) return t.problemMinTokens
  if (settings.separators.length > MAX_SEPARATORS) return t.problemTooManySeparators(MAX_SEPARATORS)
  for (const separator of settings.separators) {
    if (separator.kind !== 'text' && separator.kind !== 'pattern') continue
    if (separator.value === '') return t.problemEmptySeparator
    if ([...separator.value].length > MAX_SEPARATOR_VALUE_CHARS) return t.problemLongSeparator(MAX_SEPARATOR_VALUE_CHARS)
  }
  return null
}
