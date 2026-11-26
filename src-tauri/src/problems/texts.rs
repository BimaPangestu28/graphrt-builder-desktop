//! Problem titles, explanations and button labels in the UI language (English
//! or Indonesian, from the `app.language` setting). Error text that comes from
//! graphrt or a plugin is quoted as is.

use crate::desktop::app_settings::AppSettings;
use crate::desktop::ui_language::UiLanguage;
use crate::storage::Database;

/// The problem texts in one language.
#[derive(Debug, Clone, Copy)]
pub(super) struct ProblemTexts {
    language: UiLanguage,
}

impl ProblemTexts {
    pub(super) fn new(language: UiLanguage) -> Self {
        Self { language }
    }

    /// The texts in the stored UI language (English until one is stored).
    pub(super) fn for_database(db: &Database) -> Self {
        Self::new(AppSettings::load_or_default(db).language.unwrap_or_default())
    }

    fn pick(self, english: String, indonesian: String) -> String {
        match self.language {
            UiLanguage::En => english,
            UiLanguage::Id => indonesian,
        }
    }

    fn word(self, english: &str, indonesian: &str) -> String {
        self.pick(english.to_owned(), indonesian.to_owned())
    }

    // Buttons

    pub(super) fn see_what_happened(self) -> String {
        self.word("See what happened", "Lihat yang terjadi")
    }
    pub(super) fn retry_from_start(self) -> String {
        self.word("Retry from the start", "Ulangi dari awal")
    }
    pub(super) fn open_plugin_settings(self) -> String {
        self.word("Open plugin settings", "Buka pengaturan plugin")
    }
    pub(super) fn open_connections(self) -> String {
        self.word("Open Connections", "Buka Koneksi")
    }
    pub(super) fn open_plugins(self) -> String {
        self.word("Open plugins", "Buka Plugin")
    }
    pub(super) fn install_plugin_runtime(self) -> String {
        self.word("Install the plugin runtime", "Pasang runtime plugin")
    }
    pub(super) fn install_browser(self) -> String {
        self.word("Install the browser", "Pasang browser")
    }
    pub(super) fn change_schedule(self) -> String {
        self.word("Change the schedule", "Ubah jadwal")
    }
    pub(super) fn reconnect(self) -> String {
        self.word("Reconnect", "Hubungkan ulang")
    }
    pub(super) fn open_step(self) -> String {
        self.word("Open the step", "Buka langkahnya")
    }
    pub(super) fn open_builder(self) -> String {
        self.word("Open the builder", "Buka builder")
    }

    // Problem list

