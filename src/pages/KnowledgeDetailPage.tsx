import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { FileDropZone } from '@/components/fileDrop'
import { AppShell } from '@/components/layout'
import { Button } from '@/components/ui'
import {
  addKnowledgeSource,
  deleteKnowledgeBase,
  removeKnowledgeSource,
  renameKnowledgeBase,
  syncKnowledgeBase,
  updateKnowledgeSettings,
} from '@/api/knowledge'
import type { KnowledgeBase, KnowledgeBaseDetail, KnowledgeSettings, KnowledgeSource, KnowledgeSourceKind, KnowledgeUsage } from '@/api/knowledgeTypes'
import { useKnowledgeBaseDetail } from '@/hooks/useKnowledge'
import { agentPath, routePaths, sampleKnowledgeBaseId } from '@/routes'
import { AddLinkForm } from './knowledge/AddLinkForm'
import { SectionHeading, compactButtonClassNames } from './knowledge/FormControls'
import { KnowledgeSettingsPanel } from './knowledge/KnowledgeSettingsPanel'
import { KnowledgeSourcesTable } from './knowledge/KnowledgeSourcesTable'
import { TestQuestionSection, parseMatchThreshold } from './knowledge/TestQuestionSection'
import { formatClockTime, formatMegabytes, pluralize } from './knowledge/knowledgeDisplay'
import { knowledgeDropAccept, knowledgeDropHint } from './knowledge/knowledgeDrop'
import { useSourcePicker } from './knowledge/useSourcePicker'
import { toError } from '@/lib/errors'
import { messages, useT } from '@/i18n'

function agentLink(usage: KnowledgeUsage): string {
  return agentPath('builder', usage.agentId)
}

function UsedBySection({ usages }: { usages: KnowledgeUsage[] }) {
  const t = useT().knowledge
  return (
    <section aria-labelledby="used-h" className="flex flex-col gap-2.5">
      <SectionHeading id="used-h">{t.usedBy}</SectionHeading>
      {usages.length === 0 && <p className="m-0 text-[13px] text-muted">{t.noAgentUsesThis}</p>}
      {usages.map((usage) => (
        <Link
          key={usage.agentId}
          to={agentLink(usage)}
          className="flex justify-between rounded-[10px] border border-line bg-surface px-3 py-2.5 no-underline !text-ink hover:border-line-heavy"
        >
          <span className="font-medium">{usage.agentName}</span>
          <span className="text-[12px] text-muted">{t.open}</span>
        </Link>
      ))}
    </section>
  )
}

function replaceKnowledgeBase(detail: KnowledgeBaseDetail | null, knowledgeBase: KnowledgeBase): KnowledgeBaseDetail | null {
  return detail ? { ...detail, knowledgeBase } : detail
}

/** Detail actions; every failure becomes a message on screen. */
function useKnowledgeBaseActions(knowledgeBaseId: string, live: ReturnType<typeof useKnowledgeBaseDetail>) {
  const navigate = useNavigate()
  const [actionError, setActionError] = useState<string | null>(null)
  const { setData, reload } = live

  const runAction = async (action: () => Promise<void>) => {
    setActionError(null)
    try {
      await action()
    } catch (actionFailure) {
      setActionError(toError(actionFailure).message)
    }
  }

  const addSources = (kind: KnowledgeSourceKind, locations: string[]) =>
    runAction(async () => {
      for (const location of locations) {
        const source = await addKnowledgeSource(knowledgeBaseId, kind, location)
        setData((current) => (current && !current.sources.some((known) => known.id === source.id) ? { ...current, sources: [...current.sources, source] } : current))
      }
    })

  return {
    actionError,
    setActionError,
    addSources,
    removeSource: (source: KnowledgeSource) =>
      runAction(async () => {
        await removeKnowledgeSource(source.id)
        reload()
      }),
    syncNow: () =>
      runAction(async () => {
        const knowledgeBase = await syncKnowledgeBase(knowledgeBaseId)
        setData((current) => replaceKnowledgeBase(current, knowledgeBase))
      }),
    saveSettings: (settings: KnowledgeSettings) =>
      runAction(async () => {
        const knowledgeBase = await updateKnowledgeSettings(knowledgeBaseId, settings)
        setData((current) => replaceKnowledgeBase(current, knowledgeBase))
        if (knowledgeBase.status === 'syncing' || settings.embedding !== live.data?.knowledgeBase.settings.embedding) reload()
      }),
    rename: (name: string) =>
      runAction(async () => {
        const knowledgeBase = await renameKnowledgeBase(knowledgeBaseId, name)
        setData((current) => replaceKnowledgeBase(current, knowledgeBase))
      }),
    deleteBase: (name: string) =>
      runAction(async () => {
        if (!window.confirm(messages().knowledge.confirmDelete(name))) return
        await deleteKnowledgeBase(knowledgeBaseId)
        navigate(routePaths.knowledge)
      }),
  }
}

