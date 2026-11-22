import type { ElkNode } from 'elkjs/lib/elk-api.js'
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url'

/**
 * Where ELK runs. Laying out a large graph takes long enough to freeze the canvas, so the
 * app runs ELK in a Web Worker only: elkjs' small `elk-api` talks to `elk-worker.min.js`,
 * served as its own asset and loaded on first use. Every Tauri webview (WKWebView,
 * WebView2, WebKitGTK) has Web Workers, so there is no in-thread copy of ELK: it would
 * ship the same 1.4 MB a second time. When the worker cannot start, `runElkLayout`
 * rejects with a `LayoutWorkerError` and the canvas places the steps in a row instead.
 *
 * One engine is created lazily and reused: starting the worker and registering ELK's
 * algorithms costs more than a layout of a typical agent. A failed engine is dropped, so
 * the next layout tries a fresh worker.
 */

/** The one call the canvas needs from ELK. */
export interface LayoutEngine {
  layout: (graph: ElkNode) => Promise<ElkNode>
}

/** The layout worker could not start or crashed (not a problem with the graph). */
export class LayoutWorkerError extends Error {
  constructor(detail: string) {
    super(`the layout worker failed: ${detail}`)
    this.name = 'LayoutWorkerError'
  }
}

let sharedEngine: Promise<LayoutEngine> | null = null

/** ELK in a worker; `layout` rejects when the worker fails to load or crashes. */
async function createWorkerEngine(): Promise<LayoutEngine> {
  if (typeof Worker === 'undefined') throw new LayoutWorkerError('this window cannot start Web Workers')
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

function readSharedEngine(): Promise<LayoutEngine> {
  sharedEngine ??= createWorkerEngine()
  return sharedEngine
}

/**
 * Lays `graph` out with ELK in a Web Worker.
 *
 * @param graph - ELK graph with sizes and layout options (ElkNode)
 * @returns The same graph with positions and container sizes (Promise<ElkNode>)
 * @throws LayoutWorkerError - when the worker cannot start or crashes (the next call retries)
 * @throws Error - when ELK cannot lay the graph out (malformed nesting)
 *
 * @example
 * const laidOut = await runElkLayout({ id: 'root', children: [{ id: 'a', width: 10, height: 10 }] })
 */
export async function runElkLayout(graph: ElkNode): Promise<ElkNode> {
  try {
    const engine = await readSharedEngine()
    return await engine.layout(graph)
  } catch (layoutError) {
    if (layoutError instanceof LayoutWorkerError) sharedEngine = null
    throw layoutError
  }
}
