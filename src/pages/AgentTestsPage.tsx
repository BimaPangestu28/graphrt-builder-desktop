import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { addAgentTests, deleteAgentTest, startAgentCheck, updateAgentTest } from '@/api/quality'
import type { AgentTest, QualityOverview, QuestionResult, TestInput } from '@/api/qualityTypes'
import { AppShell, PageFrame, PageTitleBlock } from '@/components/layout'
import { Button, Card, Icon } from '@/components/ui'
import { useAgent } from '@/hooks/useAgent'
import { useT } from '@/i18n'
import { describeError } from '@/lib/agentDisplay'
import { agentPath, sampleAgentId } from '@/routes'
import { CheckSummary } from './quality/CheckSummary'
import { QualitySettingsForm } from './quality/QualitySettingsForm'
import { QualityTabs } from './quality/QualityTabs'
import { emptyTestInput } from './quality/qualityDisplay'
import { SuggestPanel } from './quality/SuggestPanel'
import { TestCard } from './quality/TestCard'
import { TestEditor } from './quality/TestEditor'
import { useAgentQuality, type AgentQualityState } from './quality/useAgentQuality'

/** What the form area shows: nothing, the suggestions, a new question or one being changed. */
type Editing = { kind: 'none' } | { kind: 'suggest' } | { kind: 'new' } | { kind: 'change'; test: AgentTest }

function toInput(test: AgentTest): TestInput {
  return { question: test.question, goodAnswer: test.goodAnswer, mustInclude: test.mustInclude, mustNotInclude: test.mustNotInclude, suggested: test.suggested }
}

/** Questions whose last answer was not good come first; the order is kept otherwise. */
function testsNotGoodFirst(tests: AgentTest[], resultOf: (test: AgentTest) => QuestionResult | null): AgentTest[] {
  const rank = (test: AgentTest) => (resultOf(test)?.good === false ? 0 : 1)
  return [...tests].sort((left, right) => rank(left) - rank(right))
}

function EmptyTests({ onSuggest, onWrite }: { onSuggest: () => void; onWrite: () => void }) {
  const t = useT().quality.test
  return (
    <Card className="flex flex-col items-start gap-3 p-6">
      <span className="text-[17px] font-semibold text-ink">{t.emptyHeading}</span>
      <span className="max-w-[70ch] text-[14px] leading-normal text-body">{t.emptyText}</span>
      <div className="flex flex-wrap gap-2">
        <Button size="lg" onClick={onSuggest}>
          <Icon name="lightbulb" size={16} />
          {t.suggest}
        </Button>
        <Button size="lg" variant="secondary" onClick={onWrite}>
          <Icon name="plus" size={16} />
          {t.write}
        </Button>
      </div>
    </Card>
  )
}