    pub(super) fn provider_turned_on(self, provider: &str) -> String {
        self.pick(format!("{provider} turned on in Connections"), format!("{provider} diaktifkan di Koneksi"))
    }
    pub(super) fn provider_key(self, provider: &str) -> String {
        self.pick(format!("{provider} key"), format!("key {provider}"))
    }
    pub(super) fn plugin_setting(self, plugin: &str, setting: &str) -> String {
        self.pick(format!("{plugin} setting {setting}"), format!("pengaturan {plugin} {setting}"))
    }
    pub(super) fn missing_connection_title(self, agent: &str) -> String {
        self.pick(format!("{agent} is missing a connection"), format!("{agent} belum punya koneksi yang dibutuhkan"))
    }
    pub(super) fn missing_connection_detail(self, items: &str) -> String {
        self.pick(
            format!("It needs {items}. Its runs cannot start until this is set"),
            format!("Agent ini butuh {items}. Run-nya tidak bisa dimulai sampai ini diisi"),
        )
    }
    pub(super) fn plugin_missing_title(self, plugin: &str) -> String {
        self.pick(format!("The {plugin} plugin is not installed"), format!("Plugin {plugin} belum terpasang"))
    }
    pub(super) fn plugin_missing_detail(self, agents: &str) -> String {
        self.pick(
            format!("{agents} uses it. Install it from Connections, Plugins"),
            format!("Dipakai oleh {agents}. Pasang dari halaman Plugin"),
        )
    }
    pub(super) fn cannot_run_until_it_does(self, agents: &str) -> String {
        self.pick(
            format!(" {agents} cannot run until it does."),
            format!(" {agents} tidak bisa jalan sampai plugin ini bisa dimulai."),
        )
    }
    pub(super) fn plugin_not_loaded_title(self, plugin: &str) -> String {
        self.pick(format!("The {plugin} plugin could not start"), format!("Plugin {plugin} gagal dimulai"))
    }
    pub(super) fn plugin_untrusted_title(self, plugin: &str) -> String {
        self.pick(format!("The {plugin} plugin is not trusted yet"), format!("Plugin {plugin} belum dipercaya"))
    }
    pub(super) fn plugin_untrusted_detail(self, agents: &str) -> String {
        self.pick(
            format!("{agents} uses it. Plugins only run after you trust them"),
            format!("Dipakai oleh {agents}. Plugin baru bisa jalan setelah kamu percayai"),
        )
    }
    pub(super) fn plugin_runtime_missing_title(self) -> String {
        self.word("The plugin runtime is not installed", "Runtime plugin belum terpasang")
    }
    pub(super) fn plugin_runtime_missing_detail(self, agents: &str) -> String {
        self.pick(
            format!("{agents} use plugins, which run on Node.js. It is a one-time download of about 30 MB"),
            format!("{agents} memakai plugin yang berjalan di Node.js. Cukup diunduh sekali, sekitar 30 MB"),
        )
    }
    pub(super) fn browser_missing_title(self) -> String {
        self.word("The browser for web steps is not installed", "Browser untuk langkah web belum terpasang")
    }
    pub(super) fn browser_missing_detail(self, agents: &str) -> String {
        self.pick(
            format!("{agents} open web pages and need it. It is a one-time download"),
            format!("{agents} membuka halaman web dan membutuhkannya. Cukup diunduh sekali"),
        )
    }
    pub(super) fn an_agent(self) -> String {
        self.word("An agent", "Sebuah agent")
    }
    pub(super) fn schedule_invalid_title(self, agent: &str) -> String {
        self.pick(format!("The schedule of {agent} cannot be read"), format!("Jadwal {agent} tidak bisa dibaca"))
    }
    pub(super) fn schedule_invalid_detail(self, error: &str) -> String {
        self.pick(
            format!("It will not run until the schedule is fixed. {error}"),
            format!("Agent tidak akan jalan sampai jadwalnya diperbaiki. {error}"),
        )
    }
    pub(super) fn schedule_failing_title(self, agent: &str) -> String {
        self.pick(format!("{agent} keeps failing on schedule"), format!("{agent} terus gagal sesuai jadwal"))
    }
    pub(super) fn schedule_failing_detail(self, count: usize) -> String {
        self.pick(
            format!("Its last {count} scheduled runs failed. Fix the cause, or turn the schedule off for now"),
            format!("{count} run terjadwal terakhirnya gagal. Perbaiki penyebabnya, atau matikan jadwalnya dulu"),
        )
    }

    // Failed run report

