//! The HTTP server of Phone access: the monitoring page of graphrt and the part of the
//! `graphrt serve` API it uses, answered from this computer's runs.
//!
//! | Method | Path | Who |
//! | --- | --- | --- |
//! | GET | `/monitor/`, `/monitor/<file>` | anyone (the page holds nothing) |
//! | GET | `/pair`, `/pair.js` | anyone: trades the pairing code in the URL fragment for a token |
//! | POST | `/v1/pair` `{code}` | anyone with a pairing code (rate limited) |
//! | GET | `/v1/monitor/config` | anyone |
//! | GET, DELETE | `/v1/devices/me` | a device token |
//! | GET | `/v1/runs`, `/v1/runs/{id}`, `/v1/runs/{id}/events` | a device token with `runs:read` |
//! | GET, POST | `/v1/approvals`, `/v1/approvals/{run_id}` | a device token with `approvals:resolve` |
//! | GET, POST, DELETE | `/v1/push`, `/v1/push/subscriptions`, `/v1/push/test` | a device token |
//!
//! There is no owner credential on this server at all: the person pairs and removes phones
//! in Desktop. A device token never starts, stops or edits an agent, and never reads keys.
//! Every request first passes [`super::guard::AllowedHosts`].

// Handlers return early with a ready `Response` as the error: the idiomatic axum shape.
#![allow(clippy::result_large_err)]

use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::{ConnectInfo, DefaultBodyLimit, Path as UrlPath, Query, Request, State};
use axum::http::header::{AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE, LOCATION};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Json as JsonBody;
use axum::Router;
use futures::Stream;
use graphrt_cli::devices::{DeviceAccess, DeviceError, Devices, Scope};
use graphrt_cli::notify::webpush::{PushError, Subscription, WebPush};
use serde::Deserialize;
use serde_json::{json, Value as Json};

use super::assets;
use super::audit::{Activity, ActivityKind, ActivityLog};
use super::guard::{AllowedHosts, Limits, Refusal};
use super::pairing::PairingCodes;
use super::wire;
use super::PhoneAccessEvents;
use crate::engine::RunManager;
use crate::error::AppError;
use crate::storage::models::RunStatus;
use crate::storage::phone_runs::{PhoneRun, MAX_PAGE};
use crate::storage::Database;

/// Largest request body (a pairing code, an answer, a push subscription).
const MAX_BODY_BYTES: usize = 64 * 1024;
/// Runs per page unless the page asks for another number.
const DEFAULT_PAGE: usize = 50;
/// How often a followed run's new events are looked for.
const FOLLOW_INTERVAL: Duration = Duration::from_millis(400);
/// Events read from the database at a time while following a run.
const FOLLOW_BATCH: usize = 200;
/// Events that end a run's stream.
const TERMINAL_EVENTS: &[&str] = &["run_succeeded", "run_failed", "run_aborted", "run_paused"];

/// Everything the handlers share.
#[derive(Debug)]
pub struct ServerContext {
    pub db: Arc<Database>,
    pub runs: Arc<RunManager>,
    pub devices: Arc<Devices>,
    pub push: Arc<WebPush>,
    pub pairing: Arc<PairingCodes>,
    pub activity: Arc<ActivityLog>,
    pub events: Arc<dyn PhoneAccessEvents>,
    pub hosts: AllowedHosts,
    pub limits: Limits,
}

type Context = Arc<ServerContext>;

