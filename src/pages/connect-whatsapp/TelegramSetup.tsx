import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { checkTelegramToken, connectTelegram, disconnectTelegram, getTelegramConnection } from '@/api/channels'
import type { TelegramConnection, TelegramTokenCheck } from '@/api/channelTypes'
import { openCardLink } from '@/api/runSummary'
import { Button } from '@/components/ui'
import { describeError } from '@/lib/agentDisplay'
import { getCredentialStoreName } from '@/lib/platform'
import { messages } from '@/i18n'
import { SetupStep } from './SetupStep'

const botFatherUrl = 'https://t.me/BotFather'
/** How often the status is read while the step is open. */
const statusRefreshMs = 3000

const inputClassNames =
  'box-border h-9 min-w-0 flex-[1_1_260px] rounded-lg border border-line-strong bg-surface px-3 font-mono text-[13px] text-ink outline-none focus:border-brand'

/** A link that opens in the browser (t.me opens Telegram). */
function ExternalLink({ url, children }: { url: string; children: string }) {
  return (
    <button
      type="button"
      onClick={() => void openCardLink(url).catch(() => undefined)}
      className="cursor-pointer border-0 bg-transparent p-0 text-left text-[13px] font-medium text-brand underline"
    >
      {children}
    </button>
  )
}

function ConnectionStatus({ connection }: { connection: TelegramConnection }) {
  const c = messages().channels
  const account = connection.bot.username ? `@${connection.bot.username}` : (connection.bot.name ?? '')
  const isConnected = connection.state === 'connected'
  return (
    <p role={isConnected ? 'status' : 'alert'} className={isConnected ? 'm-0 text-[13px] font-medium text-ok-strong' : 'm-0 text-[13px] text-danger'}>
      {isConnected ? c.answeringAs(account) : c.telegramStates[connection.state]}
    </p>
  )
}

/**
 * Screen 05, "Telegram": make a bot with @BotFather, paste and test its token (the bot's name
 * and a t.me link to try it), then connect it to this chatbot. The token goes to the OS
 * credential store; the status says in plain words what is wrong.
 */
export function TelegramSetup({ agentId }: { agentId: string }) {
  const c = messages().channels
  const tokenId = useId()
  const [token, setToken] = useState('')
  const [checked, setChecked] = useState<TelegramTokenCheck | null>(null)
  const [connection, setConnection] = useState<TelegramConnection | null>(null)
  const [pending, setPending] = useState<'testing' | 'connecting' | 'disconnecting' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setConnection(await getTelegramConnection(agentId))
    } catch (loadError) {
      setError(describeError(loadError))
    }
  }, [agentId])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), statusRefreshMs)
    return () => window.clearInterval(timer)
  }, [refresh])

  async function testToken(event: FormEvent) {
    event.preventDefault()
    setPending('testing')
    setError(null)
    setChecked(null)
    try {
      setChecked(await checkTelegramToken(token))
    } catch (checkError) {
      setError(describeError(checkError))
    } finally {
      setPending(null)
    }
  }

  async function connect() {
    setPending('connecting')
    setError(null)
    try {
      setConnection(await connectTelegram(agentId, token))
      setToken('')
      setChecked(null)
    } catch (connectError) {
      setError(describeError(connectError))
    } finally {
      setPending(null)
    }
  }

  async function disconnect() {
    setPending('disconnecting')
    setError(null)
    try {
      await disconnectTelegram(agentId)
      setConnection(null)
    } catch (disconnectError) {
      setError(describeError(disconnectError))
    } finally {
      setPending(null)
    }
  }

  const link = connection?.link ?? checked?.link ?? null
  return (
    <div className="flex flex-col gap-4">
      <ol aria-label={c.setUpTelegram} className="m-0 flex list-none flex-col gap-4 p-0">
        <SetupStep number={1} title={c.makeABot} isDone={connection !== null || checked !== null}>
          <span className="text-[13px] text-body">{c.makeABotBody}</span>
          <span>
            <ExternalLink url={botFatherUrl}>{c.openBotFather}</ExternalLink>
          </span>
        </SetupStep>
        <SetupStep number={2} title={c.pasteAndTest} isDone={connection !== null || checked !== null}>
          {connection === null && (
            <form onSubmit={(event) => void testToken(event)} aria-label={c.pasteAndTest} className="flex flex-col gap-1.5">
              <label htmlFor={tokenId} className="text-[12px] font-medium text-ink-2">
                {c.botToken}
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  id={tokenId}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="123456789:AAE…"
                  value={token}
                  onChange={(event) => {
                    setToken(event.target.value)
                    setChecked(null)
                  }}
                  className={inputClassNames}
                />
                <Button type="submit" variant="secondary" size="sm" disabled={token.trim() === '' || pending !== null}>
                  {pending === 'testing' ? c.testing : c.testToken}
                </Button>
              </div>
            </form>
          )}
          {checked && connection === null && (
            <p role="status" className="m-0 text-[13px] font-medium text-ok-strong">
              {c.botFound(checked.bot.name ?? '', checked.bot.username ?? '')}
            </p>
          )}
        </SetupStep>
        <SetupStep number={3} title={c.connectToThisChatbot} isDone={connection?.state === 'connected'}>
          {connection === null && checked && (
            <span>
              <Button size="sm" disabled={pending !== null} onClick={() => void connect()}>
                {pending === 'connecting' ? c.connecting : c.connectBot}
              </Button>
            </span>
          )}
          {connection && (
            <div className="flex flex-col gap-2">
              <ConnectionStatus connection={connection} />
              <span className="text-[12px] text-muted">{c.worksWhileOpen}</span>
              <span>
                <Button variant="secondary" size="sm" disabled={pending !== null} onClick={() => void disconnect()}>
                  {pending === 'disconnecting' ? c.disconnecting : c.disconnect}
                </Button>
              </span>
            </div>
          )}
          {link && <ExternalLink url={link}>{c.tryItInTelegram}</ExternalLink>}
        </SetupStep>
      </ol>
      {error && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {error}
        </p>
      )}
      <p className="m-0 text-[12px] text-muted">{c.tokenStaysIn(getCredentialStoreName())}</p>
    </div>
  )
}