    pub(super) fn a_step(self) -> String {
        self.word("A step", "Sebuah langkah")
    }
    pub(super) fn nothing_after(self) -> String {
        self.word("Steps after it did not run.", "Langkah setelahnya tidak dijalankan.")
    }
    pub(super) fn retry_once_fixed(self) -> String {
        self.word("Retry from the start once it is fixed", "Ulangi dari awal setelah diperbaiki")
    }
    pub(super) fn app_closed_title(self) -> String {
        self.word("The app closed during this run", "Aplikasi tertutup saat run ini berjalan")
    }
    pub(super) fn app_closed_detail(self, step: &str, nothing_after: &str) -> String {
        self.pick(
            format!("graphrt was closed or the computer restarted while {step} was running. {nothing_after}"),
            format!("Graphrt ditutup atau komputer dinyalakan ulang saat {step} sedang berjalan. {nothing_after}"),
        )
    }
    pub(super) fn runtime_missing_detail(self, step: &str, nothing_after: &str) -> String {
        self.pick(
            format!("{step} uses a plugin, and plugins run on Node.js, which graphrt downloads once (about 30 MB). {nothing_after}"),
            format!("{step} memakai plugin, dan plugin berjalan di Node.js yang diunduh Graphrt sekali saja (sekitar 30 MB). {nothing_after}"),
        )
    }
    pub(super) fn signed_out_title(self) -> String {
        self.word("A connected account was signed out", "Akun yang terhubung sudah keluar")
    }
    pub(super) fn signed_out_detail(self, step: &str, nothing_after: &str) -> String {
        self.pick(
            format!("{step} was refused because a sign-in or key is no longer valid. {nothing_after}"),
            format!("{step} ditolak karena login atau key-nya sudah tidak berlaku. {nothing_after}"),
        )
    }
    pub(super) fn signed_out_fix(self) -> String {
        self.word("Sign in again or update the key in Connections", "Login lagi atau perbarui key di Koneksi")
    }
    pub(super) fn timeout_title(self) -> String {
        self.word("A step kept timing out", "Sebuah langkah terus kehabisan waktu")
    }
    pub(super) fn timeout_detail(self, step: &str, nothing_after: &str) -> String {
        self.pick(
            format!("{step} took too long to answer. {nothing_after}"),
            format!("{step} terlalu lama menjawab. {nothing_after}"),
        )
    }
    pub(super) fn timeout_fix(self) -> String {
        self.word(
            "Try again later, or ask chat in the builder to change this step",
            "Coba lagi nanti, atau minta chat di builder mengubah langkah ini",
        )
    }
    pub(super) fn model_title(self) -> String {
        self.word("The AI model did not answer", "Model AI tidak menjawab")
    }
    pub(super) fn model_fix(self) -> String {
        self.word("Check the model's key and credit in Connections", "Cek key dan kredit model di Koneksi")
    }
    pub(super) fn http_title(self) -> String {
        self.word("A website or service did not answer", "Situs atau layanan tidak menjawab")
    }
    pub(super) fn http_fix(self) -> String {
        self.word("Check that the service is up, then try again", "Pastikan layanannya aktif, lalu coba lagi")
    }
    pub(super) fn limit_title(self) -> String {
        self.word("The run took too long", "Run terlalu lama")
    }
    pub(super) fn limit_fix(self) -> String {
        self.word(
            "Ask chat in the builder to make the agent do less per run",
            "Minta chat di builder supaya agent mengerjakan lebih sedikit per run",
        )
    }
    pub(super) fn invalid_input_title(self) -> String {
        self.word("The run started with missing or wrong details", "Run dimulai dengan data yang kurang atau salah")
    }
    pub(super) fn invalid_input_fix(self) -> String {
        self.word("Check the details the agent asks for before it starts", "Cek data yang diminta agent sebelum mulai")
    }
    pub(super) fn step_failed_title(self, step: &str) -> String {
        self.pick(format!("{step} failed"), format!("{step} gagal"))
    }
    pub(super) fn step_failed_fix(self) -> String {
        self.word(
            "Open the step in the builder and ask chat to fix it",
            "Buka langkahnya di builder dan minta chat memperbaikinya",
        )
    }
    pub(super) fn graphrt_said(self, error: &str) -> String {
        self.pick(format!(" graphrt said: {error}."), format!(" Pesan dari Graphrt, {error}."))
    }
    pub(super) fn stopped_at(self, step: &str, reason: &str, nothing_after: &str) -> String {
        self.pick(
            format!("The run stopped at {step}.{reason} {nothing_after}"),
            format!("Run berhenti di {step}.{reason} {nothing_after}"),
        )
    }
    pub(super) fn failed_after_tries(self, tries: u32) -> String {
        self.pick(format!("Failed after {tries} tries"), format!("Gagal setelah {tries} percobaan"))
    }
    pub(super) fn failed(self) -> String {
        self.word("Failed", "Gagal")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn texts_in_both_languages() {
        assert_eq!(ProblemTexts::new(UiLanguage::En).plugin_missing_title("Maps"), "The Maps plugin is not installed");
        assert_eq!(ProblemTexts::new(UiLanguage::Id).plugin_missing_title("Maps"), "Plugin Maps belum terpasang");
        assert_eq!(ProblemTexts::new(UiLanguage::Id).retry_from_start(), "Ulangi dari awal");
    }
}
