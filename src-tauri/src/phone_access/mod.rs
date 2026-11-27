//! Phone access: follow and answer the agents that run on this computer from a phone
//! (Settings > Phone access, cargo feature `phone-access`, off until the person turns it on).
//!
//! This computer serves graphrt's monitoring page (graphrt#136) and the part of the
//! `graphrt serve` API it reads ([`server`]), answered from Desktop's own runs. A phone
//! pairs by scanning a QR code ([`pairing`]): a code that works once for ten minutes and is
//! traded for a device token of graphrt's [`Devices`] (it reads runs and answers requests,
//! nothing else, and can be removed at any time). Notifications are graphrt's Web Push
//! notifier ([`push`]).
//!
//! Where phones reach it ([`Reach`]):
//! - **Same Wi-Fi** ([`Reach::Lan`]): bound to the computer's private network address only.
//!   Plain HTTP: the network is the person's own; browsers allow no notifications there.
//! - **Tailscale** ([`Reach::Tailscale`]): with HTTPS certificates on the tailnet,
//!   `tailscale serve` terminates HTTPS with a real certificate and forwards to the loopback
//!   address, which is the only address bound. Otherwise bound to the tailnet address over
//!   plain HTTP (WireGuard still encrypts it).
//! - **A tunnel of your own** ([`Reach::Tunnel`], e.g. Cloudflare Tunnel): bound to the
//!   loopback address; the tunnel's HTTPS name is the only other name answered.
//!
//! Devices, push subscriptions, the VAPID key and the activity log are kept in
//! `<app data>/phone-access/` (owner-only files), so phones stay paired across restarts
//! and sleep. The address is checked again every [`WATCH_INTERVAL`] and the server moves
//! when the network changed (a new Wi-Fi address after waking up).

pub mod assets;
pub mod audit;
pub mod guard;
pub mod network;
pub mod pairing;
pub mod push;
pub mod server;
pub mod wire;

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use graphrt_cli::devices::Devices;
use graphrt_cli::notify::webpush::WebPush;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

pub use self::audit::Activity;
use self::audit::{ActivityKind, ActivityLog};
use self::guard::{AllowedHosts, Limits};
use self::network::{TailscaleCli, TailscaleInfo};
use self::pairing::PairingCodes;
use crate::deploy::phone::{DevicePairing, PairedDevice};
use crate::engine::RunManager;
use crate::error::{AppError, AppResult};
use crate::storage::Database;

/// Folder of the phone access files in the app data directory.
pub const DIR_NAME: &str = "phone-access";
/// The port phones connect to. It stays the same, so a page added to a phone's home screen
/// keeps working.
pub const DEFAULT_PORT: u16 = 47613;
/// Settings key of [`PhoneAccessSettings`].
const SETTINGS_KEY: &str = "phone_access";
/// The address push services may write to about this sender (the VAPID `sub`): the
/// project's page, so no personal address is sent anywhere.
const PUSH_CONTACT: &str = "https://github.com/Graphrt/graphrt-builder-desktop";
/// How often the address is checked again.
const WATCH_INTERVAL: Duration = Duration::from_secs(30);
/// The Tauri event sent when devices, activity or the server changed.
pub const PHONE_ACCESS_EVENT: &str = "phone-access-changed";

/// Where phones reach this computer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum Reach {
    /// The same Wi-Fi or cable network.
    Lan,
    /// The person's own Tailscale network.
    Tailscale,
    /// A tunnel the person runs (Cloudflare Tunnel...) to `http://127.0.0.1:<port>`.
    Tunnel { public_url: String },
}

/// What the person chose.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneAccessSettings {
    pub enabled: bool,
    pub reach: Reach,
    #[serde(default = "default_port")]
    pub port: u16,
}

fn default_port() -> u16 {
    DEFAULT_PORT
}

impl Default for PhoneAccessSettings {
    fn default() -> Self {
        Self { enabled: false, reach: Reach::Lan, port: DEFAULT_PORT }
    }
}

