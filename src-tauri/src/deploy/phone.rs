//! What an online agent (or a connected server) offers right now, and the phones paired with
//! it: asked from the server itself with its access key.
//!
//! graphrt routes (graphrt `docs/web.md`, `docs/monitoring.md`): `GET /v1/chat/config` and
//! `GET /v1/monitor/config` (public, `404` when the page is off), `GET /v1/devices`,
//! `POST /v1/devices {name, url}` and `DELETE /v1/devices/{id}` (access key).
//!
//! A pairing link holds the phone's key (a device token that only reads runs and answers
//! requests, and can be revoked). It is kept in the keychain as `deploy:device:<target>:<id>`
//! so its QR code can be shown again on request, is handed to the UI only by
//! [`DeployService::device_pairing`], and is never logged.

use serde::{Deserialize, Serialize};

use super::http::{self, HttpMethod, HttpReply, HttpRequest};
use super::DeployService;
use crate::error::{AppError, AppResult};

/// Settings key prefix of the device ids whose pairing link is kept in the keychain, per target.
const PAIRED_DEVICES_SETTING_PREFIX: &str = "deploy_paired_devices:";
/// Longest device name the server takes (bytes).
const MAX_DEVICE_NAME_BYTES: usize = 100;

/// An online agent, or a server connected in "My own server".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum OnlineTarget {
    Agent { agent_id: String },
    Server { server_id: String },
}

impl OnlineTarget {
    /// `agent:<id>` or `server:<id>`: the part of keychain and settings names.
    fn storage_name(&self) -> String {
        match self {
            Self::Agent { agent_id } => format!("agent:{}", agent_id.trim()),
            Self::Server { server_id } => format!("server:{}", server_id.trim()),
        }
    }
}

/// The chat page of a server.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveChat {
    /// `guests` (anyone with the link), `key` (the access key), `users` (signed-in users of
    /// an identity provider) or `open` (a server without an access key).
    pub audience: String,
    /// The link to share.
    pub link: String,
    /// The one line that adds the chat bubble to a website.
    pub widget_snippet: String,
    /// The server keeps the conversations.
    pub keeps_conversations: bool,
}

/// The phone page of a server.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LivePhone {
    /// The page to open on a phone (it asks for the access key unless opened by a pairing link).
    pub link: String,
    /// Phones can be paired.
    pub can_pair: bool,
    /// Requests that wait for a person can be answered there.
    pub approvals: bool,
    /// Requests answer themselves when their time runs out.
    pub answers_when_time_runs_out: bool,
    /// Notifications can be turned on in the page.
    pub notifications: bool,
}

/// What a server offers right now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveFeatures {
    /// The server answered. `false`: nothing below is known.
    pub reachable: bool,
    /// Why it could not be asked (plain sentence).
    pub problem: Option<String>,
    pub chat: Option<LiveChat>,
    pub phone: Option<LivePhone>,
}

/// A phone (or another device) paired with a server.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedDevice {
    pub id: String,
    pub name: String,
    /// Unix time in milliseconds.
    pub paired_at_ms: Option<u64>,
    pub last_used_at_ms: Option<u64>,
    /// Its pairing code is kept on this computer and can be shown again.
    pub can_show_code: bool,
}

/// A pairing code to scan. `link` is the phone's key: show it only when asked for.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicePairing {
    pub device_id: String,
    pub device_name: String,
    /// Opens the phone page already paired; shown as a QR code.
    pub link: String,
}

impl std::fmt::Debug for DevicePairing {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("DevicePairing")
            .field("device_id", &self.device_id)
            .field("device_name", &self.device_name)
            .field("link", &"<redacted>")
            .finish()
    }
}

/// `<script src="…/chat/embed.js" data-workflow="…" async></script>`.
pub fn widget_snippet(base_url: &str, workflow: &str) -> String {
    let escape = |text: &str| text.replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;");
    format!(
        r#"<script src="{}" data-workflow="{}" async></script>"#,
        escape(&http::join_url(base_url, "chat/embed.js")),
        escape(workflow)
    )
}

