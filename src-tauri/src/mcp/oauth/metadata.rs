//! Discovery: MCP server -> protected resource metadata (RFC 9728) ->
//! authorization server metadata (RFC 8414, or OpenID Connect discovery).

use serde::Deserialize;
use url::Url;

use super::client::OAuthHttp;
use super::OAuthError;

/// Everything a sign-in needs to know about a server's authorization.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Discovery {
    /// The protected resource (sent as `resource`, RFC 8707).
    pub resource: String,
    /// The authorization server's issuer identifier.
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub registration_endpoint: Option<String>,
    pub revocation_endpoint: Option<String>,
    pub client_id_metadata_document_supported: bool,
    /// Scopes to request (the resource's `scopes_supported`, space separated), if any.
    pub scope: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProtectedResourceMetadata {
    resource: Option<String>,
    #[serde(default)]
    authorization_servers: Vec<String>,
    #[serde(default)]
    scopes_supported: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct AuthorizationServerMetadata {
    issuer: Option<String>,
    authorization_endpoint: Option<String>,
    token_endpoint: Option<String>,
    registration_endpoint: Option<String>,
    revocation_endpoint: Option<String>,
    #[serde(default)]
    code_challenge_methods_supported: Option<Vec<String>>,
    #[serde(default)]
    client_id_metadata_document_supported: bool,
}

/// Finds how to sign in to the MCP server at `server_url`.
///
/// # Errors
/// `Discovery` when the server does not ask for a sign-in, or its metadata is
/// missing, unreadable or unsafe (an endpoint that is not https).
pub async fn discover(http: &OAuthHttp, server_url: &str) -> Result<Discovery, OAuthError> {
    let server = parse_url(server_url, "the server address")?;
    let challenge = http.probe_challenge(server_url).await?;
    let (resource_metadata, challenge_scope) = match challenge {
        Probe::Challenge { resource_metadata: Some(url), scope } => (vec![url], scope),
        Probe::Challenge { resource_metadata: None, scope } => {
            (well_known_urls(&server, "oauth-protected-resource"), scope)
        }
        Probe::Redirect { status } => {
            return Err(OAuthError::Discovery(format!(
                "the server answered with a redirect (HTTP {status}); enter the address it redirects to"
            )))
        }
        Probe::NoSignInNeeded => {
            return Err(OAuthError::Discovery(
                "this server does not ask for a sign-in; use no authentication or a bearer token".into(),
            ))
        }
    };
    let resource = fetch_first::<ProtectedResourceMetadata>(http, &resource_metadata).await;
    let (resource_id, issuer, scope) = match resource {
        Some(metadata) => {
            let issuer = metadata.authorization_servers.first().cloned().ok_or_else(|| {
                OAuthError::Discovery("the server's resource metadata names no authorization server".into())
            })?;
            // The MCP spec: the scope of the challenge first, else everything the resource supports.
            let supported = (!metadata.scopes_supported.is_empty()).then(|| metadata.scopes_supported.join(" "));
            let scope = challenge_scope.or(supported);
            let resource = metadata.resource.unwrap_or_else(|| server_url.to_owned());
            // RFC 9728 §3.3: metadata for another resource must not be used (tokens are bound to it).
            // A resource that covers the server (same origin, a parent path) is fine.
            if !covers_resource(&resource, server_url) {
                return Err(OAuthError::Discovery(format!(
                    "the server's sign-in settings are for {resource}, not {server_url}; not signing in"
                )));
            }
            (resource, issuer, scope)
        }
        // Servers from before RFC 9728 act as their own authorization server.
        None => (server_url.to_owned(), origin(&server), challenge_scope),
    };
    let issuer_url = parse_url(&issuer, "the authorization server")?;
    require_safe(&issuer_url, "the authorization server")?;
    let mut candidates = well_known_urls(&issuer_url, "oauth-authorization-server");
    candidates.extend(well_known_urls(&issuer_url, "openid-configuration"));
    let metadata = fetch_first::<AuthorizationServerMetadata>(http, &candidates).await.ok_or_else(|| {
        OAuthError::Discovery(format!("could not read the sign-in settings of {}", origin(&issuer_url)))
    })?;
    build_discovery(resource_id, issuer, scope, metadata)
}

fn build_discovery(
    resource: String,
    issuer: String,
    scope: Option<String>,
    metadata: AuthorizationServerMetadata,
) -> Result<Discovery, OAuthError> {
    if let Some(stated) = &metadata.issuer {
        if stated.trim_end_matches('/') != issuer.trim_end_matches('/') {
            return Err(OAuthError::Discovery(format!(
                "the authorization server says it is {stated}, not {issuer}; not signing in"
            )));
        }
    }
    if let Some(methods) = &metadata.code_challenge_methods_supported {
        if !methods.iter().any(|method| method == "S256") {
            return Err(OAuthError::Discovery("the sign-in server does not support PKCE (S256)".into()));
        }
    }
    let required = |value: Option<String>, name: &str| -> Result<String, OAuthError> {
        let value = value.ok_or_else(|| OAuthError::Discovery(format!("the sign-in server has no {name}")))?;
        require_safe(&parse_url(&value, name)?, name)?;
        Ok(value)
    };
    let optional = |value: Option<String>, name: &str| -> Result<Option<String>, OAuthError> {
        value.map(|value| required(Some(value), name)).transpose()
    };
    Ok(Discovery {
        resource,
        issuer,
        authorization_endpoint: required(metadata.authorization_endpoint, "authorization endpoint")?,
        token_endpoint: required(metadata.token_endpoint, "token endpoint")?,
        registration_endpoint: optional(metadata.registration_endpoint, "registration endpoint")?,
        revocation_endpoint: optional(metadata.revocation_endpoint, "revocation endpoint")?,
        client_id_metadata_document_supported: metadata.client_id_metadata_document_supported,
        scope,
    })
}

/// What an unauthenticated request to the MCP server returned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Probe {
    /// HTTP 401, with the `resource_metadata` and `scope` of its `WWW-Authenticate` header when present.
    Challenge { resource_metadata: Option<String>, scope: Option<String> },
    /// A 3xx: the address is not the server's endpoint.
    Redirect { status: u16 },
    /// Anything else: the server works without a sign-in.
    NoSignInNeeded,
}

