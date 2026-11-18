import type * as ClientModule from '@/api/client'

/**
 * Helpers for tests of desktop-app behaviour. They replace `@/api/client` so that
 * `isDesktopApp()` is true and every Tauri command is answered from a handler table: the
 * real `src/api/*` wrappers then run against fake backend answers instead of the sample
 * backend. Backend events never fire.
 *
 * The test file installs the mock itself (vi.mock is hoisted per file):
 *
 * @example
 * const fakeBackend = vi.hoisted(() => ({ handlers: {} as CommandHandlers }))
 * vi.mock('@/api/client', async (importOriginal) => {
 *   const { createDesktopClient } = await import('@/test/desktopBackend')
 *   return createDesktopClient(await importOriginal(), fakeBackend)
 * })
 *
 * beforeEach(() => {
 *   fakeBackend.handlers = { list_agents: () => [] }
 * })
 */

/** Answers one command from its camelCase arguments; throw a `BackendError` to fail it. */
export type CommandHandler = (commandArguments: Record<string, unknown>) => unknown
export type CommandHandlers = Record<string, CommandHandler>

/** The handler table a test swaps between cases. */
export interface FakeBackend {
  handlers: CommandHandlers
}

/**
 * `@/api/client` as seen inside the desktop app, answering from `fakeBackend.handlers`.
 * Unknown commands fail with `internal`, so a test notices calls it did not expect.
 *
 * @param originalClient - The real module, from `importOriginal()` (typeof ClientModule)
 * @param fakeBackend - Handler table read on every call (FakeBackend)
 * @returns The replacement module (typeof ClientModule)
 */
export function createDesktopClient(originalClient: typeof ClientModule, fakeBackend: FakeBackend): typeof ClientModule {
  async function callFakeBackend(command: string, commandArguments: Record<string, unknown> = {}) {
    const handler = fakeBackend.handlers[command]
    if (!handler) throw new originalClient.BackendError('internal', `unexpected command ${command}`)
    return handler(commandArguments)
  }
  return {
    ...originalClient,
    isDesktopApp: () => true,
    callBackend: callFakeBackend as typeof ClientModule.callBackend,
    listenToBackend: async () => () => {},
  }
}
