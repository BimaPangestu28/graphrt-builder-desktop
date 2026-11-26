import { useEffect, useState } from 'react'
import type { EmbeddingChoice, KnowledgeBase, KnowledgeSettings } from '@/api/knowledgeTypes'
import { CheckboxRow, LabeledField, SectionHeading, compactButtonClassNames, fieldControlClassNames } from './FormControls'
import { parseMatchThreshold } from './TestQuestionSection'
import { messages, useT } from '@/i18n'

function listEmbeddingOptions(): { value: EmbeddingChoice; label: string }[] {
  return [
    { value: 'local', label: messages().knowledge.embeddingLocal },
    { value: 'openai', label: 'OpenAI text-embedding-3-small' },
  ]
}
const passagesPerAnswerOptions = [2, 4, 6, 8, 10]

interface KnowledgeSettingsPanelProps {
  knowledgeBase: KnowledgeBase
  /** Live "Ignore matches below" text, so "Test a question" reacts while typing. */
  thresholdText: string
  onThresholdTextChange: (thresholdText: string) => void
  onSaveSettings: (settings: KnowledgeSettings) => void
  onRename: (name: string) => void
  onDelete: () => void
}

/**
 * Settings column of screen 18: name, embedding model, passages per answer, match
 * threshold and source citing. Selects save at once; text fields save when they lose focus.
 */
export function KnowledgeSettingsPanel({ knowledgeBase, thresholdText, onThresholdTextChange, onSaveSettings, onRename, onDelete }: KnowledgeSettingsPanelProps) {
  const t = useT().knowledge
  const { settings } = knowledgeBase
  const [nameText, setNameText] = useState(knowledgeBase.name)
  useEffect(() => setNameText(knowledgeBase.name), [knowledgeBase.name])
  const passagesOptions = passagesPerAnswerOptions.includes(settings.passagesPerAnswer)
    ? passagesPerAnswerOptions
    : [...passagesPerAnswerOptions, settings.passagesPerAnswer].sort((first, second) => first - second)

  return (
    <section aria-labelledby="set-h" className="flex flex-col gap-3">
      <SectionHeading id="set-h">{t.settings}</SectionHeading>
      <LabeledField label={t.name}>
        <input
          type="text"
          value={nameText}
          onChange={(event) => setNameText(event.target.value)}
          onBlur={() => {
            if (nameText.trim() && nameText.trim() !== knowledgeBase.name) onRename(nameText.trim())
          }}
          className={fieldControlClassNames}
        />
      </LabeledField>
      <LabeledField label={t.embeddingModel}>
        <select
          value={settings.embedding}
          onChange={(event) => onSaveSettings({ ...settings, embedding: event.target.value as EmbeddingChoice })}
          className={fieldControlClassNames}
        >
          {listEmbeddingOptions().map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </LabeledField>
      <LabeledField label={t.passagesPerAnswer}>
        <select
          value={String(settings.passagesPerAnswer)}
          onChange={(event) => onSaveSettings({ ...settings, passagesPerAnswer: Number(event.target.value) })}
          className={fieldControlClassNames}
        >
          {passagesOptions.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </LabeledField>
      <LabeledField label={t.ignoreBelow}>
        <input
          type="text"
          inputMode="decimal"
          value={thresholdText}
          onChange={(event) => onThresholdTextChange(event.target.value)}
          onBlur={() => {
            const minScore = parseMatchThreshold(thresholdText)
            if (minScore !== settings.minScore) onSaveSettings({ ...settings, minScore })
          }}
          className={fieldControlClassNames}
        />
      </LabeledField>
      <CheckboxRow checked={settings.showSources} onChange={(isChecked) => onSaveSettings({ ...settings, showSources: isChecked })}>
        {t.alwaysShowSource}
      </CheckboxRow>
      <button type="button" onClick={onDelete} className={compactButtonClassNames('secondary', 'self-start !text-danger')}>
        {t.deleteBase}
      </button>
    </section>
  )
}
