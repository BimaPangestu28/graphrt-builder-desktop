import { ElkTestWorker } from './elkTestWorker'

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

  it('lays the graph out in the ELK worker', async () => {
    const createdWorkers: ElkTestWorker[] = []
    vi.stubGlobal(
      'Worker',
      class extends ElkTestWorker {
        constructor(url: string) {
          super(url)
          createdWorkers.push(this)
        }
      },
    )
    const { runElkLayout } = await importFreshLayoutEngine()

    const laidOut = await runElkLayout(tinyGraph)

    const [first, second] = laidOut.children ?? []
    expect(second.y).toBeGreaterThan(first.y ?? 0)
    expect(createdWorkers).toHaveLength(1)
    expect(createdWorkers[0].url).toMatch(/elk-worker\.min\.js/)
  })

  it('rejects with a LayoutWorkerError where there is no Worker', async () => {
    vi.stubGlobal('Worker', undefined)
    const { runElkLayout, LayoutWorkerError } = await importFreshLayoutEngine()

    await expect(runElkLayout(tinyGraph)).rejects.toBeInstanceOf(LayoutWorkerError)
  })

  it('rejects when the worker cannot load, and starts a fresh worker on the next layout', async () => {
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
    const { runElkLayout, LayoutWorkerError } = await importFreshLayoutEngine()

    await expect(runElkLayout(tinyGraph)).rejects.toBeInstanceOf(LayoutWorkerError)
    await expect(runElkLayout(tinyGraph)).rejects.toThrow('the layout worker failed: blocked')
    expect(createdWorkers).toHaveLength(2)
  })
})
