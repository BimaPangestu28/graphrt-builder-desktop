//! Online providers ("Online accounts") and checking the access details people connect.
//!
//! Each provider's credential is validated here (pure functions, no network) and stored as one
//! JSON value in the OS keychain (see `CredentialStore::set_deploy_account`); a short, non-secret
//! summary ("service account graphrt@acme-agents") goes to the settings table so lists never read
//! the keychain. Only Fly.io can deploy in this release; the others connect and wait for graphrt.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// Largest key file accepted (service-account JSON, kubeconfig, certificate).
pub const MAX_KEY_FILE_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeployProvider {
    Fly,
    GoogleCloud,
    Aws,
    Azure,
    Kubernetes,
}

pub const ALL_DEPLOY_PROVIDERS: [DeployProvider; 5] = [
    DeployProvider::Fly,
    DeployProvider::GoogleCloud,
    DeployProvider::Aws,
    DeployProvider::Azure,
    DeployProvider::Kubernetes,
];

impl DeployProvider {
    /// The serde name, also the keychain account suffix and the `--target` of `graphrt deploy`.
    pub fn key(self) -> &'static str {
        match self {
            Self::Fly => "fly",
            Self::GoogleCloud => "google_cloud",
            Self::Aws => "aws",
            Self::Azure => "azure",
            Self::Kubernetes => "kubernetes",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::Fly => "Fly.io",
            Self::GoogleCloud => "Google Cloud",
            Self::Aws => "AWS",
            Self::Azure => "Microsoft Azure",
            Self::Kubernetes => "Kubernetes",
        }
    }

    /// Whether the desktop can put agents online with it today (Phase 1: Fly.io only).
    pub fn can_deploy(self) -> bool {
        self == Self::Fly
    }
}

/// What the Connect dialog sends. Files arrive as paths (dropped or picked) and are read here.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "provider", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum DeployAccountInput {
    Fly {
        access_token: String,
    },
    GoogleCloud {
        key_file_path: String,
    },
    Aws {
        access_key_id: String,
        secret_access_key: String,
        #[serde(default)]
        session_token: Option<String>,
    },
    Azure {
        tenant_id: String,
        client_id: String,
        #[serde(default)]
        certificate_path: Option<String>,
        #[serde(default)]
        client_secret: Option<String>,
    },
    Kubernetes {
        kubeconfig_path: String,
        #[serde(default)]
        context: Option<String>,
    },
}

impl DeployAccountInput {
    pub fn provider(&self) -> DeployProvider {
        match self {
            Self::Fly { .. } => DeployProvider::Fly,
            Self::GoogleCloud { .. } => DeployProvider::GoogleCloud,
            Self::Aws { .. } => DeployProvider::Aws,
            Self::Azure { .. } => DeployProvider::Azure,
            Self::Kubernetes { .. } => DeployProvider::Kubernetes,
        }
    }
}

/// A checked credential: what goes to the keychain (`secret_json`) and what may be shown.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckedAccount {
    pub provider: DeployProvider,
    /// The whole credential as JSON; only ever written to the keychain.
    pub secret_json: String,
    /// Plain, non-secret summary, e.g. "service account graphrt@acme-agents".
    pub summary: String,
}

/// Reads a dropped or picked key file, refusing folders and large files.
///
/// # Errors
/// `InvalidInput` with a plain sentence when the file cannot be used.
pub fn read_key_file(path: &str) -> AppResult<String> {
    let path = std::path::Path::new(path.trim());
    let metadata = std::fs::metadata(path)
        .map_err(|_| AppError::InvalidInput(format!("Could not open {}", display_file_name(path))))?;
    if !metadata.is_file() {
        return Err(AppError::InvalidInput("Drop a file, not a folder".into()));
    }
    if metadata.len() > MAX_KEY_FILE_BYTES {
        return Err(AppError::InvalidInput("This file is too large to be a key file".into()));
    }
    std::fs::read_to_string(path).map_err(|_| AppError::InvalidInput("This file is not a text key file".into()))
}

fn display_file_name(path: &std::path::Path) -> String {
    path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| "the file".into())
}

