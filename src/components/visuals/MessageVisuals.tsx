import { messages } from '@/i18n'
import type { CardSubmission } from './adaptive-card/AdaptiveCardView'
import type { UiBlock, UiBlockKind } from './uiBlockTypes'
import { VisualBlock } from './VisualBlock'

const blockKinds: Record<UiBlockKind, true> = { adaptive_card: true, chart: true, table: true, stats: true, diagram: true }

/**
 * The UI blocks of a chat message (`metadata.visuals`). The backend validated them with graphrt-ui before
 * storing the message; anything that is not a block of a kind this app draws is skipped.
 *
 * @param metadata - A conversation message's metadata (Record<string, unknown>)
 * @returns The blocks, in order (UiBlock[])
 */
export function readMessageVisuals(metadata: Record<string, unknown>): UiBlock[] {
  const visuals = metadata.visuals
  if (!Array.isArray(visuals)) return []
  return visuals.filter((block): block is UiBlock => {
    const kind = block && typeof block === 'object' ? (block as { $ui?: unknown }).$ui : undefined
    return typeof kind === 'string' && kind in blockKinds
  })
}

/** Whether the message's text only repeats its blocks as text (a reply that had no text of its own). */
export function isTextOnlyFallback(metadata: Record<string, unknown>): boolean {
  return metadata.textIsFallback === true && readMessageVisuals(metadata).length > 0
}

interface MessageVisualsProps {
  blocks: UiBlock[]
  /** Answers a card as the customer. Without it card buttons are disabled and show `disabledHint`. */
  onCardSubmit?: (submission: CardSubmission) => void
  isSubmitting?: boolean
  disabledHint?: string
}

/**
 * The cards, charts, tables, KPI tiles and diagrams of one chat message, each as wide as the chat column
 * (a card squeezed into a bubble is hard to read).
 */
export function MessageVisuals({ blocks, onCardSubmit, isSubmitting = false, disabledHint }: MessageVisualsProps) {
  if (blocks.length === 0) return null
  const answering = { onSubmit: onCardSubmit, acceptsAnyAction: true, isSubmitting, disabledHint: disabledHint ?? messages().visuals.buttonsAreForCustomer }
  return (
    <div className="flex w-full min-w-0 flex-col gap-2 self-stretch text-left">
      {blocks.map((block, index) => (
        <VisualBlock key={index} block={block} answering={block.$ui === 'adaptive_card' ? answering : undefined} />
      ))}
    </div>
  )
}