/**
 * Screen 18 · Knowledge detail.
 * Sources with live status (reading → ready / failed, from `knowledge-event`), adding files,
 * a folder or a link, removing sources, "Sync now", "Test a question" searched by the backend,
 * the agents whose workflow uses this knowledge base, and retrieval settings.
 */
export function KnowledgeDetailPage() {
  const t = useT().knowledge
  const { knowledgeBaseId = sampleKnowledgeBaseId } = useParams()
  const live = useKnowledgeBaseDetail(knowledgeBaseId)
  const { data: detail, error: loadError, isLoading, readingPercents } = live
  const actions = useKnowledgeBaseActions(knowledgeBaseId, live)
  const [thresholdText, setThresholdText] = useState<string | null>(null)
  const { pickFiles, pickFolder, pickerInputs } = useSourcePicker(
    (picked) => void actions.addSources(picked.kind, picked.locations),
    (pickError) => actions.setActionError(toError(pickError).message),
    { files: t.pickFilesAdd, folder: t.pickFolderAdd },
  )
  const knowledgeBase = detail?.knowledgeBase
  const currentThresholdText = thresholdText ?? String(knowledgeBase?.settings.minScore ?? 0)

  return (
    <AppShell activeNav="knowledge" agents={{ kind: 'list' }} mainClassName="flex flex-col">
      <header className="box-border flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line px-8 py-3">
        <div className="flex items-center gap-2 text-muted">
          <Link to={routePaths.knowledge} className="no-underline !text-muted hover:!text-ink">
            {t.title}
          </Link>
          <span aria-hidden="true">/</span>
          <h1 className="m-0 text-[14px] font-semibold text-ink">{knowledgeBase?.name ?? (isLoading ? t.loadingEllipsis : t.knowledgeBase)}</h1>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={!knowledgeBase} onClick={() => void actions.syncNow()} className={compactButtonClassNames('secondary')}>
            {knowledgeBase?.status === 'syncing' ? t.syncing : t.syncNow}
          </button>
          <button type="button" disabled={!knowledgeBase} onClick={pickFiles} className={compactButtonClassNames('primary')}>
            {t.addSource}
          </button>
          {pickerInputs}
        </div>
      </header>

      {loadError && (
        <p role="alert" className="m-0 px-8 py-7 text-[13px] text-danger">
          {t.couldNotLoadBase(loadError.message)}
        </p>
      )}
      {detail && knowledgeBase && (
        <div className="flex flex-auto flex-wrap">
          <div className="box-border flex min-w-0 flex-[3_1_520px] flex-col gap-6 px-8 py-7">
            {actions.actionError && (
              <p role="alert" className="m-0 rounded-[10px] border border-danger-line bg-danger-tint px-3.5 py-3 text-[13px] text-danger">
                {actions.actionError}
              </p>
            )}
            <section aria-labelledby="src-h" className="flex flex-col gap-3">
              <SectionHeading id="src-h">{t.sources}</SectionHeading>
              <KnowledgeSourcesTable sources={detail.sources} readingPercents={readingPercents} onRemove={(source) => void actions.removeSource(source)} />
              <FileDropZone
                compact
                itemDescription={t.filesOrFolder}
                accept={knowledgeDropAccept}
                multiple
                onDrop={(droppedItems) => droppedItems.forEach((item) => void actions.addSources(item.kind, [item.path]))}
                chooseLabel={t.chooseFiles}
                onChoose={pickFiles}
                secondaryActions={
                  <Button variant="secondary" size="sm" onClick={pickFolder}>
                    {t.addFolder}
                  </Button>
                }
                hint={knowledgeDropHint()}
              />
              <AddLinkForm label={t.websiteLinkToAdd} onAddLink={(url) => actions.addSources('url', [url])} />
            </section>
            <TestQuestionSection knowledgeBaseId={knowledgeBase.id} matchThreshold={parseMatchThreshold(currentThresholdText)} />
          </div>

          <aside className="box-border flex min-w-0 flex-[1_1_300px] flex-col gap-[22px] border-l border-line bg-subtle p-6">
            <UsedBySection usages={knowledgeBase.usedBy} />
            <KnowledgeSettingsPanel
              knowledgeBase={knowledgeBase}
              thresholdText={currentThresholdText}
              onThresholdTextChange={setThresholdText}
              onSaveSettings={(settings) => void actions.saveSettings(settings)}
              onRename={(name) => void actions.rename(name)}
              onDelete={() => void actions.deleteBase(knowledgeBase.name)}
            />
            <p className="m-0 text-[13px] leading-normal text-body">
              {t.footer(pluralize(knowledgeBase.passageCount, 'passage'), formatMegabytes(knowledgeBase.storageBytes), formatClockTime(knowledgeBase.lastSyncedAt))}
            </p>
          </aside>
        </div>
      )}
    </AppShell>
  )
}
