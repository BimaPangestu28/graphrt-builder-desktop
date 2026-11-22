import * as elkWorkerModule from 'elkjs/lib/elk-worker.js'

/**
 * A `Worker` for jsdom, which has none: elkjs' worker build exports `FakeWorker` under
 * CommonJS, running ELK on the calling thread behind the worker message protocol. This
 * wraps it in an `EventTarget` so `layoutEngine` can listen for `error` as it does on a
 * real worker. Tests that need real ELK layouts stub it in.
 *
 * @example
 * vi.stubGlobal('Worker', ElkTestWorker)
 */

interface ElkFakeWorker {
  onmessage: (event: { data: unknown }) => void
  postMessage: (message: unknown) => void
}

type ElkFakeWorkerConstructor = new (url: string) => ElkFakeWorker

const elkWorkerExports = elkWorkerModule as { Worker?: ElkFakeWorkerConstructor; default?: { Worker?: ElkFakeWorkerConstructor } }
const ElkFakeWorkerClass = elkWorkerExports.Worker ?? elkWorkerExports.default?.Worker

export class ElkTestWorker extends EventTarget {
  onmessage: ((event: { data: unknown }) => void) | null = null
  private readonly fakeWorker: ElkFakeWorker

  constructor(readonly url: string) {
    super()
    if (!ElkFakeWorkerClass) throw new Error('elkjs/lib/elk-worker.js did not export its FakeWorker')
    this.fakeWorker = new ElkFakeWorkerClass(url)
    this.fakeWorker.onmessage = (event) => this.onmessage?.(event)
  }

  postMessage(message: unknown) {
    this.fakeWorker.postMessage(message)
  }

  terminate() {}
}
