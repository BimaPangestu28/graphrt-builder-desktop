import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { getLiveOnlineFeatures } from '@/api/deploy'
import type { LiveFeatures, OnlineFeatures, OnlineTarget } from '@/api/deployTypes'
import { Badge, Button, LinkButton } from '@/components/ui'
import { messages } from '@/i18n'
import { plainErrorMessage } from './deployDisplay'
import { onlineTargetKey } from './onlineFeatures'
import { PairedPhones } from './PairedPhones'

interface OnlineFeaturesPanelProps {
  target: OnlineTarget
  /** Where the choices are changed (the Review screen); absent for a server the IT team runs. */
  changeTo?: string
  /** What the online copy was put online with (an agent's own choices), for what the server does not report. */
  chosen?: OnlineFeatures
}

function CopyRow({ label, value, copyLabel, isCode = false }: { label: string; value: string; copyLabel: string; isCode?: boolean }) {
  const [isCopied, setIsCopied] = useState(false)
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] text-ink-2">{label}</span>
      <span className="flex flex-wrap items-center gap-2">
        <code className={isCode ? 'min-w-0 flex-[1_1_260px] overflow-x-auto whitespace-nowrap rounded-lg bg-subtle px-3 py-2 font-mono text-[12px]' : 'min-w-0 flex-[1_1_260px] truncate rounded-lg bg-subtle px-3 py-2 font-mono text-[12px]'}>{value}</code>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(value)
            setIsCopied(true)
          }}
        >
          {isCopied ? messages().deploy.sharing.copied : copyLabel}
        </Button>
      </span>
    </div>
  )
}

function FeatureRow({ title, isOn, summary, children }: { title: string; isOn: boolean; summary: string; children?: ReactNode }) {
  const text = messages().deploy.sharing
  return (
    <li className="flex flex-col gap-3 rounded-[12px] border border-line px-4 py-3">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold">{title}</span>
          <span className="text-[13px] text-body">{summary}</span>
        </span>
        <Badge tone={isOn ? 'ok' : 'neutral'}>{isOn ? text.on : text.off}</Badge>
      </span>
      {isOn && children}
    </li>
  )
}

/**
 * What an online agent (or a connected server) offers right now, asked from the server itself:
 * the chat page with its link and the line for a website, the phone page with its paired
 * phones, and what happens to a request nobody answers in time. "Change" opens the choices.
 */
export function OnlineFeaturesPanel({ target, changeTo, chosen }: OnlineFeaturesPanelProps) {
  const text = messages().deploy.sharing
  const [live, setLive] = useState<LiveFeatures | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const targetKey = onlineTargetKey(target)

  const load = useCallback(async () => {
    setErrorMessage(null)
    try {
      setLive(await getLiveOnlineFeatures(target))
    } catch (error) {
      setLive(null)
      setErrorMessage(plainErrorMessage(error))
    }
    // Keyed by the target's identity: a new object for the same target must not reload.
  }, [targetKey])

  useEffect(() => {
    setLive(null)
    void load()
  }, [load])

  const problem = errorMessage ?? (live && !live.reachable ? (live.problem ?? text.notReachable) : null)
  const chatFor = text.chatFor as Readonly<Record<string, string>>
  const answersItself = chosen?.answerWhenTimeRunsOut ?? live?.phone?.answersWhenTimeRunsOut ?? false
  return (
    <section aria-label={text.whatIsOn} className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-[14px] font-semibold">{text.whatIsOn}</h3>
        {changeTo && (
          <LinkButton to={changeTo} size="sm" variant="secondary">
            {text.change}
          </LinkButton>
        )}
      </div>
      {!live && !problem && <span className="text-[13px] text-muted">{text.checking}</span>}
      {problem && (
        <div role="status" className="flex flex-wrap items-center gap-3 text-[13px] text-amber-strong">
          <span className="min-w-0 flex-[1_1_240px]">
            {text.notReachable} {problem !== text.notReachable && problem}
          </span>
          <Button size="sm" variant="secondary" onClick={() => void load()}>
            {text.tryAgain}
          </Button>
        </div>
      )}
      {live?.reachable && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          <FeatureRow title={text.chatTitle} isOn={live.chat !== null} summary={live.chat ? (chatFor[live.chat.audience] ?? chatFor.key) : text.chatOff}>
            {live.chat && (
              <>
                <CopyRow label={text.linkToShare} value={live.chat.link} copyLabel={text.copyLink} />
                <CopyRow label={text.widgetLabel} value={live.chat.widgetSnippet} copyLabel={text.copyLine} isCode />
                {chosen && <span className="text-[12px] text-muted">{chosen.embedSite ? text.embedSiteIs(chosen.embedSite) : text.embedSiteMissing}</span>}
              </>
            )}
          </FeatureRow>
          <FeatureRow title={text.phoneTitle} isOn={live.phone !== null} summary={live.phone ? `${text.phoneOn} · ${live.phone.notifications ? text.notificationsOn : text.notificationsOff}` : text.phoneOff}>
            {live.phone?.canPair && <PairedPhones target={target} />}
          </FeatureRow>
          <FeatureRow title={text.expiryTitle} isOn={answersItself} summary={answersItself ? text.expiryOn : text.expiryOff} />
        </ul>
      )}
    </section>
  )
}
