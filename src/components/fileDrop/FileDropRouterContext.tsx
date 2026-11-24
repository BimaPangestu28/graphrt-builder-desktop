import { createContext, useContext } from 'react'
import { subscribeToWindowDragDrop } from '@/api/fileDrop'
import { createFileDropRouter, type FileDropRouter } from '@/lib/fileDropRouter'

/** The app-wide router fed by Tauri's window drag and drop events. */
const windowFileDropRouter = createFileDropRouter(subscribeToWindowDragDrop)

/**
 * The router drop zones register with. Tests provide a router fed by a fake source to
 * simulate desktop drops at a position.
 */
export const FileDropRouterContext = createContext<FileDropRouter>(windowFileDropRouter)

/** The router of the nearest {@link FileDropRouterContext} provider (the window router by default). */
export function useFileDropRouter(): FileDropRouter {
  return useContext(FileDropRouterContext)
}
