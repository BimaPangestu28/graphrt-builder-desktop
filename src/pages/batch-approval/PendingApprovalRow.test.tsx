import { render, screen } from '@testing-library/react'
import type { PendingApproval } from '@/api/runReviewTypes'
import { ApprovalCard } from '@/pages/agent-run/ApprovalCard'
import { PendingApprovalRow } from './PendingApprovalRow'

/** A question whose prompt carries the invoice items as one line of JSON, as a workflow writes them. */
const invoiceApproval: PendingApproval = {
  id: 'approve_pdf',
  kind: 'form',
  nodeId: 'approve_pdf',
  frame: '',
  resumeKey: 'approve_pdf',
  stepTitle: 'Tanya sebelum membuat PDF',
  prompt: 'Buat PDF invoice ini?\n\nKlien: PT Maju Bersama\nItem: [{"description":"Desain antarmuka","quantity":3,"unit":"hari","unit_price":1500000}]',
  fields: [],
  actions: [
    { id: 'create', title: 'Buat PDF' },
    { id: 'cancel', title: 'Batal' },
  ],
  timeoutMs: null,
  expiresAt: null,
  onTimeout: null,
  toolCall: null,
  card: null,
  container: null,
}

const readableItem = /1\. Desain antarmuka · quantity 3 · unit hari · unit price 1500000/

describe('data inside an approval question', () => {
  it('is an outline, not JSON, on the approval card of a test run', () => {
    render(<ApprovalCard approval={invoiceApproval} onAnswer={() => {}} />)
    expect(screen.getByText(readableItem)).toBeInTheDocument()
    expect(screen.queryByText(/"unit_price"/)).not.toBeInTheDocument()
  })

  it('is an outline, not JSON, in the review list of a run', () => {
    render(
      <ul>
        <PendingApprovalRow
          approval={invoiceApproval}
          values={{}}
          chosenActionId="create"
          actionPair={['create', 'cancel']}
          isEditing
          isLast
          onChooseAction={() => {}}
          onStartEditing={() => {}}
          onChangeValue={() => {}}
        />
      </ul>,
    )
    expect(screen.getByText(readableItem)).toBeInTheDocument()
    expect(screen.queryByText(/"unit_price"/)).not.toBeInTheDocument()
  })
})
