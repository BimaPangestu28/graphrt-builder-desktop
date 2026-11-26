import { joinClassNames } from '@/components/ui'
import { StepNumberBadge } from './StepNumberBadge'
import { messages } from '@/i18n'

/**
 * Pieces that show what the model is writing while a build or revision streams
 * (screens 03 and 04): the step titles written so far and a screen-reader
 * announcement that only changes when something settles, not on every token.
 */

/** Fades and lifts a newly written title in; with reduced motion it simply appears. */
const enterAnimationClassNames =
  'motion-safe:transition-[opacity,translate] motion-safe:duration-300 motion-safe:ease-out motion-safe:starting:translate-y-1 motion-safe:starting:opacity-0'

/** Grey pulsing cards for steps not written yet (screen 03's agent column). */
export function StepPlaceholders({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <ol aria-hidden="true" className="m-0 flex list-none flex-col gap-2 p-0">
      {Array.from({ length: count }, (_, placeholderIndex) => (
        <li key={`placeholder-${placeholderIndex}`} className="h-[54px] animate-pulse rounded-xl bg-selected motion-reduce:animate-none" />
      ))}
    </ol>
  )
}

interface DraftStepCardsProps {
  stepTitles: string[]
  /** How many cards (titles plus placeholders) to show before the model has written that many. */
  minimumCardCount: number
  /** While the model still writes, at least one placeholder stays below the titles. */
  isWriting: boolean
}

/** Screen 03's agent column while drafting: a numbered card per written step, then placeholders. */
export function DraftStepCards({ stepTitles, minimumCardCount, isWriting }: DraftStepCardsProps) {
  const placeholderCount = Math.max(minimumCardCount - stepTitles.length, isWriting ? 1 : 0)
  return (
    <div className="flex flex-col gap-2">
      {stepTitles.length > 0 && (
        <ol aria-label={messages().builder.stepsWrittenSoFar} className="m-0 flex list-none flex-col gap-2 p-0">
          {stepTitles.map((stepTitle, stepIndex) => (
            <li
              key={stepIndex}
              className={joinClassNames('flex items-center gap-3.5 rounded-xl border border-line bg-surface px-4 py-3.5', enterAnimationClassNames)}
            >
              <StepNumberBadge number={stepIndex + 1} />
              <span className="font-semibold">{stepTitle}</span>
            </li>
          ))}
        </ol>
      )}
      <StepPlaceholders count={placeholderCount} />
    </div>
  )
}

/** Screen 04's live bubble: the step titles being written, as a compact numbered list. */
export function CompactDraftStepList({ stepTitles }: { stepTitles: string[] }) {
  if (stepTitles.length === 0) return null
  return (
    <ol aria-label={messages().builder.stepsBeingWritten} className="m-0 flex list-none flex-col gap-1 rounded-lg border border-line bg-subtle px-3 py-2 text-[13px]">
      {stepTitles.map((stepTitle, stepIndex) => (
        <li key={stepIndex} className={joinClassNames('flex gap-2', enterAnimationClassNames)}>
          <span className="w-4 shrink-0 text-right text-muted tabular-nums">{stepIndex + 1}</span>
          <span>{stepTitle}</span>
        </li>
      ))}
    </ol>
  )
}

/**
 * Polite live region for screen readers. Pass text that changes only when something
 * settles (a stage change, the final explanation) so streaming tokens are not read out.
 */
export function PoliteAnnouncement({ text }: { text: string }) {
  return (
    <div aria-live="polite" className="sr-only">
      {text}
    </div>
  )
}
