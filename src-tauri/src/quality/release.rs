//! Whether the agent's latest version may be released: the pure rule behind the Release
//! button, so the screen and the backend always agree.
//!
//! A version is released when its newest check ran the current tests to the end and
//! enough answers were good. Otherwise the reason is returned in plain terms, and the
//! person may release anyway with a written reason, except when nothing new would be
//! released or a check is still running.

use serde::{Deserialize, Serialize};

use crate::storage::quality::{CheckRecord, CheckStatus, Release};

/// The share of good answers a release needs unless the person changes it.
pub const DEFAULT_REQUIRED_PERCENT: i64 = 80;

/// What the rule looks at.
#[derive(Debug, Clone, Copy)]
pub struct ReleaseFacts<'a> {
    pub current_version: i64,
    pub tests_count: usize,
    /// Fingerprint of the tests as they are now.
    pub tests_fingerprint: &'a str,
    /// The agent's checks, newest first.
    pub checks: &'a [CheckRecord],
    pub releases: &'a [Release],
    pub required_percent: i64,
}

/// Why the latest version cannot be released (yet).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ReleaseBlock {
    /// This version is already release `number`.
    AlreadyReleased { number: i64 },
    /// A check of this version is running.
    CheckRunning,
    /// The agent has no tests.
    NoTests,
    /// This version was never checked.
    NotChecked,
    /// The tests changed after the last check.
    TestsChanged,
    /// The last check could not run to the end.
    CheckDidNotFinish,
    /// Too few good answers.
    #[serde(rename_all = "camelCase")]
    NotEnoughGood { good: i64, total: i64, needed: i64, required_percent: i64 },
}

impl ReleaseBlock {
    /// Whether the person may release anyway with a reason.
    pub fn can_override(&self) -> bool {
        !matches!(self, Self::AlreadyReleased { .. } | Self::CheckRunning)
    }
}

/// The verdict for the latest version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ReleaseReadiness {
    #[serde(rename_all = "camelCase")]
    Ready { check_id: String, good: i64, total: i64 },
    #[serde(rename_all = "camelCase")]
    Blocked { block: ReleaseBlock, can_override: bool, check_id: Option<String> },
}

/// How many of `total` answers must be good at `required_percent` (rounded up).
pub fn needed_good(total: i64, required_percent: i64) -> i64 {
    let required = required_percent.clamp(0, 100);
    (total.max(0) * required + 99) / 100
}

/// Applies the rule to `facts`.
pub fn readiness(facts: &ReleaseFacts<'_>) -> ReleaseReadiness {
    let blocked = |block: ReleaseBlock, check_id: Option<String>| ReleaseReadiness::Blocked {
        can_override: block.can_override(),
        block,
        check_id,
    };
    if let Some(release) = facts.releases.iter().find(|release| release.agent_version == facts.current_version) {
        return blocked(ReleaseBlock::AlreadyReleased { number: release.number }, None);
    }
    let latest = facts.checks.iter().find(|check| check.agent_version == facts.current_version);
    if latest.is_some_and(|check| check.status == CheckStatus::Running) {
        return blocked(ReleaseBlock::CheckRunning, latest.map(|check| check.id.clone()));
    }
    if facts.tests_count == 0 {
        return blocked(ReleaseBlock::NoTests, None);
    }
    let Some(check) = latest else { return blocked(ReleaseBlock::NotChecked, None) };
    let check_id = Some(check.id.clone());
    if check.tests_fingerprint != facts.tests_fingerprint {
        return blocked(ReleaseBlock::TestsChanged, check_id);
    }
    if check.status != CheckStatus::Finished {
        return blocked(ReleaseBlock::CheckDidNotFinish, check_id);
    }
    let needed = needed_good(check.total, facts.required_percent);
    if check.total == 0 || check.passed < needed {
        return blocked(
            ReleaseBlock::NotEnoughGood {
                good: check.passed,
                total: check.total,
                needed,
                required_percent: facts.required_percent,
            },
            check_id,
        );
    }
    ReleaseReadiness::Ready { check_id: check.id.clone(), good: check.passed, total: check.total }
}

