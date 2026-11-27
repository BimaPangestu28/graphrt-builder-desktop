import { useState } from 'react'
import { createAgentRelease, switchAgentRelease } from '@/api/quality'
import type { QualityOverview, Release, ReleaseSwitchOutcome } from '@/api/qualityTypes'
import { Badge, Button, Card, LinkButton } from '@/components/ui'
import { formatDate } from '@/i18n/format'
import { useT } from '@/i18n'
import { describeError } from '@/lib/agentDisplay'
import { agentPath } from '@/routes'
import { describeReadiness, needsCheck } from './qualityDisplay'

const fieldClassNames =
  'box-border w-full min-w-0 rounded-[9px] border border-line-strong bg-surface px-3 py-2 font-sans text-[14px] text-ink outline-none focus:border-ink'

function releasedOn(release: Release): string {
  return formatDate(new Date(release.createdAt), { day: 'numeric', month: 'short', year: 'numeric' })
}

/** The checked result a release was made with, or why it was released anyway. */
function ReleaseFacts({ release }: { release: Release }) {
  const t = useT().quality.release
  return (
    <>
      <span className="text-[13px] text-muted">
        {t.releasedOn(releasedOn(release))}
        {release.passed !== null && release.total !== null && ` · ${t.checkedLine(release.passed, release.total)}`}
      </span>
      {release.overrideReason && <span className="text-[13px] text-amber-deep">{t.releasedAnyway(release.overrideReason)}</span>}
    </>
  )
}

/** What runs now: the release in use (what goes online), or that nothing is released yet. */
export function InUseCard({ inUse }: { inUse: Release | null }) {
  const t = useT().quality.release
  return (
    <Card className="flex flex-col gap-1 p-5">
      <span className="text-[12px] font-medium text-muted">{t.inUseHeading}</span>
      {inUse ? (
        <>
          <span className="text-[20px] font-semibold tracking-[-0.3px] text-ink">
            {t.releaseName(inUse.number)} <span className="font-normal text-muted">· {t.ofVersion(inUse.agentVersion)}</span>
          </span>
          {inUse.notes && <span className="text-[14px] text-body">{inUse.notes}</span>}
          <ReleaseFacts release={inUse} />
        </>
      ) : (
        <>
          <span className="text-[20px] font-semibold text-ink">{t.nothingYet}</span>
          <span className="text-[14px] text-body">{t.nothingYetHint}</span>
        </>
      )}
    </Card>
  )
}

interface NewReleaseCardProps {
  agentId: string
  overview: QualityOverview
  isOnline: boolean
  onReleased: () => void
}

/**
 * "Release your latest changes": ready (one button) or the plain reason it is not, with the
 * way to fix it and, folded away, "Release anyway" with a reason.
 */
export function NewReleaseCard({ agentId, overview, isOnline, onReleased }: NewReleaseCardProps) {
  const t = useT().quality
  const [notes, setNotes] = useState('')
  const [reason, setReason] = useState('')
  const [isReleasing, setIsReleasing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [released, setReleased] = useState<Release | null>(null)
  const readiness = overview.readiness
  const blockText = describeReadiness(readiness, t)
  const canOverride = readiness.status === 'blocked' && readiness.canOverride

  async function release(overrideReason: string | null) {
    setIsReleasing(true)
    setError(null)
    try {
      const made = await createAgentRelease(agentId, notes, overrideReason)
      setReleased(made)
      setNotes('')
      setReason('')
      onReleased()
    } catch (releaseError) {
      setError(t.couldNot(describeError(releaseError)))
    } finally {
      setIsReleasing(false)
    }
  }

  if (released) {
    return (
      <Card className="flex flex-col items-start gap-3 border-ok-soft bg-ok-tint p-5">
        <span className="text-[16px] font-semibold text-ok-strong">{t.release.released(released.number)}</span>
        <LinkButton to={agentPath('putOnline', agentId)}>{isOnline ? t.release.updateOnline : t.release.putOnline}</LinkButton>
      </Card>
    )
  }

  if (readiness.status === 'blocked' && readiness.block.kind === 'already_released') {
    return <p className="m-0 rounded-[10px] bg-subtle px-3.5 py-3 text-[14px] text-body">{blockText}</p>
  }

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[16px] font-semibold text-ink">{t.release.newHeading}</span>
        <span className="text-[13px] text-muted">{t.release.latestVersion(overview.currentVersion)}</span>
      </div>
      {readiness.status === 'ready' ? (
        <span className="text-[14px] text-ok-strong">{t.release.ready(readiness.good, readiness.total)}</span>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-amber-line-2 bg-amber-tint px-3.5 py-3">
          <span role="status" className="min-w-0 flex-1 basis-[320px] text-[14px] leading-normal text-amber-deep">
            {blockText}
          </span>
          {needsCheck(readiness) && (
            <LinkButton to={agentPath('agentTests', agentId)} variant="secondary" size="sm">
              {t.release.goCheck}
            </LinkButton>
          )}
        </div>
      )}
      <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
        {t.release.notes}
        <input type="text" value={notes} maxLength={2000} placeholder={t.release.notesPlaceholder} onChange={(event) => setNotes(event.target.value)} className={`${fieldClassNames} h-10`} />
      </label>
      {readiness.status === 'ready' && (
        <Button size="lg" className="self-start" onClick={() => void release(null)} disabled={isReleasing}>
          {isReleasing ? t.release.releasing : t.release.releaseVersion(overview.currentVersion)}
        </Button>
      )}
      {canOverride && (
        <details className="text-[13px]">
          <summary className="cursor-pointer font-medium text-ink-2">{t.release.anyway}</summary>
          <div className="mt-2 flex flex-col gap-2">
            <span className="text-muted">{t.release.anywayHint}</span>
            <label className="flex flex-col gap-1 font-semibold text-ink">
              {t.release.anywayReason}
              <input type="text" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} className={`${fieldClassNames} h-10`} />
            </label>
            <Button variant="danger" className="self-start" onClick={() => void release(reason)} disabled={isReleasing || !reason.trim()}>
              {isReleasing ? t.release.releasing : t.release.anyway}
            </Button>
          </div>
        </details>
      )}
      {error && (
        <span role="alert" className="text-[13px] text-danger">
          {error}
        </span>
      )}
    </Card>
  )
}

