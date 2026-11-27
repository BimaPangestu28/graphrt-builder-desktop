//! What an online agent offers to browsers and phones, chosen in Review ("Chat page", "Follow
//! it from your phone") and turned into `graphrt deploy` flags or, for "My own server", into
//! the environment variables of `graphrt serve` in Docker.
//!
//! graphrt names (graphrt `docs/deploy-direct.md`, `docs/serving.md`): `--chat`,
//! `--chat-access key|guests`, `--cors-origin`, `--monitor` (devices and the approvals inbox),
//! `--push mailto:…`, `--expire-approvals`, `--drop-store`. The guest limits of the server (10
//! messages a minute for one visitor, 120 for all) are never changed here.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// `agent_settings` key of the features of the agent's online copy ([`OnlineFeatures`]).
pub const ONLINE_FEATURES_KEY: &str = "online_features";
/// Where the store volume is mounted in the "My own server" instructions.
const OWN_SERVER_STORE_PATH: &str = "/data";
/// Messages one visitor may send in a minute (the server's default, shown in the app).
pub const GUEST_MESSAGES_PER_MINUTE: u32 = 10;
/// Messages all visitors together may send in a minute (the server's default).
pub const ALL_GUESTS_MESSAGES_PER_MINUTE: u32 = 120;

/// Who may use the chat page.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatAudience {
    /// Anyone with the link, within the server's limits.
    #[default]
    Guests,
    /// Only people who have the agent's access key.
    Key,
}

impl ChatAudience {
    fn cli_value(self) -> &'static str {
        match self {
            Self::Guests => "guests",
            Self::Key => "key",
        }
    }
}

/// The choices of one online agent. Everything is off by default.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OnlineFeatures {
    /// A chat page (and a chat bubble for a website) for the agent.
    pub chat: bool,
    pub chat_audience: ChatAudience,
    /// The website that may show the chat bubble, as `https://www.example.com`.
    pub embed_site: Option<String>,
    /// The monitoring page for a phone: runs, and requests that wait for a person.
    pub phone: bool,
    /// Notifications on the phone when a run fails or waits for a person.
    pub notifications: bool,
    /// The email address notification services may write to about this sender.
    pub notify_email: Option<String>,
    /// Requests whose time ran out answer themselves as the agent says (or stop the run).
    pub answer_when_time_runs_out: bool,
    /// Customers talk to the chatbot on WhatsApp Business (`--channel whatsapp`). Its four
    /// values are copied from the credential store as secrets of the online copy.
    pub whatsapp: bool,
    /// People talk to the chatbot in Microsoft Teams (`--channel teams`). The Azure Bot's
    /// three values are copied from the credential store as secrets of the online copy.
    pub teams: bool,
}

impl OnlineFeatures {
    /// Whether anything is on.
    pub fn any(&self) -> bool {
        self.chat || self.phone || self.notifications || self.answer_when_time_runs_out || self.whatsapp || self.teams
    }

    /// Whether the online copy keeps paired phones and notification sign-ups, which needs a
    /// small storage volume with the provider (billed by the provider).
    pub fn needs_storage(&self) -> bool {
        self.phone || self.notifications || self.whatsapp || self.teams
    }

    /// The choices as they are saved and deployed: the website as an origin, options of a
    /// feature that is off dropped.
    ///
    /// # Errors
    /// `InvalidInput` with a plain sentence for a website or an email address that cannot be used.
    pub fn checked(&self) -> AppResult<Self> {
        let embed_site = match self.embed_site.as_deref().map(str::trim).filter(|site| !site.is_empty()) {
            Some(site) if self.chat => Some(site_origin(site)?),
            _ => None,
        };
        let notifications = self.phone && self.notifications;
        let notify_email = match self.notify_email.as_deref().map(str::trim).filter(|email| !email.is_empty()) {
            Some(email) if notifications => Some(checked_email(email)?),
            None if notifications => {
                return Err(AppError::InvalidInput(
                    "Enter your email address for notifications. Notification services use it only to reach you \
                     if something is wrong with this sender"
                        .into(),
                ));
            }
            _ => None,
        };
        Ok(Self {
            chat: self.chat,
            chat_audience: if self.chat { self.chat_audience } else { ChatAudience::default() },
            embed_site,
            phone: self.phone,
            notifications,
            notify_email,
            answer_when_time_runs_out: self.answer_when_time_runs_out,
            whatsapp: self.whatsapp,
            teams: self.teams,
        })
    }

