import { useState } from 'react'
import { setAgentQualitySettings } from '@/api/quality'
import type { QualitySettings } from '@/api/qualityTypes'
import { Button } from '@/components/ui'
import { useT } from '@/i18n'
import { describeError } from '@/lib/agentDisplay'

const requiredChoices = [50, 60, 70, 80, 90, 100] as const
const timesChoices = [1, 2, 3] as const
const selectClassNames = 'box-border h-10 rounded-[9px] border border-line-strong bg-surface px-3 font-sans text-[14px] text-ink'

/** "Advanced", folded by default: how many good answers a release needs, and how often to ask. */
export function QualitySettingsForm({ agentId, settings, onSaved }: { agentId: string; settings: QualitySettings; onSaved: () => void }) {
  const t = useT().quality
  const [requiredPercent, setRequiredPercent] = useState(settings.requiredPercent)
  const [timesEach, setTimesEach] = useState(settings.timesEach)
  const [status, setStatus] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const isChanged = requiredPercent !== settings.requiredPercent || timesEach !== settings.timesEach

  async function save() {
    setIsSaving(true)
    setStatus(null)
    try {
      await setAgentQualitySettings(agentId, { requiredPercent, timesEach })
      setStatus(t.settings.saved)
      onSaved()
    } catch (saveError) {
      setStatus(t.couldNot(describeError(saveError)))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <details className="rounded-[14px] border border-line bg-surface px-4 py-3">
      <summary className="cursor-pointer text-[14px] font-semibold text-ink">{t.settings.heading}</summary>
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
          {t.settings.required}
          <select value={requiredPercent} onChange={(event) => setRequiredPercent(Number(event.target.value))} className={selectClassNames}>
            {[...new Set([...requiredChoices, settings.requiredPercent])]
              .sort((left, right) => left - right)
              .map((value) => (
                <option key={value} value={value}>
                  {t.settings.percent(value)}
                </option>
              ))}
          </select>
          <span className="text-[12px] font-normal text-muted">{t.settings.requiredHint}</span>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
          {t.settings.timesEach}
          <select value={timesEach} onChange={(event) => setTimesEach(Number(event.target.value))} className={selectClassNames}>
            {[...new Set([...timesChoices, settings.timesEach])].map((value) => (
              <option key={value} value={value}>
                {t.settings.times(value)}
              </option>
            ))}
          </select>
          <span className="text-[12px] font-normal text-muted">{t.settings.timesHint}</span>
        </label>
      </div>
      <div className="mt-3 flex items-center justify-end gap-3">
        {status && <span className="text-[13px] text-muted">{status}</span>}
        <Button variant="secondary" onClick={() => void save()} disabled={!isChanged || isSaving}>
          {t.save}
        </Button>
      </div>
    </details>
  )
}