/// Checks an input and builds what is stored. Files are read with [`read_key_file`].
///
/// # Errors
/// `InvalidInput` with a plain sentence naming what to fix.
pub fn check_account(input: &DeployAccountInput) -> AppResult<CheckedAccount> {
    let provider = input.provider();
    let (secret, summary) = match input {
        DeployAccountInput::Fly { access_token } => check_fly_token(access_token)?,
        DeployAccountInput::GoogleCloud { key_file_path } => check_google_key(&read_key_file(key_file_path)?)?,
        DeployAccountInput::Aws { access_key_id, secret_access_key, session_token } => {
            check_aws_keys(access_key_id, secret_access_key, session_token.as_deref())?
        }
        DeployAccountInput::Azure { tenant_id, client_id, certificate_path, client_secret } => {
            let certificate =
                certificate_path.as_deref().filter(|path| !path.trim().is_empty()).map(read_key_file).transpose()?;
            check_azure(tenant_id, client_id, certificate.as_deref(), client_secret.as_deref())?
        }
        DeployAccountInput::Kubernetes { kubeconfig_path, context } => {
            check_kubeconfig(&read_key_file(kubeconfig_path)?, context.as_deref())?
        }
    };
    Ok(CheckedAccount { provider, secret_json: secret.to_string(), summary })
}

fn invalid(message: &str) -> AppError {
    AppError::InvalidInput(message.to_owned())
}

/// A Fly.io access token: one line, no spaces. Fly tokens start with `FlyV1 ` (org and deploy
/// tokens) or an older bare format; the prefix `FlyV1 ` is kept as Fly prints it.
pub fn check_fly_token(token: &str) -> AppResult<(serde_json::Value, String)> {
    let token = token.trim();
    if token.is_empty() {
        return Err(invalid("Paste your Fly.io access key first"));
    }
    let body = token.strip_prefix("FlyV1 ").unwrap_or(token);
    if body.len() < 20 || body.contains(char::is_whitespace) {
        return Err(invalid("This doesn't look like a Fly.io access key. Copy the whole key from the Tokens page"));
    }
    Ok((serde_json::json!({ "token": token }), "Access key saved".into()))
}

/// A Google Cloud service-account key file (`"type": "service_account"`).
pub fn check_google_key(text: &str) -> AppResult<(serde_json::Value, String)> {
    let key: serde_json::Value =
        serde_json::from_str(text).map_err(|_| invalid("This file is not a Google Cloud key file (it is not JSON)"))?;
    if key.get("type").and_then(serde_json::Value::as_str) != Some("service_account") {
        return Err(invalid(
            "This is not a service-account key file. Create a key for a service account and drop that file",
        ));
    }
    let field = |name: &str| key.get(name).and_then(serde_json::Value::as_str).filter(|value| !value.trim().is_empty());
    let (Some(client_email), Some(project_id), Some(_private_key)) =
        (field("client_email"), field("project_id"), field("private_key"))
    else {
        return Err(invalid("This key file is missing its account, project or private key. Download a new key"));
    };
    let account = client_email.split_once(".iam.gserviceaccount.com").map_or(client_email, |(account, _)| account);
    Ok((key.clone(), format!("Service account {account} · project {project_id}")))
}

/// An AWS access key id (`AKIA…` / `ASIA…`, 16–128 characters) and its secret.
pub fn check_aws_keys(
    access_key_id: &str,
    secret_access_key: &str,
    session_token: Option<&str>,
) -> AppResult<(serde_json::Value, String)> {
    let access_key_id = access_key_id.trim();
    let secret_access_key = secret_access_key.trim();
    let id_ok = (16..=128).contains(&access_key_id.len())
        && access_key_id.bytes().all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit());
    if !id_ok {
        return Err(invalid("The access key ID looks wrong. It is about 20 capital letters and digits, like AKIA…"));
    }
    if secret_access_key.len() < 20 || secret_access_key.contains(char::is_whitespace) {
        return Err(invalid("The secret access key looks wrong. Copy it again from AWS"));
    }
    let session_token = session_token.map(str::trim).filter(|token| !token.is_empty());
    let masked_id = format!("{}…{}", &access_key_id[..4], &access_key_id[access_key_id.len() - 4..]);
    let secret = serde_json::json!({
        "accessKeyId": access_key_id,
        "secretAccessKey": secret_access_key,
        "sessionToken": session_token,
    });
    Ok((secret, format!("Access key {masked_id}")))
}

