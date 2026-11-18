import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ErrorStatesPage } from '@/pages/ErrorStatesPage'
import { routePaths } from '@/routes'

function renderErrorStatesPage() {
  return render(
    <MemoryRouter>
      <ErrorStatesPage />
    </MemoryRouter>,
  )
}

describe('ErrorStatesPage', () => {
  it('explains the failed run and lists other problems', () => {
    renderErrorStatesPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Could not read your email' })).toBeInTheDocument()
    expect(screen.getByText('Failed after 3 tries')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Scan QR again' })).toHaveAttribute('href', routePaths.connectWhatsApp)
  })

  it('blocks a retry until Gmail is reconnected, then resumes the run', () => {
    renderErrorStatesPage()
    const retryButton = screen.getByRole('button', { name: 'Retry from the failed step' })
    fireEvent.click(retryButton)
    expect(screen.getByRole('status')).toHaveTextContent('Reconnect Gmail first')
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect Gmail' }))
    fireEvent.click(retryButton)
    expect(screen.getByRole('status')).toHaveTextContent('The digest was sent to Telegram')
    expect(screen.queryByText('Failed after 3 tries')).not.toBeInTheDocument()
  })

  it('resolves the OpenAI card when keeping Ollama', () => {
    renderErrorStatesPage()
    const creditCard = screen.getByRole('article', { name: 'OpenAI ran out of credit' })
    fireEvent.click(within(creditCard).getByRole('button', { name: 'Keep using Ollama' }))
    expect(within(creditCard).getByRole('status')).toHaveTextContent('keep using Ollama')
  })
})
