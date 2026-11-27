//! What the channels of an online chatbot share (WhatsApp Business, Microsoft Teams): the
//! online copy (`graphrt serve --channel KIND`) takes the channel's deliveries and its bot
//! answers there, and the app shows those chats in the Inbox and sends the owner's
//! take-over and replies through the online copy.
//!
//! - [`sync_online_chats`] reads `GET /v1/conversations` of the online copy and stores the
//!   messages of the chats of one channel kind it has not stored before (by a stable id).
//! - [`post_to_online_copy`] sends `POST /v1/channels/{name}/messages` and `/handoff`.

use serde_json::{json, Value as Json};

use crate::conversations::channel::{DeliveryFailure, DeliveryProblem};
use crate::conversations::inbound::MirroredMessage;
use crate::conversations::models::MessageAuthor;
use crate::conversations::ConversationManager;
use crate::deploy::http::{join_url, DeployHttp, HttpMethod, HttpRequest};
use crate::error::{AppError, AppResult};
use crate::storage::Database;

/// One channel of the online copy, as the sync reads it.
#[derive(Debug, Clone, Copy)]
pub struct OnlineChannel<'a> {
    /// The channel's kind in the online copy's conversations (`whatsapp`, `teams`).
    pub kind: &'a str,
    /// The channel's name on the app's conversations.
    pub app_channel: &'a str,
    /// The `agent_settings` key of the newest change already shown.
    pub synced_key: &'a str,
    /// What the online copy is to be put online with, for its "keeps no conversations" error.
    pub feature_name: &'a str,
}

/// A JSON answer of the online copy.
///
/// # Errors
/// When it cannot be reached, refuses the key, or keeps no conversations.
pub async fn server_json(server: &dyn DeployHttp, url: &str, api_key: &str, feature_name: &str) -> AppResult<Json> {
    let reply = server.get(url.to_owned(), Some(api_key.to_owned())).await?;
    match reply.status {
        200 => Ok(serde_json::from_str(&reply.body).unwrap_or(Json::Null)),
        401 | 403 => Err(AppError::Credentials("the online chatbot did not accept its access key".into())),
        404 => Err(AppError::InvalidInput(format!(
            "the online chatbot keeps no conversations: put it online again with {feature_name} on"
        ))),
        status => Err(AppError::Internal(format!("the online chatbot answered with an error ({status})"))),
    }
}

/// Stores what changed in the online copy's chats of `channel` for `agent_id` since the
/// last time; `on_chat` sees each chat's summary (its `channel` field). Returns how many
/// messages were new.
///
/// # Errors
/// When the online copy cannot be reached or answers with an error.
#[allow(clippy::too_many_arguments)]
pub async fn sync_online_chats(
    db: &Database,
    server: &dyn DeployHttp,
    manager: &ConversationManager,
    (url, api_key): (&str, &str),
    agent_id: &str,
    channel: OnlineChannel<'_>,
    mut on_chat: impl FnMut(&str, &Json),
) -> AppResult<usize> {
    let list = server_json(server, &join_url(url, "v1/conversations?limit=100"), api_key, channel.feature_name).await?;
    let synced = db.get_agent_setting(agent_id, channel.synced_key)?.and_then(|value| value.as_u64()).unwrap_or(0);
    let mut newest = synced;
    let mut added = 0;
    for summary in list["conversations"].as_array().into_iter().flatten() {
        let link = &summary["channel"];
        if link["kind"].as_str() != Some(channel.kind) {
            continue;
        }
        let updated = summary["updated_ms"].as_u64().unwrap_or(0);
        let (Some(id), Some(chat)) = (summary["id"].as_str(), link["chat_id"].as_str()) else { continue };
        on_chat(chat, link);
        if updated <= synced {
            continue;
        }
        newest = newest.max(updated);
        let detail =
            server_json(server, &join_url(url, &format!("v1/conversations/{id}")), api_key, channel.feature_name)
                .await?;
        let name = link["customer_name"].as_str();
        for message in detail["messages"].as_array().into_iter().flatten() {
            let author = match message["role"].as_str() {
                Some("user") => MessageAuthor::Customer,
                Some("assistant") => MessageAuthor::Bot,
                _ => continue,
            };
            let created = message["created_ms"].as_u64().unwrap_or(0);
            let mirrored = MirroredMessage {
                external_id: format!("{id}:{created}:{}", message["role"].as_str().unwrap_or_default()),
                author,
                text: message["content"].as_str().unwrap_or_default().to_owned(),
            };
            if author == MessageAuthor::Bot
                && manager.claim_operator_message(channel.app_channel, agent_id, chat, &mirrored)?
            {
                continue;
            }
            if manager.mirror_channel_message(channel.app_channel, agent_id, chat, name, &mirrored)? {
                added += 1;
            }
        }
        let person = link["human"].as_bool().unwrap_or(false);
        let waiting = link["waiting_run"].as_str().is_some();
        manager.mirror_channel_status(channel.app_channel, agent_id, chat, person, waiting)?;
    }
    if newest > synced {
        db.set_agent_setting(agent_id, channel.synced_key, &json!(newest))?;
    }
    Ok(added)
}

/// `POST` `body` to `path` of the online copy at `access` (its address and key).
///
/// # Errors
/// A [`DeliveryFailure`] in plain words: not online, offline, key refused, or the online
/// copy's own refusal (`OutsideWindow` when it names WhatsApp's 24 hours).
pub async fn post_to_online_copy(
    server: &dyn DeployHttp,
    access: AppResult<(String, String)>,
    path: &str,
    body: Json,
) -> Result<(), DeliveryFailure> {
    let (url, api_key) =
        access.map_err(|error| DeliveryFailure::new(DeliveryProblem::NotConnected, error.to_string()))?;
    let request =
        HttpRequest { method: HttpMethod::Post, url: join_url(&url, path), bearer: Some(api_key), body: Some(body) };
    let reply = server
        .send(request)
        .await
        .map_err(|_| DeliveryFailure::new(DeliveryProblem::Offline, "the online chatbot cannot be reached"))?;
    match reply.status {
        200..=299 => Ok(()),
        401 | 403 => {
            Err(DeliveryFailure::new(DeliveryProblem::NotConnected, "the online chatbot did not accept its access key"))
        }
        status => {
            let why = serde_json::from_str::<Json>(&reply.body)
                .ok()
                .and_then(|body| body["error"].as_str().map(str::to_owned))
                .unwrap_or_else(|| format!("error {status}"));
            let problem = if why.contains("24") { DeliveryProblem::OutsideWindow } else { DeliveryProblem::Other };
            Err(DeliveryFailure::new(problem, format!("the online chatbot refused: {why}")))
        }
    }
}
