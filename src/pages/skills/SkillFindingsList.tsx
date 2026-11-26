import type { SkillFinding } from '@/api/skillTypes'
import { Badge } from '@/components/ui'
import { useT } from '@/i18n'
import { describeFinding, describeFindingLocation, findingSeverityTones, sortFindings } from './skillDisplay'

/**
 * What the safety check found, most serious first, each in one plain sentence with where it
 * is. With no findings it says so, and always says the check cannot catch everything.
 */
export function SkillFindingsList({ findings }: { findings: readonly SkillFinding[] }) {
  const t = useT().skills.safety
  const sorted = sortFindings(findings)
  return (
    <div className="flex flex-col gap-3">
      {sorted.length === 0 ? (
        <p className="m-0 font-medium text-ok-strong">{t.nothingFound}</p>
      ) : (
        <ul aria-label={t.listLabel} className="m-0 flex list-none flex-col gap-2 p-0">
          {sorted.map((finding, index) => {
            const location = describeFindingLocation(finding)
            return (
              <li
                key={`${finding.code}-${index}`}
                data-severity={finding.severity}
                className={
                  finding.severity === 'blocking'
                    ? 'flex flex-wrap items-start gap-x-3 gap-y-1 rounded-[10px] border border-danger-line bg-danger-tint px-3 py-2.5'
                    : 'flex flex-wrap items-start gap-x-3 gap-y-1 rounded-[10px] border border-line bg-surface px-3 py-2.5'
                }
              >
                <Badge tone={findingSeverityTones[finding.severity]} className="shrink-0">
                  {t.severity[finding.severity]}
                </Badge>
                <span className="flex min-w-0 flex-1 basis-[280px] flex-col gap-0.5">
                  <span className="text-[14px] leading-normal text-ink">{describeFinding(finding)}</span>
                  {location && <span className="text-[12px] text-muted">{location}</span>}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <p className="m-0 text-[12px] leading-normal text-muted">{t.limits}</p>
    </div>
  )
}
