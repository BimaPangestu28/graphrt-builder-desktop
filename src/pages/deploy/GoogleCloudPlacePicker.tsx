import { useCallback, useEffect, useState } from 'react'
import { listGoogleCloudProjects, openGoogleCloudPage } from '@/api/deploy'
import type { BillingState, CloudPlace, DeployProblem, GoogleProject } from '@/api/deployTypes'
import { Badge, Button, type BadgeTone } from '@/components/ui'
import { DeployProblemNotice } from './DeployProblemNotice'
import { plainErrorMessage } from './deployDisplay'
import { cloudRunRegionLabel, cloudRunRegions, deployProblemOf, nearestCloudRunRegion } from './googleCloud'
import { messages } from '@/i18n'

const selectClassName = 'h-10 w-full rounded-[9px] border border-line-strong bg-surface px-3 text-[14px] text-ink disabled:opacity-60'

const billingTones: Record<BillingState, BadgeTone> = { enabled: 'ok', disabled: 'amber', unknown: 'neutral' }

function billingLabel(billing: BillingState): string {
  const words = messages().deploy.googleCloud
  return billing === 'enabled' ? words.billingOn : billing === 'disabled' ? words.billingOff : words.billingUnknown
}

interface GoogleCloudPlacePickerProps {
  /** Where it is online now (or was last). */
  current: CloudPlace | null
  /** It is online in `current`: the choice cannot change (take it offline to move it). */
  isLocked: boolean
  /** The chosen place, or null while no usable project is picked (none, or billing off). */
  onChange: (place: CloudPlace | null) => void
}

/**
 * Review › Google Cloud: the signed-in account's projects (billing on first, "Turn on billing"
 * for one without) and the Cloud Run region (the closest to this computer's time zone first).
 */
export function GoogleCloudPlacePicker({ current, isLocked, onChange }: GoogleCloudPlacePickerProps) {
  const words = messages().deploy.googleCloud
  const [projects, setProjects] = useState<GoogleProject[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [problem, setProblem] = useState<DeployProblem | null>(null)
  const [projectId, setProjectId] = useState<string>(current?.project ?? '')
  const [region, setRegion] = useState<string>(current?.region ?? nearestCloudRunRegion())

  const load = useCallback(async () => {
    setLoadError(null)
    setProblem(null)
    try {
      const found = await listGoogleCloudProjects()
      setProjects(found)
      setProjectId((chosen) => chosen || (found.find((project) => project.billing !== 'disabled')?.id ?? found[0]?.id ?? ''))
    } catch (error) {
      setProjects([])
      setProblem(deployProblemOf(error))
      setLoadError(plainErrorMessage(error))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const chosen = projects?.find((project) => project.id === projectId) ?? null
  // While it is online its project stays usable, even when the list no longer shows it.
  const isUsable = isLocked ? projectId !== '' : chosen !== null && chosen.billing !== 'disabled'

  useEffect(() => {
    onChange(isUsable ? { project: projectId, region } : null)
  }, [onChange, projectId, region, isUsable])

  const regionOptions: string[] = (cloudRunRegions as readonly string[]).includes(region) ? [...cloudRunRegions] : [region, ...cloudRunRegions]

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-[13px] text-body">
        {words.projectLabel}
        <span className="flex flex-wrap items-center gap-2">
          <select aria-label={words.projectLabel} value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={isLocked || !projects || projects.length === 0} className={`${selectClassName} min-w-0 flex-[1_1_220px]`}>
            {projects === null && <option value={projectId}>{words.loadingProjects}</option>}
            {isLocked && projectId && !chosen && <option value={projectId}>{projectId}</option>}
            {projects?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name === project.id ? project.id : `${project.name} (${project.id})`} · {billingLabel(project.billing)}
              </option>
            ))}
          </select>
          {!isLocked && (
            <Button size="sm" variant="ghost" onClick={() => void load()}>
              {words.refresh}
            </Button>
          )}
        </span>
      </label>
      {problem ? (
        <DeployProblemNotice problem={problem} compact />
      ) : (
        loadError && (
          <p role="alert" className="m-0 text-[13px] text-danger">
            {loadError}
          </p>
        )
      )}
      {projects !== null && projects.length === 0 && !loadError && (
        <span className="flex flex-wrap items-center gap-2 text-[13px] text-body">
          {words.noProjects}
          <Button size="sm" variant="secondary" onClick={() => void openGoogleCloudPage('create_project', null)}>
            {words.createProject}
          </Button>
        </span>
      )}
      {chosen && (
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={billingTones[chosen.billing]}>{billingLabel(chosen.billing)}</Badge>
          {chosen.billing === 'disabled' && (
            <>
              <span className="text-[13px] text-amber-deep">{words.billingOffHint(chosen.id)}</span>
              <Button size="sm" variant="secondary" onClick={() => void openGoogleCloudPage('billing', chosen.id)}>
                {words.turnOnBilling}
              </Button>
            </>
          )}
          {chosen.billing === 'unknown' && <span className="text-[13px] text-muted">{words.billingUnknownHint}</span>}
        </span>
      )}
      <label className="flex flex-col gap-1.5 text-[13px] text-body">
        {words.regionLabel}
        <select aria-label={words.regionLabel} value={region} onChange={(event) => setRegion(event.target.value)} disabled={isLocked} className={selectClassName}>
          {regionOptions.map((option) => (
            <option key={option} value={option}>
              {cloudRunRegionLabel(option)}
            </option>
          ))}
        </select>
        <span className="text-[12px] text-muted">{words.regionHint}</span>
      </label>
    </div>
  )
}