/// The router of one server.
pub fn router(context: Context) -> Router {
    let device_routes = Router::new()
        .route("/v1/devices/me", get(device_me).delete(unpair_me))
        .route("/v1/runs", get(list_runs))
        .route("/v1/runs/{run_id}", get(get_run))
        .route("/v1/runs/{run_id}/events", get(run_events))
        .route("/v1/runs/{run_id}/abort", post(owner_only))
        .route("/v1/runs/{run_id}/resume", post(owner_only))
        .route("/v1/approvals", get(list_approvals))
        .route("/v1/approvals/{run_id}", post(resolve_approval))
        .route("/v1/push", get(push_info))
        .route("/v1/push/subscriptions", post(subscribe).delete(unsubscribe))
        .route("/v1/push/test", post(push_test))
        .route_layer(middleware::from_fn_with_state(Arc::clone(&context), authenticate));
    Router::new()
        .route("/", get(to_monitor))
        .route("/monitor", get(to_monitor))
        .route("/monitor/", get(monitor_page))
        .route("/monitor/{file}", get(monitor_file))
        .route("/pair", get(pair_page))
        .route("/pair.js", get(pair_script))
        .route("/v1/pair", post(pair))
        .route("/v1/monitor/config", get(monitor_config))
        .merge(device_routes)
        .fallback(not_found)
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(middleware::from_fn_with_state(Arc::clone(&context), guard))
        .with_state(context)
}

fn error_response(status: StatusCode, message: &str) -> Response {
    (status, JsonBody(json!({ "error": message }))).into_response()
}

fn app_error(error: &AppError) -> Response {
    log::warn!("phone access: {error}");
    match error {
        AppError::NotFound(_) => error_response(StatusCode::NOT_FOUND, "unknown run"),
        _ => error_response(StatusCode::INTERNAL_SERVER_ERROR, "this computer could not answer"),
    }
}

/// Host and Origin checks, and the headers every answer carries.
async fn guard(State(context): State<Context>, request: Request, next: Next) -> Response {
    if let Err(refusal) = context.hosts.check(request.headers()) {
        return match refusal {
            Refusal::UnknownHost => error_response(StatusCode::MISDIRECTED_REQUEST, "unknown host"),
            Refusal::ForeignOrigin => error_response(StatusCode::FORBIDDEN, "requests from other sites are refused"),
        };
    }
    let is_api = request.uri().path().starts_with("/v1/");
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    let fixed = [
        ("x-content-type-options", "nosniff"),
        ("referrer-policy", "no-referrer"),
        ("x-frame-options", "DENY"),
        ("cross-origin-resource-policy", "same-origin"),
    ];
    for (name, value) in fixed {
        headers.insert(HeaderName::from_static(name), HeaderValue::from_static(value));
    }
    if is_api {
        headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    response
}

/// The device behind the request's bearer token. Refused tokens count towards a limit
/// per client, so guessing is slow; the answer never says why a token failed.
async fn authenticate(
    State(context): State<Context>,
    ConnectInfo(client): ConnectInfo<SocketAddr>,
    mut request: Request,
    next: Next,
) -> Response {
    let token = request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim);
    let verified = match token {
        Some(token) if graphrt_cli::devices::is_device_token(token) => context.devices.verify(token),
        _ => Err(DeviceError::InvalidToken),
    };
    match verified {
        Ok(access) => {
            request.extensions_mut().insert(access);
            next.run(request).await
        }
        Err(error) => {
            if !context.limits.allow_bad_token(client.ip()) {
                let mut refused = error_response(StatusCode::TOO_MANY_REQUESTS, "too many attempts: wait a minute");
                refused.headers_mut().insert("retry-after", HeaderValue::from_static("60"));
                return refused;
            }
            let message = match error {
                DeviceError::Expired => "this phone's access expired: pair it again",
                _ => "pair this phone again in Graphrt Desktop (Settings, Phone access)",
            };
            error_response(StatusCode::UNAUTHORIZED, message)
        }
    }
}

fn require(access: &DeviceAccess, scope: Scope) -> Result<(), Response> {
    if access.allows(scope) {
        Ok(())
    } else {
        Err(error_response(StatusCode::FORBIDDEN, &format!("this phone may not use `{}`", scope.name())))
    }
}

async fn not_found() -> Response {
    error_response(StatusCode::NOT_FOUND, "not found")
}

async fn owner_only() -> Response {
    error_response(StatusCode::FORBIDDEN, "a phone cannot start or stop runs: use Graphrt Desktop")
}

async fn to_monitor() -> Response {
    (StatusCode::FOUND, [(LOCATION, HeaderValue::from_static("monitor/"))]).into_response()
}

