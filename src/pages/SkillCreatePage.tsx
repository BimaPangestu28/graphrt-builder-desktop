import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { isBackendErrorWithCode } from '@/api/client'
import { draftSkill, draftSkillFromNotes, getAuthoredSkillDraft, installAuthoredSkill, reviewAuthoredSkill } from '@/api/skills'
import type { SkillDraft, SkillDraftSource, SkillReview } from '@/api/skillTypes'
import { Button, LinkButton, Spinner } from '@/components/ui'
import { describeError } from '@/lib/agentDisplay'
import { useT } from '@/i18n'
import { agentPath, connectionsTabPath, routePaths, skillDetailPath, skillFromAgentParam } from '@/routes'
import { SkillDraftEditor, SkillSourceForm } from './skills/SkillDraftForms'
import { SkillSetupWizard } from './skills/SkillSetupWizard'
import { WizardFrame, type SkillWizardStep } from './skills/WizardFrame'

const createSteps: readonly SkillWizardStep[] = ['describe', 'draft', 'about', 'tools', 'safety', 'agents']
/** Changing a skill, or writing one from what an agent learned, starts at the draft. */
const draftFirstSteps: readonly SkillWizardStep[] = ['draft', 'about', 'tools', 'safety', 'agents']
const emptyDraft: SkillDraft = { title: '', description: '', instructions: '', requestedTools: [] }

/** Where the first draft comes from when it is not the person's own words. */
type Opening = { kind: 'edit'; skillName: string } | { kind: 'notes'; agentId: string } | null

/**
 * Screen 69 · Create a skill. The person says what the agent should do in their own words, or
 * pastes a conversation that went well; their AI model writes a draft (`draftSkill`, the
 * runtime's drafting); they read and edit it; then it goes through the same confirmation
 * screens as a catalog skill. Without a model they can write the draft themselves.
 *
 * The same screen changes a skill written here (`/skills/edit/:skillName`: it opens on the
 * skill's own wording) and writes one from what an agent learned (`?fromAgent=`: the model
 * drafts it from the agent's notes). Both go through the same check and confirmation.
 */
export function SkillCreatePage() {
  const t = useT().skills
  const { skillName } = useParams()
  const [searchParams] = useSearchParams()
  const fromAgentId = searchParams.get(skillFromAgentParam)
  const opening: Opening = skillName ? { kind: 'edit', skillName } : fromAgentId ? { kind: 'notes', agentId: fromAgentId } : null
  const openingKey = opening ? `${opening.kind}:${opening.kind === 'edit' ? opening.skillName : opening.agentId}` : ''
  const [source, setSource] = useState<SkillDraftSource>({ kind: 'description', text: '' })
  const [draft, setDraft] = useState<SkillDraft | null>(null)
  const [isManual, setIsManual] = useState(false)
  const [review, setReview] = useState<SkillReview | null>(null)
  const [isWorking, setIsWorking] = useState(false)
  const [error, setError] = useState<{ message: string; needsModel: boolean } | null>(null)
  const [isOpening, setIsOpening] = useState(opening !== null)
  const openedKey = useRef('')

  function describeDraftError(draftError: unknown): { message: string; needsModel: boolean } {
    const needsModel = isBackendErrorWithCode(draftError, 'missing_credentials')
    const keyUnreadable = isBackendErrorWithCode(draftError, 'credentials')
    const message = needsModel ? t.describe.noModel : keyUnreadable ? t.describe.keyUnreadable : t.describe.couldNotDraft(describeError(draftError))
    return { message, needsModel }
  }

  useEffect(() => {
    if (!opening || openedKey.current === openingKey) return
    openedKey.current = openingKey
    let isCurrent = true
    const load = opening.kind === 'edit' ? getAuthoredSkillDraft(opening.skillName) : draftSkillFromNotes(opening.agentId)
    load
      .then((loaded) => {
        if (!isCurrent) return
        if (loaded) setDraft(loaded)
        else setError({ message: t.fromNotes.tooFew, needsModel: false })
      })
      .catch((loadError: unknown) => {
        if (!isCurrent) return
        setError(opening.kind === 'edit' ? { message: t.edit.couldNotOpen(describeError(loadError)), needsModel: false } : describeDraftError(loadError))
      })
      .finally(() => {
        if (isCurrent) setIsOpening(false)
      })
    return () => {
      isCurrent = false
    }
    // Runs once per skill or agent opened: the wording functions do not change what is loaded.
  }, [openingKey])

  async function writeDraft() {
    setIsWorking(true)
    setError(null)
    try {
      setDraft(await draftSkill(source))
      setIsManual(false)
    } catch (draftError) {
      setError(describeDraftError(draftError))
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

  const steps = opening ? draftFirstSteps : createSteps
  const title = opening?.kind === 'edit' ? t.wizard.editTitle : t.wizard.createTitle
  const leaveTo = opening?.kind === 'edit' ? skillDetailPath(opening.skillName) : opening?.kind === 'notes' ? agentPath('learned', opening.agentId) : routePaths.skills
  const leaveLink = (
    <LinkButton to={leaveTo} variant="ghost" className="!text-ink-2">
      {t.wizard.cancel}
    </LinkButton>
  )
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
        title={title}
        review={review}
        onInstall={(choices) => installAuthoredSkill(draft, choices)}
        onReviewAgain={() => setReview(null)}
        leadingSteps={{ steps: opening ? ['draft'] : ['describe', 'draft'], onBack: () => setReview(null) }}
      />
    )
  }

  if (opening && !draft) {
    return (
      <WizardFrame title={title} steps={steps} currentStep="draft" footer={<>{leaveLink}<span /></>}>
        {isOpening && (
          <span role="status" className="inline-flex items-center gap-2 text-[14px] text-muted">
            <Spinner />
            {opening.kind === 'edit' ? t.edit.opening : t.fromNotes.writing}
          </span>
        )}
        {errorNotice}
      </WizardFrame>
    )
  }

  if (draft) {
    const missing = !draft.title.trim() ? t.draft.needsName : !draft.description.trim() ? t.draft.needsWhen : !draft.instructions.trim() ? t.draft.needsInstructions : null
    const intro = opening?.kind === 'edit' ? t.edit.intro : opening?.kind === 'notes' ? t.fromNotes.intro : undefined
    return (
      <WizardFrame
        title={title}
        steps={steps}
        currentStep="draft"
        footer={
          <>
            {opening ? (
              leaveLink
            ) : (
              <Button variant="secondary" disabled={isWorking} onClick={() => setDraft(null)}>
                {t.wizard.back}
              </Button>
            )}
            <span className="flex flex-wrap items-center gap-3">
              {missing && <span className="text-[13px] text-muted">{missing}</span>}
              <Button disabled={missing !== null || isWorking} onClick={() => void checkDraft(draft)}>
                {t.wizard.next}
              </Button>
            </span>
          </>
        }
      >
        <SkillDraftEditor draft={draft} isManual={isManual} intro={intro} onChange={setDraft} disabled={isWorking} />
        {errorNotice}
      </WizardFrame>
    )
  }

  const hasText = source.text.trim().length > 0
  return (
    <WizardFrame
      title={title}
      steps={steps}
      currentStep="describe"
      footer={
        <>
          {leaveLink}
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
