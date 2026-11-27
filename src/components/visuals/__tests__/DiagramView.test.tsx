import { render, screen, waitFor } from '@testing-library/react'
import { VisualBlock } from '../VisualBlock'
import type { DiagramBlock } from '../uiBlockTypes'
import { isInertSvg, renderDiagram, sizeSvg } from '../diagram/renderDiagram'
import orderFlow from './fixtures/diagram-order-flow.json'

vi.mock('../diagram/renderDiagram', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../diagram/renderDiagram')>()),
  renderDiagram: vi.fn(),
}))

const renderMock = vi.mocked(renderDiagram)
const drawing = { svg: '<svg width="320" height="180" viewBox="0 0 320 180"><text>Customer asks</text></svg>', width: 320, height: 180 }
const block = orderFlow as DiagramBlock

describe('DiagramView', () => {
  beforeEach(() => {
    renderMock.mockReset()
    delete document.documentElement.dataset.theme
  })

  it('shows the drawing as an image, never as markup in the page', async () => {
    renderMock.mockResolvedValue(drawing)
    const { container } = render(<VisualBlock block={block} />)
    const image = await screen.findByRole('img', { name: block.fallback_text })
    expect(image.getAttribute('src')).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/)
    expect(image).toHaveAttribute('width', '320')
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.getByRole('heading', { name: 'How an order is handled' })).toBeInTheDocument()
    expect(renderMock).toHaveBeenCalledWith(block.source, expect.objectContaining({ isDark: false }))
  })

  it('draws again in the dark theme when the app theme changes', async () => {
    renderMock.mockResolvedValue(drawing)
    render(<VisualBlock block={block} />)
    await screen.findByRole('img')
    document.documentElement.dataset.theme = 'dark'
    await waitFor(() => expect(renderMock).toHaveBeenLastCalledWith(block.source, expect.objectContaining({ isDark: true })))
  })

  it('says so, with the fallback text, when the diagram cannot be drawn', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    renderMock.mockRejectedValue(new Error('Parse error on line 2'))
    render(<VisualBlock block={block} />)
    expect(await screen.findByText('This diagram could not be drawn.')).toBeInTheDocument()
    expect(screen.getByText(block.fallback_text ?? '')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})

describe('diagram SVG checks', () => {
  it('gives the SVG its viewBox size so an image knows how large it is', () => {
    const sized = sizeSvg('<svg id="d1" width="100%" xmlns="http://www.w3.org/2000/svg" style="max-width: 300.5px;" viewBox="0 0 300.5 149.2" role="graphics-document"><g/></svg>')
    expect(sized).toEqual({
      svg: '<svg width="301" height="150" id="d1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300.5 149.2" role="graphics-document"><g/></svg>',
      width: 301,
      height: 150,
    })
    expect(sizeSvg('<svg><g/></svg>')).toBeNull()
    expect(sizeSvg('<svg viewBox="0 0 0 10"></svg>')).toBeNull()
  })

  it('refuses scripts, HTML islands and event handlers', () => {
    expect(isInertSvg('<svg viewBox="0 0 1 1"><text>a --> b</text></svg>')).toBe(true)
    expect(isInertSvg('<svg><script>alert(1)</script></svg>')).toBe(false)
    expect(isInertSvg('<svg><foreignObject><div>x</div></foreignObject></svg>')).toBe(false)
    expect(isInertSvg('<svg><image onerror="alert(1)"/></svg>')).toBe(false)
    expect(isInertSvg('<svg><a href="javascript:alert(1)">x</a></svg>')).toBe(false)
  })
})
