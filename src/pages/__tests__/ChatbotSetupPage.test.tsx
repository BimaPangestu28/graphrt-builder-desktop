import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ChatbotSetupPage } from '../ChatbotSetupPage'

function renderChatbotSetup() {
  return render(
    <MemoryRouter>
      <ChatbotSetupPage />
    </MemoryRouter>,
  )
}

describe('ChatbotSetupPage', () => {
  it('shows the chatbot name and the setup sections', () => {
    renderChatbotSetup()
    expect(screen.getByRole('heading', { level: 1, name: 'Catering assistant' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Persona' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name customers see')).toHaveValue('Admin Catering')
    expect(screen.getByRole('heading', { name: 'Try it' })).toBeInTheDocument()
  })

  it('goes live and removes a knowledge file', () => {
    renderChatbotSetup()
    fireEvent.click(screen.getByRole('button', { name: 'Go live' }))
    expect(screen.getByText('Live')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Price list.xlsx' }))
    expect(screen.queryByText('Price list.xlsx')).not.toBeInTheDocument()
  })

  it('answers a test message in the Try it panel', () => {
    renderChatbotSetup()
    fireEvent.change(screen.getByLabelText('Test message'), { target: { value: 'Ongkir gratis?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByText('Ongkir gratis?')).toBeInTheDocument()
    expect(screen.getByText('Free delivery inside Bandar Lampung for orders of 30 boxes or more')).toBeInTheDocument()
  })
})
