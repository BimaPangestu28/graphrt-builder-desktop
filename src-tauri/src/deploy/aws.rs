//! AWS Lambda as a place to put agents online (`graphrt deploy --target lambda --direct`).
//!
//! - Connecting: an IAM user's access key (pasted, or read from a profile of `~/.aws` on this
//!   computer), checked with AWS (`sts:GetCallerIdentity`, signed here with Signature V4) and
//!   kept in the OS keychain (`account:aws`). Each `graphrt` call gets it as
//!   `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (/ `AWS_SESSION_TOKEN`) plus `--region`.
//! - Picking where: an AWS region (Jakarta first, or the one closest to this computer).
//! - Errors: the CLI's codes (`permission_denied`, `unauthorized`, `account_not_ready`...) become
//!   a [`DeployProblem`] with plain words and a fix (reconnect, or the right console page).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::google_cloud::{DeployFix, DeployProblem};
use super::providers::DeployProvider;
use crate::error::{AppError, AppResult};

/// The region a first deploy suggests: Jakarta.
pub const DEFAULT_REGION: &str = "ap-southeast-3";
const STS_URL: &str = "https://sts.amazonaws.com/";
const STS_HOST: &str = "sts.amazonaws.com";
const STS_BODY: &str = "Action=GetCallerIdentity&Version=2011-06-15";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
/// Where the minimum IAM policy is explained (and the policy itself).
pub const IAM_POLICY_DOCS_URL: &str =
    "https://github.com/Graphrt/graphrt/blob/main/docs/deploy-direct-aws.md#iam-policy";

/// A region code such as `ap-southeast-3`, `us-east-1` or `us-gov-west-1`.
pub fn is_region(region: &str) -> bool {
    let parts: Vec<&str> = region.split('-').collect();
    let Some((number, words)) = parts.split_last() else { return false };
    (2..=3).contains(&words.len())
        && words.iter().all(|word| !word.is_empty() && word.bytes().all(|byte| byte.is_ascii_lowercase()))
        && (1..=2).contains(&number.len())
        && number.bytes().all(|byte| byte.is_ascii_digit())
}

/// The region with its code checked.
///
/// # Errors
/// `InvalidInput` with a plain sentence.
pub fn checked_region(region: Option<&str>) -> AppResult<String> {
    let region = region.map(str::trim).filter(|region| !region.is_empty()).unwrap_or_default();
    if !is_region(region) {
        return Err(AppError::InvalidInput(format!("Pick an AWS region such as {DEFAULT_REGION} first")));
    }
    Ok(region.to_owned())
}

// ---- keys ----

/// What is kept in the keychain for AWS (the whole value is the secret).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AwsKeys {
    pub access_key_id: String,
    pub secret_access_key: String,
    #[serde(default)]
    pub session_token: Option<String>,
}

impl AwsKeys {
    /// The variables the graphrt process gets.
    pub fn environment(&self) -> Vec<(String, String)> {
        let mut environment = vec![
            ("AWS_ACCESS_KEY_ID".to_owned(), self.access_key_id.clone()),
            ("AWS_SECRET_ACCESS_KEY".to_owned(), self.secret_access_key.clone()),
        ];
        if let Some(token) = self.session_token.as_ref().filter(|token| !token.is_empty()) {
            environment.push(("AWS_SESSION_TOKEN".to_owned(), token.clone()));
        }
        environment
    }

    /// `AKIA…WXYZ`.
    pub fn masked_id(&self) -> String {
        let id = &self.access_key_id;
        if id.len() < 8 {
            return "…".into();
        }
        format!("{}…{}", &id[..4], &id[id.len() - 4..])
    }
}

/// Who the keys belong to, as AWS says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Caller {
    pub account: String,
    pub arn: String,
}

