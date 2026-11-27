//! Where a phone can reach this computer: its address on the local network, and the
//! person's own Tailscale (detected with the `tailscale` command line, never installed or
//! configured behind their back).
//!
//! On a tailnet with HTTPS certificates, Tailscale itself terminates HTTPS with a real
//! `*.ts.net` certificate (`tailscale serve`) and hands the requests to this computer's
//! loopback address, so the app never holds a certificate or a key for it. Without them
//! (or when the person may not change Tailscale's settings), the page is served on the
//! tailnet address over plain HTTP: still encrypted end to end by WireGuard, but browsers
//! do not count it as a secure origin, so phones get no notifications there.

use std::net::{IpAddr, Ipv4Addr};
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// How long one `tailscale` command may take (it talks to the local daemon only).
const TAILSCALE_TIMEOUT: Duration = Duration::from_secs(8);

/// Interface names of virtual networks a phone never sits on (containers, VMs, VPNs).
const VIRTUAL_INTERFACE_PREFIXES: &[&str] = &[
    "docker",
    "br-",
    "veth",
    "virbr",
    "vmnet",
    "vboxnet",
    "lxc",
    "lxd",
    "cni",
    "flannel",
    "podman",
    "tailscale",
    "utun",
    "tun",
    "tap",
    "wg",
    "zt",
    "nordlynx",
    "ham",
    "awdl",
    "llw",
    "bridge",
    "vEthernet",
];

/// A private IPv4 address of this computer on a network a phone can join (Wi-Fi or cable),
/// or `None` when it has none (offline, or only virtual networks).
pub fn lan_address() -> Option<Ipv4Addr> {
    let candidates: Vec<(String, Ipv4Addr)> = match if_addrs::get_if_addrs() {
        Ok(interfaces) => interfaces
            .into_iter()
            .filter_map(|interface| match interface.ip() {
                IpAddr::V4(address) => Some((interface.name, address)),
                IpAddr::V6(_) => None,
            })
            .collect(),
        Err(error) => {
            log::warn!("phone access: cannot list network interfaces: {error}");
            Vec::new()
        }
    };
    pick_lan_address(&candidates, routed_address())
}

/// The source address the system would use towards the internet. Connecting a UDP socket
/// sends nothing; it only asks the routing table.
fn routed_address() -> Option<Ipv4Addr> {
    let socket = std::net::UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    // TEST-NET-1 (RFC 5737): never answered, nothing is sent by `connect` anyway.
    socket.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(address) => Some(address),
        IpAddr::V6(_) => None,
    }
}

/// A private address of a real interface: the routed one when it is such, else the first.
fn pick_lan_address(candidates: &[(String, Ipv4Addr)], routed: Option<Ipv4Addr>) -> Option<Ipv4Addr> {
    let usable: Vec<Ipv4Addr> = candidates
        .iter()
        .filter(|(name, address)| is_lan_ipv4(*address) && !is_virtual_interface(name))
        .map(|(_, address)| *address)
        .collect();
    routed.filter(|address| usable.contains(address)).or_else(|| usable.first().copied())
}

/// RFC 1918 private addresses (Tailscale's 100.64.0.0/10 is not one).
pub fn is_lan_ipv4(address: Ipv4Addr) -> bool {
    address.is_private() && !address.is_loopback()
}

fn is_virtual_interface(name: &str) -> bool {
    VIRTUAL_INTERFACE_PREFIXES.iter().any(|prefix| name.starts_with(prefix))
}

/// What Tailscale offers on this computer.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TailscaleInfo {
    /// The `tailscale` command was found.
    pub installed: bool,
    /// Signed in and connected.
    pub running: bool,
    /// This computer's name on the tailnet (`laptop.tailnet-1234.ts.net`).
    pub dns_name: Option<String>,
    /// Its tailnet IPv4 address (`100.x.y.z`).
    pub address: Option<Ipv4Addr>,
    /// MagicDNS is on: phones on the tailnet find `dns_name`.
    pub magic_dns: bool,
    /// The tailnet has HTTPS certificates turned on (needed for `tailscale serve`).
    pub https_certificates: bool,
}

impl TailscaleInfo {
    /// The host phones should use: the name with MagicDNS, else the address.
    pub fn host(&self) -> Option<String> {
        match (&self.dns_name, self.magic_dns, self.address) {
            (Some(name), true, _) => Some(name.clone()),
            (_, _, Some(address)) => Some(address.to_string()),
            _ => None,
        }
    }
}

