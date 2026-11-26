import { useState } from 'react'
import { isBackendErrorWithCode } from '@/api/client'
import type { McpServerDefinition, McpSignInStatus } from '@/api/connectionTypes'
import { cancelMcpSignIn, setMcpToolApproval, signInMcpServer, signOutMcpServer } from '@/api/mcpServers'
import { Badge, Button, StatusDot, joinClassNames, type StatusDotTone } from '@/components/ui'
import { messages } from '@/i18n'
import { describeError } from '@/lib/agentDisplay'

/** "Signed in", "Not signed in" or "Sign in again: <reason>". */
export function describeSignIn(status: McpSignInStatus | null | undefined): string {
  const text = messages().connections.mcpAuth
  if (!status || status.state === 'signedOut') return text.notSignedIn
  if (status.state === 'expired') return text.signInAgainReason(status.reason)
  return text.signedIn
}

function signInTone(status: McpSignInStatus | null | undefined): StatusDotTone {
  if (status?.state === 'signedIn') return 'ok'
  if (status?.state === 'expired') return 'danger'
  return 'paused'
}

/**
 * The sign-in row of an OAuth server: its state and Sign in / Cancel / Sign out. Signing in
 * opens the browser; the backend waits for the user to finish there (up to 5 minutes).
 */
export function McpSignInRow({ server, onChanged }: { server: McpServerDefinition; onChanged: () => Promise<void> }) {
  const [pendingAction, setPendingAction] = useState<'signIn' | 'signOut' | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const text = messages().connections.mcpAuth
  const status = server.signIn
  const isSignedIn = status?.state === 'signedIn'

  async function signIn() {
    setPendingAction('signIn')
    setErrorMessage(null)
    try {
      await signInMcpServer(server.name)
    } catch (signInError) {
      // Cancelled by the user: nothing to report.
      if (!isBackendErrorWithCode(signInError, 'stopped')) setErrorMessage(text.couldNotSignIn(server.name, describeError(signInError)))
    } finally {
      setPendingAction(null)
      await onChanged()
    }
  }

  async function signOut() {
    setPendingAction('signOut')
    setErrorMessage(null)
    try {
      await signOutMcpServer(server.name)
    } catch (signOutError) {
      setErrorMessage(text.couldNotSignOut(server.name, describeError(signOutError)))
    } finally {
      setPendingAction(null)
      // Also after a failure: the sign-in may be half gone.
      await onChanged()
    }
  }

  const tone = signInTone(status)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-start gap-2">
          <StatusDot tone={tone} className="mt-[5px]" />
          <span className={joinClassNames('text-[13px] leading-normal', tone === 'ok' ? 'text-ok-strong' : tone === 'danger' ? 'text-danger' : 'text-muted')}>
            {pendingAction === 'signIn' ? text.finishInBrowser : describeSignIn(status)}
          </span>
        </span>
        <span className="flex gap-1">
          {pendingAction === 'signIn' ? (
            <Button variant="ghost" size="sm" aria-label={text.cancelSignInName(server.name)} onClick={() => void cancelMcpSignIn(server.name)}>
              {messages().connections.cancel}
            </Button>
          ) : isSignedIn ? (
            <Button variant="ghost" size="sm" aria-label={text.signOutName(server.name)} disabled={pendingAction !== null} onClick={() => void signOut()}>
              {pendingAction === 'signOut' ? text.signingOut : text.signOut}
            </Button>
          ) : (
            <Button size="sm" aria-label={text.signInName(server.name)} disabled={pendingAction !== null} onClick={() => void signIn()}>
              {status?.state === 'expired' ? text.signInAgain : text.signIn}
            </Button>
          )}
        </span>
      </div>
      {errorMessage && (
        <span role="alert" className="text-[13px] text-danger">
          {errorMessage}
        </span>
      )}
    </div>
  )
}

/**
 * Per-tool approvals of a server: which tools a run asks about before calling them. The user
 * can let one tool run on its own, or make it ask again. Collapsed by default.
 */
export function McpToolApprovals({ server, onChanged }: { server: McpServerDefinition; onChanged: () => Promise<void> }) {
  const [pendingTool, setPendingTool] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const text = messages().connections.mcpAuth
  const approvals = server.toolApprovals ?? []
  if (approvals.length === 0) return null
  const relaxed = new Set(server.approval?.withoutApproval ?? [])
  const askingCount = approvals.filter((tool) => tool.asksFirst).length

  async function toggle(tool: string, ask: boolean) {
    setPendingTool(tool)
    setErrorMessage(null)
    try {
      await setMcpToolApproval(server.name, tool, ask)
      await onChanged()
    } catch (toggleError) {
      setErrorMessage(text.couldNotChangeTool(tool, describeError(toggleError)))
    } finally {
      setPendingTool(null)
    }
  }

  return (
    <details className="text-[13px]">
      <summary className="cursor-pointer text-muted">{text.approvalsSummary(askingCount, approvals.length)}</summary>
      <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
        {approvals.map((tool) => {
          const isRelaxed = relaxed.has(tool.name)
          return (
            <li key={tool.name} className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <code className="font-mono text-[12px]">{tool.name}</code>
                <Badge tone={tool.asksFirst ? 'amber' : 'neutral'}>{tool.asksFirst ? text.asksYouFirst : isRelaxed ? text.runsOnItsOwnYouChose : text.runsOnItsOwn}</Badge>
              </span>
              {(tool.asksFirst || isRelaxed) && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={tool.asksFirst ? text.letToolRunName(tool.name) : text.makeToolAskName(tool.name)}
                  disabled={pendingTool !== null}
                  onClick={() => void toggle(tool.name, !tool.asksFirst)}
                >
                  {tool.asksFirst ? text.letItRun : text.askMeFirst}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {errorMessage && (
        <span role="alert" className="mt-1 block text-danger">
          {errorMessage}
        </span>
      )}
    </details>
  )
}
