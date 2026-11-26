import { useState, type ReactNode } from 'react'
import { isBackendErrorWithCode } from '@/api/client'
import type { InstalledSkill, SkillInstallChoices, SkillReview, ToolPermission } from '@/api/skillTypes'
import { Badge, Button, LinkButton } from '@/components/ui'
import { describeError } from '@/lib/agentDisplay'
import { useT } from '@/i18n'
import { routePaths, skillDetailPath } from '@/routes'
import { AgentSkillPicker } from './AgentSkillPicker'
import { SkillFindingsList } from './SkillFindingsList'
import { describeSkillSource, describeUpdateChanges } from './skillDisplay'
import { ToolPermissionPicker } from './ToolPermissionPicker'
import { WizardFrame, type SkillWizardStep } from './WizardFrame'

/** The steps every skill goes through once there is something to review. */
const reviewSteps: readonly SkillWizardStep[] = ['about', 'tools', 'safety', 'agents']

interface SkillSetupWizardProps {
  title: string
  /** What was downloaded (or drafted) and checked. Nothing is installed yet. */
  review: SkillReview
  /** Installs exactly what `review` showed with the person's choices. */
  onInstall: (choices: SkillInstallChoices) => Promise<InstalledSkill>
  /** The review is stale: the person starts over from the first step. */
  onReviewAgain: () => void
  /** For "Create a skill": the form is the wizard's first step; Back on "What it does" returns to it. */
  describeStep?: { onBack: () => void }
}

/**
 * The confirmation screens of a skill, one question per step: what it does (and what an
 * update changes), what it may use (nothing ticked), what the safety check found, then, once
 * added, which agents use it. The skill is added only by the button on the safety step.
 */
