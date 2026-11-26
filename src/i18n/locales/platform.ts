import { defineMessages } from '../types'

/** Names of system places (keychain, tray, file manager) and generic error wording. */
export const platform = defineMessages(
  {
    keychainMac: 'macOS Keychain',
    keychainWindows: 'Windows Credential Manager',
    keychainLinux: 'your system keyring',
    keychainShortMac: 'Keychain',
    keychainShortWindows: 'Credential Manager',
    keychainShortLinux: 'keyring',
    trayMac: 'menu bar',
    trayOther: 'system tray',
    fileManagerMac: 'Finder',
    fileManagerWindows: 'File Explorer',
    fileManagerLinux: 'your file manager',
    genericError: 'Something went wrong',
    runtimeDownloadSize: 'about 30 MB download',
    couldNotOpenPage: (reason: string) => `Could not open the page: ${reason}`,
  },
  {
    keychainMac: 'macOS Keychain',
    keychainWindows: 'Windows Credential Manager',
    keychainLinux: 'keyring sistem kamu',
    keychainShortMac: 'Keychain',
    keychainShortWindows: 'Credential Manager',
    keychainShortLinux: 'keyring',
    trayMac: 'bilah menu',
    trayOther: 'system tray',
    fileManagerMac: 'Finder',
    fileManagerWindows: 'File Explorer',
    fileManagerLinux: 'file manager kamu',
    genericError: 'Ada yang tidak beres',
    runtimeDownloadSize: 'unduhan sekitar 30 MB',
    couldNotOpenPage: (reason) => `Halaman gagal dibuka. ${reason}`,
  },
)
