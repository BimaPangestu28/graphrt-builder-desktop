import {
  detectDesktopPlatform,
  formatShortcut,
  getCredentialStoreName,
  getCredentialStoreShortName,
  getFileManagerName,
  getTrayAreaName,
} from '../platform'

const macUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'
const windowsUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/131.0'
const linuxUserAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)'

describe('detectDesktopPlatform', () => {
  it('reads the system from the user agent of each webview', () => {
    expect(detectDesktopPlatform({ userAgent: macUserAgent })).toBe('macos')
    expect(detectDesktopPlatform({ userAgent: windowsUserAgent })).toBe('windows')
    expect(detectDesktopPlatform({ userAgent: linuxUserAgent })).toBe('linux')
  })

  it('prefers userAgentData, then navigator.platform, over the user agent', () => {
    expect(detectDesktopPlatform({ userAgentData: { platform: 'Windows' }, userAgent: macUserAgent })).toBe('windows')
    expect(detectDesktopPlatform({ platform: 'MacIntel', userAgent: linuxUserAgent })).toBe('macos')
    expect(detectDesktopPlatform({ platform: '', userAgent: windowsUserAgent })).toBe('windows')
  })

  it('does not mistake "darwin" for Windows', () => {
    expect(detectDesktopPlatform({ userAgent: 'Mozilla/5.0 (darwin) jsdom/25.0.1' })).toBe('macos')
    expect(detectDesktopPlatform({ userAgent: 'Mozilla/5.0 (win32) jsdom/25.0.1' })).toBe('windows')
  })

  it('falls back to Linux wording when nothing is known', () => {
    expect(detectDesktopPlatform({})).toBe('linux')
    expect(detectDesktopPlatform({ userAgent: 'Mozilla/5.0', platform: '' })).toBe('linux')
  })

  it('uses the real navigator by default (pinned to macOS in the test setup)', () => {
    expect(detectDesktopPlatform()).toBe('macos')
  })
})

describe('platform names', () => {
  it('names the credential store of each system', () => {
    expect(getCredentialStoreName('macos')).toBe('macOS Keychain')
    expect(getCredentialStoreName('windows')).toBe('Windows Credential Manager')
    expect(getCredentialStoreName('linux')).toBe('your system keyring')
    expect(getCredentialStoreShortName('macos')).toBe('Keychain')
    expect(getCredentialStoreShortName('windows')).toBe('Credential Manager')
    expect(getCredentialStoreShortName('linux')).toBe('keyring')
  })

  it('names the tray area and the file manager', () => {
    expect(getTrayAreaName('macos')).toBe('menu bar')
    expect(getTrayAreaName('windows')).toBe('system tray')
    expect(getTrayAreaName('linux')).toBe('system tray')
    expect(getFileManagerName('macos')).toBe('Finder')
    expect(getFileManagerName('windows')).toBe('File Explorer')
    expect(getFileManagerName('linux')).toBe('your file manager')
  })

  it('formats shortcuts with ⌘ on macOS and Ctrl elsewhere', () => {
    expect(formatShortcut('Enter', 'macos')).toBe('⌘+Enter')
    expect(formatShortcut('Enter', 'windows')).toBe('Ctrl+Enter')
    expect(formatShortcut('Enter', 'linux')).toBe('Ctrl+Enter')
  })
})
