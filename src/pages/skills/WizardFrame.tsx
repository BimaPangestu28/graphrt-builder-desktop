import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AppShell, PageFrame, PageTitleBlock } from '@/components/layout'
import { Card, Icon } from '@/components/ui'
import { useT } from '@/i18n'
import { routePaths } from '@/routes'

export type SkillWizardStep = 'describe' | 'draft' | 'about' | 'tools' | 'safety' | 'agents'

interface WizardFrameProps {
  title: string
  steps: readonly SkillWizardStep[]
  currentStep: SkillWizardStep
  children: ReactNode
  /** Buttons under the step (Back on the left, the main action on the right). */
  footer?: ReactNode
}

/**
 * The frame of the skill wizards: a back link to Skills, the title, the numbered steps with
 * the current one marked, and one wide card holding the step. One question per step.
 */
export function WizardFrame({ title, steps, currentStep, children, footer }: WizardFrameProps) {
  const t = useT().skills
  const currentIndex = steps.indexOf(currentStep)
  return (
    <AppShell activeNav="skills">
      <PageFrame>
        <div className="flex flex-col gap-3">
          <Link to={routePaths.skills} className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium no-underline !text-ink-2 hover:underline">
            <Icon name="arrowLeft" size={14} />
            {t.backToSkills}
          </Link>
          <PageTitleBlock title={title} subtitle={t.wizard.stepOf(currentIndex + 1, steps.length)} />
        </div>
        <ol aria-label={t.wizard.stepsLabel} className="m-0 flex list-none flex-wrap gap-2 p-0">
          {steps.map((step, index) => {
            const isCurrent = index === currentIndex
            const isDone = index < currentIndex
            return (
              <li
                key={step}
                aria-current={isCurrent ? 'step' : undefined}
                className={`inline-flex h-[34px] items-center gap-2 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap ${
                  isCurrent ? 'border-ink bg-ink text-white' : isDone ? 'border-line-strong bg-surface text-ink' : 'border-line bg-surface text-muted'
                }`}
              >
                <span className={`flex size-5 items-center justify-center rounded-full text-[11px] font-semibold ${isCurrent ? 'bg-white/20' : 'bg-chip text-ink-2'}`}>
                  {isDone ? <Icon name="check" size={12} /> : index + 1}
                </span>
                {t.wizard.steps[step]}
              </li>
            )
          })}
        </ol>
        <Card className="flex flex-col gap-5 p-6">
          <h2 className="m-0 text-[18px] font-semibold tracking-[-0.2px]">{t.wizard.steps[currentStep]}</h2>
          {children}
        </Card>
        {footer && <div className="flex flex-wrap items-center justify-between gap-3">{footer}</div>}
      </PageFrame>
    </AppShell>
  )
}
