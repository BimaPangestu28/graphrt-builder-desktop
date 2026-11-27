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
    keyringNoDefault:
      'This computer has no default password keyring yet, so there is no safe place to save this. Open the "Passwords and Keys" app, add a password keyring, right-click it and choose "Set as default", then try again.',
    keyringNotRunning:
      'This computer has no password keyring running, so there is no safe place to save this. Install GNOME Keyring (or turn on KDE Wallet), sign out and back in, then try again.',
    keyringLocked: 'Your password keyring is locked. Unlock it with your computer password when asked, then try again.',
    runtimeDownloadSize: 'about 30 MB download',
    couldNotOpenPage: (reason: string) => `Could not open the page: ${reason}`,
    // en:end
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
    keyringNoDefault:
      'Komputer ini belum punya keyring kata sandi default, jadi belum ada tempat aman untuk menyimpannya. Buka aplikasi "Passwords and Keys" (Kata Sandi dan Kunci), tambahkan keyring kata sandi, klik kanan lalu pilih "Set as default", lalu coba lagi.',
    keyringNotRunning:
      'Di komputer ini tidak ada keyring kata sandi yang berjalan, jadi belum ada tempat aman untuk menyimpannya. Pasang GNOME Keyring (atau nyalakan KDE Wallet), keluar lalu masuk lagi ke komputer, lalu coba lagi.',
    keyringLocked: 'Keyring kata sandi kamu terkunci. Buka kuncinya dengan kata sandi komputer saat diminta, lalu coba lagi.',
    runtimeDownloadSize: 'unduhan sekitar 30 MB',
    couldNotOpenPage: (reason) => `Halaman gagal dibuka. ${reason}`,
    // id:end
  },
)