async fn monitor_page(headers: HeaderMap) -> Response {
    assets::monitor_page(&headers)
}

async fn monitor_file(UrlPath(file): UrlPath<String>, headers: HeaderMap) -> Response {
    assets::monitor_file(&file, &headers).unwrap_or_else(|| error_response(StatusCode::NOT_FOUND, "not found"))
}

async fn pair_page(headers: HeaderMap) -> Response {
    assets::pair_page(&headers)
}

async fn pair_script(headers: HeaderMap) -> Response {
    assets::pair_script(&headers)
}

async fn monitor_config() -> Response {
    // No API key exists here: the page needs a device token, which only pairing gives.
    JsonBody(json!({
        "access": "key",
        "devices": false,
        "approvals": true,
        "expire_approvals": true,
        "push": true,
    }))
    .into_response()
}

#[derive(Debug, Deserialize)]
struct PairBody {
    code: String,
}

fn is_json(headers: &HeaderMap) -> bool {
    headers.get(CONTENT_TYPE).and_then(|value| value.to_str().ok()).is_some_and(|value| {
        value.split(';').next().is_some_and(|kind| kind.trim().eq_ignore_ascii_case("application/json"))
    })
}

/// `POST /v1/pair`: a pairing code for the phone's device token.
async fn pair(
    State(context): State<Context>,
    ConnectInfo(client): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let refused = |status: StatusCode, message: &str| {
        context.activity.record(Activity {
            at_ms: graphrt_core::store::now_ms(),
            kind: ActivityKind::PairingRefused,
            device_id: None,
            device_name: None,
            run_id: None,
            agent_name: None,
        });
        error_response(status, message)
    };
    if !context.limits.allow_pairing(client.ip()) {
        let mut response = refused(StatusCode::TOO_MANY_REQUESTS, "too many pairing attempts: wait a minute");
        response.headers_mut().insert("retry-after", HeaderValue::from_static("60"));
        return response;
    }
    if !is_json(&headers) {
        return error_response(StatusCode::UNSUPPORTED_MEDIA_TYPE, "send JSON");
    }
    let Ok(body) = serde_json::from_slice::<PairBody>(&body) else {
        return error_response(StatusCode::BAD_REQUEST, "expected {\"code\": \"...\"}");
    };
    let Some(device_name) = context.pairing.redeem(body.code.trim()) else {
        return refused(
            StatusCode::GONE,
            "this pairing code was used already or expired: show a new code in Graphrt Desktop",
        );
    };
    let created = match context.devices.create(&device_name, &Scope::ALL, None) {
        Ok(created) => created,
        Err(DeviceError::TooMany) => {
            return error_response(
                StatusCode::CONFLICT,
                "this computer has too many phones: remove one in Graphrt Desktop",
            )
        }
        Err(error) => {
            log::warn!("phone access: cannot pair a phone: {error}");
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, "this computer could not pair the phone");
        }
    };
    context.activity.record(Activity {
        at_ms: graphrt_core::store::now_ms(),
        kind: ActivityKind::Paired,
        device_id: Some(created.device.id.clone()),
        device_name: Some(created.device.name.clone()),
        run_id: None,
        agent_name: None,
    });
    context.events.changed();
    (StatusCode::CREATED, JsonBody(json!({ "device": created.device.public_json(), "token": created.token })))
        .into_response()
}

/// `GET /v1/devices/me`.
async fn device_me(State(context): State<Context>, axum::Extension(access): axum::Extension<DeviceAccess>) -> Response {
    match context.devices.list() {
        Ok(devices) => match devices.into_iter().find(|device| device.id == access.id) {
            Some(device) => JsonBody(device.public_json()).into_response(),
            None => error_response(StatusCode::UNAUTHORIZED, "this phone is no longer paired"),
        },
        Err(error) => {
            log::warn!("phone access: cannot read devices: {error}");
            error_response(StatusCode::INTERNAL_SERVER_ERROR, "this computer could not answer")
        }
    }
}

