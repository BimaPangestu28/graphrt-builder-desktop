import { useState } from 'react'
import { isBackendErrorWithCode } from '@/api/client'
import { draftSkill, installAuthoredSkill, reviewAuthoredSkill } from '@/api/skills'
import type { SkillDraft, SkillDraftSource, SkillReview } from '@/api/skillTypes'
import { Button, LinkButton, Spinner } from '@/components/ui'
import { describeError } from '@/lib/agentDisplay'
import { useT } from '@/i18n'
import { connectionsTabPath, routePaths } from '@/routes'
import { SkillDraftEditor, SkillSourceForm } from './skills/SkillDraftForms'
import { SkillSetupWizard } from './skills/SkillSetupWizard'
import { WizardFrame, type SkillWizardStep } from './skills/WizardFrame'

const createSteps: readonly SkillWizardStep[] = ['describe', 'draft', 'about', 'tools', 'safety', 'agents']
const leadingSteps: readonly SkillWizardStep[] = ['describe', 'draft']
const emptyDraft: SkillDraft = { title: '', description: '', instructions: '', requestedTools: [] }

/**
 * Screen 69 · Create a skill. The person says what the agent should do in their own words, or
 * pastes a conversation that went well; their AI model writes a draft (`draftSkill`, the
 * runtime's drafting); they read and edit it; then it goes through the same confirmation
 * screens as a catalog skill. Without a model they can write the draft themselves.
 */
export function SkillCreatePage() {
  const t = useT().skills
  const [source, setSource] = useState<SkillDraftSource>({ kind: 'description', text: '' })
  const [draft, setDraft] = useState<SkillDraft | null>(null)
  const [isManual, setIsManual] = useState(false)
  const [review, setReview] = useState<SkillReview | null>(null)
  const [isWorking, setIsWorking] = useState(false)
  const [error, setError] = useState<{ message: string; needsModel: boolean } | null>(null)

  async function writeDraft() {
    setIsWorking(true)
    setError(null)
    try {
      setDraft(await draftSkill(source))
      setIsManual(false)
    } catch (draftError) {
      const needsModel = isBackendErrorWithCode(draftError, 'missing_credentials')
      const keyUnreadable = isBackendErrorWithCode(draftError, 'credentials')
      const message = needsModel ? t.describe.noModel : keyUnreadable ? t.describe.keyUnreadable : t.describe.couldNotDraft(describeError(draftError))
      setError({ message, needsModel })
    } finally {
      setIsWorking(false)
    }
  }

  async function checkDraft(checkedDraft: SkillDraft) {
    setIsWorking(true)
    setError(null)
    try {
      setReview(await reviewAuthoredSkill(checkedDraft))
    } catch (checkError) {
      setError({ message: t.draft.couldNotCheck(describeError(checkError)), needsModel: false })
    } finally {
      setIsWorking(false)
    }
  }

  function writeMyself() {
    setError(null)
    setIsManual(true)
    setDraft(emptyDraft)
  }

  const errorNotice = error && (
    <div role="alert" className="flex flex-wrap items-center gap-3 text-[13px] text-danger">
      <span>{error.message}</span>
      {error.needsModel && (
        <LinkButton to={connectionsTabPath('models')} variant="secondary" size="sm" className="!text-ink">
          {t.describe.connectModel}
        </LinkButton>
      )}
    </div>
  )

  if (review && draft) {
    return (
      <SkillSetupWizard
        key={review.reviewId}
        title={t.wizard.createTitle}
        review={review}
        onInstall={(choices) => installAuthoredSkill(draft, choices)}
        onReviewAgain={() => setReview(null)}
        leadingSteps={{ steps: leadingSteps, onBack: () => setReview(null) }}
      />
    )
  }

  if (draft) {
    const missing = !draft.title.trim() ? t.draft.needsName : !draft.description.trim() ? t.draft.needsWhen : !draft.instructions.trim() ? t.draft.needsInstructions : null
    return (
      <WizardFrame
        title={t.wizard.createTitle}
        steps={createSteps}
        currentStep="draft"
        footer={
          <>
            <Button variant="secondary" disabled={isWorking} onClick={() => setDraft(null)}>
              {t.wizard.back}
            </Button>
            <span className="flex flex-wrap items-center gap-3">
              {missing && <span className="text-[13px] text-muted">{missing}</span>}
              <Button disabled={missing !== null || isWorking} onClick={() => void checkDraft(draft)}>
                {t.wizard.next}
              </Button>
            </span>
          </>
        }
      >
        <SkillDraftEditor draft={draft} isManual={isManual} onChange={setDraft} disabled={isWorking} />
        {errorNotice}
      </WizardFrame>
    )
  }

  const hasText = source.text.trim().length > 0
  return (
    <WizardFrame
      title={t.wizard.createTitle}
      steps={createSteps}
      currentStep="describe"
      footer={
        <>
          <LinkButton to={routePaths.skills} variant="ghost" className="!text-ink-2">
            {t.wizard.cancel}
          </LinkButton>
          <span className="flex flex-wrap items-center gap-3">
            {isWorking ? (
              <span role="status" className="inline-flex items-center gap-2 text-[13px] text-muted">
                <Spinner />
                {t.describe.writing}
              </span>
            ) : (
              !hasText && <span className="text-[13px] text-muted">{t.describe.needsText}</span>
            )}
            <Button variant="ghost" disabled={isWorking} onClick={writeMyself}>
              {t.describe.writeMyself}
            </Button>
            <Button disabled={!hasText || isWorking} onClick={() => void writeDraft()}>
              {t.describe.write}
            </Button>
          </span>
        </>
      }
    >
      <SkillSourceForm source={source} onChange={setSource} disabled={isWorking} />
      {errorNotice}
    </WizardFrame>
  )
}
