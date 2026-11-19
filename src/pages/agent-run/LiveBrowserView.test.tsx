import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveBrowserView, NO_FRAME_HINT_DELAY_MS } from './LiveBrowserView'

describe('LiveBrowserView', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('waits for the browser, then suggests updating the plugin when no picture arrives', () => {
    render(<LiveBrowserView image={null} />)
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for the browser…')
    act(() => vi.advanceTimersByTime(NO_FRAME_HINT_DELAY_MS))
    expect(screen.getByRole('status')).toHaveTextContent(/update the plugin in Connections/)
  })

  it('shows the picture once it arrives', () => {
    render(<LiveBrowserView image="data:image/jpeg;base64,AAAA" />)
    expect(screen.getByRole('img', { name: 'What the browser shows right now' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
