import type { ReactNode } from 'react'
import { joinClassNames } from '@/components/ui'
import { Sidebar, type SidebarProps } from './Sidebar'

interface AppShellProps extends SidebarProps {
  /** Extra classes for the white main panel (padding, layout). Defaults to none so pages control their own layout. */
  mainClassName?: string
  children: ReactNode
}

/**
 * The window layout used by every in-app screen: grey canvas, sidebar on the left,
 * and a white rounded main panel inset 8px from the window edge.
 * Wraps on narrow widths so the sidebar stacks above the content.
 */
export function AppShell({ mainClassName, children, ...sidebarProps }: AppShellProps) {
  return (
    <div className="box-border flex min-h-screen flex-wrap bg-canvas text-[14px] text-ink">
      <Sidebar {...sidebarProps} />
      <main
        className={joinClassNames(
          'm-2 box-border min-w-0 flex-[999_1_560px] overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)] md:ml-0',
          mainClassName,
        )}
      >
        {children}
      </main>
    </div>
  )
}
