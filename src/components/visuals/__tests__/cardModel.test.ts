import refundCard from './fixtures/adaptive-card-refund-approval.json'
import { actionKey, buildSubmissionValues, collectInputs, initialCardValues, missingRequiredInputs, resolveAnswerAction } from '../adaptive-card/cardModel'
import type { AdaptiveCardBlock, CardNode } from '../uiBlockTypes'

const block = refundCard as unknown as AdaptiveCardBlock

describe('Adaptive Card model', () => {
  it('collects inputs with their starting values', () => {
    const inputs = collectInputs(block.card)
    expect(inputs.map((input) => input.id)).toEqual(['reason', 'amount', 'note', 'restock'])
    expect(initialCardValues(inputs)).toEqual({ reason: 'damaged', amount: '250000', note: '', restock: 'false' })
  })

  it('sends typed values merged over the action data', () => {
    const inputs = collectInputs(block.card)
    const values = { ...initialCardValues(inputs), note: 'Sorry!', restock: 'true' }
    const action: CardNode = { type: 'Action.Submit', id: 'approve', data: { source: 'card', note: 'overridden' } }
    expect(buildSubmissionValues(action, inputs, values)).toEqual({ source: 'card', reason: 'damaged', amount: 250000, note: 'Sorry!', restock: true })
    expect(buildSubmissionValues({ ...action, associatedInputs: 'none' }, inputs, values)).toEqual({ source: 'card', note: 'overridden' })
  })

  it('maps buttons to the step answers and never guesses between several', () => {
    expect(actionKey({ type: 'Action.Execute', verb: 'reject', id: 'x' })).toBe('reject')
    expect(actionKey({ type: 'Action.Submit', data: { action: 'approve' } })).toBe('approve')
    expect(resolveAnswerAction('Approve', ['approve', 'reject'])).toBe('approve')
    expect(resolveAnswerAction('later', ['approve', 'reject'])).toBeNull()
    expect(resolveAnswerAction('ok', ['submit'])).toBe('submit')
  })

  it('reports required inputs that are empty', () => {
    const inputs = collectInputs({ type: 'AdaptiveCard', body: [{ type: 'Input.Text', id: 'note', label: 'Note', isRequired: true }] })
    expect(missingRequiredInputs(inputs, { note: ' ' })).toEqual(['Note'])
    expect(missingRequiredInputs(inputs, { note: 'ok' })).toEqual([])
  })
})
