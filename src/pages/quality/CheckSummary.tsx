import type { CheckProgress, CheckView } from '@/api/qualityTypes'
import { Badge, Button, Card, LinkButton, Spinner } from '@/components/ui'
import { useT } from '@/i18n'

interface CheckSummaryProps {
  check: CheckView | null
  testsCount: number
  /** The agent's latest version, to say when the last check was of an older one. */
  currentVersion: number
  progress: CheckProgress | null
  canStart: boolean
  isStarting: boolean
  error: string | null
  /** Set when the latest version passed and can be released. */
  releasePath: string | null
  onStart: () => void
}

/**
 * The big number of the last check (good answers of all, against what a release needs),
 * how it compares with the check before, and the one button that checks again.
 */
export function CheckSummary({ check, testsCount, currentVersion, progress, canStart, isStarting, error, releasePath, onStart }: CheckSummaryProps) {
  const t = useT().quality
  const isRunning = progress !== null || check?.status === 'running'
  const total = progress?.total ?? check?.total ?? 0
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          {isRunning ? (
            <span className="flex items-center gap-2.5 text-[18px] font-semibold text-ink">
              <Spinner />
              {t.test.checking(progress?.done ?? 0, total)}
            </span>
          ) : check?.status === 'finished' ? (
            <>
              <span className="text-[12px] font-medium text-muted">
                {t.result.heading} · {t.result.ofVersion(check.agentVersion)}
              </span>
              <span className="text-[22px] font-semibold tracking-[-0.3px] text-ink">{t.result.score(check.good, check.total)}</span>
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={check.enoughGood ? 'ok' : 'amber'}>{check.enoughGood ? t.result.enough : t.result.notEnough(check.needed)}</Badge>
                {check.previous && <span className="text-[13px] text-muted">{t.result.lastTime(check.previous.good, check.previous.total)}</span>}
              </span>
            </>
          ) : check?.status === 'failed' ? (
            <span className="text-[14px] text-danger">{t.result.didNotFinish(check.errorMessage ?? '')}</span>
          ) : (
            <span className="text-[15px] text-body">{t.test.readyToCheck(testsCount)}</span>
          )}
          {isRunning && <span className="text-[13px] text-muted">{t.test.checkingHint}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {releasePath && !isRunning && (
            <LinkButton to={releasePath} variant="secondary">
              {t.result.goToRelease}
            </LinkButton>
          )}
          <Button size="lg" onClick={onStart} disabled={!canStart || isRunning || isStarting}>
            {check && check.status !== 'running' ? t.test.checkAgain : t.test.check}
          </Button>
        </div>
      </div>
      {check && check.status !== 'running' && check.agentVersion < currentVersion && !isRunning && (
        <p className="m-0 rounded-[10px] border border-amber-line-2 bg-amber-tint px-3 py-2 text-[13px] text-amber-deep">{t.result.olderVersion(currentVersion)}</p>
      )}
      {check?.testsChangedSince && !isRunning && <p className="m-0 rounded-[10px] border border-amber-line-2 bg-amber-tint px-3 py-2 text-[13px] text-amber-deep">{t.result.testsChanged}</p>}
      {releasePath && !isRunning && <p className="m-0 text-[13px] text-ok-strong">{t.result.readyHint}</p>}
      {error && (
        <span role="alert" className="text-[13px] text-danger">
          {error}
        </span>
      )}
    </Card>
  )
}