/// `DELETE /v1/devices/me`: the phone unpairs itself.
async fn unpair_me(State(context): State<Context>, axum::Extension(access): axum::Extension<DeviceAccess>) -> Response {
    let name =
        context.devices.list().ok().and_then(|devices| devices.into_iter().find(|d| d.id == access.id)).map(|d| d.name);
    match context.devices.revoke(&access.id) {
        Ok(_) => {
            context.push.forget_device(&access.id);
            context.activity.record(Activity {
                at_ms: graphrt_core::store::now_ms(),
                kind: ActivityKind::UnpairedItself,
                device_id: Some(access.id.clone()),
                device_name: name,
                run_id: None,
                agent_name: None,
            });
            context.events.changed();
            StatusCode::NO_CONTENT.into_response()
        }
        Err(error) => {
            log::warn!("phone access: cannot unpair a phone: {error}");
            error_response(StatusCode::INTERNAL_SERVER_ERROR, "this computer could not unpair the phone")
        }
    }
}

/// Agent names by id, read once per request.
fn agent_names(db: &Database) -> Result<std::collections::HashMap<String, String>, Response> {
    db.list_agents()
        .map(|agents| agents.into_iter().map(|agent| (agent.id, agent.name)).collect())
        .map_err(|error| app_error(&error))
}

fn record_of(
    phone_run: &PhoneRun,
    names: &std::collections::HashMap<String, String>,
) -> graphrt_core::store::RunRecord {
    let workflow = names.get(&phone_run.run.agent_id).map_or("Agent", String::as_str);
    let last_event_ms = phone_run.last_event_at.as_deref().map(wire::millis);
    wire::run_record(&phone_run.run, workflow, phone_run.event_count, last_event_ms)
}

#[derive(Debug, Default, Deserialize)]
struct ListQuery {
    status: Option<String>,
    workflow: Option<String>,
    limit: Option<usize>,
    cursor: Option<String>,
}

fn parse_status(text: &str) -> Option<RunStatus> {
    match text {
        "running" => Some(RunStatus::Running),
        "paused" => Some(RunStatus::Paused),
        "succeeded" => Some(RunStatus::Succeeded),
        "failed" => Some(RunStatus::Failed),
        "aborted" => Some(RunStatus::Aborted),
        _ => None,
    }
}

/// A page of runs, the cursor of the next page, and the agent names by id.
type RunsPage = (Vec<PhoneRun>, Option<String>, std::collections::HashMap<String, String>);

/// Runs of `query`, and the cursor of the next page.
fn runs_page(context: &ServerContext, query: &ListQuery, status: Option<RunStatus>) -> Result<RunsPage, Response> {
    let names = agent_names(&context.db)?;
    let agent_ids: Option<Vec<String>> = query
        .workflow
        .as_deref()
        .map(|workflow| names.iter().filter(|(_, name)| name.as_str() == workflow).map(|(id, _)| id.clone()).collect());
    let limit = query.limit.unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE);
    let runs = context
        .db
        .list_phone_runs(
            status,
            agent_ids.as_deref(),
            query.cursor.as_deref().filter(|cursor| !cursor.is_empty()),
            limit,
        )
        .map_err(|error| app_error(&error))?;
    let next_cursor = (runs.len() == limit).then(|| runs.last().map(|last| last.run.id.clone())).flatten();
    Ok((runs, next_cursor, names))
}

/// `GET /v1/runs`.
async fn list_runs(
    State(context): State<Context>,
    axum::Extension(access): axum::Extension<DeviceAccess>,
    Query(query): Query<ListQuery>,
) -> Response {
    if let Err(refused) = require(&access, Scope::RunsRead) {
        return refused;
    }
    let status = match query.status.as_deref() {
        Some(text) => match parse_status(text) {
            Some(status) => Some(status),
            None => return error_response(StatusCode::BAD_REQUEST, &format!("unknown status `{text}`")),
        },
        None => None,
    };
    match runs_page(&context, &query, status) {
        Ok((runs, next_cursor, names)) => {
            let runs: Vec<Json> = runs.iter().map(|run| wire::record_json(&record_of(run, &names))).collect();
            JsonBody(json!({ "runs": runs, "next_cursor": next_cursor })).into_response()
        }
        Err(refused) => refused,
    }
}

