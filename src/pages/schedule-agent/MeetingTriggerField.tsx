import { useEffect, useState } from 'react'
import { getMeetingStatus, getMeetingTrigger, setMeetingTrigger } from '@/api/meetings'

/** The "When a meeting is recorded" choice of the schedule form, saved with "Activate agent". */
export interface MeetingTriggerChoice {
  /** False where meeting notes are not supported (the field is hidden). */
  isSupported: boolean
  isEnabled: boolean
  setIsEnabled: (isEnabled: boolean) => void
  /** Saves the choice when it differs from the stored one. */
  save: () => Promise<void>
}

/**
 * Loads the agent's meeting trigger for the schedule form.
 *
 * @param agentId - The agent being scheduled (string)
 * @returns The choice and its save function (MeetingTriggerChoice)
 */
export function useMeetingTriggerChoice(agentId: string): MeetingTriggerChoice {
  const [isSupported, setIsSupported] = useState(false)
  const [storedValue, setStoredValue] = useState(false)
  const [isEnabled, setIsEnabled] = useState(false)

  useEffect(() => {
    let isCurrent = true
    void Promise.all([getMeetingStatus(), getMeetingTrigger(agentId)])
      .then(([status, trigger]) => {
        if (!isCurrent) return
        setIsSupported(status.isSupported)
        setStoredValue(trigger.enabled)
        setIsEnabled(trigger.enabled)
      })
      .catch((loadError: unknown) => console.error('Could not load the meeting trigger', loadError))
    return () => {
      isCurrent = false
    }
  }, [agentId])

  async function save() {
    if (!isSupported || isEnabled === storedValue) return
    const saved = await setMeetingTrigger(agentId, isEnabled)
    setStoredValue(saved.enabled)
  }

  return { isSupported, isEnabled, setIsEnabled, save }
}

/** Checkbox under "When": run this agent on the notes of meetings the user records. */
export function MeetingTriggerField({ choice }: { choice: MeetingTriggerChoice }) {
  if (!choice.isSupported) return null
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={choice.isEnabled}
        onChange={(event) => choice.setIsEnabled(event.target.checked)}
        className="mt-0.5 size-[18px] accent-brand"
      />
      <span className="flex flex-col gap-0.5">
        <span>Also run when a meeting is recorded</span>
        <span className="text-[13px] text-muted">
          When you choose Take notes on a meeting, this agent gets it after you stop (use a Transcribe meeting step)
        </span>
      </span>
    </label>
  )
}