interface ReleaseListProps {
  agentId: string
  releases: Release[]
  inUse: Release | null
  onSwitched: () => void
}

/** Every release, newest first; any other than the one in use can be put back in use. */
export function ReleaseList({ agentId, releases, inUse, onSwitched }: ReleaseListProps) {
  const t = useT().quality
  const [confirming, setConfirming] = useState<number | null>(null)
  const [isSwitching, setIsSwitching] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  function describeOutcome(outcome: ReleaseSwitchOutcome): string {
    const switched = t.release.switched(outcome.release.number)
    if (outcome.online.kind === 'switched') return `${switched} ${t.release.onlineSwitched}`
    if (outcome.online.kind === 'needs_update') return `${switched} ${t.release.onlineNeedsUpdate}`
    return switched
  }

  async function switchTo(number: number) {
    setIsSwitching(true)
    setNotice(null)
    try {
      setNotice(describeOutcome(await switchAgentRelease(agentId, number)))
      setConfirming(null)
      onSwitched()
    } catch (switchError) {
      setNotice(t.couldNot(describeError(switchError)))
    } finally {
      setIsSwitching(false)
    }
  }

  if (releases.length === 0) return null
  return (
    <section className="flex flex-col gap-3">
      <h2 className="m-0 text-[16px] font-semibold text-ink">{t.release.allHeading}</h2>
      {notice && (
        <p role="status" className="m-0 text-[13px] text-ink-2">
          {notice}
        </p>
      )}
      <ul aria-label={t.release.allHeading} className="m-0 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2">
        {releases.map((release) => {
          const isInUse = inUse?.number === release.number
          const isOlder = inUse !== null && release.number < inUse.number
          return (
            <li key={release.number} className="min-w-0">
              <Card className="flex h-full flex-col gap-1.5 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[15px] font-semibold text-ink">
                    {t.release.releaseName(release.number)} <span className="font-normal text-muted">· {t.release.ofVersion(release.agentVersion)}</span>
                  </span>
                  {isInUse && <Badge tone="ok">{t.release.inUseBadge}</Badge>}
                </div>
                <span className="text-[14px] text-body">{release.notes || t.release.noNotes}</span>
                <ReleaseFacts release={release} />
                {!isInUse && confirming !== release.number && (
                  <Button variant="secondary" size="sm" className="mt-auto self-start" onClick={() => setConfirming(release.number)} disabled={isSwitching}>
                    {isOlder ? t.release.goBack : t.release.useThis}
                  </Button>
                )}
                {confirming === release.number && (
                  <div className="mt-1 flex flex-col gap-2 rounded-[10px] bg-subtle px-3 py-2.5">
                    <span className="text-[13px] text-ink">{t.release.confirmSwitch(release.number)}</span>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => void switchTo(release.number)} disabled={isSwitching}>
                        {t.release.confirm}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setConfirming(null)} disabled={isSwitching}>
                        {t.cancel}
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
