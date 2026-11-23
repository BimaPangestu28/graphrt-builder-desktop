//! The hosts an agent trusts for read-only lookups (see `crate::flow::trusted_hosts`).
//!
//! Stored in `agent_settings` under [`TRUSTED_LOOKUP_HOSTS_KEY`] as a JSON array of
//! normalized entries, so they are removed with their agent. They live outside the
//! workflow document on purpose: saving a new version (builder draft, Nodes edit,
//! import) never changes them; only these methods do, called from the user's
//! "Trust" actions.

use rusqlite::{params, Connection, OptionalExtension};

use super::agents::ensure_agent_exists;
use super::{now_rfc3339, Database};
use crate::error::{AppError, AppResult};
use crate::flow::trusted_hosts::{normalize_trusted_host, TrustedHosts};

/// `agent_settings` key of the list.
pub const TRUSTED_LOOKUP_HOSTS_KEY: &str = "trusted_lookup_hosts";
/// Most hosts one agent may trust; a longer list is almost certainly a mistake.
pub const MAX_TRUSTED_HOSTS: usize = 50;

impl Database {
    /// The agent's trusted lookup hosts (none when never set).
    ///
    /// # Errors
    /// `NotFound` for an unknown agent; `Serialization` when the stored text is not JSON.
    pub fn trusted_lookup_hosts(&self, agent_id: &str) -> AppResult<TrustedHosts> {
        let connection = self.lock()?;
        ensure_agent_exists(&connection, agent_id)?;
        read_hosts(&connection, agent_id)
    }

    /// Trusts `host` (normalized, see `normalize_trusted_host`) for the agent's lookups;
    /// adding a host already trusted changes nothing. Returns the new list.
    ///
    /// # Errors
    /// `InvalidInput` with a plain reason for an invalid host or a full list;
    /// `NotFound` for an unknown agent.
    pub fn add_trusted_lookup_host(&self, agent_id: &str, host: &str) -> AppResult<TrustedHosts> {
        let normalized = normalize_trusted_host(host).map_err(AppError::InvalidInput)?;
        let connection = self.lock()?;
        ensure_agent_exists(&connection, agent_id)?;
        let mut entries = read_hosts(&connection, agent_id)?.entries().to_vec();
        if entries.contains(&normalized) {
            return Ok(TrustedHosts::from_entries(entries));
        }
        if entries.len() >= MAX_TRUSTED_HOSTS {
            return Err(AppError::InvalidInput(format!("An agent can trust at most {MAX_TRUSTED_HOSTS} sites")));
        }
        entries.push(normalized);
        write_hosts(&connection, agent_id, &entries)?;
        log::info!("agent {agent_id}: trusted {host} for read-only lookups");
        Ok(TrustedHosts::from_entries(entries))
    }

    /// Stops trusting `host`; removing a host that is not trusted changes nothing.
    ///
    /// # Errors
    /// `NotFound` for an unknown agent.
    pub fn remove_trusted_lookup_host(&self, agent_id: &str, host: &str) -> AppResult<TrustedHosts> {
        let connection = self.lock()?;
        ensure_agent_exists(&connection, agent_id)?;
        let target = normalize_trusted_host(host).unwrap_or_else(|_| host.trim().to_ascii_lowercase());
        let entries: Vec<String> =
            read_hosts(&connection, agent_id)?.entries().iter().filter(|entry| **entry != target).cloned().collect();
        write_hosts(&connection, agent_id, &entries)?;
        log::info!("agent {agent_id}: no longer trusts {target} for lookups");
        Ok(TrustedHosts::from_entries(entries))
    }
}

fn read_hosts(connection: &Connection, agent_id: &str) -> AppResult<TrustedHosts> {
    let stored: Option<String> = connection
        .query_row(
            "SELECT value_json FROM agent_settings WHERE agent_id = ?1 AND key = ?2",
            params![agent_id, TRUSTED_LOOKUP_HOSTS_KEY],
            |row| row.get(0),
        )
        .optional()?;
    let Some(text) = stored else { return Ok(TrustedHosts::none()) };
    let entries: Vec<String> = serde_json::from_str(&text)?;
    Ok(TrustedHosts::from_entries(entries))
}