fn is_guid(text: &str) -> bool {
    let groups: Vec<&str> = text.split('-').collect();
    groups.len() == 5
        && groups
            .iter()
            .zip([8, 4, 4, 4, 12])
            .all(|(group, length)| group.len() == length && group.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

/// An Azure app registration: tenant and client ids, plus a PEM certificate with its key or a
/// client secret.
pub fn check_azure(
    tenant_id: &str,
    client_id: &str,
    certificate_pem: Option<&str>,
    client_secret: Option<&str>,
) -> AppResult<(serde_json::Value, String)> {
    let tenant_id = tenant_id.trim();
    let client_id = client_id.trim();
    if !is_guid(tenant_id) {
        return Err(invalid("The tenant ID looks wrong. It looks like 00000000-0000-0000-0000-000000000000"));
    }
    if !is_guid(client_id) {
        return Err(invalid("The app (client) ID looks wrong. It looks like 00000000-0000-0000-0000-000000000000"));
    }
    let client_secret = client_secret.map(str::trim).filter(|secret| !secret.is_empty());
    let certificate_pem = certificate_pem.map(str::trim).filter(|pem| !pem.is_empty());
    let summary = format!("App {}…", &client_id[..8]);
    match (certificate_pem, client_secret) {
        (Some(pem), _) => {
            if !pem.contains("-----BEGIN CERTIFICATE-----") || !pem.contains("PRIVATE KEY-----") {
                return Err(invalid("This file needs both the certificate and its private key (a .pem file)"));
            }
            let secret = serde_json::json!({ "tenantId": tenant_id, "clientId": client_id, "certificatePem": pem });
            Ok((secret, format!("{summary} · certificate")))
        }
        (None, Some(secret_value)) => {
            let secret =
                serde_json::json!({ "tenantId": tenant_id, "clientId": client_id, "clientSecret": secret_value });
            Ok((secret, format!("{summary} · client secret")))
        }
        (None, None) => Err(invalid("Add the certificate file, or paste a client secret instead")),
    }
}

/// The context names of a kubeconfig, in file order.
///
/// # Errors
/// `InvalidInput` when the text is not a kubeconfig with at least one context.
pub fn kubeconfig_contexts(text: &str) -> AppResult<Vec<String>> {
    let config: serde_json::Value =
        serde_saphyr::from_str(text).map_err(|_| invalid("This file is not a kubeconfig (it is not YAML)"))?;
    if config.get("kind").and_then(serde_json::Value::as_str).is_some_and(|kind| kind != "Config") {
        return Err(invalid("This file is not a kubeconfig"));
    }
    let contexts: Vec<String> = config
        .get("contexts")
        .and_then(serde_json::Value::as_array)
        .map(|contexts| {
            contexts.iter().filter_map(|context| context.get("name")?.as_str().map(str::to_owned)).collect()
        })
        .unwrap_or_default();
    if contexts.is_empty() {
        return Err(invalid("This kubeconfig has no contexts. Ask your IT team for one with a context"));
    }
    Ok(contexts)
}

/// A kubeconfig and the context to use (its `current-context`, else the first, unless chosen).
pub fn check_kubeconfig(text: &str, chosen_context: Option<&str>) -> AppResult<(serde_json::Value, String)> {
    let contexts = kubeconfig_contexts(text)?;
    let config: serde_json::Value =
        serde_saphyr::from_str(text).map_err(|_| invalid("This file is not a kubeconfig"))?;
    let current = config.get("current-context").and_then(serde_json::Value::as_str);
    let context = match chosen_context.map(str::trim).filter(|context| !context.is_empty()) {
        Some(chosen) if contexts.iter().any(|context| context == chosen) => chosen.to_owned(),
        Some(chosen) => return Err(AppError::InvalidInput(format!("The context {chosen} is not in this kubeconfig"))),
        None => current
            .filter(|current| contexts.iter().any(|context| context == current))
            .unwrap_or(&contexts[0])
            .to_owned(),
    };
    let secret = serde_json::json!({ "kubeconfig": text, "context": context });
    Ok((secret, format!("Context {context}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A placeholder PEM block (built at run time so no key-looking text sits in the source).
    fn pem_block(label: &str) -> String {
        let dashes = "-".repeat(5);
        format!("{dashes}BEGIN {label}{dashes}\nnot-real\n{dashes}END {label}{dashes}")
    }

    #[test]
    fn fly_tokens_are_trimmed_and_checked() {
        let (secret, _) = check_fly_token("  FlyV1 test_token_0123456789abcdef  ").unwrap();
        assert_eq!(secret["token"], "FlyV1 test_token_0123456789abcdef");
        assert!(check_fly_token("").is_err());
        assert!(check_fly_token("short").is_err());
        assert!(check_fly_token("has spaces inside the token value ok").is_err());
    }

    #[test]
    fn google_keys_must_be_service_accounts() {
        let key = serde_json::json!({
            "type": "service_account",
            "project_id": "acme-agents",
            "private_key": pem_block("PRIVATE KEY"),
            "client_email": "graphrt@acme-agents.iam.gserviceaccount.com",
        })
        .to_string();
        let key = key.as_str();
        let (_, summary) = check_google_key(key).unwrap();
        assert_eq!(summary, "Service account graphrt@acme-agents · project acme-agents");
        let user_key = r#"{"type":"authorized_user","client_id":"x"}"#;
        assert!(check_google_key(user_key).unwrap_err().to_string().contains("not a service-account key"));
        assert!(check_google_key("not json").unwrap_err().to_string().contains("not JSON"));
        assert!(check_google_key(r#"{"type":"service_account"}"#).is_err());
    }

    #[test]
    fn aws_keys_are_checked_and_masked() {
        let (secret, summary) = check_aws_keys("TESTACCESSKEYID00000", "test-secret-value-not-real", None).unwrap();
        assert_eq!(summary, "Access key TEST…0000");
        assert_eq!(secret["sessionToken"], serde_json::Value::Null);
        assert!(check_aws_keys("akia-lower", "test-secret-value-not-real", None).is_err());
        assert!(check_aws_keys("TESTACCESSKEYID00000", "short", None).is_err());
    }

    #[test]
    fn azure_needs_ids_and_a_certificate_or_secret() {
        let tenant = "72f988bf-86f1-41af-91ab-2d7cd011db47";
        let client = "11111111-2222-3333-4444-555555555555";
        let pem = format!("{}\n{}", pem_block("CERTIFICATE"), pem_block("PRIVATE KEY"));
        let pem = pem.as_str();
        assert!(check_azure(tenant, client, Some(pem), None).unwrap().1.ends_with("certificate"));
        assert!(check_azure(tenant, client, None, Some("s3cret~value")).unwrap().1.ends_with("client secret"));
        assert!(check_azure(tenant, client, None, None).is_err());
        assert!(check_azure("not-a-guid", client, None, Some("x")).is_err());
        let only_cert = pem_block("CERTIFICATE");
        let only_cert = only_cert.as_str();
        assert!(check_azure(tenant, client, Some(only_cert), None).unwrap_err().to_string().contains("private key"));
    }

    #[test]
    fn kubeconfigs_pick_the_current_or_chosen_context() {
        let kubeconfig = "apiVersion: v1\nkind: Config\ncurrent-context: prod\ncontexts:\n  - name: staging\n    context: { cluster: a }\n  - name: prod\n    context: { cluster: b }\n";
        assert_eq!(kubeconfig_contexts(kubeconfig).unwrap(), ["staging", "prod"]);
        assert_eq!(check_kubeconfig(kubeconfig, None).unwrap().1, "Context prod");
        assert_eq!(check_kubeconfig(kubeconfig, Some("staging")).unwrap().1, "Context staging");
        assert!(check_kubeconfig(kubeconfig, Some("other")).is_err());
        assert!(kubeconfig_contexts("apiVersion: v1\nkind: Config\n").is_err());
        assert!(kubeconfig_contexts("{ not: [valid").is_err());
    }

    #[test]
    fn key_files_must_be_small_regular_files() {
        let temp = tempfile::tempdir().unwrap();
        assert!(read_key_file(temp.path().to_str().unwrap()).unwrap_err().to_string().contains("not a folder"));
        let big = temp.path().join("big.json");
        std::fs::write(&big, vec![b'a'; (MAX_KEY_FILE_BYTES + 1) as usize]).unwrap();
        assert!(read_key_file(big.to_str().unwrap()).unwrap_err().to_string().contains("too large"));
        let key = temp.path().join("key.json");
        std::fs::write(&key, "{}").unwrap();
        assert_eq!(read_key_file(key.to_str().unwrap()).unwrap(), "{}");
        assert!(read_key_file("/definitely/missing.json").is_err());
    }

    #[test]
    fn inputs_deserialize_from_the_connect_dialog() {
        let input: DeployAccountInput = serde_json::from_value(
            serde_json::json!({ "provider": "aws", "accessKeyId": "A", "secretAccessKey": "B" }),
        )
        .unwrap();
        assert_eq!(input.provider(), DeployProvider::Aws);
        let input: DeployAccountInput =
            serde_json::from_value(serde_json::json!({ "provider": "google_cloud", "keyFilePath": "/k.json" }))
                .unwrap();
        assert_eq!(input, DeployAccountInput::GoogleCloud { key_file_path: "/k.json".into() });
    }
}
