import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VisualBlock } from '../VisualBlock'
import type { AdaptiveCardBlock, UiBlock } from '../uiBlockTypes'
import salesChart from './fixtures/chart-bar-monthly-sales.json'
import donutChart from './fixtures/chart-donut.json'
import lineChart from './fixtures/chart-line-with-gaps.json'
import stackedChart from './fixtures/chart-stacked-horizontal-bar.json'
import productsTable from './fixtures/table-top-products.json'
import weeklyStats from './fixtures/stats-weekly-kpis.json'
import refundCard from './fixtures/adaptive-card-refund-approval.json'
import showCard from './fixtures/adaptive-card-showcard-and-table.json'

const fixtures: Array<[string, unknown]> = [
  ['bar chart', salesChart],
  ['donut chart', donutChart],
  ['line chart', lineChart],
  ['stacked horizontal bar chart', stackedChart],
  ['table', productsTable],
  ['stats', weeklyStats],
  ['approval card', refundCard],
  ['show-card card', showCard],
]

describe('VisualBlock', () => {
  it.each(fixtures)('renders the %s fixture', async (_, fixture) => {
    const block = fixture as UiBlock
    render(<VisualBlock block={block} />)
    await waitFor(() => expect(screen.queryByText('Drawing…')).not.toBeInTheDocument())
    if (block.title) expect(screen.getAllByRole('heading', { name: block.title })[0]).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a chart as an exact table on request', async () => {
    render(<VisualBlock block={salesChart as UiBlock} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Show as table' }))
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Toko Online' })).toBeInTheDocument()
    expect(within(table).getAllByRole('row')).toHaveLength(7)
    expect(screen.getByText('Toko Offline', { selector: 'li' })).toBeInTheDocument()
  })

  it('shows KPI tiles with the direction in words', async () => {
    render(<VisualBlock block={weeklyStats as UiBlock} />)
    expect(await screen.findByText('Pendapatan')).toBeInTheDocument()
    expect(screen.getByText('up 12.5%')).toBeInTheDocument()
    expect(screen.getByText('Sehat')).toBeInTheDocument()
  })

  it('keeps card buttons disabled outside a question', async () => {
    render(<VisualBlock block={refundCard as UiBlock} />)
    const approve = await screen.findByRole('button', { name: 'Approve refund' })
    expect(approve).toBeDisabled()
    expect(screen.getAllByText('Buttons work when the agent asks you to choose').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Open order/ })).toBeEnabled()
  })

  it('answers a question with the button id and typed inputs', async () => {
    const onSubmit = vi.fn()
    render(<VisualBlock block={refundCard as UiBlock} answering={{ onSubmit, answerActionIds: ['approve', 'reject'], isSubmitting: false }} />)
    await userEvent.type(await screen.findByLabelText('Note to customer'), 'Sorry about that')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Put the items back in stock' }))
    await userEvent.click(screen.getByRole('button', { name: 'Approve refund' }))
    expect(onSubmit).toHaveBeenCalledWith({ action: 'approve', values: { reason: 'damaged', amount: 250000, note: 'Sorry about that', restock: true } })
  })

  it('opens a ShowCard inline and renders its table', async () => {
    render(<VisualBlock block={showCard as UiBlock} />)
    await userEvent.click(await screen.findByRole('button', { name: /Details/ }))
    expect(screen.getByText('Counted by Budi at 09:00')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Item' })).toBeInTheDocument()
    expect(screen.getByAltText('pixel')).toHaveAttribute('src', expect.stringMatching(/^data:image\/png/))
  })

  it('never loads remote images or injects HTML', async () => {
    const card: AdaptiveCardBlock = {
      $ui: 'adaptive_card',
      version: 1,
      card: {
        type: 'AdaptiveCard',
        version: '1.5',
        body: [
          { type: 'Image', url: 'https://tracker.example.com/pixel.png' },
          { type: 'TextBlock', text: '<img src=x onerror="alert(1)"> **hi**' },
        ],
      },
    }
    const { container } = render(<VisualBlock block={card} />)
    expect(await screen.findByText(/Image from tracker.example.com/)).toBeInTheDocument()
    expect(container.querySelectorAll('img')).toHaveLength(0)
    expect(screen.getByText('<img src=x onerror="alert(1)">', { exact: false })).toBeInTheDocument()
  })
})
