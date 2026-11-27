import { useId } from 'react'
import type { SkillDraft, SkillDraftSource } from '@/api/skillTypes'
import { pillTabClassNames } from '@/components/ui'
import { useT } from '@/i18n'

const fieldClassNames = 'box-border w-full min-w-0 rounded-[9px] border border-line-strong bg-surface px-3 text-[14px] font-normal text-ink outline-none focus:border-ink'
/** Limits of the backend (`skills::draft`), so typing stops where sending would fail. */
const maxSourceChars = 24_000
const maxTitleChars = 60
const maxDescriptionChars = 1024

interface SkillSourceFormProps {
  source: SkillDraftSource
  onChange: (source: SkillDraftSource) => void
  disabled?: boolean
}

/**
 * "Describe it": one box. Either what the agent should do in the person's own words, or a
 * pasted conversation that went the way they want. The model writes the draft from it.
 */
export function SkillSourceForm({ source, onChange, disabled = false }: SkillSourceFormProps) {
  const t = useT().skills.describe
  const textId = useId()
  const isConversation = source.kind === 'conversation'
  const conversationExample = `${t.exampleCustomer}: ${t.exampleCustomerLine}\n${t.exampleMe}: ${t.exampleMeLine}`
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 max-w-[80ch] leading-normal text-body">{t.intro}</p>
      <div role="radiogroup" aria-label={t.sourceLabel} className="flex flex-wrap gap-2">
        {(['description', 'conversation'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={source.kind === kind}
            disabled={disabled}
            onClick={() => onChange({ kind, text: source.text })}
            className={pillTabClassNames(source.kind === kind)}
          >
            {kind === 'description' ? t.fromWords : t.fromConversation}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={textId} className="text-[13px] font-semibold text-ink">
          {isConversation ? t.conversationLabel : t.wordsLabel}
        </label>
        <textarea
          id={textId}
          value={source.text}
          maxLength={maxSourceChars}
          rows={isConversation ? 9 : 5}
          placeholder={isConversation ? conversationExample : t.wordsPlaceholder}
          disabled={disabled}
          onChange={(event) => onChange({ kind: source.kind, text: event.target.value })}
          className={`${fieldClassNames} resize-y py-2 leading-normal`}
        />
        {isConversation && <span className="text-[12px] text-muted">{t.conversationHint}</span>}
      </div>
    </div>
  )
}

interface SkillDraftEditorProps {
  draft: SkillDraft
  /** The person is writing it themselves: there is no model draft to check. */
  isManual: boolean
  onChange: (draft: SkillDraft) => void
  disabled?: boolean
}

/**
 * "Check the draft": the name, when to use it and what to do, all editable. What the person
 * leaves here is what gets checked and reviewed in the next steps; the model's draft itself
 * is never added.
 */
export function SkillDraftEditor({ draft, isManual, onChange, disabled = false }: SkillDraftEditorProps) {
  const t = useT().skills.draft
  const nameId = useId()
  const whenId = useId()
  const instructionsId = useId()
  return (
    <div className="flex flex-col gap-5">
      <p className="m-0 max-w-[80ch] leading-normal text-body">{isManual ? t.introManual : t.intro}</p>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={nameId} className="text-[13px] font-semibold text-ink">
            {t.nameLabel}
          </label>
          <input
            id={nameId}
            type="text"
            value={draft.title}
            maxLength={maxTitleChars}
            placeholder={t.namePlaceholder}
            disabled={disabled}
            onChange={(event) => onChange({ ...draft, title: event.target.value })}
            className={`${fieldClassNames} h-10`}
          />
          <span className="text-[12px] text-muted">{t.nameHint}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={whenId} className="text-[13px] font-semibold text-ink">
            {t.whenLabel}
          </label>
          <textarea
            id={whenId}
            value={draft.description}
            maxLength={maxDescriptionChars}
            rows={2}
            placeholder={t.whenPlaceholder}
            disabled={disabled}
            onChange={(event) => onChange({ ...draft, description: event.target.value })}
            className={`${fieldClassNames} resize-y py-2 leading-normal`}
          />
          <span className="text-[12px] text-muted">{t.whenHint}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={instructionsId} className="text-[13px] font-semibold text-ink">
          {t.instructionsLabel}
        </label>
        <textarea
          id={instructionsId}
          value={draft.instructions}
          rows={10}
          placeholder={t.instructionsPlaceholder}
          disabled={disabled}
          onChange={(event) => onChange({ ...draft, instructions: event.target.value })}
          className={`${fieldClassNames} resize-y py-2 leading-relaxed`}
        />
        <span className="text-[12px] text-muted">{t.instructionsHint}</span>
      </div>
      {draft.requestedTools.length > 0 && <p className="m-0 text-[13px] text-body">{t.asksForTools(draft.requestedTools.length)}</p>}
    </div>
  )
}
