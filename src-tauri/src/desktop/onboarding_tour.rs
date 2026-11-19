//! Whether the user has been through the onboarding tour, so it opens by
//! itself only once. Stored as one row of the `settings` table
//! (`app.onboarding_tour`), apart from [`super::app_settings::AppSettings`]
//! so the Settings screen saving its preferences never overwrites it.

use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::storage::Database;

const KEY_ONBOARDING_TOUR: &str = "app.onboarding_tour";

/// Where the user is with the tour. Sent to the frontend as `not_seen`,
/// `completed` or `skipped` (`src/api/onboardingTour.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum OnboardingTourStatus {
    /// Never opened: the app shows it once on Home or the first New agent screen.
    #[default]
    NotSeen,
    /// Read to the last step.
    Completed,
    /// Closed early ("Skip tour", Escape or the close button).
    Skipped,
}

impl OnboardingTourStatus {
    fn as_stored_text(self) -> &'static str {
        match self {
            Self::NotSeen => "not_seen",
            Self::Completed => "completed",
            Self::Skipped => "skipped",
        }
    }

    fn from_stored_text(text: &str) -> Option<Self> {
        match text {
            "not_seen" => Some(Self::NotSeen),
            "completed" => Some(Self::Completed),
            "skipped" => Some(Self::Skipped),
            _ => None,
        }
    }

    /// Reads the stored status; a missing or unreadable row means `NotSeen`.
    ///
    /// @throws AppError::Database - when the settings table cannot be read
    pub fn load(db: &Database) -> AppResult<Self> {
        Ok(match db.get_setting(KEY_ONBOARDING_TOUR)?.as_deref() {
            Some(text) => Self::from_stored_text(text).unwrap_or_else(|| {
                log::warn!("ignoring unreadable setting {KEY_ONBOARDING_TOUR}={text:?}");
                Self::default()
            }),
            None => Self::default(),
        })
    }

    /// Stores the status.
    ///
    /// @throws AppError::Database - when the value cannot be written
    pub fn save(self, db: &Database) -> AppResult<()> {
        db.set_setting(KEY_ONBOARDING_TOUR, self.as_stored_text())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_install_has_not_seen_the_tour() {
        let database = Database::open_in_memory().unwrap();
        assert_eq!(OnboardingTourStatus::load(&database).unwrap(), OnboardingTourStatus::NotSeen);
    }

    #[test]
    fn the_status_round_trips() {
        let database = Database::open_in_memory().unwrap();
        for status in [OnboardingTourStatus::Completed, OnboardingTourStatus::Skipped, OnboardingTourStatus::NotSeen] {
            status.save(&database).unwrap();
            assert_eq!(OnboardingTourStatus::load(&database).unwrap(), status);
        }
    }

    #[test]
    fn an_unreadable_value_counts_as_not_seen() {
        let database = Database::open_in_memory().unwrap();
        database.set_setting(KEY_ONBOARDING_TOUR, "halfway").unwrap();
        assert_eq!(OnboardingTourStatus::load(&database).unwrap(), OnboardingTourStatus::NotSeen);
    }

    #[test]
    fn serializes_as_snake_case() {
        assert_eq!(serde_json::to_value(OnboardingTourStatus::NotSeen).unwrap(), "not_seen");
        let skipped: OnboardingTourStatus = serde_json::from_value(serde_json::json!("skipped")).unwrap();
        assert_eq!(skipped, OnboardingTourStatus::Skipped);
    }
}
