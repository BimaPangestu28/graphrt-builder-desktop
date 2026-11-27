import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import {
  forgetWhatsAppBusiness,
  getWhatsAppBusinessSetup,
  getWhatsAppWebChannel,
  revealWhatsAppVerifyToken,
  saveWhatsAppBusiness,
  setWhatsAppWebChatbot,
} from '@/api/channels'
import type { WhatsAppBusinessInput, WhatsAppBusinessSetup, WhatsAppWebChannel } from '@/api/channelTypes'
import { Button, LinkButton } from '@/components/ui'
import { plainError } from './plainError'
import { getCredentialStoreName } from '@/lib/platform'
import { agentPath } from '@/routes'
import { messages } from '@/i18n'
import { SetupStep } from './SetupStep'

const inputClassNames =
  'box-border h-9 w-full min-w-0 rounded-lg border border-line-strong bg-surface px-3 font-mono text-[13px] text-ink outline-none focus:border-brand'

function SecretField({ label, help, value, onChange }: { label: string; help: string; value: string; onChange: (value: string) => void }) {
  const id = useId()
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-[12px] font-medium text-ink-2">
        {label}
      </label>
      <input id={id} type="password" autoComplete="off" spellCheck={false} value={value} onChange={(event) => onChange(event.target.value)} className={inputClassNames} />
      <span className="text-[12px] text-muted">{help}</span>
    </div>
  )
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const c = messages().channels
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[12px] font-medium text-ink-2">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-[1_1_240px] truncate rounded-lg bg-canvas px-3 py-2 text-[12px]">{value}</code>
        <Button
          variant="secondary"
          size="sm"
          aria-label={`${c.copy} ${label}`}
          onClick={() => void navigator.clipboard?.writeText(value).then(() => setCopied(true), () => undefined)}
        >
          {copied ? c.copied : c.copy}
        </Button>
      </div>
    </div>
  )
}

const emptyInput: WhatsAppBusinessInput = { accessToken: '', phoneNumberId: '', appSecret: '' }

/**
 * WhatsApp Business as a customer channel of a chatbot. Meta delivers only to a public
 * webhook, so the chatbot answers from its online copy: save the four values (checked with
 * Meta, kept in the OS credential store), put it online with WhatsApp Business on, then
 * enter the callback URL and verify token in the Meta app.
 */
