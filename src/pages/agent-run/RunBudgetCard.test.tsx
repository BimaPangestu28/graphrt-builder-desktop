import { render, screen } from '@testing-library/react'
import type { RunBudget } from '@/api/runSummaryTypes'
import { RunBudgetCard } from './RunBudgetCard'

const budget = (changes: Partial<RunBudget> = {}): RunBudget => ({
  tokensUsed: 12_400,
  estimatedCostMicros: 3_100,
  limit: { maxTotalTokens: null, maxCostMicros: null },
  limitReached: false,
  ...changes,
})

describe('RunBudgetCard', () => {
  it('shows what the run used without a limit', () => {
    render(<RunBudgetCard budget={budget()} />)
    const card = screen.getByRole('region', { name: 'Spending' })
    expect(card).toHaveTextContent('12,400 tokens')
    expect(card).toHaveTextContent('about $0.0031')
    expect(card).toHaveTextContent('No spending limit')
  })

  it('shows the use against the limit and says when the limit stopped the run', () => {
    render(<RunBudgetCard budget={budget({ limit: { maxTotalTokens: 20_000, maxCostMicros: 50_000 }, limitReached: true })} />)
    const card = screen.getByRole('region', { name: 'Spending' })
    expect(card).toHaveTextContent('12,400 of 20,000 tokens')
    expect(card).toHaveTextContent('about $0.0031 of $0.05')
    expect(card).not.toHaveTextContent('No spending limit')
    expect(screen.getByRole('status')).toHaveTextContent('Stopped at the spending limit')
  })

  it('says when the cost of a model is unknown', () => {
    render(<RunBudgetCard budget={budget({ estimatedCostMicros: null })} />)
    expect(screen.getByRole('region', { name: 'Spending' })).toHaveTextContent('cost unknown for this model')
  })

  it('shows nothing for a run without models or limit, and says when it could not be worked out', () => {
    const { container, rerender } = render(<RunBudgetCard budget={budget({ tokensUsed: 0 })} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<RunBudgetCard budget={null} isUnavailable />)
    expect(screen.getByText('What this run spent could not be worked out.')).toBeInTheDocument()
  })
})
