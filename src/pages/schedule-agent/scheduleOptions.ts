import { messages } from '@/i18n'
import { withLocalizedLabels } from '@/i18n/localized'
/** Options and defaults for screen 08, the "Run it on a schedule" dialog. */

export type ScheduleFrequency = 'manual' | 'daily' | 'weekdays' | 'custom'

export const scheduleFrequencyOptions: ReadonlyArray<{ value: ScheduleFrequency; readonly label: string }> = withLocalizedLabels(
  [{ value: 'manual' as const }, { value: 'daily' as const }, { value: 'weekdays' as const }, { value: 'custom' as const }],
  (option) => messages().schedule.frequencies[option.value],
)

export const scheduleTimeZoneOptions = [
  { value: 'Asia/Jakarta', label: 'Asia/Jakarta (WIB)' },
  { value: 'Asia/Makassar', label: 'Asia/Makassar (WITA)' },
  { value: 'Asia/Jayapura', label: 'Asia/Jayapura (WIT)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT)' },
]

export type ApprovalMode = 'once-per-run' | 'every-message' | 'never'

export const approvalModeOptions: ReadonlyArray<{ value: ApprovalMode; readonly label: string }> = withLocalizedLabels(
  [{ value: 'once-per-run' as const }, { value: 'every-message' as const }, { value: 'never' as const }],
  (option) => messages().schedule.approvalModes[option.value],
)

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
