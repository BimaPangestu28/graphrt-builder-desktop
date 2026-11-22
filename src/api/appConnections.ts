import type { Connection } from '@/api/appConnectionTypes'
import { isDesktopApp } from './client'
import { sampleAppConnectionsBackend } from './sampleBackend/appConnections'

/**
 * App accounts on the Connections screen (WhatsApp, Gmail...). The desktop app has no
 * account sign-in of its own yet: apps are reached through plugins (the Plugins page), whose tokens are plugin settings. So the desktop app lists none; the browser
 * preview shows the design's sample apps.
 */
export function listAppConnections(): Promise<Connection[]> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleAppConnectionsBackend.listAppConnections()
  return Promise.resolve([])
}