/// What the settings screen shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneAccessStatus {
    pub settings: PhoneAccessSettings,
    /// Phones can connect right now.
    pub serving: bool,
    /// The address phones open (`http://192.168.1.21:47613`).
    pub address: Option<String>,
    /// Served over HTTPS: phones can get notifications.
    pub secure: bool,
    /// Why it is not serving (plain sentence).
    pub problem: Option<String>,
    /// Something the person should know while it serves (plain sentence).
    pub notice: Option<String>,
    /// This computer's address on the local network, if it has one.
    pub lan_address: Option<String>,
    pub tailscale: TailscaleInfo,
    pub paired_count: usize,
}

/// Tells the screens that something changed (a phone paired, a request was answered).
pub trait PhoneAccessEvents: Send + Sync + std::fmt::Debug {
    fn changed(&self);
}

/// Sends [`PHONE_ACCESS_EVENT`] to every window.
#[derive(Debug)]
pub struct TauriPhoneAccessEvents {
    app_handle: AppHandle,
}

impl TauriPhoneAccessEvents {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

impl PhoneAccessEvents for TauriPhoneAccessEvents {
    fn changed(&self) {
        if let Err(error) = self.app_handle.emit(PHONE_ACCESS_EVENT, ()) {
            log::warn!("could not emit the phone access event: {error}");
        }
    }
}

/// The stores that live in the phone access folder, opened on first use.
#[derive(Debug)]
struct Stores {
    devices: Arc<Devices>,
    push: Arc<WebPush>,
}

/// How a server is planned to run.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Plan {
    bind: SocketAddr,
    /// The address phones open.
    address: String,
    /// Every base URL the server answers for.
    base_urls: Vec<String>,
    secure: bool,
    /// Ask `tailscale serve` to forward HTTPS on this port.
    tailscale_serve: bool,
    notice: Option<String>,
}

/// A server that runs.
#[derive(Debug)]
struct Running {
    plan: Plan,
    task: tauri::async_runtime::JoinHandle<()>,
}

#[derive(Debug, Default, Clone)]
struct Snapshot {
    address: Option<String>,
    secure: bool,
    problem: Option<String>,
    notice: Option<String>,
}

/// Phone access of this computer.
#[derive(Debug)]
pub struct PhoneAccess {
    db: Arc<Database>,
    dir: PathBuf,
    events: Arc<dyn PhoneAccessEvents>,
    stores: Mutex<Option<Arc<Stores>>>,
    pairing: Arc<PairingCodes>,
    activity: Arc<ActivityLog>,
    runs: OnceLock<Arc<RunManager>>,
    running: tokio::sync::Mutex<Option<Running>>,
    snapshot: Mutex<Snapshot>,
}

impl PhoneAccess {
    /// Phone access with its files in `<app_data_dir>/phone-access/`. Nothing is created or
    /// served until the person turns it on.
    pub fn new(db: Arc<Database>, app_data_dir: &std::path::Path, events: Arc<dyn PhoneAccessEvents>) -> Self {
        let dir = app_data_dir.join(DIR_NAME);
        let activity = Arc::new(ActivityLog::open(Some(dir.clone())));
        Self {
            db,
            dir,
            events,
            stores: Mutex::new(None),
            pairing: Arc::new(PairingCodes::default()),
            activity,
            runs: OnceLock::new(),
            running: tokio::sync::Mutex::new(None),
            snapshot: Mutex::new(Snapshot::default()),
        }
    }

    /// Hands over the run manager (it is built after the event sinks that need this).
    pub fn attach(&self, runs: Arc<RunManager>) {
        if self.runs.set(runs).is_err() {
            log::warn!("phone access: the run manager was attached twice");
        }
    }

    /// The saved settings (defaults when none or unreadable).
    pub fn settings(&self) -> PhoneAccessSettings {
        match self.db.get_setting(SETTINGS_KEY) {
            Ok(Some(text)) => serde_json::from_str(&text).unwrap_or_else(|error| {
                log::warn!("phone access: unreadable settings, using the defaults: {error}");
                PhoneAccessSettings::default()
            }),
            Ok(None) => PhoneAccessSettings::default(),
            Err(error) => {
                log::warn!("phone access: cannot read the settings: {error}");
                PhoneAccessSettings::default()
            }
        }
    }

