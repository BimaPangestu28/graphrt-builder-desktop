import { useId } from 'react'
import type { AuthoredSkillInput } from '@/api/skillTypes'
import { Button, Icon } from '@/components/ui'
import { useT } from '@/i18n'

interface SkillDescribeFormProps {
  form: AuthoredSkillInput
  onChange: (form: AuthoredSkillInput) => void
  disabled?: boolean
}

const fieldClassNames = 'box-border w-full min-w-0 rounded-[9px] border border-line-strong bg-surface px-3 text-[14px] font-normal text-ink outline-none focus:border-ink'
/** Limits of the backend's form check (`skills::draft`), so typing stops where saving would fail. */
const maxTitleChars = 60
const maxWhenChars = 600
const maxStepChars = 1000
const maxSteps = 30

/** "Describe it": the skill's name, when the agent should use it, and what to do step by step. */
export function SkillDescribeForm({ form, onChange, disabled = false }: SkillDescribeFormProps) {
  const t = useT().skills.describe
  const nameId = useId()
  const whenId = useId()

  function setStep(index: number, text: string) {
    onChange({ ...form, steps: form.steps.map((step, stepIndex) => (stepIndex === index ? text : step)) })
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="m-0 max-w-[80ch] leading-normal text-body">{t.intro}</p>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={nameId} className="text-[13px] font-semibold text-ink">
            {t.nameLabel}
          </label>
          <input
            id={nameId}
            type="text"
            value={form.title}
            maxLength={maxTitleChars}
            placeholder={t.namePlaceholder}
            disabled={disabled}
            onChange={(event) => onChange({ ...form, title: event.target.value })}
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
            value={form.whenToUse}
            maxLength={maxWhenChars}
            rows={2}
            placeholder={t.whenPlaceholder}
            disabled={disabled}
            onChange={(event) => onChange({ ...form, whenToUse: event.target.value })}
            className={`${fieldClassNames} resize-y py-2 leading-normal`}
          />
          <span className="text-[12px] text-muted">{t.whenHint}</span>
        </div>
      </div>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 p-0 text-[13px] font-semibold text-ink">{t.stepsLabel}</legend>
        {form.steps.map((step, index) => (
          <div key={index} className="flex items-center gap-2">
            <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-chip text-[12px] font-semibold text-ink-2">
              {index + 1}
            </span>
            <input
              type="text"
              aria-label={t.stepLabel(index + 1)}
              value={step}
              maxLength={maxStepChars}
              placeholder={index === 0 ? t.stepPlaceholder : undefined}
              disabled={disabled}
              onChange={(event) => setStep(index, event.target.value)}
              className={`${fieldClassNames} h-10`}
            />
            {form.steps.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={t.removeStep(index + 1)}
                disabled={disabled}
                onClick={() => onChange({ ...form, steps: form.steps.filter((_, stepIndex) => stepIndex !== index) })}
              >
                <Icon name="trash" size={14} />
              </Button>
            )}
          </div>
        ))}
        {form.steps.length < maxSteps && (
          <Button variant="secondary" size="sm" className="self-start" disabled={disabled} onClick={() => onChange({ ...form, steps: [...form.steps, ''] })}>
            <Icon name="plus" size={14} />
            {t.addStep}
          </Button>
        )}
      </fieldset>
    </div>
  )
}
