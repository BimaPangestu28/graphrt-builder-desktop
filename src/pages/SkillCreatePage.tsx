import { useState } from 'react'
import { installAuthoredSkill, reviewAuthoredSkill } from '@/api/skills'
import type { AuthoredSkillInput, SkillReview } from '@/api/skillTypes'
import { Button, LinkButton } from '@/components/ui'
import { describeError } from '@/lib/agentDisplay'
import { useT } from '@/i18n'
import { routePaths } from '@/routes'
import { SkillDescribeForm } from './skills/SkillDescribeForm'
import { SkillSetupWizard } from './skills/SkillSetupWizard'
import { WizardFrame } from './skills/WizardFrame'

const emptyForm: AuthoredSkillInput = { title: '', whenToUse: '', steps: ['', ''] }

/**
 * Screen 69 · Create a skill. A short form (name, when to use it, steps) becomes a skill that
 * then goes through the same confirmation screens as a catalog skill. Turning the form into
 * a skill is one call (`reviewAuthoredSkill`), the one to swap when graphrt can draft a skill
 * from plain language or an example conversation.
 */
export function SkillCreatePage() {
  const t = useT().skills
  const [form, setForm] = useState<AuthoredSkillInput>(emptyForm)
  const [review, setReview] = useState<SkillReview | null>(null)
  const [isDrafting, setIsDrafting] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)

  const missing = !form.title.trim() ? t.describe.needsName : !form.whenToUse.trim() ? t.describe.needsWhen : !form.steps.some((step) => step.trim()) ? t.describe.needsStep : null

  async function draft() {
    setIsDrafting(true)
    setDraftError(null)
    try {
      setReview(await reviewAuthoredSkill(form))
    } catch (error) {
      setDraftError(t.describe.couldNotDraft(describeError(error)))
    } finally {
      setIsDrafting(false)
    }
  }

  if (review) {
    return (
      <SkillSetupWizard
        key={review.reviewId}
        title={t.wizard.createTitle}
        review={review}
        onInstall={(choices) => installAuthoredSkill(form, choices)}
        onReviewAgain={() => setReview(null)}
        describeStep={{ onBack: () => setReview(null) }}
      />
    )
  }

  return (
    <WizardFrame
      title={t.wizard.createTitle}
      steps={['describe', 'about', 'tools', 'safety', 'agents']}
      currentStep="describe"
      footer={
        <>
          <LinkButton to={routePaths.skills} variant="ghost" className="!text-ink-2">
            {t.wizard.cancel}
          </LinkButton>
          <span className="flex flex-wrap items-center gap-3">
            {missing && <span className="text-[13px] text-muted">{missing}</span>}
            <Button disabled={missing !== null || isDrafting} onClick={() => void draft()}>
              {t.wizard.next}
            </Button>
          </span>
        </>
      }
    >
      <SkillDescribeForm form={form} onChange={setForm} disabled={isDrafting} />
      {draftError && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {draftError}
        </p>
      )}
    </WizardFrame>
  )
}
