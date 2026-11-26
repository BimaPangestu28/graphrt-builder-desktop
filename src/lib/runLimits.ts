import type { RunLimits } from '@/api/appSettingsTypes'
import { formatNumber, messages } from '@/i18n'

/**
 * The run limits shown in Settings › Runner › Run limits: defaults, allowed ranges and the
 * explanation of each. Keep in sync with `src-tauri/src/desktop/run_limits.rs`, which refuses
 * values outside these ranges.
 */

export const defaultRunLimits: RunLimits = {
  stepTimeoutSeconds: 120,
  runDurationMinutes: 30,
  maxStepAttempts: 10_000,
  maxNestingDepth: 8,
  maxParallelSteps: 64,
}

export interface RunLimitField {
  key: keyof RunLimits
  /** In the current language. */
  readonly title: string
  readonly description: string
  /** Shown after the number, e.g. "seconds". */
  readonly unit: string
  min: number
  max: number
}

/** A limit's bounds; its texts come from the dictionary when read. */
function limitField(key: keyof RunLimits, min: number, max: number): RunLimitField {
  return {
    key,
    min,
    max,
    get title() {
      return messages().settings.runLimitFields[key].title
    },
    get description() {
      return messages().settings.runLimitFields[key].description
    },
    get unit() {
      return messages().settings.runLimitFields[key].unit
    },
  }
}

export const runLimitFields: readonly RunLimitField[] = [
  limitField('stepTimeoutSeconds', 10, 3_600),
  limitField('runDurationMinutes', 1, 1_440),
  limitField('maxStepAttempts', 100, 1_000_000),
  limitField('maxNestingDepth', 1, 32),
  limitField('maxParallelSteps', 1, 256),
]

/**
 * Why `runLimits` cannot be saved, or null when every limit is a whole number in its range.
 *
 * @param runLimits - The limits to check (RunLimits)
 * @returns A message naming the first bad limit (string | null)
 *
 * @example
 * findInvalidRunLimit({ ...defaultRunLimits, maxNestingDepth: 0 }) // "Loops inside loops must be between 1 and 32"
 */
export function findInvalidRunLimit(runLimits: RunLimits): string | null {
  const invalidField = runLimitFields.find((field) => {
    const limitValue = runLimits[field.key]
    return !Number.isInteger(limitValue) || limitValue < field.min || limitValue > field.max
  })
  return invalidField ? messages().settings.limitOutOfRange(invalidField.title, formatNumber(invalidField.min), formatNumber(invalidField.max)) : null
}
