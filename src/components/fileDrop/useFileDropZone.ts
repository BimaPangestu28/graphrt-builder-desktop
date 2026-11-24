import { useCallback, useEffect, useRef, useState, type DragEvent, type RefObject } from 'react'
import { isDesktopApp } from '@/api/client'
import { checkDroppedItems, type DroppedItem, type FileDropAccept, type RawDroppedItem } from '@/lib/fileDrop'
import { useFileDropRouter } from './FileDropRouterContext'

/** idle: nothing dragged over the zone; accepting / refusing: something is, and it fits or not. */
export type FileDragState = 'idle' | 'accepting' | 'refusing'

export interface UseFileDropZoneOptions {
  accept: FileDropAccept
  /** The zone takes several items (default false). */
  multiple?: boolean
  /** Called with the accepted items of a drop (never empty). */
  onDrop: (items: DroppedItem[]) => void
  /** No highlight and no drops while true. */
  disabled?: boolean
}

/** HTML drag and drop handlers for the browser preview (desktop drops come through the router). */
export interface BrowserDropHandlers {
  onDragEnter: (event: DragEvent<HTMLElement>) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDragLeave: (event: DragEvent<HTMLElement>) => void
  onDrop: (event: DragEvent<HTMLElement>) => void
}

export interface FileDropZoneState {
  zoneRef: RefObject<HTMLDivElement>
  dragState: FileDragState
  /** Why the last drop (or the current drag) was refused; null when nothing was. */
  rejection: string | null
  clearRejection: () => void
  browserDropHandlers: BrowserDropHandlers
}

function hasDraggedFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

/** Names (and folder flags, when the browser knows) of what was dropped in the browser preview. */
function browserDroppedItems(dataTransfer: DataTransfer): RawDroppedItem[] {
  const items = Array.from(dataTransfer.items ?? []).filter((item) => item.kind === 'file')
  if (items.length > 0 && typeof items[0].webkitGetAsEntry === 'function') {
    return items.flatMap((item) => {
      const entry = item.webkitGetAsEntry()
      if (entry) return [{ path: entry.name, isFolder: entry.isDirectory }]
      const file = item.getAsFile()
      return file ? [{ path: file.name }] : []
    })
  }
  return Array.from(dataTransfer.files ?? []).map((file) => ({ path: file.name }))
}

/**
 * Drag and drop for one drop zone: registers with the window router (desktop drops with real
 * paths, routed to the zone under the pointer) and gives HTML drag and drop handlers for the
 * browser preview. Dropped items are checked against `accept` and `multiple`; refused ones
 * produce `rejection` instead of reaching `onDrop`.
 *
 * @param options - What the zone accepts and what to do with a drop (UseFileDropZoneOptions)
 * @returns The ref to put on the zone's element, its drag state and handlers (FileDropZoneState)
 *
 * @example
 * const { zoneRef, dragState, browserDropHandlers } = useFileDropZone({ accept: { extensions: ['pdf'] }, onDrop: addFiles })
 */
export function useFileDropZone({ accept, multiple = false, onDrop, disabled = false }: UseFileDropZoneOptions): FileDropZoneState {
  const router = useFileDropRouter()
  const zoneRef = useRef<HTMLDivElement>(null)
  const [dragState, setDragState] = useState<FileDragState>('idle')
  const [rejection, setRejection] = useState<string | null>(null)
  const latest = useRef({ accept, multiple, onDrop })
  latest.current = { accept, multiple, onDrop }

  const handleDroppedItems = useCallback((rawItems: RawDroppedItem[]) => {
    setDragState('idle')
    const { accept: currentAccept, multiple: currentMultiple, onDrop: currentOnDrop } = latest.current
    const { accepted, rejection: dropRejection } = checkDroppedItems(rawItems, currentAccept, currentMultiple)
    setRejection(dropRejection)
    if (accepted.length > 0) currentOnDrop(accepted)
  }, [])

  useEffect(() => {
    if (disabled) {
      setDragState('idle')
      return
    }
    return router.register({
      getElement: () => zoneRef.current,
      onHoverChange: (draggedPaths) => {
        if (draggedPaths === null) {
          // A drop that follows sets its own rejection; a drag that left shows none.
          setDragState('idle')
          setRejection(null)
          return
        }
        const { accept: currentAccept, multiple: currentMultiple } = latest.current
        const preview = checkDroppedItems(draggedPaths.map((path) => ({ path })), currentAccept, currentMultiple)
        setRejection(preview.rejection)
        setDragState(preview.rejection && preview.accepted.length === 0 ? 'refusing' : 'accepting')
      },
      onDrop: (paths) => handleDroppedItems(paths.map((path) => ({ path }))),
    })
  }, [router, disabled, handleDroppedItems])

  const browserDropHandlers: BrowserDropHandlers = {
    onDragEnter: (event) => {
      if (disabled || isDesktopApp() || !hasDraggedFiles(event)) return
      event.preventDefault()
      const tooMany = !multiple && (event.dataTransfer.items?.length ?? 0) > 1
      setDragState(tooMany ? 'refusing' : 'accepting')
    },
    onDragOver: (event) => {
      if (disabled || isDesktopApp() || !hasDraggedFiles(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setDragState((current) => (current === 'idle' ? 'accepting' : current))
    },
    onDragLeave: (event) => {
      if (isDesktopApp()) return
      const nextTarget = event.relatedTarget as Node | null
      if (nextTarget && event.currentTarget.contains(nextTarget)) return
      setDragState('idle')
    },
    onDrop: (event) => {
      if (disabled || isDesktopApp()) return
      event.preventDefault()
      handleDroppedItems(browserDroppedItems(event.dataTransfer))
    },
  }

  return { zoneRef, dragState, rejection, clearRejection: () => setRejection(null), browserDropHandlers }
}
