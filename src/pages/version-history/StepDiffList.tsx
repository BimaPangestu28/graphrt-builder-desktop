import type { ReactNode } from 'react'
import { joinClassNames } from '@/components/ui'
import type { StepDiffRow } from './diffAgentSteps'

const markerBaseClassNames = 'w-[22px] shrink-0 text-center text-[12px]'

function UnchangedRow({ name, position }: { name: string; position: number }) {
  return (
    <>
      <span className={joinClassNames(markerBaseClassNames, 'font-semibold text-muted')}>{position}</span>
      <span>{name}</span>
    </>
  )
}

function MarkedRow({ marker, label, tone, children }: { marker: string; label: string; tone: 'danger' | 'amber' | 'ok'; children: ReactNode }) {
  const toneClassNames = { danger: 'text-danger', amber: 'text-amber-strong', ok: 'text-ok-strong' }[tone]
  return (
    <>
      <span aria-hidden="true" className={joinClassNames(markerBaseClassNames, 'font-bold', toneClassNames)}>
        {marker}
      </span>
      <span className="flex flex-auto flex-col gap-1">{children}</span>
      <span className={joinClassNames('text-[12px] font-medium', toneClassNames)}>{label}</span>
    </>
  )
}

function StepDiffRowContent({ row }: { row: StepDiffRow }) {
  switch (row.kind) {
    case 'unchanged':
      return <UnchangedRow name={row.step.name} position={row.position} />
    case 'removed':
      return (
        <MarkedRow marker="−" label="Removed" tone="danger">
          <span className="text-danger-deep line-through">{row.step.name}</span>
        </MarkedRow>
      )
    case 'added':
      return (
        <MarkedRow marker="+" label="Added" tone="ok">
          <span>{row.step.name}</span>
        </MarkedRow>
      )
    case 'changed':
      return (
        <MarkedRow marker="~" label="Changed" tone="amber">
          <span>{row.step.name}</span>
          <span className="text-[13px] text-amber-deep">
            {row.fromSetting} → {row.toSetting}
          </span>
        </MarkedRow>
      )
  }
}

const rowBackgroundClassNames: Record<StepDiffRow['kind'], string> = {
  unchanged: 'items-center',
  removed: 'items-center bg-danger-tint',
  added: 'items-center bg-ok-tint',
  changed: 'items-start bg-amber-tint',
}

/** Bordered list of steps, highlighting what a restore would remove, add or change. */
export function StepDiffList({ rows }: { rows: StepDiffRow[] }) {
  return (
    <ol aria-label="Steps" className="m-0 list-none overflow-hidden rounded-[14px] border border-line p-0">
      {rows.map((row) => (
        <li
          key={`${row.kind}-${row.step.id}`}
          className={joinClassNames('flex gap-3.5 border-b border-chip px-4 py-3.5 last:border-b-0', rowBackgroundClassNames[row.kind])}
        >
          <StepDiffRowContent row={row} />
        </li>
      ))}
    </ol>
  )
}
