import { Link, useParams } from 'react-router-dom'
import { getAgentDeployment } from '@/api/deploy'
import { AppShell, PageFrame, PageTitleBlock } from '@/components/layout'
import { Icon } from '@/components/ui'
import { useAgent } from '@/hooks/useAgent'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useT } from '@/i18n'
import { describeError } from '@/lib/agentDisplay'
import { agentPath, sampleAgentId } from '@/routes'
import { QualityTabs } from './quality/QualityTabs'
import { InUseCard, NewReleaseCard, ReleaseList } from './quality/ReleaseParts'
import { useAgentQuality } from './quality/useAgentQuality'

/**
 * Screen 72 · Release (`/agents/:agentId/releases`), step 2 of "Test & release". What is in
 * use now, releasing the latest checked version (blocked in plain words when the check did
 * not pass, with "Release anyway" and a reason folded away), and every earlier release to
 * go back to. Only the release in use goes online.
 */
export function AgentReleasesPage() {
  const t = useT().quality
  const { agentId = sampleAgentId } = useParams()
  const { data: agent } = useAgent(agentId)
  const quality = useAgentQuality(agentId)
  const deployment = useAsyncData(() => getAgentDeployment(agentId), [agentId])
  const overview = quality.data
  const reload = () => {
    void quality.reload()
    void deployment.reload()
  }

  return (
    <AppShell agents={{ kind: 'list', activeAgentId: agentId }}>
      <PageFrame>
        <div className="flex flex-col gap-3">
          <Link to={agentPath('builder', agentId)} className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium no-underline !text-ink-2 hover:underline">
            <Icon name="arrowLeft" size={14} />
            {t.backToAgent}
          </Link>
          <PageTitleBlock title={t.release.title(agent?.name ?? '…')} subtitle={t.release.subtitle} />
          <QualityTabs agentId={agentId} current="release" />
        </div>
        {quality.error && (
          <p role="alert" className="m-0 text-[13px] text-danger">
            {t.couldNotLoad(describeError(quality.error))}
          </p>
        )}
        {!quality.error && !overview && <p className="m-0 text-muted">{t.loading}</p>}
        {overview && (
          <>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <InUseCard inUse={overview.inUse} />
              <NewReleaseCard agentId={agentId} overview={overview} isOnline={Boolean(deployment.data)} onReleased={reload} />
            </div>
            <ReleaseList agentId={agentId} releases={overview.releases} inUse={overview.inUse} onSwitched={reload} />
          </>
        )}
      </PageFrame>
    </AppShell>
  )
}
