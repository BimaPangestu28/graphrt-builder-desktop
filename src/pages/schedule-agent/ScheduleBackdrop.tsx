import { LogoLockup } from '@/components/ui'

/**
 * Decorative, greyed-out outline of the builder window behind the schedule dialog.
 * Hidden from assistive tech: it only hints at the screen the dialog was opened from.
 */
export function ScheduleBackdrop() {
  return (
    <>
      <div aria-hidden="true" className="box-border flex flex-[1_1_232px] flex-col gap-[18px] px-3.5 py-5">
        <LogoLockup className="px-1.5" />
        <div className="h-10 rounded-[10px] bg-ink" />
        <div className="h-[120px] rounded-[10px] bg-selected" />
        <div className="h-14 rounded-[10px] bg-brand-soft" />
      </div>
      <div aria-hidden="true" className="flex flex-[999_1_560px] flex-wrap">
        <div className="flex-[1_1_380px] border-r border-line bg-surface" />
        <div className="box-border flex flex-[1_1_440px] flex-col gap-2.5 bg-subtle px-6 py-[88px]">
          <div className="h-20 rounded-xl border border-line bg-surface" />
          <div className="h-60 rounded-xl border border-line bg-surface" />
        </div>
      </div>
    </>
  )
}
