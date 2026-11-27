import { getAgentQuality } from '@/api/quality'
import { Card, LinkButton } from '@/components/ui'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useT } from '@/i18n'
import { agentPath } from '@/routes'

/**
 * In "Put it online": which release goes online, or that one must be released first (only a
 * checked release goes online). `needsRelease` is set when the backend refused for that reason.
 */
export function DeployReleaseNotice({ agentId, needsRelease }: { agentId: string; needsRelease: boolean }) {
  const t = useT().quality
  const { data: overview } = useAsyncData(() => getAgentQuality(agentId), [agentId, needsRelease])
  if (!overview) return null
  if (!overview.inUse || needsRelease) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 border-amber-line-2 bg-amber-tint p-4">
        <div className="flex min-w-0 flex-1 basis-[320px] flex-col gap-0.5">
          <span className="text-[15px] font-semibold text-amber-deep">{t.deploy.needsReleaseTitle}</span>
          <span className="text-[13px] leading-normal text-amber-deep">{t.deploy.needsReleaseText}</span>
        </div>
        <LinkButton to={agentPath('agentReleases', agentId)}>{t.deploy.needsReleaseButton}</LinkButton>
      </Card>
    )
  }
  const hasNewerDraft = !overview.releases.some((release) => release.agentVersion === overview.currentVersion)
  return (
    <div className="flex flex-col gap-1 text-[13px]">
      <span className="font-medium text-ink-2">{t.deploy.putsOnline(overview.inUse.number, overview.inUse.agentVersion)}</span>
      {hasNewerDraft && <span className="text-muted">{t.deploy.newerNotReleased(overview.currentVersion)}</span>}
    </div>
  )
}