impl Caller {
    /// `user graphrt-deployer` from `arn:aws:iam::123:user/graphrt-deployer`, `root user`, ...
    pub fn identity(&self) -> String {
        let resource = self.arn.rsplit(':').next().unwrap_or_default();
        if resource == "root" {
            return "root user".into();
        }
        match resource.split_once('/') {
            Some(("user", name)) => format!("user {name}"),
            Some(("assumed-role", rest)) => format!("role {}", rest.split('/').next().unwrap_or(rest)),
            _ => resource.to_owned(),
        }
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// HMAC-SHA256 (RFC 2104).
pub fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    const BLOCK: usize = 64;
    let mut block_key = [0u8; BLOCK];
    if key.len() > BLOCK {
        block_key[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        block_key[..key.len()].copy_from_slice(key);
    }
    let mut inner = Sha256::new();
    inner.update(block_key.map(|byte| byte ^ 0x36));
    inner.update(data);
    let inner = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(block_key.map(|byte| byte ^ 0x5c));
    outer.update(inner);
    outer.finalize().into()
}

/// The headers of a Signature V4 signed `sts:GetCallerIdentity` (us-east-1, the global endpoint).
pub fn signed_identity_headers(keys: &AwsKeys, now: chrono::DateTime<chrono::Utc>) -> Vec<(String, String)> {
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date = now.format("%Y%m%d").to_string();
    let content_type = "application/x-www-form-urlencoded; charset=utf-8";
    let token = keys.session_token.as_deref().filter(|token| !token.is_empty());
    let mut canonical_headers = format!("content-type:{content_type}\nhost:{STS_HOST}\nx-amz-date:{amz_date}\n");
    let mut signed_headers = "content-type;host;x-amz-date".to_owned();
    if let Some(token) = token {
        canonical_headers.push_str(&format!("x-amz-security-token:{token}\n"));
        signed_headers.push_str(";x-amz-security-token");
    }
    let canonical_request =
        format!("POST\n/\n\n{canonical_headers}\n{signed_headers}\n{}", hex(&Sha256::digest(STS_BODY.as_bytes())));
    let scope = format!("{date}/us-east-1/sts/aws4_request");
    let string_to_sign =
        format!("AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}", hex(&Sha256::digest(canonical_request.as_bytes())));
    let mut key = hmac_sha256(format!("AWS4{}", keys.secret_access_key).as_bytes(), date.as_bytes());
    for part in ["us-east-1", "sts", "aws4_request"] {
        key = hmac_sha256(&key, part.as_bytes());
    }
    let signature = hex(&hmac_sha256(&key, string_to_sign.as_bytes()));
    let mut headers = vec![
        ("content-type".to_owned(), content_type.to_owned()),
        ("x-amz-date".to_owned(), amz_date),
        (
            "authorization".to_owned(),
            format!(
                "AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders={signed_headers}, Signature={signature}",
                keys.access_key_id
            ),
        ),
    ];
    if let Some(token) = token {
        headers.push(("x-amz-security-token".to_owned(), token.to_owned()));
    }
    headers
}

fn xml_value<'a>(body: &'a str, tag: &str) -> Option<&'a str> {
    let start = body.find(&format!("<{tag}>"))? + tag.len() + 2;
    let end = body[start..].find(&format!("</{tag}>"))? + start;
    Some(body[start..end].trim())
}

/// AWS's answer to `sts:GetCallerIdentity`, as who the keys are or a plain refusal.
///
/// # Errors
/// `InvalidInput` with what to fix when AWS refuses the keys.
pub fn read_identity_answer(status: u16, body: &str) -> AppResult<Caller> {
    if (200..300).contains(&status) {
        return match (xml_value(body, "Account"), xml_value(body, "Arn")) {
            (Some(account), Some(arn)) => Ok(Caller { account: account.to_owned(), arn: arn.to_owned() }),
            _ => Err(AppError::Internal("AWS answered without saying whose keys these are".into())),
        };
    }
    let code = xml_value(body, "Code").unwrap_or_default();
    Err(AppError::InvalidInput(match code {
        "InvalidClientTokenId" => "AWS doesn't know this access key ID. Copy it again, or make a new access key in the AWS console (IAM, Users, Security credentials)".into(),
        "SignatureDoesNotMatch" => "The secret access key doesn't belong to this access key ID. Copy the secret again (AWS shows it only once: make a new key if it is lost)".into(),
        "ExpiredToken" | "ExpiredTokenException" => "These temporary keys have expired. Get new ones and connect again".into(),
        _ => format!("AWS refused these keys ({}). Check them and try again", if code.is_empty() { status.to_string() } else { code.to_owned() }),
    }))
}

