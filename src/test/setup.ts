import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'
import { setSampleDelayScale } from '@/api/sampleBackend/sampleResponse'
import { resetLocaleForTests } from '@/i18n/locale'

// findBy*/waitFor give up after 1 s by default. Full-page tests (the Nodes canvas,
// the builder) render a lot in jsdom, and on a busy machine (all test files run in
// parallel) the first paint alone can take longer, which made them flaky.
configure({ asyncUtilTimeout: 5000 })

// The sample builder pauses between stages to look real; tests should not wait on
// it. Tests that step through those pauses with fake timers set the scale to 1.
beforeEach(() => setSampleDelayScale(0))

// jsdom's user agent names the host system (darwin, linux, win32). Pin macOS so
// copy that names the system (Keychain, menu bar, Finder) is the same on every
// machine; tests for other systems use `vi.spyOn(navigator, 'userAgent', 'get')`.
Object.defineProperty(window.navigator, 'userAgent', {
  configurable: true,
  get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
})

// Every test starts in English; tests of the Indonesian UI switch with `setLocale('id')`.
afterEach(() => resetLocaleForTests('en'))
