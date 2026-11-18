import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { defaultJobDescription } from '@/data/newAgentTemplates'
import { routePaths } from '@/routes'
import { NewAgentPage } from '../NewAgentPage'

/** Stand-in for screen 03 that shows the router state it received. */
function GeneratingStandIn() {
  const location = useLocation()
  return <p>Generating screen {JSON.stringify(location.state)}</p>
}

function renderNewAgentPage() {
  return render(
    <MemoryRouter initialEntries={[routePaths.newAgent]}>
      <Routes>
        <Route path={routePaths.newAgent} element={<NewAgentPage />} />
        <Route path={routePaths.generating} element={<GeneratingStandIn />} />
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

  it('builds a task agent by passing the request to the generating screen', () => {
    renderNewAgentPage()
    fireEvent.change(screen.getByLabelText('Describe the job'), { target: { value: '  Send invoice reminders  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Build agent' }))
    expect(screen.getByText(/Generating screen/)).toHaveTextContent(JSON.stringify({ buildRequest: { description: 'Send invoice reminders', kind: 'task' } }))
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