    /// The `graphrt deploy --direct` flags for these (checked) choices. Without paired phones
    /// or notifications, `--drop-store` removes the storage volume an earlier deploy made, so
    /// turning them off also ends its cost.
    pub fn deploy_arguments(&self) -> Vec<String> {
        let mut arguments: Vec<String> = Vec::new();
        if self.chat {
            arguments.extend([
                "--chat".to_owned(),
                "--chat-access".to_owned(),
                self.chat_audience.cli_value().to_owned(),
            ]);
            if let Some(site) = &self.embed_site {
                arguments.extend(["--cors-origin".to_owned(), site.clone()]);
            }
        }
        if self.phone {
            arguments.push("--monitor".to_owned());
        }
        if let Some(email) = self.notify_email.as_ref().filter(|_| self.notifications) {
            arguments.extend(["--push".to_owned(), format!("mailto:{email}")]);
        }
        if self.answer_when_time_runs_out {
            arguments.push("--expire-approvals".to_owned());
        }
        if self.whatsapp {
            arguments.extend(["--channel".to_owned(), "whatsapp".to_owned()]);
        }
        if self.teams {
            arguments.extend(["--channel".to_owned(), "teams".to_owned()]);
        }
        if !self.needs_storage() {
            arguments.push("--drop-store".to_owned());
        }
        arguments
    }

    /// The environment variables of `graphrt serve` for these (checked) choices, for a server
    /// an IT team runs in Docker.
    ///
    /// @param workflow - the name the agent is served under (&str)
    pub fn serve_environment(&self, workflow: &str) -> Vec<(String, String)> {
        let mut environment: Vec<(String, String)> = Vec::new();
        let mut set = |name: &str, value: String| environment.push((name.to_owned(), value));
        if self.chat {
            set("GRAPHRT_CHAT", workflow.to_owned());
            set("GRAPHRT_CHAT_ACCESS", self.chat_audience.cli_value().to_owned());
            if let Some(site) = &self.embed_site {
                set("GRAPHRT_CORS_ORIGINS", site.clone());
            }
        }
        if self.needs_storage() {
            set("GRAPHRT_STORE", OWN_SERVER_STORE_PATH.to_owned());
            set("GRAPHRT_PUBLIC_URL", "<https://the address of this server>".to_owned());
        }
        if self.phone {
            set("GRAPHRT_MONITOR", "1".to_owned());
        }
        if let Some(email) = self.notify_email.as_ref().filter(|_| self.notifications) {
            set("GRAPHRT_PUSH", format!("mailto:{email}"));
        }
        if self.answer_when_time_runs_out {
            set("GRAPHRT_EXPIRE_APPROVALS", "1".to_owned());
        }
        environment
    }
}

/// `www.example.com/shop` → `https://www.example.com`: the part of a website's address a
/// browser compares (scheme, host and port).
///
/// # Errors
/// `InvalidInput` with a plain sentence.
pub fn site_origin(site: &str) -> AppResult<String> {
    let refused =
        || AppError::InvalidInput(format!("`{site}` is not a website address such as https://www.example.com"));
    let with_scheme = if site.contains("://") { site.to_owned() } else { format!("https://{site}") };
    let parsed = reqwest::Url::parse(&with_scheme).map_err(|_| refused())?;
    let host = parsed.host_str().filter(|host| !host.is_empty()).ok_or_else(refused)?;
    let usable = matches!(parsed.scheme(), "https" | "http")
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && (host.contains('.') || host == "localhost");
    if !usable {
        return Err(refused());
    }
    Ok(match parsed.port() {
        Some(port) => format!("{}://{host}:{port}", parsed.scheme()),
        None => format!("{}://{host}", parsed.scheme()),
    })
}