/// The `resource_metadata` parameter of a `WWW-Authenticate: Bearer ...` header.
pub fn resource_metadata_parameter(header: &str) -> Option<String> {
    challenge_parameter(header, "resource_metadata")
}

/// A parameter (`name=value` or `name="value"`) of a `WWW-Authenticate` header.
pub fn challenge_parameter(header: &str, name: &str) -> Option<String> {
    let lower = header.to_ascii_lowercase();
    let key = format!("{name}=");
    // A whole parameter name: at the start, or after a space or comma.
    let found = lower
        .match_indices(&key)
        .map(|(index, _)| index)
        .find(|&index| index == 0 || lower.as_bytes().get(index - 1).is_some_and(|byte| matches!(byte, b' ' | b',')))?;
    let start = found + key.len();
    let rest = header.get(start..)?;
    let value = match rest.strip_prefix('"') {
        Some(quoted) => quoted.split('"').next()?,
        None => rest.split([',', ' ']).next()?,
    };
    (!value.is_empty()).then(|| value.to_owned())
}

/// `<origin>/.well-known/<name><path>` (RFC 8414 / 9728 path insertion), then
/// `<origin>/.well-known/<name>` when the URL has a path.
pub fn well_known_urls(base: &Url, name: &str) -> Vec<String> {
    let path = base.path().trim_end_matches('/');
    let mut urls = Vec::with_capacity(2);
    if !path.is_empty() {
        urls.push(format!("{}/.well-known/{name}{path}", origin(base)));
    }
    urls.push(format!("{}/.well-known/{name}", origin(base)));
    urls
}

/// Whether the resource `stated` (from the metadata) covers `server_url`: the
/// same origin, and the same path or a parent path (`https://host` covers
/// `https://host/mcp`), ignoring a trailing `/` and the case of scheme and host.
pub(crate) fn covers_resource(stated: &str, server_url: &str) -> bool {
    match (Url::parse(stated), Url::parse(server_url)) {
        (Ok(stated), Ok(server)) => {
            let stated_path = stated.path().trim_end_matches('/');
            let server_path = server.path().trim_end_matches('/');
            let path_covers = server_path == stated_path
                || server_path.strip_prefix(stated_path).is_some_and(|rest| rest.starts_with('/'));
            stated.origin() == server.origin()
                && path_covers
                && (stated.query().is_none() || stated.query() == server.query())
        }
        _ => false,
    }
}

fn origin(url: &Url) -> String {
    url.origin().ascii_serialization()
}

fn parse_url(value: &str, what: &str) -> Result<Url, OAuthError> {
    Url::parse(value).map_err(|_| OAuthError::Discovery(format!("{what} is not a valid address: {value}")))
}

/// https, or http to this computer (local servers and tests).
pub fn require_safe(url: &Url, what: &str) -> Result<(), OAuthError> {
    let loopback = url.host_str().is_some_and(|host| {
        let host = host.trim_start_matches('[').trim_end_matches(']');
        host.eq_ignore_ascii_case("localhost") || host.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback())
    });
    match url.scheme() {
        "https" => Ok(()),
        "http" if loopback => Ok(()),
        _ => Err(OAuthError::Discovery(format!("{what} must use https:// ({url})"))),
    }
}

/// The first of `urls` that answers 200 with JSON of type `T`.
async fn fetch_first<T: for<'de> Deserialize<'de>>(http: &OAuthHttp, urls: &[String]) -> Option<T> {
    for url in urls {
        let Ok(parsed) = Url::parse(url) else { continue };
        if require_safe(&parsed, "metadata").is_err() {
            continue;
        }
        match http.get_json::<T>(url).await {
            Ok(Some(value)) => return Some(value),
            Ok(None) => continue,
            Err(error) => log::debug!("OAuth metadata at {url} not usable: {error}"),
        }
    }
    None
}