function TestsContent({ agentId, overview, quality }: { agentId: string; overview: QualityOverview; quality: AgentQualityState }) {
  const t = useT().quality
  const [editing, setEditing] = useState<Editing>({ kind: 'none' })
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const reload = () => void quality.reload()
  const latest = overview.latestCheck
  const resultOf = (test: AgentTest) => latest?.questions.find((question) => question.testId === test.id) ?? null

  async function save(work: () => Promise<unknown>) {
    setIsSaving(true)
    setError(null)
    try {
      await work()
      setEditing({ kind: 'none' })
      reload()
    } catch (saveError) {
      setError(t.couldNot(describeError(saveError)))
    } finally {
      setIsSaving(false)
    }
  }

  async function startCheck() {
    setIsStarting(true)
    setCheckError(null)
    try {
      await startAgentCheck(agentId)
      reload()
    } catch (startError) {
      setCheckError(t.couldNot(describeError(startError)))
    } finally {
      setIsStarting(false)
    }
  }

  const editor =
    editing.kind === 'suggest' ? (
      <SuggestPanel agentId={agentId} onClose={() => setEditing({ kind: 'none' })} onAdded={() => {
        setEditing({ kind: 'none' })
        reload()
      }} />
    ) : editing.kind === 'new' ? (
      <TestEditor initial={emptyTestInput()} submitLabel={t.test.addQuestion} isSaving={isSaving} error={error} onCancel={() => setEditing({ kind: 'none' })} onSubmit={(test) => void save(() => addAgentTests(agentId, [test]))} />
    ) : editing.kind === 'change' ? (
      <TestEditor
        key={editing.test.id}
        initial={toInput(editing.test)}
        submitLabel={t.save}
        isSaving={isSaving}
        error={error}
        onCancel={() => setEditing({ kind: 'none' })}
        onSubmit={(test) => void save(() => updateAgentTest(agentId, editing.test.id, test))}
      />
    ) : null

  if (!overview.canCheck) return <p className="m-0 rounded-[10px] border border-amber-line-2 bg-amber-tint px-3 py-2 text-[13px] text-amber-deep">{t.test.cannotCheck}</p>

  if (overview.tests.length === 0) {
    return editor ?? <EmptyTests onSuggest={() => setEditing({ kind: 'suggest' })} onWrite={() => setEditing({ kind: 'new' })} />
  }

  return (
    <>
      <CheckSummary
        check={latest}
        testsCount={overview.tests.length}
        currentVersion={overview.currentVersion}
        progress={quality.progress}
        canStart={overview.tests.length > 0}
        isStarting={isStarting}
        error={checkError}
        releasePath={overview.readiness.status === 'ready' ? agentPath('agentReleases', agentId) : null}
        onStart={() => void startCheck()}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-[16px] font-semibold text-ink">{t.test.questionsHeading(overview.tests.length)}</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setEditing({ kind: 'suggest' })} disabled={editing.kind !== 'none'}>
            <Icon name="lightbulb" size={14} />
            {t.test.suggest}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setEditing({ kind: 'new' })} disabled={editing.kind !== 'none'}>
            <Icon name="plus" size={14} />
            {t.test.addMore}
          </Button>
        </div>
      </div>
      {editor}
      <ul aria-label={t.test.questionsHeading(overview.tests.length)} className="m-0 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2">
        {testsNotGoodFirst(overview.tests, resultOf).map((test) => (
          <li key={test.id} className="min-w-0">
            <TestCard
              test={test}
              result={resultOf(test)}
              isBusy={isSaving}
              onChange={() => setEditing({ kind: 'change', test })}
              onRemove={() => void save(() => deleteAgentTest(agentId, test.id))}
            />
          </li>
        ))}
      </ul>
      <QualitySettingsForm key={`${overview.settings.requiredPercent}-${overview.settings.timesEach}`} agentId={agentId} settings={overview.settings} onSaved={reload} />
    </>
  )
}

/**
 * Screen 71 · Test (`/agents/:agentId/tests`), step 1 of "Test & release". The person
 * writes or accepts suggested questions with what a good answer says, checks the latest
 * version (graphrt scores every answer) and sees per question whether it was good and why.
 */
export function AgentTestsPage() {
  const t = useT().quality
  const { agentId = sampleAgentId } = useParams()
  const { data: agent } = useAgent(agentId)
  const quality = useAgentQuality(agentId)

  return (
    <AppShell agents={{ kind: 'list', activeAgentId: agentId }}>
      <PageFrame>
        <div className="flex flex-col gap-3">
          <Link to={agentPath('builder', agentId)} className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium no-underline !text-ink-2 hover:underline">
            <Icon name="arrowLeft" size={14} />
            {t.backToAgent}
          </Link>
          <PageTitleBlock title={t.test.title(agent?.name ?? '…')} subtitle={t.test.subtitle} />
          <QualityTabs agentId={agentId} current="test" />
        </div>
        {quality.error && (
          <p role="alert" className="m-0 text-[13px] text-danger">
            {t.couldNotLoad(describeError(quality.error))}
          </p>
        )}
        {!quality.error && !quality.data && <p className="m-0 text-muted">{t.loading}</p>}
        {quality.data && <TestsContent agentId={agentId} overview={quality.data} quality={quality} />}
      </PageFrame>
    </AppShell>
  )
}
