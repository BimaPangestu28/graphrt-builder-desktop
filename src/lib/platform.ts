/**
 * Which desktop system the app runs on, and the few names that differ per system.
 *
 * Most copy says "this computer" so it reads right everywhere; these helpers are
 * for the places where the system's own name helps (where secrets are saved, where
 * the tray icon lives, the file manager, keyboard shortcuts).
 *
 * Detection reads the browser's `navigator` (the Tauri webview reports the real
 * system: WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux), so it also
 * works in the browser preview. Anything unrecognized counts as Linux, the most
 * generic wording.
 */

export type DesktopPlatform = 'macos' | 'windows' | 'linux'

/** The parts of `navigator` detection reads; injectable for tests. */
export interface NavigatorLike {
  userAgent?: string
  platform?: string
  userAgentData?: { platform?: string }
}

/**
 * Detects the desktop system from `navigatorLike` (defaults to the real `navigator`).
 *
 * @param navigatorLike - Source of `userAgentData.platform`, `platform` and `userAgent` (NavigatorLike)
 * @returns 'macos', 'windows' or 'linux' (DesktopPlatform)
 *
 * @example
 * detectDesktopPlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }) // 'windows'
 */
export function detectDesktopPlatform(navigatorLike: NavigatorLike | undefined = readNavigator()): DesktopPlatform {
  const platformHints = [navigatorLike?.userAgentData?.platform, navigatorLike?.platform, navigatorLike?.userAgent]
  for (const hint of platformHints) {
    const platform = platformFromHint(hint)
    if (platform) return platform
  }
  return 'linux'
}

function readNavigator(): NavigatorLike | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as NavigatorLike)
}

function platformFromHint(hint: string | undefined): DesktopPlatform | undefined {
  if (!hint) return undefined
  // Mac first: "darwin" (Node / jsdom user agents) contains "win".
  if (/mac|darwin|iphone|ipad/i.test(hint)) return 'macos'
  if (/win/i.test(hint)) return 'windows'
  if (/linux|x11|cros|bsd/i.test(hint)) return 'linux'
  return undefined
}

/** Where provider keys and secrets are saved: "macOS Keychain", "Windows Credential Manager" or "your system keyring". */
export function getCredentialStoreName(platform: DesktopPlatform = detectDesktopPlatform()): string {
  if (platform === 'macos') return 'macOS Keychain'
  if (platform === 'windows') return 'Windows Credential Manager'
  return 'your system keyring'
}

/** Short form for tight labels: "Keychain", "Credential Manager" or "keyring". */
export function getCredentialStoreShortName(platform: DesktopPlatform = detectDesktopPlatform()): string {
  if (platform === 'macos') return 'Keychain'
  if (platform === 'windows') return 'Credential Manager'
  return 'keyring'
}

/** Where the graphrt icon lives: "menu bar" on macOS, "system tray" elsewhere. */
export function getTrayAreaName(platform: DesktopPlatform = detectDesktopPlatform()): string {
  return platform === 'macos' ? 'menu bar' : 'system tray'
}

/** The file manager: "Finder", "File Explorer" or "your file manager". */
export function getFileManagerName(platform: DesktopPlatform = detectDesktopPlatform()): string {
  if (platform === 'macos') return 'Finder'
  if (platform === 'windows') return 'File Explorer'
  return 'your file manager'
}

/** A shortcut with the system's main modifier: "⌘+Enter" on macOS, "Ctrl+Enter" elsewhere. */
export function formatShortcut(key: string, platform: DesktopPlatform = detectDesktopPlatform()): string {
  return `${platform === 'macos' ? '⌘' : 'Ctrl'}+${key}`
}
