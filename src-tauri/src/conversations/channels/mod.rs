//! The customer channels of chatbots, on graphrt's `graphrt-channel` crate.
//!
//! - [`telegram`]: a Telegram bot per chatbot, by long polling. Nothing listens on this
//!   computer: the app asks Telegram for new messages, so it works behind any router and
//!   picks up after sleep or a lost connection where it stopped (the update cursor is
//!   stored, and a message is stored before its update is confirmed).
//! - [`whatsapp_web`]: the personal WhatsApp linked with the `whatsapp-web` plugin, polled
//!   for unread chats. The plugin's own send limits stay in force.
//! - [`whatsapp_online`]: WhatsApp Business (Cloud API). Meta delivers only to a public
//!   HTTPS webhook, and the app never opens a port on the owner's computer, so WhatsApp
//!   Business answers through the chatbot's online copy (`graphrt serve --channel
//!   whatsapp`, put online with "Put it online"). The app shows those chats in the Inbox
//!   and sends the owner's take-over and replies through the online copy.
//!
//! Every adapter turns the channel's errors into a [`super::channel::DeliveryProblem`]
//! the screens put in plain words, and never names a token or a URL that carries one.

pub mod telegram;
pub mod whatsapp_online;
pub mod whatsapp_web;

#[cfg(test)]
pub(crate) mod fake_http;
#[cfg(test)]
mod tests;

use graphrt_channel::ChannelError;

use super::channel::{DeliveryFailure, DeliveryProblem};
use crate::desktop::ui_language::UiLanguage;

/// What the customer reads when a person has to answer (the bot failed, or its steps wait
/// for an approval).
pub fn waiting_message(language: UiLanguage) -> &'static str {
    match language {
        UiLanguage::Id => "Mohon tunggu sebentar. Tim kami akan membalas di sini.",
        UiLanguage::En => "One moment please. Someone from our team will answer you here.",
    }
}

/// What the customer reads when they sent only files and none could be taken.
pub fn files_not_taken_message(language: UiLanguage) -> &'static str {
    match language {
        UiLanguage::Id => "Maaf, file itu tidak bisa saya buka. Silakan tulis kebutuhan Anda.",
        UiLanguage::En => "Sorry, I cannot open that file. Please write what you need instead.",
    }
}

/// What the customer reads when they sent something with nothing to read (a sticker, a
/// location, a contact card).
pub fn unsupported_message(language: UiLanguage) -> &'static str {
    match language {
        UiLanguage::Id => "Maaf, saya hanya bisa membaca teks, foto, dan dokumen.",
        UiLanguage::En => "Sorry, I can only read text, photos and documents.",
    }
}

/// A channel's error as a delivery problem. The English text never carries a token: the
/// crate's errors name no URL and redact what the API echoes.
pub fn delivery_failure(error: &ChannelError) -> DeliveryFailure {
    let (problem, message) = match error {
        ChannelError::Api { status: 403, .. } => {
            (DeliveryProblem::Blocked, "the customer blocked the bot or cannot get messages".to_owned())
        }
        ChannelError::Api { status: 401 | 404, .. } => {
            (DeliveryProblem::TokenWrong, "the channel refused the token: it is wrong or was revoked".to_owned())
        }
        ChannelError::Api { status: 429, .. } => {
            (DeliveryProblem::RateLimited, "the channel asks to send fewer messages for now".to_owned())
        }
        ChannelError::OutsideServiceWindow => (
            DeliveryProblem::OutsideWindow,
            "more than 24 hours passed since the customer's last message: WhatsApp lets you write again after \
             they write to you"
                .to_owned(),
        ),
        ChannelError::Transport { .. } => {
            (DeliveryProblem::Offline, "no internet connection: the message was not sent".to_owned())
        }
        ChannelError::TooLarge { .. } => {
            (DeliveryProblem::TooLarge, "the file is too large for the channel".to_owned())
        }
        other => (DeliveryProblem::Other, other.to_string()),
    };
    DeliveryFailure::new(problem, message)
}

/// The reqwest client the channels call through (rustls, no redirects: an API never
/// redirects, and a redirect would carry a token in its URL elsewhere).
///
/// # Errors
/// `Internal` when the client cannot be built.
pub fn channel_http_client() -> crate::error::AppResult<reqwest::Client> {
    let _already_installed = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("graphrt-desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| crate::error::AppError::Internal(format!("could not set up the channel client: {error}")))
}