fn write_hosts(connection: &Connection, agent_id: &str, entries: &[String]) -> AppResult<()> {
    connection.execute(
        "INSERT INTO agent_settings (agent_id, key, value_json, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (agent_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
        params![agent_id, TRUSTED_LOOKUP_HOSTS_KEY, serde_json::to_string(entries)?, now_rfc3339()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::test_support::{create_test_agent, test_database};

    #[test]
    fn adds_normalized_hosts_once_and_removes_them() {
        let database = test_database();
        let agent = create_test_agent(&database, "Weather bot");
        assert!(database.trusted_lookup_hosts(&agent.id).unwrap().is_empty());

        database.add_trusted_lookup_host(&agent.id, " API.Weather.com ").unwrap();
        let hosts = database.add_trusted_lookup_host(&agent.id, "api.weather.com").unwrap();
        assert_eq!(hosts.entries(), ["api.weather.com"]);
        database.add_trusted_lookup_host(&agent.id, "*.maps.org").unwrap();
        assert_eq!(database.trusted_lookup_hosts(&agent.id).unwrap().entries(), ["api.weather.com", "*.maps.org"]);

        let hosts = database.remove_trusted_lookup_host(&agent.id, "API.weather.com").unwrap();
        assert_eq!(hosts.entries(), ["*.maps.org"]);
        assert_eq!(database.remove_trusted_lookup_host(&agent.id, "not-there.org").unwrap().entries(), ["*.maps.org"]);
    }

    #[test]
    fn refuses_invalid_hosts_and_unknown_agents() {
        let database = test_database();
        let agent = create_test_agent(&database, "Weather bot");
        for host in ["https://api.weather.com", "api.weather.com/v1", "*", ""] {
            assert!(
                matches!(database.add_trusted_lookup_host(&agent.id, host), Err(AppError::InvalidInput(_))),
                "{host:?}"
            );
        }
        assert!(matches!(database.add_trusted_lookup_host("ghost", "api.weather.com"), Err(AppError::NotFound(_))));
        assert!(matches!(database.trusted_lookup_hosts("ghost"), Err(AppError::NotFound(_))));
    }

    #[test]
    fn hosts_are_per_agent_and_go_with_it() {
        let database = test_database();
        let weather = create_test_agent(&database, "Weather bot");
        let other = create_test_agent(&database, "Other");
        database.add_trusted_lookup_host(&weather.id, "api.weather.com").unwrap();
        assert!(database.trusted_lookup_hosts(&other.id).unwrap().is_empty());
        database.delete_agent(&weather.id).unwrap();
        assert!(matches!(database.trusted_lookup_hosts(&weather.id), Err(AppError::NotFound(_))));
    }

    #[test]
    fn saving_a_new_flow_version_never_changes_the_hosts() {
        let database = test_database();
        let agent = create_test_agent(&database, "Weather bot");
        database.add_trusted_lookup_host(&agent.id, "api.weather.com").unwrap();
        let injected = "version: \"1\"\ntrusted_hosts: [evil.org]\nmetadata: { trusted_lookup_hosts: [evil.org] }\n";
        database.update_agent_flow(&agent.id, injected, "drafted").unwrap();
        assert_eq!(database.trusted_lookup_hosts(&agent.id).unwrap().entries(), ["api.weather.com"]);
    }

    #[test]
    fn the_list_is_capped() {
        let database = test_database();
        let agent = create_test_agent(&database, "Weather bot");
        for index in 0..MAX_TRUSTED_HOSTS {
            database.add_trusted_lookup_host(&agent.id, &format!("api{index}.weather.com")).unwrap();
        }
        assert!(matches!(
            database.add_trusted_lookup_host(&agent.id, "one-more.weather.com"),
            Err(AppError::InvalidInput(_))
        ));
    }
}