fn phone_run(context: &ServerContext, run_id: &str) -> Result<PhoneRun, Response> {
    match context.db.get_phone_run(run_id) {
        Ok(Some(run)) => Ok(run),
        Ok(None) => Err(error_response(StatusCode::NOT_FOUND, "unknown run")),
        Err(error) => Err(app_error(&error)),
    }
}

/// `GET /v1/runs/{run_id}`.
async fn get_run(
    State(context): State<Context>,
    axum::Extension(access): axum::Extension<DeviceAccess>,
    UrlPath(run_id): UrlPath<String>,
) -> Response {
    if let Err(refused) = require(&access, Scope::RunsRead) {
        return refused;
    }
    let found = phone_run(&context, &run_id).and_then(|run| Ok((run, agent_names(&context.db)?)));
    match found {
        Ok((run, names)) => JsonBody(wire::record_json(&record_of(&run, &names))).into_response(),
        Err(refused) => refused,
    }
}

#[derive(Debug, Default, Deserialize)]
struct EventsQuery {
    #[serde(default)]
    from: u64,
    stream: Option<bool>,
}

/// One stored event as a phone receives it.
fn event_json(event: &Json) -> Json {
    wire::redact(event)
}

fn event_type(event: &Json) -> String {
    event.get("type").and_then(Json::as_str).unwrap_or("event").to_owned()
}

/// `GET /v1/runs/{run_id}/events`: the stored events from `from` as JSON
/// (`stream=false`), or as server-sent events followed until the run ends or pauses.
async fn run_events(
    State(context): State<Context>,
    axum::Extension(access): axum::Extension<DeviceAccess>,
    UrlPath(run_id): UrlPath<String>,
    headers: HeaderMap,
    Query(query): Query<EventsQuery>,
) -> Response {
    if let Err(refused) = require(&access, Scope::RunsRead) {
        return refused;
    }
    if let Err(refused) = phone_run(&context, &run_id) {
        return refused;
    }
    if query.stream == Some(false) {
        return match context.db.list_run_events_from(&run_id, query.from, 10 * MAX_PAGE) {
            Ok(events) => {
                JsonBody(events.iter().map(|record| event_json(&record.event)).collect::<Vec<_>>()).into_response()
            }
            Err(error) => app_error(&error),
        };
    }
    // A reconnecting client names the last event it received.
    let after_last_seen = headers
        .get("last-event-id")
        .and_then(|value| value.to_str().ok())
        .and_then(|id| id.split('.').next()?.parse::<u64>().ok())
        .map(|index| index + 1);
    let from = query.from.max(after_last_seen.unwrap_or(0));
    Sse::new(follow(context, run_id, from)).keep_alive(KeepAlive::default()).into_response()
}

/// The events of `run_id` from position `from`, until a terminal one.
fn follow(context: Context, run_id: String, from: u64) -> impl Stream<Item = Result<SseEvent, Infallible>> {
    struct Following {
        context: Context,
        run_id: String,
        next: u64,
        buffered: std::collections::VecDeque<Json>,
        done: bool,
    }
    let state = Following { context, run_id, next: from, buffered: std::collections::VecDeque::new(), done: false };
    futures::stream::unfold(state, |mut state| async move {
        loop {
            if state.done {
                return None;
            }
            if let Some(event) = state.buffered.pop_front() {
                let index = state.next;
                state.next += 1;
                let kind = event_type(&event);
                state.done = TERMINAL_EVENTS.contains(&kind.as_str());
                let message =
                    SseEvent::default().event(kind).id(index.to_string()).data(event_json(&event).to_string());
                return Some((Ok(message), state));
            }
            let fresh = state.context.db.list_run_events_from(&state.run_id, state.next, FOLLOW_BATCH);
            match fresh {
                Ok(events) if !events.is_empty() => {
                    state.buffered.extend(events.into_iter().map(|record| record.event))
                }
                Ok(_) => {
                    // Nothing new: a run that no longer executes adds nothing more.
                    let still_running =
                        matches!(state.context.db.get_run(&state.run_id).map(|run| run.status), Ok(RunStatus::Running));
                    if !still_running
                        && state
                            .context
                            .db
                            .list_run_events_from(&state.run_id, state.next, 1)
                            .map_or(true, |events| events.is_empty())
                    {
                        return None;
                    }
                    tokio::time::sleep(FOLLOW_INTERVAL).await;
                }
                Err(error) => {
                    log::warn!("phone access: following run {}: {error}", state.run_id);
                    return None;
                }
            }
        }
    })
}