/// The release a person may go back to: any release that is not the one in use.
pub fn can_switch_to(releases: &[Release], in_use: Option<&Release>, number: i64) -> bool {
    releases.iter().any(|release| release.number == number) && in_use.is_none_or(|current| current.number != number)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check(version: i64, status: CheckStatus, passed: i64, total: i64, fingerprint: &str) -> CheckRecord {
        CheckRecord {
            id: format!("check-{version}-{passed}"),
            agent_id: "a".into(),
            agent_version: version,
            tests_fingerprint: fingerprint.into(),
            status,
            total,
            passed,
            required_percent: 80,
            report_json: None,
            error_message: None,
            started_at: String::new(),
            finished_at: None,
        }
    }

    fn release(number: i64, version: i64) -> Release {
        Release {
            agent_id: "a".into(),
            number,
            agent_version: version,
            notes: String::new(),
            check_id: None,
            passed: None,
            total: None,
            required_percent: 80,
            override_reason: None,
            created_at: String::new(),
        }
    }

    fn facts<'a>(checks: &'a [CheckRecord], releases: &'a [Release]) -> ReleaseFacts<'a> {
        ReleaseFacts {
            current_version: 3,
            tests_count: 10,
            tests_fingerprint: "f",
            checks,
            releases,
            required_percent: 80,
        }
    }

    fn block_of(readiness: ReleaseReadiness) -> (ReleaseBlock, bool) {
        match readiness {
            ReleaseReadiness::Blocked { block, can_override, .. } => (block, can_override),
            ready => panic!("expected a block, got {ready:?}"),
        }
    }

    #[test]
    fn needed_good_answers_round_up() {
        assert_eq!(needed_good(10, 80), 8);
        assert_eq!(needed_good(7, 80), 6);
        assert_eq!(needed_good(3, 100), 3);
        assert_eq!(needed_good(5, 0), 0);
        assert_eq!(needed_good(5, 150), 5);
    }

    #[test]
    fn enough_good_answers_on_the_current_tests_is_ready() {
        let checks = [check(3, CheckStatus::Finished, 8, 10, "f")];
        assert_eq!(
            readiness(&facts(&checks, &[])),
            ReleaseReadiness::Ready { check_id: "check-3-8".into(), good: 8, total: 10 }
        );
    }

    #[test]
    fn too_few_good_answers_block_with_the_numbers_and_may_be_overridden() {
        let checks = [check(3, CheckStatus::Finished, 7, 10, "f")];
        let (block, can_override) = block_of(readiness(&facts(&checks, &[])));
        assert_eq!(block, ReleaseBlock::NotEnoughGood { good: 7, total: 10, needed: 8, required_percent: 80 });
        assert!(can_override);
    }

    #[test]
    fn only_the_newest_check_of_this_version_counts() {
        // Newest first: the latest check of version 3 failed although an older one passed.
        let checks = [
            check(3, CheckStatus::Finished, 5, 10, "f"),
            check(3, CheckStatus::Finished, 10, 10, "f"),
            check(2, CheckStatus::Finished, 10, 10, "f"),
        ];
        assert!(matches!(block_of(readiness(&facts(&checks, &[]))).0, ReleaseBlock::NotEnoughGood { .. }));
        let older_version_only = [check(2, CheckStatus::Finished, 10, 10, "f")];
        assert_eq!(block_of(readiness(&facts(&older_version_only, &[]))), (ReleaseBlock::NotChecked, true));
    }

    #[test]
    fn changed_tests_running_or_unfinished_checks_block() {
        let changed = [check(3, CheckStatus::Finished, 10, 10, "old")];
        assert_eq!(block_of(readiness(&facts(&changed, &[]))), (ReleaseBlock::TestsChanged, true));
        let running = [check(3, CheckStatus::Running, 0, 10, "f")];
        assert_eq!(block_of(readiness(&facts(&running, &[]))), (ReleaseBlock::CheckRunning, false));
        let failed = [check(3, CheckStatus::Failed, 0, 10, "f")];
        assert_eq!(block_of(readiness(&facts(&failed, &[]))), (ReleaseBlock::CheckDidNotFinish, true));
    }

    #[test]
    fn no_tests_or_an_already_released_version_block() {
        let mut no_tests = facts(&[], &[]);
        no_tests.tests_count = 0;
        assert_eq!(block_of(readiness(&no_tests)), (ReleaseBlock::NoTests, true));
        let releases = [release(2, 3)];
        let checks = [check(3, CheckStatus::Finished, 10, 10, "f")];
        assert_eq!(
            block_of(readiness(&facts(&checks, &releases))),
            (ReleaseBlock::AlreadyReleased { number: 2 }, false)
        );
    }

    #[test]
    fn a_higher_bar_needs_more_good_answers() {
        let checks = [check(3, CheckStatus::Finished, 9, 10, "f")];
        let mut strict = facts(&checks, &[]);
        strict.required_percent = 100;
        assert!(matches!(block_of(readiness(&strict)).0, ReleaseBlock::NotEnoughGood { needed: 10, .. }));
    }

    #[test]
    fn going_back_needs_another_existing_release() {
        let releases = [release(2, 5), release(1, 3)];
        assert!(can_switch_to(&releases, releases.first(), 1));
        assert!(!can_switch_to(&releases, releases.first(), 2), "already in use");
        assert!(!can_switch_to(&releases, releases.first(), 7), "no such release");
        assert!(can_switch_to(&releases, None, 2));
    }
}
