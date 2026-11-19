/**
 * Rules for every schedule (Scheduler screen 10) that the scheduler enforces. Mirrors
 * `ScheduleRules` in `src-tauri/src/scheduler/rules.rs`. The missed-run default and
 * "keep the computer awake" live in `AppSettings` (`appSettingsTypes.ts`).
 */
export interface ScheduleRules {
  /** At most this many scheduled runs at once; a schedule due beyond it skips that run. 1 to 16. */
  maxConcurrentRuns: number
}
