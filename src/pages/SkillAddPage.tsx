import { useParams } from 'react-router-dom'
import { installCatalogSkill, reviewCatalogSkill } from '@/api/skills'
import { Button, Spinner } from '@/components/ui'
import { useAsyncData } from '@/hooks/useAsyncData'
import { describeError } from '@/lib/agentDisplay'
import { humanizePluginName } from '@/lib/pluginDisplayName'
import { useT } from '@/i18n'
import { SkillSetupWizard } from './skills/SkillSetupWizard'
import { WizardFrame } from './skills/WizardFrame'

/**
 * Screen 68a · Add a skill from the catalog (also its update). Opening it downloads the skill
 * and checks it against the signed catalog; nothing is added until the person has seen what
 * it does, chosen what it may use and read the safety check.
 */
export function SkillAddPage() {
  const t = useT().skills
  const { skillName = '' } = useParams()
  const review = useAsyncData(() => reviewCatalogSkill(skillName), [skillName])

  if (!review.data) {
    return (
      <WizardFrame title={t.wizard.addTitle(humanizePluginName(skillName))} steps={['about', 'tools', 'safety', 'agents']} currentStep="about">
        {review.error ? (
          <div role="alert" className="flex flex-col items-start gap-3">
            <p className="m-0 text-danger">{t.wizard.couldNotCheck(describeError(review.error))}</p>
            <Button variant="secondary" size="sm" onClick={() => void review.reload()}>
              {t.wizard.tryAgain}
            </Button>
          </div>
        ) : (
          <p role="status" className="m-0 inline-flex items-center gap-2 text-muted">
            <Spinner />
            {t.wizard.checking}
          </p>
        )}
      </WizardFrame>
    )
  }

  const title = review.data.update ? t.wizard.updateTitle(review.data.displayName) : t.wizard.addTitle(review.data.displayName)
  return (
    <SkillSetupWizard
      key={review.data.reviewId}
      title={title}
      review={review.data}
      onInstall={(choices) => installCatalogSkill(skillName, choices)}
      onReviewAgain={() => void review.reload()}
    />
  )
}