export function SkillSetupWizard({ title, review, onInstall, onReviewAgain, describeStep }: SkillSetupWizardProps) {
  const t = useT().skills
  const steps: readonly SkillWizardStep[] = describeStep ? ['describe', ...reviewSteps] : reviewSteps
  const [step, setStep] = useState<SkillWizardStep>('about')
  // Never prefilled, not even on an update: the person ticks what the skill may use now.
  const [permissions, setPermissions] = useState<ToolPermission[]>([])
  const [acceptsFindings, setAcceptsFindings] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)
  const [installError, setInstallError] = useState<{ message: string; isStale: boolean } | null>(null)
  const [installed, setInstalled] = useState<InstalledSkill | null>(null)

  async function install() {
    setIsInstalling(true)
    setInstallError(null)
    try {
      setInstalled(await onInstall({ reviewId: review.reviewId, permissions, acceptFindings: acceptsFindings }))
      setStep('agents')
    } catch (error) {
      const isStale = isBackendErrorWithCode(error, 'conflict')
      setInstallError({ message: isStale ? t.wizard.changedSinceReview : t.wizard.couldNotAdd(describeError(error)), isStale })
    } finally {
      setIsInstalling(false)
    }
  }

  const installLabel = review.source === 'authored' ? t.safety.saveSkill : review.update ? t.safety.updateSkill : t.safety.addSkill
  const cancelLink = (
    <LinkButton to={routePaths.skills} variant="ghost" className="!text-ink-2">
      {t.wizard.cancel}
    </LinkButton>
  )
  const footers: Record<SkillWizardStep, ReactNode> = {
    describe: null,
    about: (
      <>
        {describeStep ? (
          <Button variant="secondary" onClick={describeStep.onBack}>
            {t.wizard.back}
          </Button>
        ) : (
          cancelLink
        )}
        <Button onClick={() => setStep('tools')}>{t.wizard.next}</Button>
      </>
    ),
    tools: (
      <>
        <Button variant="secondary" onClick={() => setStep('about')}>
          {t.wizard.back}
        </Button>
        <Button onClick={() => setStep('safety')}>{t.wizard.next}</Button>
      </>
    ),
    safety: (
      <>
        <Button variant="secondary" disabled={isInstalling} onClick={() => setStep('tools')}>
          {t.wizard.back}
        </Button>
        <Button disabled={isInstalling || (review.needsExtraConfirmation && !acceptsFindings)} onClick={() => void install()}>
          {isInstalling ? t.safety.adding : installLabel}
        </Button>
      </>
    ),
    agents: (
      <>
        <span />
        <LinkButton to={installed ? skillDetailPath(installed.name) : routePaths.skills} className="!text-white">
          {t.wizard.done}
        </LinkButton>
      </>
    ),
  }

  return (
    <WizardFrame title={title} steps={steps} currentStep={step} footer={footers[step]}>
      {step === 'about' && <AboutStep review={review} />}
      {step === 'tools' && (
        <ToolPermissionPicker requestedTools={review.requestedTools} unsupportedTools={review.unsupportedTools} permissions={permissions} onChange={setPermissions} />
      )}
      {step === 'safety' && (
        <div className="flex flex-col gap-4">
          <p className="m-0 max-w-[80ch] leading-normal text-body">{t.safety.intro}</p>
          <SkillFindingsList findings={review.findings} />
          {review.needsExtraConfirmation && (
            <label className="flex cursor-pointer items-center gap-2.5 rounded-[10px] border border-danger-line bg-danger-tint px-3 py-2.5 text-[14px] font-medium text-ink">
              <input type="checkbox" checked={acceptsFindings} disabled={isInstalling} onChange={(event) => setAcceptsFindings(event.target.checked)} className="size-4 shrink-0 accent-ink" />
              {t.safety.confirmBlocking}
            </label>
          )}
          {installError && (
            <div role="alert" className="flex flex-wrap items-center gap-3 text-[13px] text-danger">
              <span>{installError.message}</span>
              {installError.isStale && (
                <Button variant="secondary" size="sm" onClick={onReviewAgain}>
                  {t.wizard.tryAgain}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {step === 'agents' && installed && (
        <div className="flex flex-col gap-4">
          <p role="status" className="m-0 font-medium text-ok-strong">
            {t.agents.added(installed.displayName)}
          </p>
          <p className="m-0 max-w-[80ch] leading-normal text-body">{t.agents.intro}</p>
          <AgentSkillPicker skillName={installed.name} />
        </div>
      )}
    </WizardFrame>
  )
}

/** "What it does": who it is from, what it is for, and for an update what changes. */
function AboutStep({ review }: { review: SkillReview }) {
  const t = useT().skills
  const changeLines = review.update ? describeUpdateChanges(review.update) : []
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[16px] font-semibold text-ink">{review.displayName}</span>
        {review.source === 'catalog' && <Badge tone="ok">{t.checked}</Badge>}
        <span className="text-[13px] text-muted">
          {[describeSkillSource(review.source, review.publisher), review.version ? t.versionLabel(review.version) : null].filter(Boolean).join(' · ')}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[12px] font-semibold tracking-wide text-muted uppercase">{t.about.purposeLabel}</span>
        <p className="m-0 max-w-[80ch] text-[15px] leading-relaxed text-ink">{review.description}</p>
      </div>
      {review.instructions && (
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold tracking-wide text-muted uppercase">{t.about.instructionsLabel}</span>
          <pre className="m-0 max-h-[280px] overflow-auto rounded-[10px] bg-subtle p-3 font-sans text-[13px] leading-relaxed whitespace-pre-wrap text-body">{review.instructions}</pre>
        </div>
      )}
      {review.update && (
        <div className="flex flex-col gap-2 rounded-[12px] border border-amber-line-2 bg-amber-tint px-4 py-3">
          <span className="text-[14px] font-semibold text-ink">{t.about.updateHeading}</span>
          {review.update.nothingChanged || changeLines.length === 0 ? (
            <span className="text-[13px] text-body">{t.about.nothingChanged}</span>
          ) : (
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] text-body">
              {changeLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <span className="text-[13px] font-medium text-amber-deep">{t.about.choicesNotKept}</span>
        </div>
      )}
      <p className="m-0 text-[13px] text-muted">{t.about.onlyInstructions}</p>
    </div>
  )
}