    /// Devices and push, opened (and the folder created) on first use.
    fn stores(&self) -> AppResult<Arc<Stores>> {
        let mut stores = self.stores.lock().map_err(|_| AppError::Internal("phone access is unavailable".into()))?;
        if let Some(stores) = stores.as_ref() {
            return Ok(Arc::clone(stores));
        }
        let devices =
            Devices::open(Some(&self.dir)).map_err(|error| AppError::Internal(format!("paired phones: {error}")))?;
        let push = WebPush::open(Some(&self.dir), PUSH_CONTACT, false)
            .map_err(|error| AppError::Internal(format!("phone notifications: {error}")))?;
        let opened = Arc::new(Stores { devices: Arc::new(devices), push: Arc::new(push) });
        *stores = Some(Arc::clone(&opened));
        Ok(opened)
    }

    /// The Web Push notifier when Phone access is on and phones may be subscribed.
    pub(crate) fn notifier(&self) -> Option<Arc<WebPush>> {
        if !self.settings().enabled {
            return None;
        }
        let stores = self.stores.lock().ok()?.as_ref().map(Arc::clone)?;
        (stores.push.subscription_count() > 0).then(|| Arc::clone(&stores.push))
    }

    /// The database, for the agent names and runs of notifications.
    pub(crate) fn database(&self) -> &Database {
        &self.db
    }

