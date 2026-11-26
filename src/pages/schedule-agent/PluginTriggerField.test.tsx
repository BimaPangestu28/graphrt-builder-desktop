import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AvailablePluginTrigger } from '@/api/pluginTriggerTypes'
import { PluginTriggerField, type PluginTriggerChoice } from './PluginTriggerField'

const recorded: AvailablePluginTrigger = {
  plugin: 'meeting-notes',
  trigger: 'meeting_recorded',
  pluginDisplayName: 'Meeting Notes',
  title: 'When a meeting is recorded',
  description: '',
  eventFields: ['meeting_id'],
  problem: null,
}

function choice(overrides: Partial<PluginTriggerChoice> = {}): PluginTriggerChoice {
  return { available: [recorded], selectedKey: '', setSelectedKey: vi.fn(), save: vi.fn(), ...overrides }
}

describe('PluginTriggerField', () => {
  it('lists the installed plugins’ triggers and picks one', async () => {
    const setSelectedKey = vi.fn()
    render(<PluginTriggerField choice={choice({ setSelectedKey })} />)
    const select = screen.getByLabelText('Also run on an event')
    expect(screen.getByRole('option', { name: 'Meeting Notes: When a meeting is recorded' })).toBeInTheDocument()
    await userEvent.selectOptions(select, 'meeting-notes.meeting_recorded')
    expect(setSelectedKey).toHaveBeenCalledWith('meeting-notes.meeting_recorded')
  })

  it('explains a chosen trigger, or why it cannot run', () => {
    const { rerender } = render(<PluginTriggerField choice={choice({ selectedKey: 'meeting-notes.meeting_recorded' })} />)
    expect(screen.getByText('Each event starts one run, with the event as its input')).toBeInTheDocument()
    rerender(
      <PluginTriggerField
        choice={choice({ selectedKey: 'meeting-notes.meeting_recorded', available: [{ ...recorded, problem: 'trust meeting-notes to let it start agents' }] })}
      />,
    )
    expect(screen.getByText('trust meeting-notes to let it start agents')).toBeInTheDocument()
  })

  it('is hidden when no plugin has a trigger', () => {
    const { container } = render(<PluginTriggerField choice={choice({ available: [] })} />)
    expect(container).toBeEmptyDOMElement()
  })
})
