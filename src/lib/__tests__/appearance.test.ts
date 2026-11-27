import { applyAppearance, parseAppearance, readStoredAppearance, resolveTheme, setAppearance, startAppearance } from '../appearance'
import { readThemeName } from '../useThemeName'

/** A stand-in for the operating system's light / dark switch behind `matchMedia`. */
function installSystemTheme(initiallyDark: boolean) {
  let isDark = initiallyDark
  const listeners = new Set<() => void>()
  const query = {
    get matches() {
      return isDark
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }
  vi.stubGlobal('matchMedia', vi.fn(() => query))
  return {
    switchTo(nextIsDark: boolean) {
      isDark = nextIsDark
      for (const listener of [...listeners]) listener()
    },
    listenerCount: () => listeners.size,
  }
}

describe('appearance', () => {
  let stopFollowing: (() => void) | null = null

  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  afterEach(() => {
    stopFollowing?.()
    stopFollowing = null
    vi.unstubAllGlobals()
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('resolves "Match the system" from the operating system and keeps explicit choices', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('accepts only the three known choices', () => {
    expect(parseAppearance('dark')).toBe('dark')
    expect(parseAppearance('system')).toBe('system')
    expect(parseAppearance('sepia')).toBeNull()
    expect(parseAppearance(null)).toBeNull()
  })

  it('starts dark when the system is dark and nothing was chosen', () => {
    installSystemTheme(true)
    stopFollowing = startAppearance()
    expect(readStoredAppearance()).toBe('system')
    expect(readThemeName()).toBe('dark')
  })

  it('follows the system when it switches while the app is open', () => {
    const system = installSystemTheme(false)
    stopFollowing = startAppearance()
    expect(readThemeName()).toBe('light')
    system.switchTo(true)
    expect(readThemeName()).toBe('dark')
    system.switchTo(false)
    expect(readThemeName()).toBe('light')
  })

  it('keeps an explicit choice whatever the system does, and remembers it', () => {
    const system = installSystemTheme(true)
    stopFollowing = startAppearance()
    setAppearance('light')
    expect(readThemeName()).toBe('light')
    system.switchTo(false)
    system.switchTo(true)
    expect(readThemeName()).toBe('light')
    expect(readStoredAppearance()).toBe('light')

    stopFollowing()
    stopFollowing = startAppearance()
    expect(readThemeName()).toBe('light')
  })

  it('goes back to following the system when "Match the system" is chosen again', () => {
    installSystemTheme(true)
    stopFollowing = startAppearance()
    setAppearance('light')
    setAppearance('system')
    expect(readThemeName()).toBe('dark')
  })

  it('picks up a choice made in another window', () => {
    installSystemTheme(false)
    stopFollowing = startAppearance()
    localStorage.setItem('graphrt.appearance', 'dark')
    window.dispatchEvent(new StorageEvent('storage', { key: 'graphrt.appearance', newValue: 'dark' }))
    expect(readThemeName()).toBe('dark')
  })

  it('stops listening when asked', () => {
    const system = installSystemTheme(false)
    startAppearance()()
    expect(system.listenerCount()).toBe(0)
    system.switchTo(true)
    expect(readThemeName()).toBe('light')
  })

  it('treats a stored value it does not know as "Match the system"', () => {
    installSystemTheme(true)
    localStorage.setItem('graphrt.appearance', 'sepia')
    expect(readStoredAppearance()).toBe('system')
    applyAppearance(readStoredAppearance())
    expect(readThemeName()).toBe('dark')
  })

  it('stays light where the system cannot be asked', () => {
    vi.stubGlobal('matchMedia', undefined)
    applyAppearance('system')
    expect(readThemeName()).toBe('light')
  })
})
