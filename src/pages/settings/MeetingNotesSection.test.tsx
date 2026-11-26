import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MeetingStatus } from '@/api/meetingTypes'
import { MeetingTriggerField, type MeetingTriggerChoice } from '../schedule-agent/MeetingTriggerField'
import { MeetingNotesSettings } from './MeetingNotesSection'

const { updateMeetingSettings } = vi.hoisted(() => ({ updateMeetingSettings: vi.fn() }))

vi.mock('@/api/meetings', () => ({
  updateMeetingSettings,
  getMeetingStatus: vi.fn(),
  getMeetingTrigger: vi.fn(),
  setMeetingTrigger: vi.fn(),
  listenToMeetingStatus: vi.fn(),
}))

function status(overrides: Partial<MeetingStatus> = {}): MeetingStatus {
  return {
    isSupported: true,
    settings: { detectionEnabled: false, keepAudio: false, whisperCliPath: null, whisperModelPath: null },
    triggeredAgents: [],
    micUsers: [],
    probeError: null,
    prompt: null,
    recording: null,
    autoStopInSeconds: null,
    transcriber: { isInstalled: false, downloadMessage: null },
    ...overrides,
  }
}

describe('Settings > Meeting notes', () => {
  beforeEach(() => updateMeetingSettings.mockReset().mockImplementation(async (settings: unknown) => settings))

  it('turns detection on, keeping the other settings', async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined)
    render(<MeetingNotesSettings status={status({ settings: { ...status().settings, keepAudio: true } })} onChanged={onChanged} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /Offer to take meeting notes/ }))
    expect(updateMeetingSettings).toHaveBeenCalledWith(expect.objectContaining({ detectionEnabled: true, keepAudio: true }))
    expect(onChanged).toHaveBeenCalled()
  })

  it('says which agents get the notes and that speech to text downloads on first use', () => {
    const { rerender } = render(<MeetingNotesSettings status={status()} onChanged={vi.fn()} />)
    expect(screen.getByText(/No agent takes meeting notes yet/)).toBeInTheDocument()
    expect(screen.getByText(/downloads the first time a meeting is transcribed/)).toBeInTheDocument()

    rerender(
      <MeetingNotesSettings
        status={status({ triggeredAgents: ['Meeting notes to Notion'], transcriber: { isInstalled: false, downloadMessage: 'Downloading the speech model (147 MB)…' } })}
        onChanged={vi.fn()}
      />,
    )
    expect(screen.getByText('Notes go to: Meeting notes to Notion')).toBeInTheDocument()
    expect(screen.getByText('Downloading the speech model (147 MB)…')).toBeInTheDocument()
  })
})

describe('Schedule > When a meeting is recorded', () => {
  function choice(overrides: Partial<MeetingTriggerChoice> = {}): MeetingTriggerChoice {
    return { isSupported: true, isEnabled: false, setIsEnabled: vi.fn(), save: vi.fn(), ...overrides }
  }

  it('toggles the choice and is hidden where meeting notes are not supported', async () => {
    const setIsEnabled = vi.fn()
    const { rerender } = render(<MeetingTriggerField choice={choice({ setIsEnabled })} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /Also run when a meeting is recorded/ }))
    expect(setIsEnabled).toHaveBeenCalledWith(true)

    rerender(<MeetingTriggerField choice={choice({ isSupported: false })} />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})
