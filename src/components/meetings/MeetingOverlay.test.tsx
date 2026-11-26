import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { MeetingRecord, MeetingStatus } from '@/api/meetingTypes'
import { MeetingOverlayView } from './MeetingOverlay'

const { startMeetingRecording, stopMeetingRecording, dismissMeetingPrompt } = vi.hoisted(() => ({
  startMeetingRecording: vi.fn(),
  stopMeetingRecording: vi.fn(),
  dismissMeetingPrompt: vi.fn(),
}))

vi.mock('@/api/meetings', () => ({ startMeetingRecording, stopMeetingRecording, dismissMeetingPrompt }))

const recording: MeetingRecord = {
  id: 'm1',
  title: 'Zoom meeting, Nov 26 10:00',
  app: 'Zoom',
  startedAt: new Date(Date.now() - 65_000).toISOString(),
  endedAt: null,
  status: 'recording',
  tracks: [],
  error: null,
  folder: '/data/meetings/m1',
}

function status(overrides: Partial<MeetingStatus> = {}): MeetingStatus {
  return {
    isSupported: true,
    settings: { detectionEnabled: true, whisperCliPath: null, whisperModelPath: null },
    micUsers: [],
    probeError: null,
    prompt: null,
    meetingSeemsOver: false,
    recording: null,
    transcribing: [],
    transcriber: { whisperCli: null, whisperModel: null, modelsFolder: '/data/meetings/models', isReady: false },
    ...overrides,
  }
}

function renderOverlay(meetingStatus: MeetingStatus) {
  const onChanged = vi.fn().mockResolvedValue(undefined)
  render(
    <MemoryRouter>
      <MeetingOverlayView status={meetingStatus} onChanged={onChanged} />
    </MemoryRouter>,
  )
  return { onChanged }
}

describe('MeetingOverlay', () => {
  beforeEach(() => {
    startMeetingRecording.mockReset().mockResolvedValue(recording)
    stopMeetingRecording.mockReset().mockResolvedValue({ ...recording, status: 'recorded' })
    dismissMeetingPrompt.mockReset().mockResolvedValue(undefined)
  })

  it('shows nothing without a prompt or a recording', () => {
    const { container } = render(
      <MemoryRouter>
        <MeetingOverlayView status={status()} onChanged={vi.fn()} />
      </MemoryRouter>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('asks before taking notes and records only on Take notes', async () => {
    const prompt = { apps: [{ kind: 'zoom' as const, label: 'Zoom', streamId: 7, pid: 42 }], message: 'Zoom is using the microphone' }
    const { onChanged } = renderOverlay(status({ prompt }))
    expect(screen.getByRole('complementary', { name: 'Meeting detected' })).toHaveTextContent('Zoom is using the microphone')
    expect(startMeetingRecording).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Take notes' }))
    expect(startMeetingRecording).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalled()
  })

  it('Not now dismisses the prompt', async () => {
    const prompt = { apps: [], message: 'A program is using the microphone' }
    renderOverlay(status({ prompt }))
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(dismissMeetingPrompt).toHaveBeenCalledTimes(1)
    expect(startMeetingRecording).not.toHaveBeenCalled()
  })

  it('shows the recording with its clock and stops it', async () => {
    renderOverlay(status({ recording }))
    const pill = screen.getByRole('complementary', { name: 'Meeting notes' })
    expect(pill).toHaveTextContent(/Recording 01:0[5-9]/)
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(stopMeetingRecording).toHaveBeenCalledTimes(1)
  })

  it('offers to keep recording when the meeting seems over, and shows errors', async () => {
    stopMeetingRecording.mockRejectedValue(new Error('pw-record failed'))
    renderOverlay(status({ recording, meetingSeemsOver: true }))
    expect(screen.getByText('The meeting seems over.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(await screen.findByText('pw-record failed')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Keep recording' }))
    expect(dismissMeetingPrompt).toHaveBeenCalledTimes(1)
  })
})