#[derive(Debug, Default, Deserialize)]
struct ApprovalsQuery {
    workflow: Option<String>,
    limit: Option<usize>,
    cursor: Option<String>,
}

/// `GET /v1/approvals`: every paused run that waits for a person, newest first.
async fn list_approvals(
    State(context): State<Context>,
    axum::Extension(access): axum::Extension<DeviceAccess>,
    Query(query): Query<ApprovalsQuery>,
) -> Response {
    if let Err(refused) = require(&access, Scope::ApprovalsResolve) {
        return refused;
    }
    let list_query = ListQuery { status: None, workflow: query.workflow, limit: query.limit, cursor: query.cursor };
    match runs_page(&context, &list_query, Some(RunStatus::Paused)) {
        Ok((runs, next_cursor, names)) => {
            let approvals: Vec<Json> = runs
                .iter()
                .filter_map(|run| wire::approval_json(&record_of(run, &names), run.run.pause_reasons.as_ref()))
                .collect();
            JsonBody(json!({ "approvals": approvals, "next_cursor": next_cursor, "expiry_enforced": true }))
                .into_response()
        }
        Err(refused) => refused,
    }
}

#[derive(Debug, Deserialize)]
struct ResolveBody {
    inputs: serde_json::Map<String, Json>,
}

/// `POST /v1/approvals/{run_id}` `{inputs}`: answers what the run waits for and lets it
/// continue on this computer, exactly as answering in Desktop does.
async fn resolve_approval(
    State(context): State<Context>,
    axum::Extension(access): axum::Extension<DeviceAccess>,
    UrlPath(run_id): UrlPath<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if let Err(refused) = require(&access, Scope::ApprovalsResolve) {
        return refused;
    }
    if !is_json(&headers) {
        return error_response(StatusCode::UNSUPPORTED_MEDIA_TYPE, "send JSON");
    }
    let Ok(body) = serde_json::from_slice::<ResolveBody>(&body) else {
        return error_response(StatusCode::BAD_REQUEST, "expected {\"inputs\": {...}}");
    };
    let found = phone_run(&context, &run_id).and_then(|run| Ok((run, agent_names(&context.db)?)));
    let (run, names) = match found {
        Ok(found) => found,
        Err(refused) => return refused,
    };
    if run.run.status != RunStatus::Paused {
        return error_response(StatusCode::CONFLICT, "this run waits for nothing anymore");
    }
    let record = record_of(&run, &names);
    let keys = wire::request_keys(&record);
    if body.inputs.is_empty() {
        return error_response(StatusCode::BAD_REQUEST, "`inputs` is empty");
    }
    if let Some(unknown) = body.inputs.keys().find(|key| !keys.contains(key)) {
        return error_response(StatusCode::BAD_REQUEST, &format!("nothing waits for an answer under `{unknown}`"));
    }
    let first_event = run.event_count;
    match context.runs.resume_run(&run_id, Json::Object(body.inputs)).await {
        Ok(_) => {
            let device_name = context
                .devices
                .list()
                .ok()
                .and_then(|devices| devices.into_iter().find(|d| d.id == access.id))
                .map(|d| d.name);
            context.activity.record(Activity {
                at_ms: graphrt_core::store::now_ms(),
                kind: ActivityKind::Answered,
                device_id: Some(access.id.clone()),
                device_name,
                run_id: Some(run_id.clone()),
                agent_name: Some(record.workflow.clone()),
            });
            context.events.changed();
            (
                StatusCode::ACCEPTED,
                JsonBody(json!({
                    "run_id": run_id,
                    "status": "running",
                    "run": format!("/v1/runs/{run_id}"),
                    "events": format!("/v1/runs/{run_id}/events"),
                    "first_event": first_event,
                })),
            )
                .into_response()
        }
        // Someone answered first (in Desktop or on another phone), or the answer is not valid.
        Err(AppError::InvalidInput(message)) if message.contains("not paused") => {
            error_response(StatusCode::CONFLICT, "this run waits for nothing anymore")
        }
        Err(AppError::InvalidInput(message) | AppError::Workflow(message)) => {
            error_response(StatusCode::BAD_REQUEST, &message)
        }
        Err(AppError::MissingCredentials(what)) => error_response(
            StatusCode::CONFLICT,
            &format!("the run cannot continue: {what} is not set up on the computer"),
        ),
        Err(error) => app_error(&error),
    }
}