    /// Starts serving at app start when the person had it on, and watches the network.
    pub fn spawn(self: &Arc<Self>) {
        let access = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            if access.settings().enabled {
                access.apply().await;
            }
            loop {
                tokio::time::sleep(WATCH_INTERVAL).await;
                access.follow_network_changes().await;
            }
        });
    }

    /// Moves the server when the planned address changed (new Wi-Fi address, Tailscale
    /// came up), and retries one that could not start.
    async fn follow_network_changes(&self) {
        let settings = self.settings();
        if !settings.enabled {
            return;
        }
        let planned = self.plan(&settings).await.ok();
        let current = self.running.lock().await.as_ref().map(|running| running.plan.clone());
        let changed = match (&planned, &current) {
            (Some(planned), Some(current)) => planned.bind != current.bind || planned.address != current.address,
            (Some(_), None) => true,
            (None, Some(_)) => true,
            (None, None) => false,
        };
        if changed {
            log::info!("phone access: the network changed, serving again");
            self.apply().await;
        }
    }

    /// Saves `settings` and serves (or stops) accordingly.
    ///
    /// # Errors
    /// `InvalidInput` for a tunnel address that is not an `https` URL or a port below 1024.
    pub async fn save(&self, mut settings: PhoneAccessSettings) -> AppResult<PhoneAccessStatus> {
        if settings.port < 1024 {
            return Err(AppError::InvalidInput("choose a port from 1024 to 65535".into()));
        }
        if let Reach::Tunnel { public_url } = &mut settings.reach {
            *public_url = tunnel_origin(public_url)?;
        }
        let previous = self.settings();
        self.db.set_setting(SETTINGS_KEY, &serde_json::to_string(&settings)?)?;
        if previous.enabled && !settings.enabled {
            self.pairing.clear();
        }
        self.apply().await;
        // Tailscale keeps what it serves after the app quits: stop it when it is no longer used.
        let stopped_tailscale = previous.reach == Reach::Tailscale
            && (!settings.enabled || settings.reach != Reach::Tailscale || settings.port != previous.port);
        if stopped_tailscale {
            if let Some(cli) = TailscaleCli::find() {
                cli.stop_serving(previous.port).await;
            }
        }
        self.events.changed();
        self.status().await
    }

    /// Stops the server, then starts it as the settings say.
    async fn apply(&self) {
        let mut running = self.running.lock().await;
        if let Some(previous) = running.take() {
            previous.task.abort();
        }
        let settings = self.settings();
        if !settings.enabled {
            self.set_snapshot(Snapshot::default());
            return;
        }
        match self.start(&settings).await {
            Ok(started) => {
                self.set_snapshot(Snapshot {
                    address: Some(started.plan.address.clone()),
                    secure: started.plan.secure,
                    problem: None,
                    notice: started.plan.notice.clone(),
                });
                *running = Some(started);
            }
            Err(problem) => {
                log::info!("phone access: not serving: {problem}");
                self.set_snapshot(Snapshot { problem: Some(problem), ..Snapshot::default() });
            }
        }
    }

    fn set_snapshot(&self, snapshot: Snapshot) {
        if let Ok(mut current) = self.snapshot.lock() {
            *current = snapshot;
        }
    }

    /// Where to serve for `settings`, or why it cannot.
    async fn plan(&self, settings: &PhoneAccessSettings) -> Result<Plan, String> {
        let port = settings.port;
        match &settings.reach {
            Reach::Lan => {
                let address = network::lan_address().ok_or_else(|| {
                    "This computer is not on a Wi-Fi or cable network right now. Connect it, and Phone access starts by itself."
                        .to_owned()
                })?;
                let url = format!("http://{address}:{port}");
                Ok(Plan {
                    bind: SocketAddr::new(IpAddr::V4(address), port),
                    address: url.clone(),
                    base_urls: vec![url],
                    secure: false,
                    tailscale_serve: false,
                    notice: None,
                })
            }
            Reach::Tailscale => {
                let cli = TailscaleCli::find()
                    .ok_or_else(|| "Tailscale is not installed on this computer. Install it from tailscale.com, sign in, and turn this on again.".to_owned())?;
                let info = cli.status().await;
                if !info.running {
                    return Err(
                        "Tailscale is not connected. Open Tailscale and sign in; Phone access starts by itself."
                            .to_owned(),
                    );
                }
                Ok(tailscale_plan(&info, port)?)
            }
            Reach::Tunnel { public_url } => {
                let local = format!("http://127.0.0.1:{port}");
                Ok(Plan {
                    bind: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port),
                    address: public_url.clone(),
                    base_urls: vec![public_url.clone(), local, format!("http://localhost:{port}")],
                    secure: public_url.starts_with("https://"),
                    tailscale_serve: false,
                    notice: Some(format!(
                        "Your tunnel must forward {public_url} to http://127.0.0.1:{port} on this computer."
                    )),
                })
            }
        }
    }

    /// Binds and starts the server of the current settings.
    async fn start(&self, settings: &PhoneAccessSettings) -> Result<Running, String> {
        let runs = self.runs.get().cloned().ok_or_else(|| "Graphrt Desktop is still starting.".to_owned())?;
        let stores = self.stores().map_err(|error| error.to_string())?;
        let mut plan = self.plan(settings).await?;
        if plan.tailscale_serve {
            let served = match TailscaleCli::find() {
                Some(cli) => cli.serve(settings.port).await.map_err(|problem| problem.message()),
                None => Err("Tailscale is not installed on this computer.".to_owned()),
            };
            if let Err(why) = served {
                // Plain HTTP on the tailnet address still works, without notifications.
                let info = match TailscaleCli::find() {
                    Some(cli) => cli.status().await,
                    None => TailscaleInfo::default(),
                };
                plan = plain_tailnet_plan(&info, settings.port)?;
                plan.notice = Some(format!("{why} Until then phones connect without HTTPS and get no notifications."));
            }
        }
        let listener = tokio::net::TcpListener::bind(plan.bind).await.map_err(|error| {
            if error.kind() == std::io::ErrorKind::AddrInUse {
                format!(
                    "Another program uses port {} on this computer. Close it, then turn Phone access off and on.",
                    plan.bind.port()
                )
            } else {
                format!("This computer could not open {}: {error}", plan.bind)
            }
        })?;
        Ok(self.launch(plan, listener, runs, &stores))
    }

    /// Serves `plan` on `listener`.
    fn launch(&self, plan: Plan, listener: tokio::net::TcpListener, runs: Arc<RunManager>, stores: &Stores) -> Running {
        let context = Arc::new(server::ServerContext {
            db: Arc::clone(&self.db),
            runs,
            devices: Arc::clone(&stores.devices),
            push: Arc::clone(&stores.push),
            pairing: Arc::clone(&self.pairing),
            activity: Arc::clone(&self.activity),
            events: Arc::clone(&self.events),
            hosts: AllowedHosts::for_urls(&plan.base_urls),
            limits: Limits::default(),
        });
        let app = server::router(context).into_make_service_with_connect_info::<SocketAddr>();
        log::info!("phone access: serving {} on {}", plan.address, plan.bind);
        let task = tauri::async_runtime::spawn(async move {
            if let Err(error) = axum::serve(listener, app).await {
                log::warn!("phone access: the server stopped: {error}");
            }
        });
        Running { plan, task }
    }

    /// Serves on a free loopback port, as the tests reach it. Returns the address.
    #[cfg(test)]
    async fn serve_on_loopback(&self) -> SocketAddr {
        let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.expect("bind a loopback port");
        let bind = listener.local_addr().expect("the bound address");
        let address = format!("http://{bind}");
        let plan = Plan {
            bind,
            address: address.clone(),
            base_urls: vec![address],
            secure: false,
            tailscale_serve: false,
            notice: None,
        };
        let runs = self.runs.get().cloned().expect("attach the run manager first");
        let stores = self.stores().expect("open the stores");
        let running = self.launch(plan, listener, runs, &stores);
        *self.running.lock().await = Some(running);
        bind
    }

    /// What the settings screen shows.
    ///
    /// # Errors
    /// None today; the signature matches the build without Phone access.
    pub async fn status(&self) -> AppResult<PhoneAccessStatus> {
        let settings = self.settings();
        let serving = self.running.lock().await.as_ref().is_some_and(|running| !running.task.inner().is_finished());
        let snapshot = self.snapshot.lock().map(|snapshot| snapshot.clone()).unwrap_or_default();
        let tailscale = match TailscaleCli::find() {
            Some(cli) => cli.status().await,
            None => TailscaleInfo::default(),
        };
        let paired_count =
            if self.dir.is_dir() { self.list_devices().map(|devices| devices.len()).unwrap_or(0) } else { 0 };
        Ok(PhoneAccessStatus {
            settings,
            serving,
            address: snapshot.address.filter(|_| serving),
            secure: snapshot.secure && serving,
            problem: snapshot.problem,
            notice: snapshot.notice.filter(|_| serving),
            lan_address: network::lan_address().map(|address| address.to_string()),
            tailscale,
            paired_count,
        })
    }

    /// The paired phones, oldest first.
    ///
    /// # Errors
    /// `Internal` when the device file cannot be read.
    pub fn list_devices(&self) -> AppResult<Vec<PairedDevice>> {
        let devices = self.stores()?.devices.list().map_err(|error| AppError::Internal(error.to_string()))?;
        Ok(devices
            .into_iter()
            .map(|device| PairedDevice {
                id: device.id,
                name: device.name,
                paired_at_ms: Some(device.created_ms),
                last_used_at_ms: device.last_used_ms,
                can_show_code: false,
            })
            .collect())
    }

    /// A pairing code for a phone named `name`, as the QR code's link.
    ///
    /// # Errors
    /// `InvalidInput` for an empty or long name, or while Phone access does not serve.
    pub async fn pair(&self, name: &str) -> AppResult<DevicePairing> {
        let name = name.trim();
        if name.is_empty() || name.len() > graphrt_cli::devices::MAX_NAME_BYTES || name.chars().any(char::is_control) {
            return Err(AppError::InvalidInput("give the phone a name of up to 100 characters".into()));
        }
        let address = self
            .running
            .lock()
            .await
            .as_ref()
            .map(|running| running.plan.address.clone())
            .ok_or_else(|| AppError::InvalidInput("Turn on Phone access first (Settings, Phone access)".into()))?;
        let code = self.pairing.create(name)?;
        Ok(DevicePairing {
            device_id: code.id,
            device_name: name.to_owned(),
            link: format!("{address}/pair#{}", code.code),
        })
    }

    /// Removes a phone (its token stops working at once), or ends a pairing code not used yet.
    ///
    /// # Errors
    /// `NotFound` for an unknown phone, `Internal` when the device file cannot be written.
    pub fn revoke(&self, device_id: &str) -> AppResult<()> {
        if device_id.starts_with("pairing-") {
            self.pairing.cancel(device_id);
            return Ok(());
        }
        let stores = self.stores()?;
        let name = stores
            .devices
            .list()
            .ok()
            .and_then(|devices| devices.into_iter().find(|d| d.id == device_id))
            .map(|d| d.name);
        if !stores.devices.revoke(device_id).map_err(|error| AppError::Internal(error.to_string()))? {
            return Err(AppError::NotFound("this phone".into()));
        }
        stores.push.forget_device(device_id);
        self.activity.record(Activity {
            at_ms: graphrt_core::store::now_ms(),
            kind: ActivityKind::Removed,
            device_id: Some(device_id.to_owned()),
            device_name: name,
            run_id: None,
            agent_name: None,
        });
        self.events.changed();
        Ok(())
    }

    /// What paired phones did, newest first.
    ///
    /// # Errors
    /// `Internal` when the log is unavailable.
    pub fn activity(&self, limit: usize) -> AppResult<Vec<Activity>> {
        self.activity.newest(limit.clamp(1, 200))
    }
}

