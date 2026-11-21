/**
 * What React Flow (`@xyflow/react`) needs from the browser that jsdom lacks:
 * `ResizeObserver`, `DOMMatrixReadOnly` and element sizes. Call
 * {@link installReactFlowTestEnvironment} in a `beforeAll` of tests that render the
 * Nodes canvas (it only adds what is missing, so calling it twice is harmless).
 */

class TestResizeObserver {
  private readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe(target: Element) {
    this.callback([{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }

  unobserve() {}

  disconnect() {}
}

class TestDomMatrixReadOnly {
  readonly m22: number

  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([0-9.]+)\)/)?.[1]
    this.m22 = scale === undefined ? 1 : Number(scale)
  }
}

/** Size React Flow sees for its pane in tests. */
export const testCanvasSize = { width: 1000, height: 700 }

export function installReactFlowTestEnvironment(): void {
  if (!('ResizeObserver' in window)) Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: TestResizeObserver })
  if (!('DOMMatrixReadOnly' in window)) Object.defineProperty(window, 'DOMMatrixReadOnly', { configurable: true, value: TestDomMatrixReadOnly })
  // React Flow measures nodes (and its own pane) with offsetWidth / offsetHeight, which jsdom
  // leaves at 0: nodes are 200 × 100, the pane a desktop-sized 1000 × 700.
  Object.defineProperties(window.HTMLElement.prototype, {
    offsetHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('react-flow__renderer') ? testCanvasSize.height : 100
      },
    },
    offsetWidth: {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('react-flow__renderer') ? testCanvasSize.width : 200
      },
    },
  })
  if (!('getBBox' in window.SVGElement.prototype)) {
    Object.defineProperty(window.SVGElement.prototype, 'getBBox', { configurable: true, value: () => ({ x: 0, y: 0, width: 0, height: 0 }) })
  }
}
