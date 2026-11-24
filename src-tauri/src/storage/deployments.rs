//! Where each agent runs online ("Put it online"), one row per agent in `deployments`, and the
//! servers an IT team runs (`own_servers`). API keys live in the keychain, never here.

use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use super::agents::ensure_agent_exists;
use super::{now_rfc3339, Database};
use crate::deploy::providers::DeployProvider;
use crate::error::{AppError, AppResult};

/// "Always ready" (`always_on`) or "Saves money" (`scale_to_zero`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeployMode {
    AlwaysOn,
    ScaleToZero,
}

impl DeployMode {
    pub fn key(self) -> &'static str {
        match self {
            Self::AlwaysOn => "always_on",
            Self::ScaleToZero => "scale_to_zero",
        }
    }

    /// The `--mode` value of `graphrt deploy`.
    pub fn cli_value(self) -> &'static str {
        match self {
            Self::AlwaysOn => "always-on",
            Self::ScaleToZero => "scale-to-zero",
        }
    }
}

/// The last known state of an online agent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeploymentStatus {
    /// The first deploy is running and has not finished.
    Deploying,
    Working,
    Paused,
    NeedsAttention,
    /// The first deploy failed; nothing is online.
    Failed,
}

impl DeploymentStatus {
    pub fn key(self) -> &'static str {
        match self {
            Self::Deploying => "deploying",
            Self::Working => "working",
            Self::Paused => "paused",
            Self::NeedsAttention => "needs_attention",
            Self::Failed => "failed",
        }
    }

    fn from_key(key: &str) -> AppResult<Self> {
        Ok(match key {
            "deploying" => Self::Deploying,
            "working" => Self::Working,
            "paused" => Self::Paused,
            "needs_attention" => Self::NeedsAttention,
            "failed" => Self::Failed,
            other => return Err(AppError::Internal(format!("unknown deployment status {other}"))),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentRecord {
    pub agent_id: String,
    pub provider: DeployProvider,
    /// `--deployment` of `graphrt deploy`; chosen on the first deploy and kept.
    pub deployment_name: String,
    /// The provider's app name (from the deploy result).
    pub app: Option<String>,
    pub url: Option<String>,
    /// Provider region code, e.g. `sin`.
    pub region: Option<String>,
    pub mode: DeployMode,
    /// `--version` of the deploy that is online, e.g. `v3`.
    pub deployed_version_label: Option<String>,
    /// The desktop agent version that deploy was made from (drift detection).
    pub deployed_agent_version: Option<i64>,
    pub status: DeploymentStatus,
    pub status_message: Option<String>,
    pub status_checked_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// A graphrt server an IT team runs ("Connect a running server").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnServer {
    pub id: String,
    pub name: String,
    pub url: String,
    pub created_at: String,
}

fn provider_from_key(key: &str) -> rusqlite::Result<DeployProvider> {
    crate::deploy::providers::ALL_DEPLOY_PROVIDERS.into_iter().find(|provider| provider.key() == key).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, format!("provider {key}").into())
    })
}

