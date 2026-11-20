import { fireEvent, render, screen } from '@testing-library/react'
import { defaultRunLimits, findInvalidRunLimit } from '@/data/runLimits'
import { RunLimitsPanel } from './RunLimitsPanel'

/** Settings › Runner › Run limits: editable within safe bounds, with Reset to defaults. */

describe('RunLimitsPanel', () => {
  it('shows every limit with its explanation and current value', () => {
    render(<RunLimitsPanel runLimits={defaultRunLimits} onSave={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Run limits' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /Time for one step/ })).toHaveValue(120)
    expect(screen.getByRole('spinbutton', { name: /Time for one run/ })).toHaveValue(30)
    expect(screen.getByRole('spinbutton', { name: /Step attempts per run/ })).toHaveValue(10000)
    expect(screen.getByRole('spinbutton', { name: /Loops inside loops/ })).toHaveValue(8)
    expect(screen.getByRole('spinbutton', { name: /Steps at the same time/ })).toHaveValue(64)
    expect(screen.getByText(/Waiting for your answer doesn't count/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled()
  })

  it('saves a changed limit when the field loses focus', () => {
    const onSave = vi.fn()
    render(<RunLimitsPanel runLimits={defaultRunLimits} onSave={onSave} />)
    const runTime = screen.getByRole('spinbutton', { name: /Time for one run/ })
    fireEvent.change(runTime, { target: { value: '90' } })
    fireEvent.blur(runTime)
    expect(onSave).toHaveBeenCalledWith({ ...defaultRunLimits, runDurationMinutes: 90 })
  })

  it('refuses values outside the safe range', () => {
    const onSave = vi.fn()
    render(<RunLimitsPanel runLimits={defaultRunLimits} onSave={onSave} />)
    const parallel = screen.getByRole('spinbutton', { name: /Steps at the same time/ })
    fireEvent.change(parallel, { target: { value: '0' } })
    fireEvent.keyDown(parallel, { key: 'Enter' })
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Use a whole number from 1 to 256')
    expect(findInvalidRunLimit({ ...defaultRunLimits, maxNestingDepth: 99 })).toBe('Loops inside loops must be between 1 and 32')
    expect(findInvalidRunLimit(defaultRunLimits)).toBeNull()
  })

  it('resets every limit to its default', () => {
    const onSave = vi.fn()
    render(<RunLimitsPanel runLimits={{ ...defaultRunLimits, stepTimeoutSeconds: 600, maxParallelSteps: 4 }} onSave={onSave} />)
    expect(screen.getByText(/default 120/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    expect(onSave).toHaveBeenCalledWith(defaultRunLimits)
    expect(screen.getByRole('spinbutton', { name: /Time for one step/ })).toHaveValue(120)
  })
})
