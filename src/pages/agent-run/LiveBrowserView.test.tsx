import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveBrowserView, NO_FRAME_HINT_DELAY_MS } from './LiveBrowserView'
import { readFrameAspectRatio } from './useDecodedFrame'

/** The frame box's aspect ratio as a number; CSSOM may serialize `1.6` as "1.6 / 1". */
function frameBoxRatio(): number {
  const [width, height = '1'] = screen.getByTestId(frameBoxTestId).style.aspectRatio.split('/')
  return Number(width) / Number(height)
}

const frameBoxTestId = 'live-browser-frame-box'

describe('LiveBrowserView', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('waits for the browser, then suggests updating the plugin when no picture arrives', () => {
    render(<LiveBrowserView image={null} />)
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for the browser…')
    act(() => vi.advanceTimersByTime(NO_FRAME_HINT_DELAY_MS))
    expect(screen.getByRole('status')).toHaveTextContent(/update the plugin in Connections/)
  })

  it('shows the picture once it arrives', () => {
    render(<LiveBrowserView image="data:image/jpeg;base64,AAAA" />)
    expect(screen.getByRole('img', { name: 'What the browser shows right now' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('uses a 16:10 box before the first frame', () => {
    render(<LiveBrowserView image={null} />)
    expect(frameBoxRatio()).toBeCloseTo(16 / 10)
  })
})

describe('LiveBrowserView with decoded frames', () => {
  const pendingDecodes: Array<{ src: string; resolve: () => void; reject: () => void }> = []
  const frameSizes: Record<string, { width: number; height: number }> = {}

  beforeEach(() => {
    pendingDecodes.length = 0
    // jsdom has no HTMLImageElement.decode; a real webview does.
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      configurable: true,
      value: function decodeLater(this: HTMLImageElement) {
        return new Promise<void>((resolve, reject) => pendingDecodes.push({ src: this.src, resolve, reject: () => reject(new Error('broken')) }))
      },
    })
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockImplementation(function readWidth(this: HTMLImageElement) {
      return frameSizes[this.src]?.width ?? 0
    })
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockImplementation(function readHeight(this: HTMLImageElement) {
      return frameSizes[this.src]?.height ?? 0
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(HTMLImageElement.prototype, 'decode')
  })

  async function finishDecode(src: string, outcome: 'resolve' | 'reject' = 'resolve') {
    const pendingDecode = pendingDecodes.find((decode) => decode.src === src)
    if (!pendingDecode) throw new Error(`no decode pending for ${src}`)
    await act(async () => pendingDecode[outcome]())
  }

  it('shapes the box like the frame once it has decoded', async () => {
    frameSizes['data:image/jpeg;base64,d2lkZQ=='] = { width: 960, height: 540 }
    render(<LiveBrowserView image="data:image/jpeg;base64,d2lkZQ==" />)
    expect(frameBoxRatio()).toBeCloseTo(16 / 10)
    await finishDecode('data:image/jpeg;base64,d2lkZQ==')
    expect(frameBoxRatio()).toBeCloseTo(960 / 540)
  })

  it('keeps the previous frame until the next one has decoded, and skips a broken one', async () => {
    const { rerender } = render(<LiveBrowserView image="data:image/jpeg;base64,b25l" />)
    await finishDecode('data:image/jpeg;base64,b25l')
    const picture = () => screen.getByRole('img', { name: 'What the browser shows right now' })
    expect(picture()).toHaveAttribute('src', 'data:image/jpeg;base64,b25l')

    rerender(<LiveBrowserView image="data:image/jpeg;base64,dHdv" />)
    expect(picture()).toHaveAttribute('src', 'data:image/jpeg;base64,b25l')
    await finishDecode('data:image/jpeg;base64,dHdv', 'reject')
    expect(picture()).toHaveAttribute('src', 'data:image/jpeg;base64,b25l')

    rerender(<LiveBrowserView image="data:image/jpeg;base64,dGhyZWU=" />)
    await finishDecode('data:image/jpeg;base64,dGhyZWU=')
    expect(picture()).toHaveAttribute('src', 'data:image/jpeg;base64,dGhyZWU=')
  })

  it('enlarges the live picture in a dialog that Escape closes', async () => {
    render(<LiveBrowserView image="data:image/jpeg;base64,b25l" />)
    await finishDecode('data:image/jpeg;base64,b25l')
    const enlargeButton = screen.getByRole('button', { name: 'Enlarge the live view' })
    enlargeButton.focus()
    fireEvent.click(enlargeButton)

    const dialog = screen.getByRole('dialog', { name: 'Live view of the browser' })
    expect(dialog).toContainElement(screen.getByRole('img', { name: 'What the browser shows right now, enlarged' }))
    expect(screen.getByRole('button', { name: 'Close the enlarged view' })).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(enlargeButton).toHaveFocus()
  })
})

describe('readFrameAspectRatio', () => {
  it('reads width over height and keeps extreme shapes in range', () => {
    expect(readFrameAspectRatio(960, 600)).toBe(1.6)
    expect(readFrameAspectRatio(100, 1000)).toBe(0.75)
    expect(readFrameAspectRatio(4000, 100)).toBe(2.5)
    expect(readFrameAspectRatio(0, 0)).toBeNull()
  })
})