/// Reads `tailscale status --json`.
pub fn parse_tailscale_status(json: &str) -> TailscaleInfo {
    let Ok(status) = serde_json::from_str::<serde_json::Value>(json) else {
        return TailscaleInfo { installed: true, ..TailscaleInfo::default() };
    };
    let me = status.get("Self");
    let dns_name = me
        .and_then(|me| me.get("DNSName"))
        .and_then(serde_json::Value::as_str)
        .map(|name| name.trim_end_matches('.').to_ascii_lowercase())
        .filter(|name| !name.is_empty());
    let address = me
        .and_then(|me| me.get("TailscaleIPs"))
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .find_map(|text| text.parse::<Ipv4Addr>().ok());
    let magic_dns = status
        .get("CurrentTailnet")
        .and_then(|tailnet| tailnet.get("MagicDNSEnabled"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let https_certificates = status
        .get("CertDomains")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|domains| domains.iter().filter_map(serde_json::Value::as_str).any(|domain| !domain.is_empty()));
    TailscaleInfo {
        installed: true,
        running: status.get("BackendState").and_then(serde_json::Value::as_str) == Some("Running"),
        dns_name,
        address,
        magic_dns,
        https_certificates,
    }
}

/// Why `tailscale serve` was refused, in words the settings screen shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServeProblem {
    /// Only an administrator (or the Tailscale "operator") may change what is served.
    NotOperator,
    /// HTTPS certificates or Serve are off for the tailnet.
    NotEnabledOnTailnet,
    Other(String),
}

impl ServeProblem {
    pub fn message(&self) -> String {
        match self {
            Self::NotOperator => "Tailscale only lets an administrator share the page with HTTPS. Run \
                                  \"sudo tailscale set --operator=$USER\" once, then turn Phone access off and on."
                .to_owned(),
            Self::NotEnabledOnTailnet => "HTTPS is off for your tailnet. Turn on \"HTTPS Certificates\" in the \
                                          Tailscale admin console (DNS page), then turn Phone access off and on."
                .to_owned(),
            Self::Other(detail) => format!("Tailscale could not share the page with HTTPS: {detail}"),
        }
    }
}

/// Reads why `tailscale serve` failed from what it printed.
pub fn classify_serve_failure(output: &str) -> ServeProblem {
    let lowercase = output.to_ascii_lowercase();
    if lowercase.contains("access denied") || lowercase.contains("permission denied") || lowercase.contains("operator")
    {
        return ServeProblem::NotOperator;
    }
    if lowercase.contains("not enabled") || lowercase.contains("https cert") || lowercase.contains("to enable") {
        return ServeProblem::NotEnabledOnTailnet;
    }
    let first_line = output.lines().map(str::trim).find(|line| !line.is_empty()).unwrap_or("no details");
    ServeProblem::Other(first_line.chars().take(200).collect())
}

/// The Tailscale command line of this computer.
#[derive(Debug, Clone)]
pub struct TailscaleCli {
    program: PathBuf,
}

impl TailscaleCli {
    /// Finds `tailscale`: on `PATH`, or where the official installers put it.
    pub fn find() -> Option<Self> {
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Some(paths) = std::env::var_os("PATH") {
            for directory in std::env::split_paths(&paths) {
                candidates.push(directory.join(if cfg!(windows) { "tailscale.exe" } else { "tailscale" }));
            }
        }
        if cfg!(target_os = "macos") {
            candidates.push(PathBuf::from("/Applications/Tailscale.app/Contents/MacOS/Tailscale"));
            candidates.push(PathBuf::from("/opt/homebrew/bin/tailscale"));
            candidates.push(PathBuf::from("/usr/local/bin/tailscale"));
        }
        if cfg!(windows) {
            candidates.push(PathBuf::from(r"C:\Program Files\Tailscale\tailscale.exe"));
        }
        candidates.into_iter().find(|path| path.is_file()).map(|program| Self { program })
    }

    /// What Tailscale offers right now.
    pub async fn status(&self) -> TailscaleInfo {
        match self.run(&["status", "--json"]).await {
            Ok((_, stdout, _)) => parse_tailscale_status(&stdout),
            Err(error) => {
                log::info!("phone access: tailscale status: {error}");
                TailscaleInfo { installed: true, ..TailscaleInfo::default() }
            }
        }
    }

    /// Shares `http://127.0.0.1:<port>` on the tailnet as `https://<name>:<port>`.
    ///
    /// # Errors
    /// Why Tailscale refused.
    pub async fn serve(&self, port: u16) -> Result<(), ServeProblem> {
        let https = format!("--https={port}");
        let target = format!("http://127.0.0.1:{port}");
        match self.run(&["serve", "--bg", "--yes", &https, &target]).await {
            Ok((true, _, _)) => Ok(()),
            Ok((false, stdout, stderr)) => Err(classify_serve_failure(&format!("{stderr}\n{stdout}"))),
            Err(error) => Err(ServeProblem::Other(error)),
        }
    }

