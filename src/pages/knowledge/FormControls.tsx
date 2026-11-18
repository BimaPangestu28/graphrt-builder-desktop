import type { ReactNode } from 'react'
import { joinClassNames } from '@/components/ui'

/**
 * Small form and button building blocks shared by the chatbot setup (14) and
 * knowledge screens (17, 18). They match the mockup's 36px header buttons,
 * 40px rounded inputs and 18px brand-tinted checkboxes, which differ slightly
 * from the shared `Button` sizes.
 */

export type CompactButtonVariant = 'primary' | 'secondary'

const compactButtonVariantClassNames: Record<CompactButtonVariant, string> = {
  primary: 'border-0 bg-ink !text-white hover:bg-ink-2',
  secondary: 'border border-line-strong bg-surface !text-ink hover:bg-subtle',
}

/**
 * Classes for the 36px, 13px medium-weight buttons used in screen headers ("Sync now", "Go live").
 *
 * @param variant - primary (ink fill) or secondary (white, bordered)
 * @param extraClassNames - optional extra classes
 * @returns The joined class string
 */
export function compactButtonClassNames(variant: CompactButtonVariant, extraClassNames?: string): string {
  return joinClassNames(
    'inline-flex h-9 cursor-pointer items-center justify-center rounded-lg px-3.5 text-[13px] font-medium no-underline whitespace-nowrap disabled:cursor-default disabled:opacity-60',
    compactButtonVariantClassNames[variant],
    extraClassNames,
  )
}

/** Shared look for 40px text inputs and selects. */
export const fieldControlClassNames =
  'box-border h-10 rounded-[10px] border border-line-strong bg-surface px-3 text-[14px] text-ink outline-none focus:border-brand'

/** Label above a control, as in "Name customers see" or "Embedding model". */
export function LabeledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-ink-2">{label}</span>
      {children}
    </label>
  )
}

interface CheckboxRowProps {
  checked: boolean
  onChange: (isChecked: boolean) => void
  children: ReactNode
}

/** A checkbox followed by its label text, 18px box with the brand accent color. */
export function CheckboxRow({ checked, onChange, children }: CheckboxRowProps) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-[18px] accent-brand" />
      {children}
    </label>
  )
}

/** Section heading used inside panels (15px semibold). */
export function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="m-0 text-[15px] font-semibold">
      {children}
    </h2>
  )
}
