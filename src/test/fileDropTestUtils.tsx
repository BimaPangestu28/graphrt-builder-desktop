import { act, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { FileDropRouterContext } from '@/components/fileDrop'
import { createFileDropRouter, type DropPoint, type WindowDragDropEvent } from '@/lib/fileDropRouter'

/**
 * Simulates Tauri's window drag and drop in jsdom: a router fed by `emit`, and helpers that
 * place a zone on screen (jsdom lays nothing out) and drag paths over or drop them at a point.
 */
export function createFakeWindowDragDrop() {
  let listener: ((event: WindowDragDropEvent) => void) | null = null
  const router = createFileDropRouter(async (onEvent) => {
    listener = onEvent
    return () => {
      listener = null
    }
  })
  const emit = (event: WindowDragDropEvent) => act(() => listener?.(event))

  return {
    router,
    emit,
    isListening: () => listener !== null,
    Provider: ({ children }: { children: ReactNode }) => <FileDropRouterContext.Provider value={router}>{children}</FileDropRouterContext.Provider>,
    dragOver: (paths: string[], position: DropPoint) => {
      emit({ type: 'enter', paths, position })
      emit({ type: 'over', position })
    },
    drop: (paths: string[], position: DropPoint) => {
      emit({ type: 'enter', paths, position })
      emit({ type: 'drop', paths, position })
    },
  }
}

/** Gives `element` a bounding box at (left, top) of the given size. */
export function placeElement(element: Element, box: { left: number; top: number; width: number; height: number }) {
  const rect = new DOMRect(box.left, box.top, box.width, box.height)
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect)
}

/** The center of a box given to {@link placeElement}. */
export function centerOf(box: { left: number; top: number; width: number; height: number }): DropPoint {
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}

/** Fires an HTML drop of `files` on `element`, as the browser preview gets it. */
export function dropBrowserFiles(element: Element, files: File[]) {
  const dataTransfer = { files, items: files.map((file) => ({ kind: 'file', getAsFile: () => file })), types: ['Files'], dropEffect: 'none' }
  fireEvent.dragEnter(element, { dataTransfer })
  fireEvent.dragOver(element, { dataTransfer })
  fireEvent.drop(element, { dataTransfer })
}
