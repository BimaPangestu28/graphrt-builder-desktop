import type { ReactNode } from 'react'
import { joinClassNames } from '@/components/ui'

/** Padding every single-column page uses inside the main panel, so titles start at the same x/y. */
export const pageFramePaddingClassName = 'px-8 py-7'

/** The page title: one size on every page. */
export const pageTitleClassName = 'm-0 text-[26px] font-semibold tracking-[-0.5px]'

interface PageFrameProps {
  children: ReactNode
  /** Names the frame as a region (renders a `<section>`); without it the frame is a plain `<div>`. */
  ariaLabel?: string
  /** 'stack' (default) lays children in a column; 'wrap' lets them sit side by side and wrap. */
  layout?: 'stack' | 'wrap'
  /** Extra classes, e.g. a flex basis when the frame shares the panel with a side panel. */
  className?: string
}

/**
 * The shared frame for single-column pages (Home, Runs, Schedule, Knowledge, Inbox, Plugins,
 * Connections, Settings…): the same padding and gap everywhere, full width of the main panel.
 * Split-pane screens (builder, test run, chat detail) keep their own layout.
 * Marked with `data-page-frame` so tests can check a page uses it.
 *
 * @example
 * <AppShell activeNav="runs"><PageFrame><PageTitleBlock title="Runs" subtitle="…" /></PageFrame></AppShell>
 */
export function PageFrame({ children, ariaLabel, layout = 'stack', className }: PageFrameProps) {
  const frameClassName = joinClassNames(
    'box-border flex w-full min-w-0 gap-6',
    layout === 'stack' ? 'flex-col' : 'flex-wrap content-start',
    pageFramePaddingClassName,
    className,
  )
  if (ariaLabel) {
    return (
      <section aria-label={ariaLabel} data-page-frame="" className={frameClassName}>
        {children}
      </section>
    )
  }
  return (
    <div data-page-frame="" className={frameClassName}>
      {children}
    </div>
  )
}

interface PageTitleBlockProps {
  title: ReactNode
  /** One line under the title (ReactNode); kept under ~90 characters wide. */
  subtitle?: ReactNode
  /** Buttons or search on the right of the title, wrapping below it on narrow widths. */
  actions?: ReactNode
  className?: string
}

/** The page heading: a 26px title with a short subtitle, plus optional actions on the right. */
export function PageTitleBlock({ title, subtitle, actions, className }: PageTitleBlockProps) {
  const heading = (
    <div className="flex min-w-0 flex-col gap-1">
      <h1 className={pageTitleClassName}>{title}</h1>
      {subtitle !== undefined && <span className="min-h-[1lh] max-w-[90ch] leading-normal text-body">{subtitle}</span>}
    </div>
  )
  if (!actions) return <div className={className}>{heading}</div>
  return (
    <div className={joinClassNames('flex flex-wrap items-end justify-between gap-4', className)}>
      {heading}
      {actions}
    </div>
  )
}