/// `https://name.example.com` of a tunnel address the person typed.
///
/// # Errors
/// `InvalidInput` unless it is an `https` URL of a host, without a path.
fn tunnel_origin(text: &str) -> AppResult<String> {
    let invalid = || AppError::InvalidInput("enter your tunnel's address, like https://agents.example.com".into());
    let url = url::Url::parse(text.trim()).map_err(|_| invalid())?;
    let has_path = !matches!(url.path(), "" | "/");
    if url.scheme() != "https"
        || url.host_str().is_none()
        || has_path
        || url.query().is_some()
        || !url.username().is_empty()
    {
        return Err(invalid());
    }
    Ok(url.origin().ascii_serialization())
}

/// Tailscale with HTTPS through `tailscale serve` when the tailnet has certificates,
/// else plain HTTP on the tailnet address.
fn tailscale_plan(info: &TailscaleInfo, port: u16) -> Result<Plan, String> {
    match (&info.dns_name, info.https_certificates) {
        (Some(name), true) => {
            let url = format!("https://{name}:{port}");
            Ok(Plan {
                bind: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port),
                address: url.clone(),
                base_urls: vec![url],
                secure: true,
                tailscale_serve: true,
                notice: None,
            })
        }
        _ => {
            let mut plan = plain_tailnet_plan(info, port)?;
            plan.notice = Some(
                "For notifications on the phone, turn on \"HTTPS Certificates\" in the Tailscale admin console \
                 (DNS page), then turn Phone access off and on. Until then phones connect without HTTPS."
                    .to_owned(),
            );
            Ok(plan)
        }
    }
}

/// Plain HTTP on the tailnet address (WireGuard encrypts it; browsers still call it insecure).
fn plain_tailnet_plan(info: &TailscaleInfo, port: u16) -> Result<Plan, String> {
    let address = info.address.ok_or_else(|| "Tailscale has no address for this computer yet.".to_owned())?;
    let mut base_urls = vec![format!("http://{address}:{port}")];
    if let Some(name) = &info.dns_name {
        base_urls.push(format!("http://{name}:{port}"));
    }
    let host = info.host().unwrap_or_else(|| address.to_string());
    Ok(Plan {
        bind: SocketAddr::new(IpAddr::V4(address), port),
        address: format!("http://{host}:{port}"),
        base_urls,
        secure: false,
        tailscale_serve: false,
        notice: None,
    })
}

#[cfg(test)]
mod tests;
