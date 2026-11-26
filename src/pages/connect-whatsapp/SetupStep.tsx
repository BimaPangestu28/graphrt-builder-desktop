import type { ReactNode } from 'react'
import { joinClassNames } from '@/components/ui'
import { messages } from '@/i18n'

interface SetupStepProps {
  number: number
  title: string
  isDone: boolean
  children?: ReactNode
}

/** One numbered step of a WhatsApp setup on screen 05, ticked once done. */
export function SetupStep({ number, title, isDone, children }: SetupStepProps) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className={joinClassNames(
          'flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold',
          isDone ? 'bg-ok-soft text-ok-strong' : 'bg-chip text-ink-2',
        )}
      >
        {isDone ? '✓' : number}
      </span>
      <div className="flex min-w-0 flex-auto flex-col gap-2">
        <span className="font-semibold">
          {title}
          {isDone && <span className="ml-2 text-[12px] font-medium text-ok-strong">{messages().chatbot.done}</span>}
        </span>
        {children}
      </div>
    </li>
  )
}