/// Asks AWS whose keys these are (read only, free, needs no permission).
///
/// # Errors
/// `InvalidInput` when AWS refuses the keys; `Internal` when AWS cannot be reached.
pub async fn check_keys_online(keys: &AwsKeys) -> AppResult<Caller> {
    let _already_installed = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(REQUEST_TIMEOUT)
        .user_agent(concat!("graphrt-desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| AppError::Internal(format!("could not set up the AWS check: {error}")))?;
    let mut request = client.post(STS_URL).body(STS_BODY);
    for (name, value) in signed_identity_headers(keys, chrono::Utc::now()) {
        request = request.header(name, value);
    }
    let response = request.send().await.map_err(|_| {
        AppError::Internal("AWS could not be reached to check the keys. Check the internet connection".into())
    })?;
    let status = response.status().as_u16();
    let body = response.text().await.unwrap_or_default();
    read_identity_answer(status, &body)
}

// ---- profiles of ~/.aws ----

/// A profile of `~/.aws/credentials` / `~/.aws/config` on this computer (never its keys).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AwsProfile {
    pub name: String,
    pub region: Option<String>,
    /// It holds an access key the app can use.
    pub has_keys: bool,
}

type Sections = BTreeMap<String, BTreeMap<String, String>>;

/// An INI file of the AWS CLI. `config` names sections `profile <name>` (but `default`).
fn parse_ini(text: &str, is_config: bool) -> Sections {
    let mut sections = Sections::new();
    let mut current: Option<String> = None;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if let Some(header) = line.strip_prefix('[').and_then(|rest| rest.strip_suffix(']')) {
            let header = header.trim();
            let name =
                if is_config { header.strip_prefix("profile ").map(str::trim).unwrap_or(header) } else { header };
            current = Some(name.to_owned());
            sections.entry(name.to_owned()).or_default();
            continue;
        }
        if let (Some(section), Some((key, value))) = (&current, line.split_once('=')) {
            sections
                .entry(section.clone())
                .or_default()
                .insert(key.trim().to_ascii_lowercase(), value.trim().to_owned());
        }
    }
    sections
}

/// `~/.aws/credentials` and `~/.aws/config` (or `AWS_SHARED_CREDENTIALS_FILE` / `AWS_CONFIG_FILE`).
fn aws_files(home: Option<&Path>, environment: &dyn Fn(&str) -> Option<String>) -> (Option<PathBuf>, Option<PathBuf>) {
    let file = |variable: &str, name: &str| {
        environment(variable)
            .filter(|path| !path.is_empty())
            .map(PathBuf::from)
            .or_else(|| home.map(|home| home.join(".aws").join(name)))
    };
    (file("AWS_SHARED_CREDENTIALS_FILE", "credentials"), file("AWS_CONFIG_FILE", "config"))
}

fn read_sections(path: Option<&Path>, is_config: bool) -> Sections {
    path.and_then(|path| std::fs::read_to_string(path).ok()).map(|text| parse_ini(&text, is_config)).unwrap_or_default()
}

fn keys_of(section: &BTreeMap<String, String>) -> Option<AwsKeys> {
    let id = section.get("aws_access_key_id").filter(|value| !value.is_empty())?;
    let secret = section.get("aws_secret_access_key").filter(|value| !value.is_empty())?;
    Some(AwsKeys {
        access_key_id: id.clone(),
        secret_access_key: secret.clone(),
        session_token: section.get("aws_session_token").filter(|value| !value.is_empty()).cloned(),
    })
}