/// Reads `GET /v1/chat/config`.
fn live_chat(base_url: &str, reply: &HttpReply) -> Option<LiveChat> {
    if !(200..300).contains(&reply.status) {
        return None;
    }
    let config: serde_json::Value = serde_json::from_str(&reply.body).ok()?;
    let workflow = config.get("workflows")?.as_array()?.first()?.get("name")?.as_str()?.to_owned();
    Some(LiveChat {
        audience: config.get("access").and_then(serde_json::Value::as_str).unwrap_or("key").to_owned(),
        link: http::join_url(base_url, &format!("chat/{workflow}")),
        widget_snippet: widget_snippet(base_url, &workflow),
        keeps_conversations: config.get("conversations").and_then(serde_json::Value::as_bool).unwrap_or(false),
    })
}

/// Reads `GET /v1/monitor/config`.
fn live_phone(base_url: &str, reply: &HttpReply) -> Option<LivePhone> {
    if !(200..300).contains(&reply.status) {
        return None;
    }
    let config: serde_json::Value = serde_json::from_str(&reply.body).ok()?;
    let flag = |name: &str| config.get(name).and_then(serde_json::Value::as_bool).unwrap_or(false);
    Some(LivePhone {
        link: http::join_url(base_url, "monitor/"),
        can_pair: flag("devices"),
        approvals: flag("approvals"),
        answers_when_time_runs_out: flag("expire_approvals"),
        notifications: flag("push"),
    })
}

/// A device id that can be part of a keychain name and of a URL path.
fn is_device_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-' || byte == b'_')
}

/// The server's refusal as a plain sentence.
fn refusal(what: &str, reply: &HttpReply) -> AppError {
    match reply.status {
        401 | 403 => AppError::Credentials("the online agent did not accept its access key".into()),
        404 => AppError::InvalidInput(format!(
            "{what} is not turned on for this agent. Turn on \"Follow it from your phone\" and update the online copy"
        )),
        status => AppError::Internal(format!("the online agent answered with an error ({status})")),
    }
}

impl DeployService {
    /// The address and access key of a target.
    fn target_access(&self, target: &OnlineTarget) -> AppResult<(String, String)> {
        let (url, secret_name) = match target {
            OnlineTarget::Agent { agent_id } => {
                let record = self.require_deployment(agent_id.trim())?;
                (record.url, format!("key:{}", agent_id.trim()))
            }
            OnlineTarget::Server { server_id } => {
                let server = self
                    .db
                    .list_own_servers()?
                    .into_iter()
                    .find(|server| server.id == server_id.trim())
                    .ok_or_else(|| AppError::NotFound("this server".into()))?;
                (Some(server.url), format!("server:{}", server.id))
            }
        };
        let url = url.ok_or_else(|| AppError::InvalidInput("This agent is not online yet".into()))?;
        let api_key = self
            .credentials
            .read_deploy_secret(&secret_name)?
            .ok_or_else(|| AppError::MissingCredentials("the access key of this online agent".into()))?;
        Ok((url, api_key))
    }

    fn pairing_secret_name(target: &OnlineTarget, device_id: &str) -> String {
        format!("device:{}:{device_id}", target.storage_name())
    }

    fn kept_device_ids(&self, target: &OnlineTarget) -> AppResult<Vec<String>> {
        let key = format!("{PAIRED_DEVICES_SETTING_PREFIX}{}", target.storage_name());
        Ok(self.db.get_setting(&key)?.and_then(|stored| serde_json::from_str(&stored).ok()).unwrap_or_default())
    }

    fn save_kept_device_ids(&self, target: &OnlineTarget, ids: &[String]) -> AppResult<()> {
        let key = format!("{PAIRED_DEVICES_SETTING_PREFIX}{}", target.storage_name());
        self.db.set_setting(&key, &serde_json::to_string(ids)?)
    }

    /// What the target offers right now: its chat page and its phone page.
    pub async fn live_features(&self, target: &OnlineTarget) -> AppResult<LiveFeatures> {
        let (url, _) = self.target_access(target)?;
        let chat = self.http.get(http::join_url(&url, "v1/chat/config"), None).await;
        let phone = self.http.get(http::join_url(&url, "v1/monitor/config"), None).await;
        Ok(match (chat, phone) {
            (Ok(chat), Ok(phone)) => LiveFeatures {
                reachable: true,
                problem: None,
                chat: live_chat(&url, &chat),
                phone: live_phone(&url, &phone),
            },
            (Err(error), _) | (_, Err(error)) => {
                LiveFeatures { reachable: false, problem: Some(error.to_string()), chat: None, phone: None }
            }
        })
    }