fn read_deployment(row: &Row<'_>) -> rusqlite::Result<(DeploymentRecord, String)> {
    let mode_key: String = row.get("mode")?;
    let record = DeploymentRecord {
        agent_id: row.get("agent_id")?,
        provider: provider_from_key(&row.get::<_, String>("provider")?)?,
        deployment_name: row.get("deployment_name")?,
        app: row.get("app")?,
        url: row.get("url")?,
        region: row.get("region")?,
        mode: if mode_key == "always_on" { DeployMode::AlwaysOn } else { DeployMode::ScaleToZero },
        deployed_version_label: row.get("deployed_version_label")?,
        deployed_agent_version: row.get("deployed_agent_version")?,
        status: DeploymentStatus::Working,
        status_message: row.get("status_message")?,
        status_checked_at: row.get("status_checked_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    };
    Ok((record, row.get("status")?))
}

const SELECT_DEPLOYMENTS: &str = "SELECT agent_id, provider, deployment_name, app, url, region, mode,
    deployed_version_label, deployed_agent_version, status, status_message, status_checked_at,
    created_at, updated_at FROM deployments";

impl Database {
    /// The agent's deployment, if it was ever put online (or a deploy is under way).
    pub fn get_deployment(&self, agent_id: &str) -> AppResult<Option<DeploymentRecord>> {
        let connection = self.lock()?;
        let found = connection
            .query_row(&format!("{SELECT_DEPLOYMENTS} WHERE agent_id = ?1"), params![agent_id], read_deployment)
            .optional()?;
        found
            .map(|(mut record, status)| {
                record.status = DeploymentStatus::from_key(&status)?;
                Ok(record)
            })
            .transpose()
    }

    /// Every deployment, newest first.
    pub fn list_deployments(&self) -> AppResult<Vec<DeploymentRecord>> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(&format!("{SELECT_DEPLOYMENTS} ORDER BY created_at DESC"))?;
        let rows = statement.query_map([], read_deployment)?.collect::<Result<Vec<_>, _>>()?;
        rows.into_iter()
            .map(|(mut record, status)| {
                record.status = DeploymentStatus::from_key(&status)?;
                Ok(record)
            })
            .collect()
    }

    /// Inserts or replaces the agent's deployment row (timestamps are set here).
    ///
    /// # Errors
    /// `NotFound` for an unknown agent.
    pub fn save_deployment(&self, record: &DeploymentRecord) -> AppResult<DeploymentRecord> {
        let now = now_rfc3339();
        {
            let connection = self.lock()?;
            ensure_agent_exists(&connection, &record.agent_id)?;
            connection.execute(
                "INSERT INTO deployments (agent_id, provider, deployment_name, app, url, region, mode,
                    deployed_version_label, deployed_agent_version, status, status_message, status_checked_at,
                    created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
                 ON CONFLICT (agent_id) DO UPDATE SET provider = excluded.provider,
                    deployment_name = excluded.deployment_name, app = excluded.app, url = excluded.url,
                    region = excluded.region, mode = excluded.mode,
                    deployed_version_label = excluded.deployed_version_label,
                    deployed_agent_version = excluded.deployed_agent_version, status = excluded.status,
                    status_message = excluded.status_message, status_checked_at = excluded.status_checked_at,
                    updated_at = excluded.updated_at",
                params![
                    record.agent_id,
                    record.provider.key(),
                    record.deployment_name,
                    record.app,
                    record.url,
                    record.region,
                    record.mode.key(),
                    record.deployed_version_label,
                    record.deployed_agent_version,
                    record.status.key(),
                    record.status_message,
                    record.status_checked_at,
                    now,
                ],
            )?;
        }
        self.get_deployment(&record.agent_id)?.ok_or_else(|| AppError::Internal("the deployment was not saved".into()))
    }

    /// Updates only the cached status (after a health check or a pause / resume).
    pub fn set_deployment_status(
        &self,
        agent_id: &str,
        status: DeploymentStatus,
        message: Option<&str>,
    ) -> AppResult<Option<DeploymentRecord>> {
        let now = now_rfc3339();
        self.lock()?.execute(
            "UPDATE deployments SET status = ?2, status_message = ?3, status_checked_at = ?4, updated_at = ?4
             WHERE agent_id = ?1",
            params![agent_id, status.key(), message, now],
        )?;
        self.get_deployment(agent_id)
    }

    /// Forgets the agent's deployment (after "Take offline"). Returns whether there was one.
    pub fn delete_deployment(&self, agent_id: &str) -> AppResult<bool> {
        Ok(self.lock()?.execute("DELETE FROM deployments WHERE agent_id = ?1", params![agent_id])? > 0)
    }

    pub fn list_own_servers(&self) -> AppResult<Vec<OwnServer>> {
        let connection = self.lock()?;
        let mut statement =
            connection.prepare("SELECT id, name, url, created_at FROM own_servers ORDER BY created_at")?;
        let servers = statement
            .query_map([], |row| {
                Ok(OwnServer { id: row.get(0)?, name: row.get(1)?, url: row.get(2)?, created_at: row.get(3)? })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(servers)
    }

    pub fn add_own_server(&self, name: &str, url: &str) -> AppResult<OwnServer> {
        let server = OwnServer {
            id: uuid::Uuid::new_v4().simple().to_string(),
            name: name.trim().to_owned(),
            url: url.trim().trim_end_matches('/').to_owned(),
            created_at: now_rfc3339(),
        };
        if server.name.is_empty() {
            return Err(AppError::InvalidInput("Give the server a name".into()));
        }
        self.lock()?.execute(
            "INSERT INTO own_servers (id, name, url, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![server.id, server.name, server.url, server.created_at],
        )?;
        Ok(server)
    }

    pub fn remove_own_server(&self, server_id: &str) -> AppResult<bool> {
        Ok(self.lock()?.execute("DELETE FROM own_servers WHERE id = ?1", params![server_id])? > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::test_support::{create_test_agent, test_database};

    fn sample_record(agent_id: &str) -> DeploymentRecord {
        DeploymentRecord {
            agent_id: agent_id.to_owned(),
            provider: DeployProvider::Fly,
            deployment_name: "menu-chatbot-1a2b".into(),
            app: Some("menu-chatbot-1a2b".into()),
            url: Some("https://menu-chatbot-1a2b.fly.dev".into()),
            region: Some("sin".into()),
            mode: DeployMode::ScaleToZero,
            deployed_version_label: Some("v1".into()),
            deployed_agent_version: Some(3),
            status: DeploymentStatus::Working,
            status_message: None,
            status_checked_at: None,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn saves_updates_and_removes_a_deployment_per_agent() {
        let database = test_database();
        let agent = create_test_agent(&database, "Menu chatbot");
        assert_eq!(database.get_deployment(&agent.id).unwrap(), None);

        let saved = database.save_deployment(&sample_record(&agent.id)).unwrap();
        assert_eq!(saved.deployed_version_label.as_deref(), Some("v1"));
        assert!(!saved.created_at.is_empty());

        let mut next = saved.clone();
        next.deployed_version_label = Some("v2".into());
        next.deployed_agent_version = Some(4);
        let updated = database.save_deployment(&next).unwrap();
        assert_eq!(updated.deployed_agent_version, Some(4));
        assert_eq!(updated.created_at, saved.created_at, "created_at is kept");
        assert_eq!(database.list_deployments().unwrap().len(), 1);

        let paused =
            database.set_deployment_status(&agent.id, DeploymentStatus::Paused, Some("paused by you")).unwrap();
        assert_eq!(paused.unwrap().status, DeploymentStatus::Paused);

        assert!(database.delete_deployment(&agent.id).unwrap());
        assert!(!database.delete_deployment(&agent.id).unwrap());
    }

    #[test]
    fn deployments_go_with_their_agent_and_need_one() {
        let database = test_database();
        assert!(matches!(database.save_deployment(&sample_record("missing")), Err(AppError::NotFound(_))));
        let agent = create_test_agent(&database, "Menu chatbot");
        database.save_deployment(&sample_record(&agent.id)).unwrap();
        database.delete_agent(&agent.id).unwrap();
        assert!(database.list_deployments().unwrap().is_empty());
    }

    #[test]
    fn own_servers_are_listed_in_order_and_removed() {
        let database = test_database();
        let first = database.add_own_server(" home-nas ", "http://192.168.1.20:8080/").unwrap();
        database.add_own_server("office", "https://graphrt.office.example").unwrap();
        assert_eq!(first.name, "home-nas");
        assert_eq!(first.url, "http://192.168.1.20:8080");
        assert_eq!(database.list_own_servers().unwrap().len(), 2);
        assert!(database.remove_own_server(&first.id).unwrap());
        assert!(database.add_own_server("  ", "https://x").is_err());
    }
}