/// A plausible email address, as given (`mailto:` in front is dropped).
fn checked_email(email: &str) -> AppResult<String> {
    let address = email.strip_prefix("mailto:").unwrap_or(email);
    let plausible = address.len() <= 190
        && !address.chars().any(|character| character.is_whitespace() || character.is_control())
        && address.split_once('@').is_some_and(|(name, host)| {
            !name.is_empty()
                && host.contains('.')
                && !host.starts_with('.')
                && !host.ends_with('.')
                && !host.contains('@')
        });
    if !plausible {
        return Err(AppError::InvalidInput(format!("`{email}` is not an email address such as you@example.com")));
    }
    Ok(address.to_owned())
}

/// The `docker run` an IT team starts the agent with, and what it needs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnServerInstructions {
    /// The command, one option per line.
    pub command: String,
    /// The chat page and the phone page need a graphrt newer than this version; `None` when
    /// nothing that needs it is on.
    pub needs_graphrt_newer_than: Option<String>,
    /// The page people chat on, with the server's address still to fill in.
    pub chat_address: Option<String>,
    /// The page to open on a phone.
    pub phone_address: Option<String>,
    /// The callback URL to enter in the Meta app, for a chatbot on WhatsApp Business.
    pub whatsapp_webhook: Option<String>,
    /// The messaging endpoint to enter in the Azure Bot, for a chatbot in Teams.
    pub teams_endpoint: Option<String>,
}

/// The newest graphrt release that does NOT have the chat page, the phone page and their
/// environment variables. They are on graphrt `main` and come with the next release.
pub const LAST_GRAPHRT_WITHOUT_ONLINE_FEATURES: &str = "0.6.2";
/// The graphrt server image.
const GRAPHRT_IMAGE: &str = "ghcr.io/graphrt/graphrt";

/// `Menu questions chatbot` → `menu-questions-chatbot`: the name the app suggests for the agent
/// file (`src/pages/OwnServerPage.tsx`, `fileNameFor`). `graphrt serve` names an agent after
/// its file, so the instructions use the same name for the chat page.
pub fn agent_file_stem(agent_name: &str) -> String {
    let mut stem = String::new();
    for character in agent_name.to_lowercase().chars() {
        if character.is_ascii_lowercase() || character.is_ascii_digit() {
            stem.push(character);
        } else if !stem.is_empty() && !stem.ends_with('-') {
            stem.push('-');
        }
    }
    let stem = stem.trim_end_matches('-');
    if stem.is_empty() {
        "agent".to_owned()
    } else {
        stem.to_owned()
    }
}

