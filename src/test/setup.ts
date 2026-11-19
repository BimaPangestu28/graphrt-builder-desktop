import '@testing-library/jest-dom/vitest'

// jsdom's user agent names the host system (darwin, linux, win32). Pin macOS so
// copy that names the system (Keychain, menu bar, Finder) is the same on every
// machine; tests for other systems use `vi.spyOn(navigator, 'userAgent', 'get')`.
Object.defineProperty(window.navigator, 'userAgent', {
  configurable: true,
  get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
})