/// `GET /v1/push`.
async fn push_info(State(context): State<Context>) -> Response {
    JsonBody(json!({ "public_key": context.push.public_key() })).into_response()
}

#[derive(Debug, Deserialize)]
struct SubscriptionKeys {
    p256dh: String,
    auth: String,
}

#[derive(Debug, Deserialize)]
struct SubscribeBody {
    endpoint: String,
    keys: SubscriptionKeys,
}

#[derive(Debug, Deserialize)]
struct EndpointBody {
    endpoint: String,
}

fn push_error(error: &PushError) -> Response {
    match error {
        PushError::Invalid(message) => error_response(StatusCode::BAD_REQUEST, message),
        PushError::TooMany => error_response(StatusCode::CONFLICT, &error.to_string()),
        PushError::Io(_) | PushError::Crypto => {
            log::warn!("phone access: push: {error}");
            error_response(StatusCode::INTERNAL_SERVER_ERROR, "this computer could not keep the subscription")
        }
    }
}

/// `POST /v1/push/subscriptions`: `PushSubscription.toJSON()` of the phone's browser.
async fn subscribe(
    State(context): State<Context>,
    axum::Extension(access): axum::Extension<DeviceAccess>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !is_json(&headers) {
        return error_response(StatusCode::UNSUPPORTED_MEDIA_TYPE, "send JSON");
    }
    let Ok(body) = serde_json::from_slice::<SubscribeBody>(&body) else {
        return error_response(StatusCode::BAD_REQUEST, "expected {endpoint, keys: {p256dh, auth}}");
    };
    let subscription = Subscription {
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        device_id: Some(access.id),
        created_ms: 0,
    };
    match context.push.subscribe(subscription) {
        Ok(()) => StatusCode::CREATED.into_response(),
        Err(error) => push_error(&error),
    }
}

/// `DELETE /v1/push/subscriptions` `{endpoint}`: only the phone's own.
async fn unsubscribe(
    State(context): State<Context>,
    axum::Extension(access): axum::Extension<DeviceAccess>,
    body: Bytes,
) -> Response {
    let Ok(body) = serde_json::from_slice::<EndpointBody>(&body) else {
        return error_response(StatusCode::BAD_REQUEST, "expected {endpoint}");
    };
    match context.push.unsubscribe(&body.endpoint, Some(&access.id)) {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => push_error(&error),
    }
}

/// `POST /v1/push/test` `{endpoint}`: one test notification to the phone's own subscription.
async fn push_test(
    State(context): State<Context>,
    axum::Extension(access): axum::Extension<DeviceAccess>,
    body: Bytes,
) -> Response {
    let Ok(body) = serde_json::from_slice::<EndpointBody>(&body) else {
        return error_response(StatusCode::BAD_REQUEST, "expected {endpoint}");
    };
    match context.push.send_test(&body.endpoint, Some(&access.id)).await {
        Ok(true) => StatusCode::ACCEPTED.into_response(),
        Ok(false) => error_response(StatusCode::NOT_FOUND, "this browser has no subscription here"),
        Err(why) => error_response(StatusCode::BAD_GATEWAY, &why),
    }
}