/// The Docker instructions of "My own server" for an agent file named `<file_name>.grt`.
///
/// @param file_name - the agent file's name without extension, also the name it is served under (&str)
/// @param features - checked choices (&OnlineFeatures)
/// @param model_key_names - the variables of the keys the agent needs, e.g. `OPENAI_API_KEY` (&[String])
pub fn own_server_instructions(
    file_name: &str,
    features: &OnlineFeatures,
    model_key_names: &[String],
) -> OwnServerInstructions {
    let mut lines = vec![format!("docker run -d --name {file_name} -p 8080:8080 \\")];
    lines.push("  -v \"$PWD/bundles:/workflows:ro\" \\".to_owned());
    if features.needs_storage() {
        lines.push(format!("  -v {file_name}-store:{OWN_SERVER_STORE_PATH} \\"));
    }
    lines.push("  -e GRAPHRT_API_KEY=<generate one> \\".to_owned());
    for name in model_key_names {
        lines.push(format!("  -e {name}=<your key> \\"));
    }
    for (name, value) in features.serve_environment(file_name) {
        let needs_quotes = value.contains(['<', ' ']);
        lines.push(if needs_quotes {
            format!("  -e {name}=\"{value}\" \\")
        } else {
            format!("  -e {name}={value} \\")
        });
    }
    if features.whatsapp {
        for name in crate::conversations::channels::whatsapp_online::SECRET_ENV_NAMES {
            lines.push(format!("  -e {name}=<from the WhatsApp step> \\"));
        }
    }
    if features.teams {
        for name in crate::conversations::channels::teams_online::SECRET_ENV_NAMES {
            lines.push(format!("  -e {name}=<from the Teams step> \\"));
        }
    }
    let needs_newer = features.any();
    let image = if needs_newer {
        format!("  {GRAPHRT_IMAGE}:<a version newer than {LAST_GRAPHRT_WITHOUT_ONLINE_FEATURES}>")
    } else {
        GRAPHRT_IMAGE.to_owned()
    };
    let channels: Vec<String> = [("whatsapp", features.whatsapp), ("teams", features.teams)]
        .iter()
        .filter(|(_, on)| *on)
        .map(|(kind, _)| format!(" --channel {kind}={file_name}"))
        .collect();
    lines.push(if channels.is_empty() {
        image
    } else {
        // The image's own command, plus the channels (`graphrt serve` reads them from no variable).
        format!("{image} \\\n  serve /workflows --addr 0.0.0.0:8080{}", channels.concat())
    });
    OwnServerInstructions {
        command: lines.join("\n"),
        needs_graphrt_newer_than: needs_newer.then(|| LAST_GRAPHRT_WITHOUT_ONLINE_FEATURES.to_owned()),
        chat_address: features.chat.then(|| format!("https://<the address of this server>/chat/{file_name}")),
        phone_address: features.phone.then(|| "https://<the address of this server>/monitor/".to_owned()),
        whatsapp_webhook: features
            .whatsapp
            .then(|| "https://<the address of this server>/v1/channels/whatsapp/webhook".to_owned()),
        teams_endpoint: features
            .teams
            .then(|| "https://<the address of this server>/v1/channels/teams/webhook".to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn everything() -> OnlineFeatures {
        OnlineFeatures {
            chat: true,
            chat_audience: ChatAudience::Guests,
            embed_site: Some("www.toko-kue.example/produk?x=1".into()),
            phone: true,
            notifications: true,
            notify_email: Some(" ana@example.com ".into()),
            answer_when_time_runs_out: true,
            whatsapp: false,
            teams: false,
        }
    }

    #[test]
    fn nothing_is_on_by_default_and_old_settings_still_read() {
        let features = OnlineFeatures::default();
        assert!(!features.any() && !features.needs_storage());
        assert_eq!(features.deploy_arguments(), ["--drop-store"], "an earlier storage volume is not left behind");
        assert!(features.serve_environment("menu").is_empty());
        let stored: OnlineFeatures = serde_json::from_str(r#"{"chat":true}"#).unwrap();
        assert!(stored.chat && stored.chat_audience == ChatAudience::Guests && !stored.phone);
    }

    #[test]
    fn checked_choices_keep_an_origin_and_a_plain_email() {
        let checked = everything().checked().unwrap();
        assert_eq!(checked.embed_site.as_deref(), Some("https://www.toko-kue.example"));
        assert_eq!(checked.notify_email.as_deref(), Some("ana@example.com"));
        assert_eq!(
            checked.deploy_arguments(),
            [
                "--chat",
                "--chat-access",
                "guests",
                "--cors-origin",
                "https://www.toko-kue.example",
                "--monitor",
                "--push",
                "mailto:ana@example.com",
                "--expire-approvals"
            ]
        );
    }

    #[test]
    fn guest_limits_of_the_server_are_never_changed() {
        let arguments = everything().checked().unwrap().deploy_arguments().join(" ");
        assert!(!arguments.contains("guest-rate-limit") && !arguments.contains("guest-budget"), "{arguments}");
        let environment = everything().checked().unwrap().serve_environment("menu");
        assert!(!environment.iter().any(|(name, _)| name.contains("GUEST")));
    }

    #[test]
    fn options_of_a_feature_that_is_off_are_dropped() {
        let chat_off =
            OnlineFeatures { chat: false, chat_audience: ChatAudience::Key, ..everything() }.checked().unwrap();
        assert_eq!((chat_off.embed_site, chat_off.chat_audience), (None, ChatAudience::Guests));
        let phone_off = OnlineFeatures { phone: false, ..everything() }.checked().unwrap();
        assert!(!phone_off.notifications && phone_off.notify_email.is_none(), "notifications arrive on the phone page");
        assert!(!phone_off.needs_storage());
        assert!(phone_off.deploy_arguments().contains(&"--drop-store".to_owned()));
        let key_only = OnlineFeatures { chat: true, chat_audience: ChatAudience::Key, ..OnlineFeatures::default() };
        assert_eq!(key_only.checked().unwrap().deploy_arguments(), ["--chat", "--chat-access", "key", "--drop-store"]);
    }

    #[test]
    fn websites_and_emails_that_cannot_work_are_refused_in_plain_words() {
        assert_eq!(site_origin("http://localhost:5173/app").unwrap(), "http://localhost:5173");
        assert_eq!(site_origin("https://shop.example.com:8443").unwrap(), "https://shop.example.com:8443");
        for site in ["not a site", "ftp://example.com", "https://user:pw@example.com", "justaword", "https://"] {
            assert!(site_origin(site).is_err(), "{site}");
        }
        let no_email = OnlineFeatures { notify_email: None, ..everything() };
        assert!(no_email.checked().unwrap_err().to_string().contains("email address"));
        for email in ["ana", "ana@", "@example.com", "ana@example", "ana b@example.com"] {
            let bad = OnlineFeatures { notify_email: Some(email.into()), ..everything() };
            assert!(bad.checked().is_err(), "{email}");
        }
        let with_prefix = OnlineFeatures { notify_email: Some("mailto:ana@example.com".into()), ..everything() };
        assert_eq!(with_prefix.checked().unwrap().notify_email.as_deref(), Some("ana@example.com"));
    }

    #[test]
    fn the_agent_file_is_named_like_the_app_suggests() {
        assert_eq!(agent_file_stem("Menu questions chatbot"), "menu-questions-chatbot");
        assert_eq!(agent_file_stem("  Toko Kué #1!  "), "toko-ku-1");
        assert_eq!(agent_file_stem("***"), "agent");
    }

    #[test]
    fn own_server_instructions_carry_the_choices_as_environment_variables() {
        let plain = own_server_instructions("menu-chatbot", &OnlineFeatures::default(), &["OPENAI_API_KEY".to_owned()]);
        assert!(plain.command.ends_with("ghcr.io/graphrt/graphrt"), "{}", plain.command);
        assert!(plain.command.contains("-e OPENAI_API_KEY=<your key>"));
        assert!(!plain.command.contains("GRAPHRT_CHAT") && !plain.command.contains("-store:"));
        assert_eq!((plain.needs_graphrt_newer_than, plain.chat_address, plain.phone_address), (None, None, None));

        let full = own_server_instructions("menu-chatbot", &everything().checked().unwrap(), &[]);
        for expected in [
            "-v menu-chatbot-store:/data",
            "-e GRAPHRT_CHAT=menu-chatbot",
            "-e GRAPHRT_CHAT_ACCESS=guests",
            "-e GRAPHRT_CORS_ORIGINS=https://www.toko-kue.example",
            "-e GRAPHRT_STORE=/data",
            "-e GRAPHRT_PUBLIC_URL=\"<https://the address of this server>\"",
            "-e GRAPHRT_MONITOR=1",
            "-e GRAPHRT_PUSH=mailto:ana@example.com",
            "-e GRAPHRT_EXPIRE_APPROVALS=1",
            "ghcr.io/graphrt/graphrt:<a version newer than 0.6.2>",
        ] {
            assert!(full.command.contains(expected), "missing {expected} in\n{}", full.command);
        }
        assert_eq!(full.needs_graphrt_newer_than.as_deref(), Some("0.6.2"));
        assert_eq!(full.chat_address.as_deref(), Some("https://<the address of this server>/chat/menu-chatbot"));
        assert!(full.phone_address.is_some());
    }
}
