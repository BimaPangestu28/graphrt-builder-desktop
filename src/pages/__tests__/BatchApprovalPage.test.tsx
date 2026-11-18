import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BatchApprovalPage } from '../BatchApprovalPage'

function renderBatchApprovalPage() {
  return render(
    <MemoryRouter>
      <BatchApprovalPage />
    </MemoryRouter>,
  )
}

describe('BatchApprovalPage', () => {
  it('shows the batch with low-score leads unselected', () => {
    renderBatchApprovalPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Review 12 messages' })).toBeInTheDocument()
    expect(screen.getByText('11 of 12 selected')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Send to place 4' })).not.toBeChecked()
    expect(screen.getByText('Low score 4 · unselected for you')).toBeInTheDocument()
  })

  it('updates the send count when a message is unticked', () => {
    renderBatchApprovalPage()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Send to place 2' }))
    expect(screen.getByRole('button', { name: 'Send 10 selected' })).toBeInTheDocument()
    expect(screen.getByText('30 of 40')).toBeInTheDocument()
  })

  it('selects everything with the bulk checkbox and reveals hidden messages', () => {
    renderBatchApprovalPage()
    fireEvent.click(screen.getByRole('checkbox', { name: '11 of 12 selected' }))
    expect(screen.getByRole('button', { name: 'Send 12 selected' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show 8 more' }))
    expect(screen.getByRole('checkbox', { name: 'Send to place 12' })).toBeChecked()
  })

  it('edits a message inline', () => {
    renderBatchApprovalPage()
    fireEvent.click(screen.getByRole('button', { name: 'Edit message to place 2' }))
    const messageField = screen.getByRole('textbox', { name: 'Message to place 2' })
    fireEvent.change(messageField, { target: { value: 'Halo!' } })
    expect(messageField).toHaveValue('Halo!')
    expect(screen.queryByRole('textbox', { name: 'Message to place 1' })).not.toBeInTheDocument()
  })
})
