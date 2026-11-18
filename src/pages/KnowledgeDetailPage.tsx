import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '@/components/layout'
import { sidebarAgents } from '@/data/agents'
import { menuAndPricesSources, menuAndPricesUsages, type KnowledgeSource } from '@/data/knowledge'
import { routePaths } from '@/routes'
import { CheckboxRow, LabeledField, SectionHeading, compactButtonClassNames, fieldControlClassNames } from './knowledge/FormControls'
import { KnowledgeSourcesTable } from './knowledge/KnowledgeSourcesTable'
import { detectSourceType } from './knowledge/SourceTypeTile'
import { TestQuestionSection, parseMatchThreshold } from './knowledge/TestQuestionSection'
import { useFilePicker } from './knowledge/useFilePicker'

interface RetrievalSettings {
  embeddingModel: string
  passagesPerAnswer: string
  matchThresholdText: string
  isSourceShownInAnswers: boolean
}

const embeddingModelOptions = ['On this Mac (free, private)', 'OpenAI text-embedding-3-small']
const passagesPerAnswerOptions = ['4', '8']

function formatClockTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function createSourceFromFile(fileName: string, sequenceNumber: number): KnowledgeSource {
  return {
    id: `added-source-${sequenceNumber}`,
    name: fileName,
    type: detectSourceType(fileName),
    passages: '…',
    updates: 'When the file changes',
    status: { kind: 'reading', percent: 0 },
  }
}

function UsedBySection() {
  return (
    <section aria-labelledby="used-h" className="flex flex-col gap-2.5">
      <SectionHeading id="used-h">Used by</SectionHeading>
      {menuAndPricesUsages.map((usage) => (
        <Link
          key={usage.agentId}
          to={sidebarAgents.find((agent) => agent.id === usage.agentId)?.path ?? routePaths.home}
          className="flex justify-between rounded-[10px] border border-line bg-surface px-3 py-2.5 no-underline !text-ink hover:border-line-heavy"
        >
          <span className="font-medium">{usage.agentName}</span>
          <span className="text-[12px] text-muted">{usage.role}</span>
        </Link>
      ))}
    </section>
  )
}

interface RetrievalSettingsSectionProps {
  settings: RetrievalSettings
  onChange: (settings: RetrievalSettings) => void
}

function RetrievalSettingsSection({ settings, onChange }: RetrievalSettingsSectionProps) {
  return (
    <section aria-labelledby="set-h" className="flex flex-col gap-3">
      <SectionHeading id="set-h">Settings</SectionHeading>
      <LabeledField label="Embedding model">
        <select value={settings.embeddingModel} onChange={(event) => onChange({ ...settings, embeddingModel: event.target.value })} className={fieldControlClassNames}>
          {embeddingModelOptions.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </LabeledField>
      <LabeledField label="Passages per answer">
        <select value={settings.passagesPerAnswer} onChange={(event) => onChange({ ...settings, passagesPerAnswer: event.target.value })} className={fieldControlClassNames}>
          {passagesPerAnswerOptions.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </LabeledField>
      <LabeledField label="Ignore matches below">
        <input
          type="text"
          inputMode="decimal"
          value={settings.matchThresholdText}
          onChange={(event) => onChange({ ...settings, matchThresholdText: event.target.value })}
          className={fieldControlClassNames}
        />
      </LabeledField>
      <CheckboxRow checked={settings.isSourceShownInAnswers} onChange={(isChecked) => onChange({ ...settings, isSourceShownInAnswers: isChecked })}>
        Always show the source in answers
      </CheckboxRow>
    </section>
  )
}

/**
 * Screen 18 · Knowledge detail ("Catering menu and prices").
 * Sources table, "Test a question" with live best-match lookup, the agents using this knowledge
 * and retrieval settings. "Ignore matches below" drives whether a test result is shown as weak.
 * "Add source" picks files that appear as reading rows; "Sync now" updates the last-synced time.
 */
export function KnowledgeDetailPage() {
  const [sources, setSources] = useState<KnowledgeSource[]>(menuAndPricesSources)
  const [lastSyncedTime, setLastSyncedTime] = useState('13:02')
  const [settings, setSettings] = useState<RetrievalSettings>({
    embeddingModel: embeddingModelOptions[0],
    passagesPerAnswer: passagesPerAnswerOptions[0],
    matchThresholdText: '0.55',
    isSourceShownInAnswers: true,
  })
  const { openFilePicker, filePickerInput } = useFilePicker(
    (fileNames) => setSources((previousSources) => [...previousSources, ...fileNames.map((fileName, index) => createSourceFromFile(fileName, previousSources.length + index))]),
    'Choose files to add as sources',
  )

  return (
    <AppShell activeNav="knowledge" agents={{ kind: 'list' }} mainClassName="flex flex-col">
      <header className="box-border flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3">
        <div className="flex items-center gap-2 text-muted">
          <Link to={routePaths.knowledge} className="no-underline !text-muted hover:!text-ink">
            Knowledge
          </Link>
          <span aria-hidden="true">/</span>
          <h1 className="m-0 text-[14px] font-semibold text-ink">Catering menu and prices</h1>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setLastSyncedTime(formatClockTime(new Date()))} className={compactButtonClassNames('secondary')}>
            Sync now
          </button>
          <button type="button" onClick={openFilePicker} className={compactButtonClassNames('primary')}>
            Add source
          </button>
          {filePickerInput}
        </div>
      </header>

      <div className="flex flex-auto flex-wrap">
        <div className="box-border flex min-w-0 flex-[3_1_520px] flex-col gap-6 px-8 py-7">
          <section aria-labelledby="src-h" className="flex flex-col gap-3">
            <SectionHeading id="src-h">Sources</SectionHeading>
            <KnowledgeSourcesTable sources={sources} />
          </section>
          <TestQuestionSection matchThreshold={parseMatchThreshold(settings.matchThresholdText)} />
        </div>

        <aside className="box-border flex min-w-0 flex-[1_1_300px] flex-col gap-[22px] border-l border-line bg-subtle p-6">
          <UsedBySection />
          <RetrievalSettingsSection settings={settings} onChange={setSettings} />
          <p className="m-0 text-[13px] leading-normal text-body">412 passages · 9.4 MB on disk · last synced {lastSyncedTime}</p>
        </aside>
      </div>
    </AppShell>
  )
}
