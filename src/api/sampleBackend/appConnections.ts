import type { Connection } from '@/api/appConnectionTypes'
import { respondWith } from './sampleResponse'

/**
 * Sample app connections (WhatsApp, Gmail, Google Sheets, Telegram) for the browser
 * preview of the Connections design (screen 21), including the signed-out Gmail banner.
 */
const sampleAppConnections: Connection[] = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    category: 'apps',
    state: 'connected',
    connectedLabel: 'Connected',
    connectedDescription: '+62 8•• •••• 1204 · used by 2 agents',
    availableDescription: 'Send and receive messages',
    setupActionLabel: 'Connect',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    category: 'apps',
    state: 'signedOut',
    connectedLabel: 'Connected',
    connectedDescription: 'Used by Morning email digest',
    availableDescription: 'Read and send email',
    setupActionLabel: 'Connect',
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    category: 'apps',
    state: 'connected',
    connectedLabel: 'Connected',
    connectedDescription: 'Used by Lead tracker, Knowledge',
    availableDescription: 'Read and write spreadsheets',
    setupActionLabel: 'Connect',
  },
  {
    id: 'telegram',
    name: 'Telegram',
    category: 'apps',
    state: 'available',
    connectedLabel: 'Connected',
    connectedDescription: 'Not used by any agent yet',
    availableDescription: 'Send and receive messages',
    setupActionLabel: 'Connect',
  },
]

export const sampleAppConnectionsBackend = {
  listAppConnections: (): Promise<Connection[]> => respondWith(() => sampleAppConnections.map((connection) => ({ ...connection }))),
}
