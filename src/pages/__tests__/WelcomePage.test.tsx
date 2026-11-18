import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { routePaths } from '@/routes'
import { WelcomePage } from '../WelcomePage'

function renderWelcomePage() {
  return render(
    <MemoryRouter initialEntries={[routePaths.welcome]}>
      <Routes>
        <Route path={routePaths.welcome} element={<WelcomePage />} />
        <Route path={routePaths.newAgent} element={<p>New agent screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('WelcomePage', () => {
  it('shows the onboarding heading with the credits option disabled', () => {
    renderWelcomePage()
    expect(screen.getByRole('heading', { name: 'Agents that run on your Mac' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /graphrt credits/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /My own API key/ })).toBeChecked()
  })

  it('blocks Continue without a key, except for a local Ollama model', () => {
    renderWelcomePage()
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'Ollama (local)' } })
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('goes to the new agent screen on Continue', () => {
    renderWelcomePage()
    fireEvent.click(screen.getByRole('checkbox', { name: /Keep agents running/ }))
    expect(screen.getByRole('checkbox', { name: /Keep agents running/ })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('New agent screen')).toBeInTheDocument()
  })
})
