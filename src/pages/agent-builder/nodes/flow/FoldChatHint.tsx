import { useState } from 'react'
import { Icon } from '@/components/ui'
import { messages } from '@/i18n'

/**
 * A one-click hint over a narrow canvas (the chat open beside a small window): fold the
 * chat into its rail to give the steps room. Closing it hides it until the view opens again.
 */
export function FoldChatHint({ onFoldChat, isTight = false }: { onFoldChat: () => void; isTight?: boolean }) {
  const [isDismissed, setIsDismissed] = useState(false)
  if (isDismissed) return null
  return (
    <div role="note" className="nodrag nopan absolute top-3 right-3 z-10 flex items-center gap-1 whitespace-nowrap rounded-full border border-line bg-surface py-0.5 pr-0.5 pl-3 text-[12px] text-ink-2 shadow-sm">
      {!isTight && <span>{messages().nodes.shortOnRoom}</span>}
      <button type="button" onClick={onFoldChat} className="h-6 cursor-pointer rounded-full border-0 bg-transparent px-2 text-[12px] font-semibold text-brand hover:bg-subtle hover:text-brand-strong">
        {messages().nodes.foldTheChat}
      </button>
      <button type="button" aria-label={messages().nodes.hideThisHint} onClick={() => setIsDismissed(true)} className="flex size-6 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted hover:bg-subtle hover:text-ink">
        <Icon name="close" size={11} />
      </button>
    </div>
  )
}