/// The profiles in these files, sorted by name (`default` first).
pub fn profiles_in(credentials: &str, config: &str) -> Vec<AwsProfile> {
    let credentials = parse_ini(credentials, false);
    let config = parse_ini(config, true);
    let mut names: Vec<&String> = credentials.keys().chain(config.keys()).collect();
    names.sort_by_key(|name| (name.as_str() != "default", name.to_lowercase()));
    names.dedup();
    names
        .into_iter()
        .map(|name| {
            let keys = credentials.get(name).and_then(keys_of).or_else(|| config.get(name).and_then(keys_of));
            AwsProfile {
                name: name.clone(),
                region: config
                    .get(name)
                    .and_then(|section| section.get("region"))
                    .filter(|region| is_region(region))
                    .cloned(),
                has_keys: keys.is_some(),
            }
        })
        .collect()
}

/// The AWS profiles of this computer's user.
pub fn local_profiles() -> Vec<AwsProfile> {
    let home = crate::local_cli::detect::home_dir();
    let (credentials, config) = aws_files(home.as_deref(), &|name| std::env::var(name).ok());
    let read = |path: Option<PathBuf>| path.and_then(|path| std::fs::read_to_string(path).ok()).unwrap_or_default();
    profiles_in(&read(credentials), &read(config))
}

/// The keys of a profile of this computer.
///
/// # Errors
/// `InvalidInput` when it has none (SSO, a role to assume, a `credential_process`).
pub fn local_profile_keys(name: &str) -> AppResult<AwsKeys> {
    let home = crate::local_cli::detect::home_dir();
    let (credentials, config) = aws_files(home.as_deref(), &|variable| std::env::var(variable).ok());
    let credentials = read_sections(credentials.as_deref(), false);
    let config = read_sections(config.as_deref(), true);
    credentials.get(name).and_then(keys_of).or_else(|| config.get(name).and_then(keys_of)).ok_or_else(|| {
        AppError::InvalidInput(format!(
            "The profile {name} has no access key (it signs in another way). Paste an access key instead"
        ))
    })
}

// ---- problems ----

/// The console address where a missing permission is granted.
const IAM_USERS_URL: &str = "https://console.aws.amazon.com/iam/home#/users";
const SERVICE_QUOTAS_URL: &str = "https://console.aws.amazon.com/servicequotas/home";
const BILLING_URL: &str = "https://console.aws.amazon.com/billing/home#/paymentmethods";

/// The first `service:Action` named after "perform" in an AWS message.
fn missing_action(message: &str) -> Option<String> {
    let after = &message[message.find("perform")?..];
    after
        .split(|character: char| !(character.is_ascii_alphanumeric() || character == ':'))
        .find(|word| word.contains(':') && word.split(':').all(|part| !part.is_empty()) && word.split(':').count() == 2)
        .map(str::to_owned)
}

