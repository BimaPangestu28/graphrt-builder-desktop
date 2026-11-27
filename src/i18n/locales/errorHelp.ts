import { defineMessages } from '../types'

/**
 * Plain explanations of the error kinds plugins and graphrt report (`invalid_input`,
 * `setup_required`…), grouped into families, each with what to do next. The original message
 * is always shown under it (see `src/lib/errorHelp.ts`).
 */
export const errorHelp = defineMessages(
  {
    families: {
      invalidInput: {
        headline: 'A value cannot be used',
        nextStep: 'The message below says which value. Fix it in the details you ran the agent with, or in the step, then run it again.',
      },
      setupRequired: {
        headline: 'The plugin is not fully set up yet',
        nextStep: 'Open the plugin’s settings, fill in or fix what the message below asks for, then run it again.',
      },
      missingKey: {
        headline: 'A key or account this agent needs is not set up yet',
        nextStep: 'Add it in Connections, then run it again.',
      },
      permissionDenied: {
        headline: 'The plugin did not allow this',
        nextStep: 'The message below says what was refused. Change the step so it does not need it, or allow it in the plugin’s settings.',
      },
      notFound: {
        headline: 'Something this step needs could not be found',
        nextStep: 'Check the name or the file in the message below. A file must exist and be in a folder the plugin may use (see its settings).',
      },
      timedOut: {
        headline: 'This took too long and was stopped',
        nextStep: 'Nothing was kept. Try again, if it keeps happening try with less at once.',
      },
      cancelled: {
        headline: 'This was stopped before it finished',
        nextStep: 'Nothing was kept. Run it again when you are ready.',
      },
      rateLimited: {
        headline: 'The service is getting too many requests right now',
        nextStep: 'Wait a minute, then run it again. If it keeps happening, check the limits of your plan with that service.',
      },
      signInRejected: {
        headline: 'The service did not accept the key or sign-in',
        nextStep: 'Check the key or the account in the plugin’s settings, then run it again.',
      },
      modelSignInRejected: {
        headline: 'The AI model did not accept the key',
        nextStep: 'Check the key of the AI model in Connections, then run it again.',
      },
      serviceProblem: {
        headline: 'The service reported a problem',
        nextStep: 'This usually comes from the service itself. Read its message below, then try again later.',
      },
      unreachable: {
        headline: 'The service could not be reached',
        nextStep: 'Check the internet connection, then try again.',
      },
      alreadyExists: {
        headline: 'This clashes with something that already exists',
        nextStep: 'The message below names it. Use another name or remove the old one, then try again.',
      },
      pluginProblem: {
        headline: 'The plugin ran into a problem',
        nextStep: 'Try again. If it keeps happening, update the plugin on its page and send the message below to whoever made it.',
      },
      pluginStopped: {
        headline: 'The plugin stopped or could not start',
        nextStep: 'Try again. If it keeps happening, update or reinstall the plugin on its page.',
      },
      pluginMismatch: {
        headline: 'The plugin and this app did not understand each other',
        nextStep: 'Update the plugin on its page (or update the app), then try again.',
      },
      modelTextTooLong: {
        headline: 'The text was too long for the AI model',
        nextStep: 'Run it with less text, or choose a model that takes more text in Connections.',
      },
      modelRefused: {
        headline: 'The AI model could not handle this request',
        nextStep: 'Try again. If it keeps happening, choose another model in Connections.',
      },
      addressNotAllowed: {
        headline: 'The agent tried to reach an address it may not use',
        nextStep: 'If you trust that address, add it to the trusted addresses in the agent’s builder, then run it again.',
      },
      runLimit: {
        headline: 'The run reached its limit and was stopped',
        nextStep: 'A step may repeat too often. Open the agent in the builder and check its steps.',
      },
      websiteBlocked: {
        headline: 'The website blocked the request',
        nextStep: 'Wait a while, then try again. Fewer requests at once help.',
      },
      agentSteps: {
        headline: 'The agent’s steps have a problem',
        nextStep: 'Open the agent in the builder and ask chat to fix the step named below.',
      },
    },
    openPluginSettings: (plugin: string) => `Open ${plugin} settings`,
    openPluginPage: (plugin: string) => `Open ${plugin}`,
    openPlugins: 'Open Plugins',
    openConnections: 'Open Connections',
    messageFrom: (source: string) => `What ${source} said`,
    originalMessage: 'Original message',
    checkTheSetting: 'Check the value against the message below, then save it again.',
    settingNotSaved: (setting: string) => `Could not save ${setting}`,
    settingNotCleared: (setting: string) => `Could not clear ${setting}`,
    operationFailed: (verb: string, plugin: string) => `Could not ${verb} ${plugin}`,
    pluginNotLoaded: (plugin: string) => `Could not load ${plugin}`,
    // en:end
  },
  {
    families: {
      invalidInput: {
        headline: 'Ada nilai yang tidak bisa dipakai',
        nextStep: 'Pesan di bawah menyebut nilai yang mana. Perbaiki di data saat menjalankan agent atau di langkahnya, lalu jalankan lagi.',
      },
      setupRequired: {
        headline: 'Plugin ini belum selesai disiapkan',
        nextStep: 'Buka pengaturan plugin, isi atau perbaiki yang diminta pesan di bawah, lalu jalankan lagi.',
      },
      missingKey: {
        headline: 'Ada kunci atau akun yang dibutuhkan agent ini yang belum disiapkan',
        nextStep: 'Tambahkan di Koneksi, lalu jalankan lagi.',
      },
      permissionDenied: {
        headline: 'Plugin tidak mengizinkan ini',
        nextStep: 'Pesan di bawah menyebut apa yang ditolak. Ubah langkahnya supaya tidak membutuhkannya, atau izinkan di pengaturan plugin.',
      },
      notFound: {
        headline: 'Ada yang dibutuhkan langkah ini tapi tidak ditemukan',
        nextStep: 'Cek nama atau file di pesan di bawah. File harus ada dan berada di folder yang boleh dipakai plugin (lihat pengaturannya).',
      },
      timedOut: {
        headline: 'Prosesnya terlalu lama, jadi dihentikan',
        nextStep: 'Tidak ada yang disimpan. Coba lagi, kalau terus terjadi coba dengan jumlah yang lebih sedikit sekaligus.',
      },
      cancelled: {
        headline: 'Proses ini dihentikan sebelum selesai',
        nextStep: 'Tidak ada yang disimpan. Jalankan lagi kalau sudah siap.',
      },
      rateLimited: {
        headline: 'Layanannya sedang menerima terlalu banyak permintaan',
        nextStep: 'Tunggu sebentar, lalu jalankan lagi. Kalau terus terjadi, cek batas paket kamu di layanan itu.',
      },
      signInRejected: {
        headline: 'Layanan menolak kunci atau login-nya',
        nextStep: 'Cek kunci atau akunnya di pengaturan plugin, lalu jalankan lagi.',
      },
      modelSignInRejected: {
        headline: 'Model AI menolak kuncinya',
        nextStep: 'Cek kunci model AI di Koneksi, lalu jalankan lagi.',
      },
      serviceProblem: {
        headline: 'Layanannya melaporkan masalah',
        nextStep: 'Biasanya ini dari layanannya sendiri. Baca pesannya di bawah, lalu coba lagi nanti.',
      },
      unreachable: {
        headline: 'Layanannya tidak bisa dihubungi',
        nextStep: 'Cek koneksi internet, lalu coba lagi.',
      },
      alreadyExists: {
        headline: 'Ini bentrok dengan sesuatu yang sudah ada',
        nextStep: 'Pesan di bawah menyebut namanya. Pakai nama lain atau hapus yang lama, lalu coba lagi.',
      },
      pluginProblem: {
        headline: 'Plugin mengalami masalah',
        nextStep: 'Coba lagi. Kalau terus terjadi, perbarui plugin di halamannya dan kirim pesan di bawah ke pembuatnya.',
      },
      pluginStopped: {
        headline: 'Plugin berhenti atau tidak bisa dimulai',
        nextStep: 'Coba lagi. Kalau terus terjadi, perbarui atau pasang ulang plugin di halamannya.',
      },
      pluginMismatch: {
        headline: 'Plugin dan aplikasi ini tidak saling mengerti',
        nextStep: 'Perbarui plugin di halamannya (atau perbarui aplikasinya), lalu coba lagi.',
      },
      modelTextTooLong: {
        headline: 'Teksnya terlalu panjang untuk model AI',
        nextStep: 'Jalankan dengan teks yang lebih sedikit, atau pilih model yang bisa menerima teks lebih panjang di Koneksi.',
      },
      modelRefused: {
        headline: 'Model AI tidak bisa memproses permintaan ini',
        nextStep: 'Coba lagi. Kalau terus terjadi, pilih model lain di Koneksi.',
      },
      addressNotAllowed: {
        headline: 'Agent mencoba menghubungi alamat yang tidak diizinkan',
        nextStep: 'Kalau kamu percaya alamat itu, tambahkan ke alamat tepercaya di builder agent, lalu jalankan lagi.',
      },
      runLimit: {
        headline: 'Run mencapai batasnya, jadi dihentikan',
        nextStep: 'Mungkin ada langkah yang berulang terlalu sering. Buka agent di builder dan cek langkah-langkahnya.',
      },
      websiteBlocked: {
        headline: 'Situsnya memblokir permintaan ini',
        nextStep: 'Tunggu sebentar, lalu coba lagi. Lebih sedikit permintaan sekaligus akan membantu.',
      },
      agentSteps: {
        headline: 'Ada masalah di langkah-langkah agent',
        nextStep: 'Buka agent di builder dan minta chat memperbaiki langkah yang disebut di bawah.',
      },
    },
    openPluginSettings: (plugin) => `Buka pengaturan ${plugin}`,
    openPluginPage: (plugin) => `Buka ${plugin}`,
    openPlugins: 'Buka Plugin',
    openConnections: 'Buka Koneksi',
    messageFrom: (source) => `Pesan dari ${source}`,
    originalMessage: 'Pesan asli',
    checkTheSetting: 'Cek nilainya sesuai pesan di bawah, lalu simpan lagi.',
    settingNotSaved: (setting) => `${setting} gagal disimpan`,
    settingNotCleared: (setting) => `${setting} gagal dikosongkan`,
    operationFailed: (verb, plugin) => `Gagal ${verb} ${plugin}`,
    pluginNotLoaded: (plugin) => `${plugin} gagal dimuat`,
    // id:end
  },
)