    /// Stops sharing what [`Self::serve`] shared on `port` (only that port).
    pub async fn stop_serving(&self, port: u16) {
        let https = format!("--https={port}");
        match self.run(&["serve", "--yes", &https, "off"]).await {
            Ok((true, _, _)) => {}
            Ok((false, _, stderr)) => log::info!("phone access: tailscale serve off: {}", stderr.trim()),
            Err(error) => log::info!("phone access: tailscale serve off: {error}"),
        }
    }

    /// Runs `tailscale <args>` without a terminal (it never waits for input).
    async fn run(&self, args: &[&str]) -> Result<(bool, String, String), String> {
        let mut command = tokio::process::Command::new(&self.program);
        command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
        let output = tokio::time::timeout(TAILSCALE_TIMEOUT, command.output())
            .await
            .map_err(|_| "tailscale did not answer in time".to_owned())?
            .map_err(|error| format!("cannot run tailscale: {error}"))?;
        Ok((
            output.status.success(),
            String::from_utf8_lossy(&output.stdout).into_owned(),
            String::from_utf8_lossy(&output.stderr).into_owned(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn named(name: &str, address: [u8; 4]) -> (String, Ipv4Addr) {
        (name.to_owned(), Ipv4Addr::from(address))
    }

    #[test]
    fn the_wifi_address_is_picked_over_containers_and_tailscale() {
        let candidates = [
            named("lo", [127, 0, 0, 1]),
            named("docker0", [172, 17, 0, 1]),
            named("br-714f91ce99e8", [192, 168, 16, 1]),
            named("tailscale0", [100, 79, 4, 107]),
            named("wlp0s20f3", [192, 168, 1, 21]),
        ];
        assert_eq!(pick_lan_address(&candidates, None), Some(Ipv4Addr::new(192, 168, 1, 21)));
        // A VPN as the default route is not a network a phone sits on.
        assert_eq!(
            pick_lan_address(&candidates, Some(Ipv4Addr::new(10, 5, 0, 2))),
            Some(Ipv4Addr::new(192, 168, 1, 21))
        );
    }

    #[test]
    fn the_routed_address_wins_when_several_networks_are_real() {
        let candidates = [named("eth0", [10, 0, 0, 5]), named("wlan0", [192, 168, 1, 21])];
        assert_eq!(
            pick_lan_address(&candidates, Some(Ipv4Addr::new(192, 168, 1, 21))),
            Some(Ipv4Addr::new(192, 168, 1, 21))
        );
    }

    #[test]
    fn no_address_without_a_private_network() {
        let candidates =
            [named("lo", [127, 0, 0, 1]), named("eth0", [203, 0, 113, 7]), named("tailscale0", [100, 64, 0, 1])];
        assert_eq!(pick_lan_address(&candidates, Some(Ipv4Addr::new(203, 0, 113, 7))), None);
    }

    #[test]
    fn tailscale_status_is_read() {
        let json = r#"{
            "BackendState": "Running",
            "Self": {"DNSName": "Laptop.tail0f0add.ts.net.", "TailscaleIPs": ["fd7a:115c:a1e0::1", "100.79.4.107"]},
            "CurrentTailnet": {"MagicDNSEnabled": true},
            "CertDomains": ["laptop.tail0f0add.ts.net"]
        }"#;
        let info = parse_tailscale_status(json);
        assert!(info.installed && info.running && info.magic_dns && info.https_certificates);
        assert_eq!(info.dns_name.as_deref(), Some("laptop.tail0f0add.ts.net"));
        assert_eq!(info.address, Some(Ipv4Addr::new(100, 79, 4, 107)));
        assert_eq!(info.host().as_deref(), Some("laptop.tail0f0add.ts.net"));
    }

    #[test]
    fn a_stopped_tailscale_without_certificates_or_magic_dns() {
        let json = r#"{"BackendState": "Stopped", "Self": {"TailscaleIPs": ["100.79.4.107"]}, "CertDomains": null}"#;
        let info = parse_tailscale_status(json);
        assert!(info.installed && !info.running && !info.https_certificates && !info.magic_dns);
        assert_eq!(info.host().as_deref(), Some("100.79.4.107"));
        assert_eq!(parse_tailscale_status("not json"), TailscaleInfo { installed: true, ..TailscaleInfo::default() });
    }

    #[test]
    fn serve_failures_are_told_apart() {
        assert_eq!(classify_serve_failure("Access denied: serve config denied"), ServeProblem::NotOperator);
        assert_eq!(
            classify_serve_failure(
                "Serve is not enabled on your tailnet.\nTo enable, visit: https://login.tailscale.com/f/serve"
            ),
            ServeProblem::NotEnabledOnTailnet
        );
        assert_eq!(classify_serve_failure("\n  boom  \nmore"), ServeProblem::Other("boom".to_owned()));
    }
}