/// The CLI's refusal (`code`, `message`) as a [`DeployProblem`] for a deploy in `region`.
pub fn problem_for(code: Option<&str>, message: &str, region: Option<&str>) -> DeployProblem {
    let page = |url: &str| Some(DeployFix::OpenPage { url: url.to_owned() });
    let mut kind = code.unwrap_or("error").to_owned();
    let mut role = None;
    let region_name = region.unwrap_or("this region");
    let (plain, fix) = match kind.as_str() {
        "missing_credentials" | "unauthorized" => (
            "AWS didn't accept the access key (it is wrong, deleted or expired). Connect AWS again with a working key, then try again".to_owned(),
            Some(DeployFix::ConnectAgain { provider: DeployProvider::Aws }),
        ),
        "permission_denied" => {
            role = missing_action(message);
            let named = role.as_deref().map(|action| format!(" ({action})")).unwrap_or_default();
            (
                format!("Your AWS user may not do this{named}. Ask your AWS administrator to attach the Graphrt deploy policy to the user, wait five minutes, then try again"),
                page(IAM_USERS_URL),
            )
        }
        "account_not_ready" => (
            "The AWS account is not ready for Lambda yet. A new account can take up to 24 hours and needs a payment method. Check it, then try again later".to_owned(),
            page(BILLING_URL),
        ),
        "quota_exceeded" => (
            "An AWS limit is used up. Take agents you no longer need offline, or ask AWS for more in Service Quotas".to_owned(),
            page(SERVICE_QUOTAS_URL),
        ),
        "region_unavailable" => (format!("{region_name} is not an AWS region. Pick another one"), None),
        "rate_limited" => ("AWS is busy right now. Try again in a minute".to_owned(), None),
        "aws_unavailable" => ("AWS could not be reached. Check the internet connection and try again in a minute".to_owned(), None),
        "health_check_failed" => (
            "The new version did not start, so the earlier one keeps answering. See Details for why".to_owned(),
            None,
        ),
        "image_unavailable" => {
            kind = "image_not_found".into();
            (
                "The server image could not be read, so the earlier version keeps answering. Leave Server image (Advanced) empty to use graphrt's own image, or name one that exists".to_owned(),
                None,
            )
        }
        _ => (message.to_owned(), None),
    };
    DeployProblem {
        provider: DeployProvider::Aws,
        kind,
        message: plain,
        technical: message.to_owned(),
        project: region.map(str::to_owned),
        service: None,
        role,
        fix,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn regions_are_checked() {
        for region in ["ap-southeast-3", "us-east-1", "eu-central-1", "us-gov-west-1"] {
            assert!(is_region(region), "{region}");
        }
        for region in ["", "jakarta", "ap-southeast", "AP-SOUTHEAST-3", "ap-southeast-3;x", "--region"] {
            assert!(!is_region(region), "{region}");
        }
        assert_eq!(checked_region(Some(" ap-southeast-3 ")).unwrap(), "ap-southeast-3");
        assert!(checked_region(None).unwrap_err().to_string().contains("Pick an AWS region"));
    }

    #[test]
    fn hmac_matches_rfc_4231() {
        // Test case 2 of RFC 4231.
        assert_eq!(
            hex(&hmac_sha256(b"Jefe", b"what do ya want for nothing?")),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
        // Test case 6: a key longer than the block.
        assert_eq!(
            hex(&hmac_sha256(&[0xaa; 131], b"Test Using Larger Than Block-Size Key - Hash Key First")),
            "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"
        );
    }

    #[test]
    fn the_identity_request_is_signed_for_sts_without_leaking_the_secret() {
        let keys = AwsKeys {
            access_key_id: "AKIDEXAMPLE".into(),
            secret_access_key: "not-a-real-secret".into(),
            session_token: Some("tok".into()),
        };
        let now = chrono::DateTime::parse_from_rfc3339("2026-11-28T10:00:00Z").unwrap().with_timezone(&chrono::Utc);
        let headers: BTreeMap<String, String> = signed_identity_headers(&keys, now).into_iter().collect();
        let authorization = &headers["authorization"];
        assert!(
            authorization.starts_with("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261128/us-east-1/sts/aws4_request")
        );
        assert!(authorization.contains("SignedHeaders=content-type;host;x-amz-date;x-amz-security-token"));
        assert_eq!(headers["x-amz-date"], "20261128T100000Z");
        assert_eq!(headers["x-amz-security-token"], "tok");
        assert!(headers.values().all(|value| !value.contains("not-a-real-secret")));
        assert_eq!(signed_identity_headers(&keys, now), signed_identity_headers(&keys, now), "deterministic");
    }

    #[test]
    fn identity_answers_and_refusals_are_read() {
        let ok = "<GetCallerIdentityResponse><GetCallerIdentityResult><Arn>arn:aws:iam::123456789012:user/graphrt-deployer</Arn><UserId>AIDA</UserId><Account>123456789012</Account></GetCallerIdentityResult></GetCallerIdentityResponse>";
        let caller = read_identity_answer(200, ok).unwrap();
        assert_eq!(caller.account, "123456789012");
        assert_eq!(caller.identity(), "user graphrt-deployer");
        assert_eq!(Caller { account: "1".into(), arn: "arn:aws:iam::1:root".into() }.identity(), "root user");
        let unknown = "<ErrorResponse><Error><Code>InvalidClientTokenId</Code></Error></ErrorResponse>";
        assert!(read_identity_answer(403, unknown).unwrap_err().to_string().contains("doesn't know this access key"));
        let wrong = "<ErrorResponse><Error><Code>SignatureDoesNotMatch</Code></Error></ErrorResponse>";
        assert!(read_identity_answer(403, wrong).unwrap_err().to_string().contains("secret access key"));
    }

    #[test]
    fn profiles_with_keys_are_found_and_others_named() {
        let credentials = "[default]\naws_access_key_id = AKIAAAAA11112222\naws_secret_access_key = s1\n\n[graphrt]\naws_access_key_id=AKIABBBB33334444\naws_secret_access_key=s2\naws_session_token=t\n";
        let config = "[default]\nregion = us-east-1\n[profile graphrt]\nregion = ap-southeast-3\n[profile work-sso]\nsso_start_url = https://x\nregion = eu-west-1\n";
        let profiles = profiles_in(credentials, config);
        assert_eq!(
            profiles,
            [
                AwsProfile { name: "default".into(), region: Some("us-east-1".into()), has_keys: true },
                AwsProfile { name: "graphrt".into(), region: Some("ap-southeast-3".into()), has_keys: true },
                AwsProfile { name: "work-sso".into(), region: Some("eu-west-1".into()), has_keys: false },
            ]
        );
        let sections = parse_ini(credentials, false);
        let keys = keys_of(&sections["graphrt"]).unwrap();
        assert_eq!(keys.session_token.as_deref(), Some("t"));
        assert_eq!(keys.masked_id(), "AKIA…4444");
        assert_eq!(keys.environment().len(), 3);
    }

    #[test]
    fn aws_files_follow_the_cli_variables() {
        let home = Path::new("/home/ana");
        let (credentials, config) = aws_files(Some(home), &|_| None);
        assert_eq!(credentials.unwrap(), Path::new("/home/ana/.aws/credentials"));
        assert_eq!(config.unwrap(), Path::new("/home/ana/.aws/config"));
        let (credentials, _) =
            aws_files(Some(home), &|name| (name == "AWS_SHARED_CREDENTIALS_FILE").then(|| "/keys/aws".to_owned()));
        assert_eq!(credentials.unwrap(), Path::new("/keys/aws"));
    }

    #[test]
    fn cli_errors_become_plain_problems_with_a_fix() {
        let denied = problem_for(
            Some("permission_denied"),
            "could not create the function: User: arn:aws:iam::1:user/x is not authorized to perform: lambda:CreateFunction on resource: arn:aws:lambda:ap-southeast-3:1:function:graphrt-a (AccessDeniedException)",
            Some("ap-southeast-3"),
        );
        assert_eq!(denied.role.as_deref(), Some("lambda:CreateFunction"));
        assert!(denied.message.contains("Graphrt deploy policy"));
        assert!(matches!(denied.fix, Some(DeployFix::OpenPage { ref url }) if url.contains("iam")));
        let bad_key = problem_for(Some("unauthorized"), "The AWS access key is wrong", Some("ap-southeast-3"));
        assert_eq!(bad_key.fix, Some(DeployFix::ConnectAgain { provider: DeployProvider::Aws }));
        assert_eq!(problem_for(Some("image_unavailable"), "cannot read the image", None).kind, "image_not_found");
        assert!(problem_for(Some("quota_exceeded"), "x", None).fix.is_some());
        let other = problem_for(Some("aws_api"), "AWS said no", None);
        assert_eq!((other.message.as_str(), other.fix), ("AWS said no", None));
    }
}
