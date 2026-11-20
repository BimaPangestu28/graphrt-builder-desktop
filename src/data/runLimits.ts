import type { RunLimits } from '@/api/appSettingsTypes'

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
  title: string
  description: string
  /** Shown after the number, e.g. "seconds". */
  unit: string
  min: number
  max: number
}

export const runLimitFields: readonly RunLimitField[] = [
  {
    key: 'stepTimeoutSeconds',
    title: 'Time for one step',
    description: 'Unless the step sets its own time limit',
    unit: 'seconds',
    min: 10,
    max: 3_600,
  },
  {
    key: 'runDurationMinutes',
    title: 'Time for one run',
    description: "Active time. Waiting for your answer doesn't count",
    unit: 'minutes',
    min: 1,
    max: 1_440,
  },
  {
    key: 'maxStepAttempts',
    title: 'Step attempts per run',
    description: 'Retries and loop rounds count too',
    unit: 'attempts',
    min: 100,
    max: 1_000_000,
  },
  {
    key: 'maxNestingDepth',
    title: 'Loops inside loops',
    description: 'How deep a loop may sit inside another',
    unit: 'deep',
    min: 1,
    max: 32,
  },
  {
    key: 'maxParallelSteps',
    title: 'Steps at the same time',
    description: 'Within one loop or branch',
    unit: 'steps',
    min: 1,
    max: 256,
  },
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
  return invalidField ? `${invalidField.title} must be between ${invalidField.min.toLocaleString('en-US')} and ${invalidField.max.toLocaleString('en-US')}` : null
}
