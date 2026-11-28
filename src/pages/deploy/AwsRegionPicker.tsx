import { useEffect, useState } from 'react'
import { openDeployLink } from '@/api/deploy'
import { awsRegionLabel, awsRegions, nearestAwsRegion } from './aws'
import { messages } from '@/i18n'

const selectClassName = 'h-10 w-full rounded-[9px] border border-line-strong bg-surface px-3 text-[14px] text-ink disabled:opacity-60'

interface AwsRegionPickerProps {
  /** Where it is online now (or was last). */
  current: string | null
  /** It is online in `current`: the region cannot change (take it offline to move it). */
  isLocked: boolean
  onChange: (region: string) => void
}

/**
 * Review › AWS region: Jakarta first, or the region closest to this computer's time zone, with
 * a note that newer regions such as Jakarta are turned on once per AWS account.
 */
export function AwsRegionPicker({ current, isLocked, onChange }: AwsRegionPickerProps) {
  const words = messages().deploy.aws
  const [region, setRegion] = useState<string>(current ?? nearestAwsRegion())
  useEffect(() => onChange(region), [onChange, region])
  const options: string[] = (awsRegions as readonly string[]).includes(region) ? [...awsRegions] : [region, ...awsRegions]
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1.5 text-[13px] text-body">
        {words.regionLabel}
        <select aria-label={words.regionLabel} value={region} onChange={(event) => setRegion(event.target.value)} disabled={isLocked} className={selectClassName}>
          {options.map((option) => (
            <option key={option} value={option}>
              {awsRegionLabel(option)}
            </option>
          ))}
        </select>
        <span className="text-[12px] text-muted">{words.regionHint}</span>
      </label>
      {!isLocked && (
        <span className="text-[12px] leading-normal text-muted">
          {words.optInHint}{' '}
          <button type="button" onClick={() => void openDeployLink('aws_regions')} className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-brand hover:underline">
            {words.openRegions}
          </button>
        </span>
      )}
    </div>
  )
}