export function WhatsAppBusinessChannel({ agentId }: { agentId: string }) {
  const c = messages().channels
  const t = messages().chatbot
  const [setup, setSetup] = useState<WhatsAppBusinessSetup | null>(null)
  const [input, setInput] = useState<WhatsAppBusinessInput>(emptyInput)
  const [verifyToken, setVerifyToken] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setSetup(await getWhatsAppBusinessSetup(agentId))
    } catch (loadError) {
      setError(plainError(loadError))
    }
  }, [agentId])

  useEffect(() => {
    void load()
  }, [load])

  async function save(event: FormEvent) {
    event.preventDefault()
    setIsSaving(true)
    setError(null)
    try {
      await saveWhatsAppBusiness(agentId, input)
      setInput(emptyInput)
      await load()
    } catch (saveError) {
      setError(plainError(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  async function reveal() {
    try {
      setVerifyToken(await revealWhatsAppVerifyToken(agentId))
    } catch (revealError) {
      setError(plainError(revealError))
    }
  }

  async function forget() {
    try {
      await forgetWhatsAppBusiness(agentId)
      setVerifyToken(null)
      await load()
    } catch (forgetError) {
      setError(plainError(forgetError))
    }
  }

  const canSave = input.accessToken.trim() !== '' && input.phoneNumberId.trim() !== '' && input.appSecret.trim() !== '' && !isSaving
  const number = setup?.number
  return (
    <section aria-labelledby="wa-business-channel-h" className="flex flex-col gap-3 rounded-xl border border-line p-4">
      <h3 id="wa-business-channel-h" className="m-0 text-[15px] font-semibold">
        {c.businessChannelTitle}
      </h3>
      <p className="m-0 text-[13px] text-body">{c.whyOnline}</p>
      <ol aria-label={c.businessChannelTitle} className="m-0 flex list-none flex-col gap-4 p-0">
        <SetupStep number={1} title={c.saveTheValues} isDone={setup?.saved ?? false}>
          {setup?.saved && number ? (
            <div className="flex flex-col gap-2">
              <p role="status" className="m-0 text-[13px] font-medium text-ok-strong">
                {c.numberConfirmed(number.verifiedName ?? '', number.displayPhoneNumber ?? '')}
              </p>
              <span className="text-[12px] text-muted">{c.valuesStayIn(getCredentialStoreName())}</span>
              <span>
                <Button variant="secondary" size="sm" onClick={() => void forget()}>
                  {c.removeValues}
                </Button>
              </span>
            </div>
          ) : (
            <form onSubmit={(event) => void save(event)} aria-label={c.saveTheValues} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <SecretField label={t.accessToken} help={c.accessTokenHelp} value={input.accessToken} onChange={(accessToken) => setInput({ ...input, accessToken })} />
              <SecretField label={t.phoneNumberId} help={c.phoneNumberIdHelp} value={input.phoneNumberId} onChange={(phoneNumberId) => setInput({ ...input, phoneNumberId })} />
              <SecretField label={c.appSecret} help={c.appSecretHelp} value={input.appSecret} onChange={(appSecret) => setInput({ ...input, appSecret })} />
              <span className="sm:col-span-3">
                <Button type="submit" size="sm" disabled={!canSave}>
                  {isSaving ? c.checkingWithMeta : c.checkAndSave}
                </Button>
              </span>
            </form>
          )}
        </SetupStep>
        <SetupStep number={2} title={c.putItOnlineStep} isDone={setup?.online ?? false}>
          {setup?.online ? (
            <span className="text-[13px] font-medium text-ok-strong">{c.isOnline}</span>
          ) : (
            setup?.saved && (
              <div className="flex flex-col gap-2">
                <span className="text-[13px] text-body">{setup.toolsReady ? c.putItOnlineBody : c.needsAppUpdate}</span>
                {setup.toolsReady && (
                  <span>
                    <LinkButton to={agentPath('putOnline', agentId)} variant="secondary" size="sm">
                      {c.openPutItOnline}
                    </LinkButton>
                  </span>
                )}
              </div>
            )
          )}
        </SetupStep>
        <SetupStep number={3} title={c.tellMeta} isDone={false}>
          {setup?.online && setup.webhookUrl && (
            <div className="flex flex-col gap-3">
              <span className="text-[13px] text-body">{c.tellMetaBody}</span>
              <CopyRow label={c.callbackUrl} value={setup.webhookUrl} />
              {verifyToken ? (
                <CopyRow label={c.verifyToken} value={verifyToken} />
              ) : (
                <span>
                  <Button variant="secondary" size="sm" aria-label={`${c.show} ${c.verifyToken}`} onClick={() => void reveal()}>
                    {c.show} {c.verifyToken}
                  </Button>
                </span>
              )}
              <span className="text-[12px] text-muted">{c.businessInbox}</span>
            </div>
          )}
        </SetupStep>
      </ol>
      {error && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {error}
        </p>
      )}
    </section>
  )
}

/**
 * The personal WhatsApp as a customer channel of a chatbot: one switch. The chatbot then
 * reads new chats while the app is open and answers them; the plugin's limits stay on.
 */
export function PersonalWhatsAppChannel({ agentId }: { agentId: string }) {
  const c = messages().channels
  const [channel, setChannel] = useState<WhatsAppWebChannel | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isCurrent = true
    getWhatsAppWebChannel().then(
      (loaded) => isCurrent && setChannel(loaded),
      (loadError: unknown) => isCurrent && setError(plainError(loadError)),
    )
    return () => {
      isCurrent = false
    }
  }, [])

  async function toggle(isOn: boolean) {
    setError(null)
    try {
      setChannel(await setWhatsAppWebChatbot(isOn ? agentId : null))
    } catch (toggleError) {
      setError(plainError(toggleError))
    }
  }

  const answersHere = channel?.agentId === agentId
  return (
    <section aria-labelledby="wa-personal-channel-h" className="flex flex-col gap-2 rounded-xl border border-line p-4">
      <h3 id="wa-personal-channel-h" className="m-0 text-[15px] font-semibold">
        {c.personalChannelTitle}
      </h3>
      <p className="m-0 text-[13px] text-body">{c.personalChannelBody}</p>
      <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium">
        <input type="checkbox" checked={answersHere} disabled={channel === null} onChange={(event) => void toggle(event.target.checked)} className="size-[18px] accent-brand" />
        {c.answerOnPersonal}
      </label>
      {channel && !answersHere && channel.agentId !== null && <span className="text-[12px] text-muted">{c.otherChatbotAnswers}</span>}
      {channel && answersHere && (
        <span role="status" className={channel.state === 'not_linked' ? 'text-[13px] text-danger' : 'text-[13px] text-ok-strong'}>
          {c.personalStates[channel.state]}
        </span>
      )}
      {error && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {error}
        </p>
      )}
    </section>
  )
}
