import type { ReactNode } from 'react'
import { StrokeIcon, joinClassNames } from '@/components/ui'
import type { ScheduleTrigger, TriggerIconKind } from '@/data/scheduler'

const triggerIconPaths: Record<TriggerIconKind, ReactNode> = {
  schedule: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  email: (
    <>
      <path d="M4 7h16v10H4z" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  webhook: <path d="M9 7 4 12l5 5M15 7l5 5-5 5" />,
}

function getTriggerIconClassNames(trigger: ScheduleTrigger): string {
  if (!trigger.isEnabled) return 'bg-canvas text-muted'
  return trigger.iconKind === 'schedule' ? 'bg-brand-soft text-brand-strong' : 'bg-canvas text-ink-2'
}

interface TriggerRowProps {
  trigger: ScheduleTrigger
  onToggle: (triggerId: string) => void
}

function TriggerRow({ trigger, onToggle }: TriggerRowProps) {
  return (
    <div className="flex items-start gap-3">
      <span className={joinClassNames('flex size-8 shrink-0 items-center justify-center rounded-lg', getTriggerIconClassNames(trigger))}>
        <StrokeIcon size={16}>{triggerIconPaths[trigger.iconKind]}</StrokeIcon>
      </span>
      <div className="flex flex-auto flex-col gap-0.5">
        <span className={joinClassNames('font-semibold', !trigger.isEnabled && 'text-body')}>{trigger.agentName}</span>
        <span className={joinClassNames('text-[13px]', trigger.isEnabled ? 'text-body' : 'text-muted')}>{trigger.description}</span>
      </div>
      <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-2">
        <input
          type="checkbox"
          checked={trigger.isEnabled}
          onChange={() => onToggle(trigger.id)}
          aria-label={`${trigger.agentName} trigger`}
          className="size-[18px] accent-brand"
        />
        {trigger.isEnabled ? 'On' : 'Off'}
      </label>
    </div>
  )
}

interface TriggersPanelProps {
  triggers: ScheduleTrigger[]
  onToggleTrigger: (triggerId: string) => void
}

/** Every trigger the user has, each with an On/Off switch. Turning one off pauses its runs on the calendar. */
export function TriggersPanel({ triggers, onToggleTrigger }: TriggersPanelProps) {
  return (
    <section aria-labelledby="scheduler-triggers-heading" className="flex flex-col gap-3.5 rounded-2xl border border-line bg-surface p-[18px]">
      <h2 id="scheduler-triggers-heading" className="m-0 text-[16px] font-semibold">
        Triggers
      </h2>
      {triggers.length === 0 && <p className="m-0 text-[13px] text-body">No schedules yet. Schedule an agent from its page to see it here</p>}
      {triggers.map((trigger) => (
        <TriggerRow key={trigger.id} trigger={trigger} onToggle={onToggleTrigger} />
      ))}
    </section>
  )
}
