import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { samplePluginsBackend } from '@/api/sampleBackend/plugins'
import { clearPluginIconCache } from '@/hooks/usePluginIcon'
import { PluginIcon } from './PluginIcon'

const iconDataUrl = 'data:image/svg+xml;base64,PHN2Zy8+'

function mockIconResponse(response: () => Promise<string | null>) {
  return vi.spyOn(samplePluginsBackend, 'getPluginIcon').mockImplementation(response)
}

describe('PluginIcon', () => {
  beforeEach(() => clearPluginIconCache())
  afterEach(() => vi.restoreAllMocks())

  it('shows the monogram and asks for nothing when the catalog has no icon', () => {
    const getPluginIcon = mockIconResponse(() => Promise.resolve(iconDataUrl))
    const { container } = render(<PluginIcon name="whatsapp-web" iconUrl={null} />)

    expect(container).toHaveTextContent('WW')
    expect(screen.queryByTestId('plugin-icon')).not.toBeInTheDocument()
    expect(getPluginIcon).not.toHaveBeenCalled()
  })

  it('shows the cached icon as an image once the backend returns it', async () => {
    mockIconResponse(() => Promise.resolve(iconDataUrl))
    const { container } = render(<PluginIcon name="whatsapp-web" iconUrl="https://example.test/whatsapp-web.svg" />)

    const icon = await screen.findByTestId('plugin-icon')

    expect(icon.querySelector('img')).toHaveAttribute('src', iconDataUrl)
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(container).not.toHaveTextContent('WW')
  })

  it('looks the icon up by name when the caller does not know the link', async () => {
    const getPluginIcon = mockIconResponse(() => Promise.resolve(iconDataUrl))
    render(<PluginIcon name="stripe" />)

    await screen.findByTestId('plugin-icon')

    expect(getPluginIcon).toHaveBeenCalledWith('stripe')
  })

  it('keeps the monogram when the backend has no icon', async () => {
    const getPluginIcon = mockIconResponse(() => Promise.resolve(null))
    const { container } = render(<PluginIcon name="google-maps-scraper" iconUrl="https://example.test/maps.svg" />)

    await waitFor(() => expect(getPluginIcon).toHaveBeenCalled())

    expect(container).toHaveTextContent('GM')
    expect(screen.queryByTestId('plugin-icon')).not.toBeInTheDocument()
  })

  it('keeps the monogram when loading the icon fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const getPluginIcon = mockIconResponse(() => Promise.reject(new Error('offline')))
    const { container } = render(<PluginIcon name="telegram-bot" iconUrl="https://example.test/telegram.svg" />)

    await waitFor(() => expect(console.warn).toHaveBeenCalled())

    expect(getPluginIcon).toHaveBeenCalledTimes(1)
    expect(container).toHaveTextContent('TB')
  })

  it('falls back to the monogram when the image cannot be shown', async () => {
    mockIconResponse(() => Promise.resolve(iconDataUrl))
    const { container } = render(<PluginIcon name="pdf-tools" iconUrl="https://example.test/pdf.svg" />)
    const icon = await screen.findByTestId('plugin-icon')

    fireEvent.error(icon.querySelector('img') as HTMLImageElement)

    expect(screen.queryByTestId('plugin-icon')).not.toBeInTheDocument()
    expect(container).toHaveTextContent('PT')
  })

  it('asks the backend once per plugin for every place that shows it', async () => {
    const getPluginIcon = mockIconResponse(() => Promise.resolve(iconDataUrl))
    render(
      <>
        <PluginIcon name="openai" iconUrl="https://example.test/openai.svg" />
        <PluginIcon name="openai" iconUrl="https://example.test/openai.svg" size="lg" />
      </>,
    )

    await waitFor(() => expect(screen.getAllByTestId('plugin-icon')).toHaveLength(2))

    expect(getPluginIcon).toHaveBeenCalledTimes(1)
  })
})
