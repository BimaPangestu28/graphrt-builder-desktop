import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react'
import { messages } from '@/i18n'
import type { CardSubmission } from './adaptive-card/AdaptiveCardView'
import type { UiBlock, UiBlockKind } from './uiBlockTypes'

/**
 * Renders one validated UI block. Each kind's renderer is its own lazily loaded chunk, so screens without
 * cards or charts never download them, and adding a kind is one entry in `renderers`. A renderer that throws
 * shows a short notice instead of taking the screen down.
 */

const ChartView = lazy(() => import('./chart/ChartView'))
const TableView = lazy(() => import('./table/TableView'))
const StatsView = lazy(() => import('./stats/StatsView'))
const AdaptiveCardView = lazy(() => import('./adaptive-card/AdaptiveCardView'))
const DiagramView = lazy(() => import('./diagram/DiagramView'))

export interface CardAnswering {
  /** Without it the card's submit buttons are disabled and show `disabledHint`. */
  onSubmit?: (submission: CardSubmission) => void
  /** The paused step's action ids a button must match. Ignored with `acceptsAnyAction`. */
  answerActionIds?: string[]
  /** In a chat every submit button is an answer: there is no step with a fixed list of actions. */
  acceptsAnyAction?: boolean
  isSubmitting?: boolean
  /** Why the buttons are disabled, when `onSubmit` is missing. */
  disabledHint?: string
}

const renderers: { [Kind in UiBlockKind]: (block: Extract<UiBlock, { $ui: Kind }>, answering?: CardAnswering) => ReactNode } = {
  chart: (block) => <ChartView block={block} />,
  table: (block) => <TableView block={block} />,
  stats: (block) => <StatsView block={block} />,
  adaptive_card: (block, answering) => (
    <AdaptiveCardView
      block={block}
      onSubmit={answering?.onSubmit}
      answerActionIds={answering?.answerActionIds}
      acceptsAnyAction={answering?.acceptsAnyAction}
      isSubmitting={answering?.isSubmitting}
      disabledHint={answering?.disabledHint}
    />
  ),
  diagram: (block) => <DiagramView block={block} />,
}

class RenderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('A UI block failed to render', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.failed) return <p role="alert" className="m-0 text-[13px] text-danger">{messages().visuals.drawingFailed}</p>
    return this.props.children
  }
}

function renderBlock(block: UiBlock, answering?: CardAnswering): ReactNode {
  const render = renderers[block.$ui] as ((block: UiBlock, answering?: CardAnswering) => ReactNode) | undefined
  return render ? render(block, answering) : null
}

interface VisualBlockProps {
  block: UiBlock
  /** For an Adaptive Card that answers a paused step or a chat. */
  answering?: CardAnswering
  /** Drop the title and frame (the approval card has its own). */
  bare?: boolean
}

/**
 * One block in a framed surface with its title and subtitle; full width of the panel. The frame has the
 * class `ui-block`. It uses the colour tokens only, so cards, tables, tiles, charts and diagrams follow
 * the app theme (`data-theme` on the root element, see `index.css`).
 */
export function VisualBlock({ block, answering, bare = false }: VisualBlockProps) {
  const body = (
    <RenderBoundary>
      <Suspense fallback={<div className="py-6 text-[13px] text-muted">{messages().visuals.loading}</div>}>{renderBlock(block, answering)}</Suspense>
    </RenderBoundary>
  )
  if (bare) return body
  const subtitle = 'subtitle' in block ? block.subtitle : undefined
  return (
    <section aria-label={block.title ?? messages().visuals.kindNames[block.$ui]} className="ui-block flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-ink">
      {(block.title || subtitle) && (
        <header className="flex flex-col gap-0.5">
          {block.title && <h3 className="m-0 text-[15px] font-semibold text-ink">{block.title}</h3>}
          {subtitle && <span className="text-[12px] text-muted">{subtitle}</span>}
        </header>
      )}
      {body}
    </section>
  )
}
