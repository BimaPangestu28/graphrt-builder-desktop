import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { forgetTeamsBot, getTeamsSetup, saveTeamsBot } from '@/api/channels'
import type { TeamsBotInput, TeamsSetup as TeamsSetupState } from '@/api/channelTypes'
import { openCardLink } from '@/api/runSummary'
import { Button, LinkButton } from '@/components/ui'
import { plainError } from './plainError'
import { getCredentialStoreName } from '@/lib/platform'
import { agentPath } from '@/routes'
import { messages } from '@/i18n'
import { SetupStep } from './SetupStep'
import { CopyRow, SecretField } from './WhatsAppChatbotChannels'

const azurePortalUrl = 'https://portal.azure.com/#create/Microsoft.AzureBot'
const emptyInput: TeamsBotInput = { appId: '', appPassword: '', tenantId: '' }

/**
 * Screen 05, "Microsoft Teams". Teams delivers only to a public HTTPS endpoint, so the
 * chatbot answers from its online copy: make an Azure Bot, save its three values (checked
 * with Microsoft, kept in the OS credential store), put the chatbot online with Teams on,
 * then paste the messaging endpoint into the Azure Bot.
 */
export function TeamsSetup({ agentId }: { agentId: string }) {
  const c = messages().channels
  const [setup, setSetup] = useState<TeamsSetupState | null>(null)
  const [input, setInput] = useState<TeamsBotInput>(emptyInput)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setSetup(await getTeamsSetup(agentId))
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
      await saveTeamsBot(agentId, input)
      setInput(emptyInput)
      await load()
    } catch (saveError) {
      setError(plainError(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  async function forget() {
    try {
      await forgetTeamsBot(agentId)
      await load()
    } catch (forgetError) {
      setError(plainError(forgetError))
    }
  }

  const canSave = input.appId.trim() !== '' && input.appPassword.trim() !== '' && input.tenantId.trim() !== '' && !isSaving
  return (
    <section aria-labelledby="teams-channel-h" className="flex flex-col gap-3 rounded-xl border border-line p-4">
      <h3 id="teams-channel-h" className="m-0 text-[15px] font-semibold">
        {c.teamsChannelTitle}
      </h3>
      <p className="m-0 text-[13px] text-body">{c.teamsWhyOnline}</p>
      <ol aria-label={c.teamsChannelTitle} className="m-0 flex list-none flex-col gap-4 p-0">
        <SetupStep number={1} title={c.teamsMakeBot} isDone={setup?.saved ?? false}>
          <span className="text-[13px] text-body">{c.teamsMakeBotBody}</span>
          <span>
            <button
              type="button"
              onClick={() => void openCardLink(azurePortalUrl).catch(() => undefined)}
              className="cursor-pointer border-0 bg-transparent p-0 text-left text-[13px] font-medium text-brand underline"
            >
              {c.openAzurePortal}
            </button>
          </span>
        </SetupStep>
        <SetupStep number={2} title={c.teamsSaveValues} isDone={setup?.saved ?? false}>
          {setup?.saved ? (
            <div className="flex flex-col gap-2">
              <p role="status" className="m-0 text-[13px] font-medium text-ok-strong">
                {c.teamsValuesSaved}
              </p>
              <span className="text-[12px] text-muted">{c.valuesStayIn(getCredentialStoreName())}</span>
              <span>
                <Button variant="secondary" size="sm" onClick={() => void forget()}>
                  {c.removeValues}
                </Button>
              </span>
            </div>
          ) : (
            <form onSubmit={(event) => void save(event)} aria-label={c.teamsSaveValues} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <SecretField label={c.teamsAppId} help={c.teamsAppIdHelp} value={input.appId} onChange={(appId) => setInput({ ...input, appId })} />
              <SecretField label={c.teamsPassword} help={c.teamsPasswordHelp} value={input.appPassword} onChange={(appPassword) => setInput({ ...input, appPassword })} />
              <SecretField label={c.teamsTenant} help={c.teamsTenantHelp} value={input.tenantId} onChange={(tenantId) => setInput({ ...input, tenantId })} />
              <span className="sm:col-span-3">
                <Button type="submit" size="sm" disabled={!canSave}>
                  {isSaving ? c.checkingWithMicrosoft : c.checkWithMicrosoft}
                </Button>
              </span>
            </form>
          )}
        </SetupStep>
        <SetupStep number={3} title={c.teamsPutOnlineStep} isDone={setup?.online ?? false}>
          {setup?.online ? (
            <span className="text-[13px] font-medium text-ok-strong">{c.teamsIsOnline}</span>
          ) : (
            setup?.saved && (
              <div className="flex flex-col gap-2">
                <span className="text-[13px] text-body">{setup.toolsReady ? c.teamsPutOnlineBody : c.teamsNeedsAppUpdate}</span>
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
        <SetupStep number={4} title={c.teamsTellAzure} isDone={false}>
          {setup?.online && setup.messagingEndpoint && (
            <div className="flex flex-col gap-3">
              <span className="text-[13px] text-body">{c.teamsTellAzureBody}</span>
              <CopyRow label={c.messagingEndpoint} value={setup.messagingEndpoint} />
              <span className="text-[12px] text-muted">{c.teamsInbox}</span>
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
