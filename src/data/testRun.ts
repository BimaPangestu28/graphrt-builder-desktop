/**
 * View types of screens 06 (test run) and 07 (run result). Their content comes from the
 * run, its flow summary and its run summary; sample content for the browser preview lives
 * in `src/api/sampleBackend/sampleTestRun.ts`.
 */

/** `running`, `failed` and `skipped` appear only while following a live run. */
export type TestRunStepState = 'done' | 'running' | 'waiting' | 'failed' | 'skipped' | 'pending'

export interface TestRunStep {
  id: string
  label: string
  state: TestRunStepState
  /** Right-aligned detail for finished steps, e.g. "18 places · 1.2s". */
  detail?: string
}

export interface RunResultStat {
  label: string
  value: string
}
