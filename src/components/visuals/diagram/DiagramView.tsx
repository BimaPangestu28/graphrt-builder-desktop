import { useEffect, useRef, useState } from 'react'
import { messages } from '@/i18n'
import type { DiagramBlock } from '../uiBlockTypes'
import { useThemeName } from '../useThemeName'
import { renderDiagram, type DiagramTheme, type RenderedDiagram } from './renderDiagram'

/**
 * Renders a `diagram` block (Mermaid text) as a picture in the app's theme.
 *
 * Mermaid loads on first use (see `renderDiagram`). The drawing is shown as an `<img>` with an SVG data URL, the
 * browser's sandbox for images: no scripts, no network, no links. Colours come from the theme tokens around the
 * block, so a diagram follows light and dark like the charts do, and is drawn again when the theme changes.
 */

const seriesTokens = [1, 2, 3, 4, 5, 6, 7, 8].map((slot) => `--color-series-${slot}`)

/** The colours of the tokens in effect at `element` (the block's frame sets the dark values). */
function readTheme(element: HTMLElement, isDark: boolean): DiagramTheme {
  const style = getComputedStyle(element)
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    isDark,
    surface: token('--color-surface', isDark ? '#18181B' : '#FFFFFF'),
    ink: token('--color-ink', isDark ? '#F4F4F5' : '#18181B'),
    muted: token('--color-muted', isDark ? '#A1A1AA' : '#5F5F67'),
    line: token('--color-line-heavy', isDark ? '#52525B' : '#D4D4D8'),
    nodeFill: token('--color-chip', isDark ? '#27272A' : '#F2F2F4'),
    groupFill: token('--color-subtle', isDark ? '#1F1F23' : '#FAFAFA'),
    noteFill: token('--color-amber-soft', isDark ? '#3A2A0C' : '#FEF3E2'),
    noteLine: token('--color-amber-line', isDark ? '#7C5A14' : '#F5C77E'),
    series: seriesTokens.map((name) => token(name, '#257DE0')),
  }
}

/** Diagrams wider than this keep their size and scroll sideways; narrower ones shrink to the frame. */
const SCROLL_FROM_WIDTH = 1400

type DrawState = { status: 'drawing' } | { status: 'drawn'; diagram: RenderedDiagram } | { status: 'failed' }

export default function DiagramView({ block }: { block: DiagramBlock }) {
  const frameRef = useRef<HTMLDivElement>(null)
  const themeName = useThemeName()
  const [state, setState] = useState<DrawState>({ status: 'drawing' })

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    let isCurrent = true
    setState((previous) => (previous.status === 'drawn' ? previous : { status: 'drawing' }))
    renderDiagram(block.source, readTheme(frame, themeName === 'dark'))
      .then((diagram) => {
        if (isCurrent) setState({ status: 'drawn', diagram })
      })
      .catch((drawError: unknown) => {
        console.warn('A diagram could not be drawn', drawError)
        if (isCurrent) setState({ status: 'failed' })
      })
    return () => {
      isCurrent = false
    }
  }, [block.source, themeName])

  const description = block.fallback_text ?? block.title ?? messages().visuals.kindNames.diagram
  return (
    <div ref={frameRef} className="min-w-0 overflow-x-auto">
      {state.status === 'drawing' && <div className="py-6 text-[13px] text-muted">{messages().visuals.loading}</div>}
      {state.status === 'failed' && (
        <div role="note" className="flex flex-col gap-1 text-[13px]">
          <span className="text-amber-strong">{messages().visuals.diagramNotDrawn}</span>
          {block.fallback_text && <span className="text-body">{block.fallback_text}</span>}
        </div>
      )}
      {state.status === 'drawn' && (
        <img
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(state.diagram.svg)}`}
          alt={description}
          width={state.diagram.width}
          height={state.diagram.height}
          draggable={false}
          className="mx-auto block h-auto"
          style={{ maxWidth: state.diagram.width > SCROLL_FROM_WIDTH ? 'none' : '100%' }}
        />
      )}
    </div>
  )
}
