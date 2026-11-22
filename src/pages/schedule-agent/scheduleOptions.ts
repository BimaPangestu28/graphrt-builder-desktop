/** Options and defaults for screen 08, the "Run it on a schedule" dialog. */

export type ScheduleFrequency = 'manual' | 'daily' | 'weekdays' | 'custom'

export const scheduleFrequencyOptions: Array<{ value: ScheduleFrequency; label: string }> = [
  { value: 'manual', label: 'By hand' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'custom', label: 'Custom' },
]

export const scheduleTimeZoneOptions = [
  { value: 'Asia/Jakarta', label: 'Asia/Jakarta (WIB)' },
  { value: 'Asia/Makassar', label: 'Asia/Makassar (WITA)' },
  { value: 'Asia/Jayapura', label: 'Asia/Jayapura (WIT)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT)' },
]

export type ApprovalMode = 'once-per-run' | 'every-message' | 'never'

export const approvalModeOptions: Array<{ value: ApprovalMode; label: string }> = [
  { value: 'once-per-run', label: 'Ask me once per run, showing every message' },
  { value: 'every-message', label: 'Ask me for every message' },
  { value: 'never', label: 'Do not ask' },
]

export interface AgentScheduleSettings {
  frequency: ScheduleFrequency
  time: string
  /** Weekdays for "Custom" (0 = Sunday … 6 = Saturday). */
  customWeekdays: number[]
  timeZone: string
  searchKeyword: string
  city: string
  skipAlreadyMessaged: boolean
  approvalMode: ApprovalMode
}

export const defaultScheduleSettings: AgentScheduleSettings = {
  frequency: 'weekdays',
  time: '09:00',
  customWeekdays: [1, 3, 5],
  timeZone: 'Asia/Jakarta',
  searchKeyword: 'cafe',
  city: 'Bandar Lampung',
  skipAlreadyMessaged: true,
  approvalMode: 'once-per-run',
}