    /// The phones paired with the target, newest first.
    ///
    /// # Errors
    /// `InvalidInput` when pairing is not turned on; `Credentials` when the key is refused.
    pub async fn list_devices(&self, target: &OnlineTarget) -> AppResult<Vec<PairedDevice>> {
        let (url, api_key) = self.target_access(target)?;
        let reply = self.http.get(http::join_url(&url, "v1/devices"), Some(api_key)).await?;
        if !(200..300).contains(&reply.status) {
            return Err(refusal("Pairing a phone", &reply));
        }
        let listed: serde_json::Value = serde_json::from_str(&reply.body)
            .map_err(|_| AppError::Internal("the online agent sent a list of phones this app can't read".into()))?;
        let kept = self.kept_device_ids(target)?;
        let mut devices: Vec<PairedDevice> = listed
            .get("devices")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|device| {
                let id = device.get("id")?.as_str()?.to_owned();
                Some(PairedDevice {
                    name: device.get("name").and_then(serde_json::Value::as_str).unwrap_or("Phone").to_owned(),
                    paired_at_ms: device.get("created_ms").and_then(serde_json::Value::as_u64),
                    last_used_at_ms: device.get("last_used_ms").and_then(serde_json::Value::as_u64),
                    can_show_code: kept.contains(&id),
                    id,
                })
            })
            .collect();
        devices.sort_by_key(|device| std::cmp::Reverse(device.paired_at_ms));
        // Codes of phones removed elsewhere (in the phone page) are of no use: forget them.
        let gone: Vec<String> =
            kept.iter().filter(|id| !devices.iter().any(|device| &device.id == *id)).cloned().collect();
        if !gone.is_empty() {
            for id in &gone {
                self.credentials.delete_deploy_secret(&Self::pairing_secret_name(target, id))?;
            }
            let still_kept: Vec<String> = kept.into_iter().filter(|id| !gone.contains(id)).collect();
            self.save_kept_device_ids(target, &still_kept)?;
        }
        Ok(devices)
    }

    /// Pairs a new phone named `name` and returns its code. The code is kept in the keychain.
    ///
    /// # Errors
    /// `InvalidInput` for a name the server would refuse, or when pairing is not turned on.
    pub async fn pair_device(&self, target: &OnlineTarget, name: &str) -> AppResult<DevicePairing> {
        let name = name.trim();
        if name.is_empty() || name.len() > MAX_DEVICE_NAME_BYTES || name.chars().any(char::is_control) {
            return Err(AppError::InvalidInput("Give the phone a short name, like \"Ana's phone\"".into()));
        }
        let (url, api_key) = self.target_access(target)?;
        let request = HttpRequest {
            method: HttpMethod::Post,
            url: http::join_url(&url, "v1/devices"),
            bearer: Some(api_key),
            // The phone reaches the agent at the address this app knows it by.
            body: Some(serde_json::json!({ "name": name, "url": url.trim_end_matches('/') })),
        };
        let reply = self.http.send(request).await?;
        if !(200..300).contains(&reply.status) {
            return Err(refusal("Pairing a phone", &reply));
        }
        let unreadable = || AppError::Internal("the online agent sent a pairing code this app can't read".into());
        let paired: serde_json::Value = serde_json::from_str(&reply.body).map_err(|_| unreadable())?;
        let device_id = paired.pointer("/device/id").and_then(serde_json::Value::as_str).ok_or_else(unreadable)?;
        let link = paired.get("link").and_then(serde_json::Value::as_str).ok_or_else(unreadable)?;
        let pairing =
            DevicePairing { device_id: device_id.to_owned(), device_name: name.to_owned(), link: link.to_owned() };
        if is_device_id(device_id) {
            self.credentials
                .set_deploy_secret(&Self::pairing_secret_name(target, device_id), &serde_json::to_string(&pairing)?)?;
            let mut kept = self.kept_device_ids(target)?;
            if !kept.iter().any(|id| id == device_id) {
                kept.push(device_id.to_owned());
                self.save_kept_device_ids(target, &kept)?;
            }
        }
        log::info!("paired a device with {}", target.storage_name());
        Ok(pairing)
    }

    /// The kept code of a paired phone, to show it again. Only for an explicit "Show code".
    ///
    /// # Errors
    /// `NotFound` when no code is kept for it on this computer.
    pub fn device_pairing(&self, target: &OnlineTarget, device_id: &str) -> AppResult<DevicePairing> {
        let device_id = device_id.trim();
        let stored = if is_device_id(device_id) {
            self.credentials.read_deploy_secret(&Self::pairing_secret_name(target, device_id))?
        } else {
            None
        };
        let stored = stored.ok_or_else(|| AppError::NotFound("this phone's code on this computer".into()))?;
        Ok(serde_json::from_str(&stored)?)
    }

    /// Removes a paired phone: its key stops working at once, and its code is forgotten here.
    ///
    /// # Errors
    /// `Credentials` when the access key is refused; the phone stays paired then.
    pub async fn revoke_device(&self, target: &OnlineTarget, device_id: &str) -> AppResult<()> {
        let device_id = device_id.trim();
        if !is_device_id(device_id) {
            return Err(AppError::InvalidInput("this is not a paired phone".into()));
        }
        let (url, api_key) = self.target_access(target)?;
        let request = HttpRequest {
            method: HttpMethod::Delete,
            url: http::join_url(&url, &format!("v1/devices/{device_id}")),
            bearer: Some(api_key),
            body: None,
        };
        let reply = self.http.send(request).await?;
        // 404: it is already gone on the server, which is what was asked for.
        if !(200..300).contains(&reply.status) && reply.status != 404 {
            return Err(refusal("Pairing a phone", &reply));
        }
        self.forget_device_codes(target, Some(device_id))?;
        log::info!("removed a paired device from {}", target.storage_name());
        Ok(())
    }

    /// Forgets the kept pairing codes of a target (one device, or all of them).
    pub(super) fn forget_device_codes(&self, target: &OnlineTarget, only: Option<&str>) -> AppResult<()> {
        let kept = self.kept_device_ids(target)?;
        let (forget, keep): (Vec<String>, Vec<String>) =
            kept.into_iter().partition(|id| only.is_none_or(|only| only == id));
        for id in &forget {
            self.credentials.delete_deploy_secret(&Self::pairing_secret_name(target, id))?;
        }
        if let Some(id) = only.filter(|id| !forget.iter().any(|known| known == id)) {
            self.credentials.delete_deploy_secret(&Self::pairing_secret_name(target, id))?;
        }
        self.save_kept_device_ids(target, &keep)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_widget_snippet_is_one_line_with_the_agents_address() {
        assert_eq!(
            widget_snippet("https://menu-1a2b.fly.dev/", "agent"),
            r#"<script src="https://menu-1a2b.fly.dev/chat/embed.js" data-workflow="agent" async></script>"#
        );
        assert!(!widget_snippet("https://a.example", "a\"><script>").contains("\"><script>"));
    }

    #[test]
    fn reads_what_the_server_says_is_on() {
        let chat = HttpReply {
            status: 200,
            body: r#"{"title":"Menu","workflows":[{"name":"agent","input":null}],"access":"guests","conversations":false}"#
                .into(),
        };
        let live = live_chat("https://a.fly.dev", &chat).unwrap();
        assert_eq!((live.audience.as_str(), live.link.as_str()), ("guests", "https://a.fly.dev/chat/agent"));
        assert!(live_chat("https://a.fly.dev", &HttpReply { status: 404, body: "{}".into() }).is_none());
        assert!(live_chat("https://a.fly.dev", &HttpReply { status: 200, body: "<html>".into() }).is_none());

        let phone = HttpReply {
            status: 200,
            body: r#"{"access":"key","devices":true,"approvals":true,"expire_approvals":false,"push":true}"#.into(),
        };
        let live = live_phone("https://a.fly.dev", &phone).unwrap();
        assert!(live.can_pair && live.approvals && live.notifications && !live.answers_when_time_runs_out);
        assert_eq!(live.link, "https://a.fly.dev/monitor/");
        assert!(live_phone("https://a.fly.dev", &HttpReply { status: 404, body: String::new() }).is_none());
    }

    #[test]
    fn device_ids_are_safe_in_names_and_paths() {
        assert!(is_device_id("dev-5c1f09ab"));
        for bad in ["", "../x", "dev 1", "DEV-1", "a/b", &"x".repeat(65)] {
            assert!(!is_device_id(bad), "{bad}");
        }
    }

    #[test]
    fn a_pairing_never_shows_its_link_in_debug_output() {
        let pairing = DevicePairing {
            device_id: "dev-1".into(),
            device_name: "Ana".into(),
            link: "https://a.fly.dev/monitor/#pair=grd1.dev-1.secret".into(),
        };
        assert!(!format!("{pairing:?}").contains("secret"));
    }
}
