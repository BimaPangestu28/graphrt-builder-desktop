import type { ReactNode } from 'react'
import { joinClassNames } from '@/components/ui'
import { messages } from '@/i18n'

/** Column of one builder reply in the build chat. */
export const assistantBlockClassNames = 'flex max-w-[92%] flex-col'

/** Prefix of a failed change in the build chat, live or saved. */
export function describeFailedChange(errorMessage: string): string {
  return messages().builder.couldNotChangeTheAgentReason(errorMessage)
}

/** Right-aligned grey bubble for what the user typed in the build chat (screens 03 and 04). */
export function UserChatBubble({ children }: { children: ReactNode }) {
  return <div className="box-content max-w-[85%] self-end rounded-[16px_16px_4px_16px] bg-canvas px-4 py-3 leading-normal">{children}</div>
}

/** Panel header row with the fixed 64px height used above the chat and the agent panels. */
export function PanelHeader({ className, children }: { className?: string; children: ReactNode }) {
  return <header className={joinClassNames('box-border flex h-16 items-center border-b border-line px-6', className)}>{children}</header>
}
