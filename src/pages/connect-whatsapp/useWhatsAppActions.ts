import { useCallback, useEffect, useState } from 'react'
import { readPluginActionData, runPluginAction } from '@/api/plugins'
import { describeError } from '@/lib/agentDisplay'

/** Plugin and node kinds screen 05 runs. */
export const whatsAppApiPluginName = 'whatsapp-api'
export const whatsAppWebPluginName = 'whatsapp-web'
const businessProfileKind = 'whatsapp-api.get_business_profile'
const webLoginKind = 'whatsapp-web.login'
const webStatusKind = 'whatsapp-web.get_status'
/** How long the QR window waits for a scan. */
export const qrLoginTimeoutSeconds = 180

export type BusinessConnectionResult = { kind: 'connected'; businessName: string | null } | { kind: 'failed'; message: string }

/** "Check connection" for the official API: runs `whatsapp-api.get_business_profile`. */
export function useBusinessConnectionCheck() {
  const [isChecking, setIsChecking] = useState(false)
  const [result, setResult] = useState<BusinessConnectionResult | null>(null)

  const checkConnection = useCallback(async () => {
    setIsChecking(true)
    setResult(null)
    try {
      const profile = readPluginActionData(await runPluginAction(whatsAppApiPluginName, businessProfileKind, {}))
      setResult({ kind: 'connected', businessName: typeof profile.verified_name === 'string' ? profile.verified_name : null })
    } catch (checkError) {
      setResult({ kind: 'failed', message: describeError(checkError) })
    } finally {
      setIsChecking(false)
    }
  }, [])

  return { isChecking, result, checkConnection }
}

/** `outputs.data` of `whatsapp-web.get_status` / `login`: `logged_in`, `needs_login` or `loading`, maybe with a message. */
export interface WhatsAppWebStatus {
  status: string
  message: string | null
  sendsToday: number | null
}

function toWhatsAppWebStatus(statusData: Record<string, unknown>): WhatsAppWebStatus {
  return {
    status: typeof statusData.status === 'string' ? statusData.status : 'unknown',
    message: typeof statusData.message === 'string' ? statusData.message : null,
    sendsToday: typeof statusData.sends_today === 'number' ? statusData.sends_today : null,
  }
}

type WebSessionAction = 'linking' | 'checking'

/**
 * The personal WhatsApp session: "Link WhatsApp" runs `whatsapp-web.login` (the plugin
 * opens a browser window with the QR code and resolves once it is scanned or times out),
 * and "Refresh status" runs `whatsapp-web.get_status`.
 *
 * @param options.checksOnMount - Run `get_status` once when mounted, so the link status shows right away (boolean)
 */
export function useWhatsAppWebSession({ checksOnMount = false }: { checksOnMount?: boolean } = {}) {
  const [pendingAction, setPendingAction] = useState<WebSessionAction | null>(checksOnMount ? 'checking' : null)
  const [sessionStatus, setSessionStatus] = useState<WhatsAppWebStatus | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const runSessionAction = useCallback(async (action: WebSessionAction, kind: string, config: Record<string, unknown>) => {
    setPendingAction(action)
    setErrorMessage(null)
    try {
      setSessionStatus(toWhatsAppWebStatus(readPluginActionData(await runPluginAction(whatsAppWebPluginName, kind, config))))
    } catch (actionError) {
      setErrorMessage(describeError(actionError))
    } finally {
      setPendingAction(null)
    }
  }, [])

  const showQrCode = useCallback(() => runSessionAction('linking', webLoginKind, { timeout_seconds: qrLoginTimeoutSeconds }), [runSessionAction])
  const refreshStatus = useCallback(() => runSessionAction('checking', webStatusKind, {}), [runSessionAction])

  useEffect(() => {
    if (checksOnMount) void refreshStatus()
  }, [checksOnMount, refreshStatus])

  return { pendingAction, sessionStatus, errorMessage, showQrCode, refreshStatus }
}
