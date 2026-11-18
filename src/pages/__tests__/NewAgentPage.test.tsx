import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { defaultJobDescription } from '@/data/newAgentTemplates'
import { routePaths } from '@/routes'
import { NewAgentPage } from '../NewAgentPage'

function renderNewAgentPage() {
  return render(
    <MemoryRouter initialEntries={[routePaths.newAgent]}>
      <Routes>
        <Route path={routePaths.newAgent} element={<NewAgentPage />} />
        <Route path={routePaths.generating} element={<p>Generating screen</p>} />
        <Route path={routePaths.chatbotSetup} element={<p>Chatbot setup screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('NewAgentPage', () => {
  it('shows the prompt, kind pills and templates', () => {
    renderNewAgentPage()
    expect(screen.getByRole('heading', { name: 'What should your agent do?' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Do a task' })).toBeChecked()
    expect(screen.getByLabelText('Describe the job')).toHaveValue(defaultJobDescription)
    expect(screen.getByRole('link', { name: /Customer chatbot/ })).toHaveAttribute('href', routePaths.chatbotSetup)
  })

  it('builds a task agent by opening the generating screen', () => {
    renderNewAgentPage()
    fireEvent.click(screen.getByRole('button', { name: 'Build agent' }))
    expect(screen.getByText('Generating screen')).toBeInTheDocument()
  })

  it('sends "Answer customers" to chatbot setup and needs a description', () => {
    renderNewAgentPage()
    fireEvent.click(screen.getByRole('radio', { name: 'Answer customers' }))
    expect(screen.getByRole('radio', { name: 'Answer customers' })).toBeChecked()
    fireEvent.change(screen.getByLabelText('Describe the job'), { target: { value: '  ' } })
    expect(screen.getByRole('button', { name: 'Build agent' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Describe the job'), { target: { value: 'Answer menu questions' } })
    fireEvent.click(screen.getByRole('button', { name: 'Build agent' }))
    expect(screen.getByText('Chatbot setup screen')).toBeInTheDocument()
  })
})
