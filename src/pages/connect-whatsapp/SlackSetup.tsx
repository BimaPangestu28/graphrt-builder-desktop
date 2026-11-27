import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { checkSlackTokens, connectSlack, disconnectSlack, getSlackConnection } from '@/api/channels'
import type { SlackApp, SlackConnection, SlackTokens } from '@/api/channelTypes'
import { openCardLink } from '@/api/runSummary'
import { Button } from '@/components/ui'
import { plainError } from './plainError'
import { getCredentialStoreName } from '@/lib/platform'
import { messages } from '@/i18n'
import { SetupStep } from './SetupStep'
import { SecretField } from './WhatsAppChatbotChannels'

const slackAppsUrl = 'https://api.slack.com/apps'
/** How often the status is read while the step is open. */
const statusRefreshMs = 3000
const emptyTokens: SlackTokens = { botToken: '', appToken: '' }

function ConnectionStatus({ connection }: { connection: SlackConnection }) {
  const c = messages().channels
  const isConnected = connection.state === 'connected'
  return (
    <p role={isConnected ? 'status' : 'alert'} className={isConnected ? 'm-0 text-[13px] font-medium text-ok-strong' : 'm-0 text-[13px] text-danger'}>
      {isConnected ? c.slackAnsweringIn(connection.app.team ?? 'Slack') : c.slackStates[connection.state]}
    </p>
  )
}

/**
 * Screen 05, "Slack": make a Slack app, give it its permissions, turn on Socket Mode, then
 * paste and test its two tokens and connect it. Socket Mode means the app connects out to
 * Slack, so it runs on this computer with no address on the internet. Both tokens go to the
 * OS credential store.
 */
export function SlackSetup({ agentId }: { agentId: string }) {
  const c = messages().channels
  const [tokens, setTokens] = useState<SlackTokens>(emptyTokens)
  const [checked, setChecked] = useState<SlackApp | null>(null)
  const [connection, setConnection] = useState<SlackConnection | null>(null)
  const [pending, setPending] = useState<'testing' | 'connecting' | 'disconnecting' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setConnection(await getSlackConnection(agentId))
    } catch (loadError) {
      setError(plainError(loadError))
    }
  }, [agentId])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), statusRefreshMs)
    return () => window.clearInterval(timer)
  }, [refresh])

  function change(next: SlackTokens) {
    setTokens(next)
    setChecked(null)
  }

  async function test(event: FormEvent) {
    event.preventDefault()
    setPending('testing')
    setError(null)
    setChecked(null)
    try {
      setChecked(await checkSlackTokens(tokens))
    } catch (checkError) {
      setError(plainError(checkError))
    } finally {
      setPending(null)
    }
  }

  async function connect() {
    setPending('connecting')
    setError(null)
    try {
      setConnection(await connectSlack(agentId, tokens))
      setTokens(emptyTokens)
      setChecked(null)
    } catch (connectError) {
      setError(plainError(connectError))
    } finally {
      setPending(null)
    }
  }

  async function disconnect() {
    setPending('disconnecting')
    setError(null)
    try {
      await disconnectSlack(agentId)
      setConnection(null)
    } catch (disconnectError) {
      setError(plainError(disconnectError))
    } finally {
      setPending(null)
    }
  }

  const isReady = connection !== null || checked !== null
  const canTest = tokens.botToken.trim() !== '' && tokens.appToken.trim() !== '' && pending === null
  return (
    <div className="flex flex-col gap-4">
      <ol aria-label={c.setUpSlack} className="m-0 flex list-none flex-col gap-4 p-0">
        <SetupStep number={1} title={c.slackMakeApp} isDone={isReady}>
          <span className="text-[13px] text-body">{c.slackMakeAppBody}</span>
          <span>
            <button
              type="button"
              onClick={() => void openCardLink(slackAppsUrl).catch(() => undefined)}
              className="cursor-pointer border-0 bg-transparent p-0 text-left text-[13px] font-medium text-brand underline"
            >
              {c.openSlackApps}
            </button>
          </span>
        </SetupStep>
        <SetupStep number={2} title={c.slackPermissions} isDone={isReady}>
          <span className="text-[13px] text-body">{c.slackPermissionsBody}</span>
        </SetupStep>
        <SetupStep number={3} title={c.slackSocket} isDone={isReady}>
          <span className="text-[13px] text-body">{c.slackSocketBody}</span>
        </SetupStep>
        <SetupStep number={4} title={c.pasteSlackTokens} isDone={isReady}>
          {connection === null && (
            <form onSubmit={(event) => void test(event)} aria-label={c.pasteSlackTokens} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SecretField label={c.slackBotToken} help={c.slackBotTokenHelp} value={tokens.botToken} onChange={(botToken) => change({ ...tokens, botToken })} />
              <SecretField label={c.slackAppToken} help={c.slackAppTokenHelp} value={tokens.appToken} onChange={(appToken) => change({ ...tokens, appToken })} />
              <span className="sm:col-span-2">
                <Button type="submit" variant="secondary" size="sm" disabled={!canTest}>
                  {pending === 'testing' ? c.testing : c.testTokens}
                </Button>
              </span>
            </form>
          )}
          {checked && connection === null && (
            <p role="status" className="m-0 text-[13px] font-medium text-ok-strong">
              {c.slackFound(checked.team ?? 'Slack')}
            </p>
          )}
        </SetupStep>
        <SetupStep number={5} title={c.connectToThisChatbot} isDone={connection?.state === 'connected'}>
          {connection === null && checked && (
            <span>
              <Button size="sm" disabled={pending !== null} onClick={() => void connect()}>
                {pending === 'connecting' ? c.connecting : c.connectApp}
              </Button>
            </span>
          )}
          {connection && (
            <div className="flex flex-col gap-2">
              <ConnectionStatus connection={connection} />
              <span className="text-[12px] text-muted">{c.slackWorksWhileOpen}</span>
              <span>
                <Button variant="secondary" size="sm" disabled={pending !== null} onClick={() => void disconnect()}>
                  {pending === 'disconnecting' ? c.disconnecting : c.disconnect}
                </Button>
              </span>
            </div>
          )}
        </SetupStep>
      </ol>
      {error && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {error}
        </p>
      )}
      <p className="m-0 text-[12px] text-muted">{c.slackTokensStayIn(getCredentialStoreName())}</p>
    </div>
  )
}
