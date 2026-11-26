import { useState } from 'react'
import type { NodeConfig } from '@/api/agentGraphTypes'
import { Button } from '@/components/ui'
import { edgesFromExit, removeExit } from './branchEdits'
import { linkButtonClassName } from './fields'
import { useInspector } from './InspectorContext'
import { messages } from '@/i18n'

/**
 * "Remove" for a case, category or button that is a port. With an arrow on that port it
 * asks first, then removes the item and its arrow as one undo step.
 */
interface ExitRemoveButtonProps {
  /** The port id (case_id, class id, action id). */
  handleId: string
  /** Name in the question and the summary ("Case 1"). */
  itemName: string
  /** The config without the item. */
  nextConfig: NodeConfig
  disabled?: boolean
}

export function ExitRemoveButton({ handleId, itemName, nextConfig, disabled }: ExitRemoveButtonProps) {
  const { node, graph, controller, readOnly, updateNode } = useInspector()
  const [isConfirming, setIsConfirming] = useState(false)
  const arrowCount = edgesFromExit(graph, node.id, handleId).length
  const remove = () => {
    setIsConfirming(false)
    if (readOnly) return
    if (arrowCount === 0) {
      updateNode({ config: nextConfig }, messages().nodes.removedItemname(itemName))
      return
    }
    controller.applyEdit((current) => removeExit(current, node.id, nextConfig, handleId), messages().nodes.removedItemnameAndItsArrowOn(itemName, node.displayTitle))
  }
  if (isConfirming) {
    return (
      <span role="alertdialog" aria-label={messages().nodes.removeItemname(itemName)} className="flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
        {itemName} {messages().nodes.hasAnArrowRemoveBoth}
        <Button size="sm" variant="danger" className="h-7 px-2 text-[12px]" onClick={remove}>
          {messages().nodes.remove}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-[12px]" onClick={() => setIsConfirming(false)}>
          {messages().nodes.keep}
        </Button>
      </span>
    )
  }
  return (
    <button type="button" aria-label={messages().nodes.removeItemname2(itemName)} className={linkButtonClassName} disabled={disabled || readOnly} onClick={() => (arrowCount > 0 ? setIsConfirming(true) : remove())}>
      {messages().nodes.remove}
    </button>
  )
}
