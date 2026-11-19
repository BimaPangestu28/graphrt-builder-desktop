//! Conversions between model types and SQLite column values.
//!
//! Enums are stored as their serde `snake_case` names so the database stays
//! readable and matches the JSON the frontend sees. JSON values are stored as
//! TEXT. Implementing `ToSql`/`FromSql` here (instead of in `models.rs`) keeps
//! the model types free of any database dependency.

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSqlOutput, ValueRef};
use rusqlite::{Row, ToSql};

use super::models::{
    AgentKind, AgentStatus, BuilderMessageRole, BuilderMessageStatus, MissedRunPolicy, RunStatus, RunTrigger,
};

/// Implements `ToSql`/`FromSql` for a fieldless enum as a TEXT column, with
/// an `as_db_text` helper so SQL literals can be built from the same table.
macro_rules! text_enum_column {
    ($enum_type:ty { $($variant:ident => $text:literal),+ $(,)? }) => {
        impl $enum_type {
            /// The stored TEXT value (identical to the serde name).
            pub(crate) fn as_db_text(self) -> &'static str {
                match self {
                    $(<$enum_type>::$variant => $text),+
                }
            }
        }

        impl ToSql for $enum_type {
            fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
                Ok(ToSqlOutput::from(self.as_db_text()))
            }
        }

        impl FromSql for $enum_type {
            fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
                match value.as_str()? {
                    $($text => Ok(<$enum_type>::$variant),)+
                    unknown => Err(FromSqlError::Other(
                        format!("unknown {} value {unknown:?}", stringify!($enum_type)).into(),
                    )),
                }
            }
        }
    };
}

text_enum_column!(AgentKind {
    Task => "task",
    Chatbot => "chatbot",
    Chain => "chain",
    Team => "team",
});

text_enum_column!(AgentStatus {
    Draft => "draft",
    Tested => "tested",
    Active => "active",
    Paused => "paused",
});

text_enum_column!(RunTrigger {
    Test => "test",
    Manual => "manual",
    Schedule => "schedule",
});

text_enum_column!(RunStatus {
    Running => "running",
    Paused => "paused",
    Succeeded => "succeeded",
    Failed => "failed",
    Aborted => "aborted",
});

text_enum_column!(MissedRunPolicy {
    RunOnce => "run_once",
    Skip => "skip",
});

text_enum_column!(BuilderMessageRole {
    User => "user",
    Builder => "builder",
});

text_enum_column!(BuilderMessageStatus {
    Done => "done",
    Failed => "failed",
});

/// Serializes a JSON value for a TEXT column.
pub(crate) fn json_to_text(value: &serde_json::Value) -> String {
    value.to_string()
}

/// Reads a nullable JSON TEXT column.
pub(crate) fn optional_json_column(row: &Row<'_>, column_name: &str) -> rusqlite::Result<Option<serde_json::Value>> {
    let text: Option<String> = row.get(column_name)?;
    text.map(|json_text| parse_json_text(row, column_name, &json_text)).transpose()
}

/// Reads a NOT NULL JSON TEXT column.
pub(crate) fn json_column(row: &Row<'_>, column_name: &str) -> rusqlite::Result<serde_json::Value> {
    let json_text: String = row.get(column_name)?;
    parse_json_text(row, column_name, &json_text)
}

fn parse_json_text(row: &Row<'_>, column_name: &str, json_text: &str) -> rusqlite::Result<serde_json::Value> {
    serde_json::from_str(json_text).map_err(|parse_error| {
        let column_index = row.as_ref().column_index(column_name).unwrap_or(0);
        rusqlite::Error::FromSqlConversionFailure(column_index, rusqlite::types::Type::Text, Box::new(parse_error))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The stored text must equal the serde name so DB values and frontend JSON agree.
    fn assert_matches_serde<T: serde::Serialize>(value: T, db_text: &str) {
        assert_eq!(serde_json::to_value(value).unwrap(), serde_json::json!(db_text));
    }

    #[test]
    fn enum_db_text_matches_serde_names() {
        for kind in [AgentKind::Task, AgentKind::Chatbot, AgentKind::Chain, AgentKind::Team] {
            assert_matches_serde(kind, kind.as_db_text());
        }
        for status in [AgentStatus::Draft, AgentStatus::Tested, AgentStatus::Active, AgentStatus::Paused] {
            assert_matches_serde(status, status.as_db_text());
        }
        for trigger in [RunTrigger::Test, RunTrigger::Manual, RunTrigger::Schedule] {
            assert_matches_serde(trigger, trigger.as_db_text());
        }
        for status in
            [RunStatus::Running, RunStatus::Paused, RunStatus::Succeeded, RunStatus::Failed, RunStatus::Aborted]
        {
            assert_matches_serde(status, status.as_db_text());
        }
        for policy in [MissedRunPolicy::RunOnce, MissedRunPolicy::Skip] {
            assert_matches_serde(policy, policy.as_db_text());
        }
        for role in [BuilderMessageRole::User, BuilderMessageRole::Builder] {
            assert_matches_serde(role, role.as_db_text());
        }
        for status in [BuilderMessageStatus::Done, BuilderMessageStatus::Failed] {
            assert_matches_serde(status, status.as_db_text());
        }
    }

    #[test]
    fn enum_round_trips_through_sqlite_and_rejects_unknown_text() {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        let round_tripped: MissedRunPolicy =
            connection.query_row("SELECT ?1", [MissedRunPolicy::RunOnce], |row| row.get(0)).unwrap();
        assert_eq!(round_tripped, MissedRunPolicy::RunOnce);
        let unknown: rusqlite::Result<RunStatus> = connection.query_row("SELECT 'exploded'", [], |row| row.get(0));
        assert!(unknown.is_err());
    }
}
