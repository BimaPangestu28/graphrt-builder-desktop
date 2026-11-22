const tinyGraph = {
  id: 'root',
  layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'DOWN' },
  children: [
    { id: 'first', width: 100, height: 40 },
    { id: 'second', width: 100, height: 40 },
  ],
  edges: [{ id: 'first-second', sources: ['first'], targets: ['second'] }],
}

/** A worker that fails to load, like a missing asset or a blocked script. */
class FailingWorker extends EventTarget {
  constructor(readonly url: string) {
    super()
    queueMicrotask(() => this.dispatchEvent(Object.assign(new Event('error'), { message: 'blocked' })))
  }
  postMessage() {}
  terminate() {}
}

async function importFreshLayoutEngine() {
  vi.resetModules()
  return import('../flow/layoutEngine')
}

describe('runElkLayout', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lays out on the main thread where there is no Worker (jsdom)', async () => {
    const { runElkLayout } = await importFreshLayoutEngine()
    const laidOut = await runElkLayout(tinyGraph)
    const [first, second] = laidOut.children ?? []
    expect(second.y).toBeGreaterThan(first.y ?? 0)
  })

  it('falls back to the main thread when the worker cannot load', async () => {
    const createdWorkers: FailingWorker[] = []
    vi.stubGlobal(
      'Worker',
      class extends FailingWorker {
        constructor(url: string) {
          super(url)
          createdWorkers.push(this)
        }
      },
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { runElkLayout } = await importFreshLayoutEngine()

    const laidOut = await runElkLayout(tinyGraph)

    expect(createdWorkers).toHaveLength(1)
    expect(createdWorkers[0].url).toMatch(/elk-worker\.min\.js/)
    expect(laidOut.children?.map((child) => child.id)).toEqual(['first', 'second'])
    expect(console.warn).toHaveBeenCalledWith('laying the steps out on the main thread instead', expect.any(Error))
  })
})
