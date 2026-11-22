import type { ElkNode } from 'elkjs/lib/elk-api.js'
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url'

/**
 * Where ELK runs. Laying out a large graph takes long enough to freeze the canvas, so the
 * app runs ELK in a Web Worker (elkjs' `elk-api` talking to `elk-worker.min.js`, served as
 * its own asset). Where there is no `Worker` (jsdom in tests), or the worker fails to load,
 * the bundled in-thread build is loaded instead. Both are loaded on first use only, so
 * neither is part of a chunk the app needs at startup.
 *
 * One engine is created lazily and reused: starting the worker and registering ELK's
 * algorithms costs more than a layout of a typical agent.
 */

/** The one call the canvas needs from ELK. */
export interface LayoutEngine {
  layout: (graph: ElkNode) => Promise<ElkNode>
}

/** The layout worker could not load or crashed (not a problem with the graph). */
export class LayoutWorkerError extends Error {
  constructor(detail: string) {
    super(`the layout worker failed: ${detail}`)
    this.name = 'LayoutWorkerError'
  }
}

let sharedEngine: Promise<LayoutEngine> | null = null

function canUseWorker(): boolean {
  return typeof Worker !== 'undefined'
}

/** ELK in a worker; `layout` rejects when the worker fails to load or crashes. */
async function createWorkerEngine(): Promise<LayoutEngine> {
  const { default: ElkApi } = await import('elkjs/lib/elk-api.js')
  let rejectWithWorkerError: (error: LayoutWorkerError) => void = () => {}
  const workerFailure = new Promise<never>((_resolve, reject) => {
    rejectWithWorkerError = reject
  })
  // Nobody may be waiting when the worker fails; the next layout sees the rejection.
  workerFailure.catch(() => {})
  const elk = new ElkApi({
    workerUrl: elkWorkerUrl,
    workerFactory: (url) => {
      const worker = new Worker(url ?? elkWorkerUrl)
      worker.addEventListener('error', (event) => rejectWithWorkerError(new LayoutWorkerError(event.message || 'could not load it')))
      return worker
    },
  })
  return { layout: (graph) => Promise.race([elk.layout(graph), workerFailure]) }
}

/** ELK on the main thread (tests, or when the worker cannot start). */
async function createInThreadEngine(): Promise<LayoutEngine> {
  const { default: Elk } = await import('elkjs/lib/elk.bundled.js')
  const elk = new Elk()
  return { layout: (graph) => elk.layout(graph) }
}

function readSharedEngine(): Promise<LayoutEngine> {
  sharedEngine ??= canUseWorker() ? createWorkerEngine() : createInThreadEngine()
  return sharedEngine
}

/**
 * Lays `graph` out with ELK, off the main thread when possible.
 *
 * @param graph - ELK graph with sizes and layout options (ElkNode)
 * @returns The same graph with positions and container sizes (Promise<ElkNode>)
 * @throws Error - when ELK cannot lay the graph out (malformed nesting)
 *
 * @example
 * const laidOut = await runElkLayout({ id: 'root', children: [{ id: 'a', width: 10, height: 10 }] })
 */
export async function runElkLayout(graph: ElkNode): Promise<ElkNode> {
  const engine = await readSharedEngine()
  try {
    return await engine.layout(graph)
  } catch (layoutError) {
    if (!(layoutError instanceof LayoutWorkerError)) throw layoutError
    console.warn('laying the steps out on the main thread instead', layoutError)
    sharedEngine = createInThreadEngine()
    return (await sharedEngine).layout(graph)
  }
}
