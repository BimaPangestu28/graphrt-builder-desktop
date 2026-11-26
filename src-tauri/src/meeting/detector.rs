//! When to offer taking notes, and when a recorded meeting seems over.
//!
//! Fed every few seconds with the meeting candidates using the microphone. It never
//! starts a recording: it only returns [`DetectorAction`]s the service turns into a
//! prompt or a notification. See the diagram in docs/design/meeting-notetaker.md.

use std::time::{Duration, Instant};

use super::apps::MeetingApp;

/// How long the microphone must be in use before offering, and free before a meeting
/// counts as over.
#[derive(Debug, Clone, Copy)]
pub struct DetectorConfig {
    pub confirm_after: Duration,
    pub release_after: Duration,
}

impl Default for DetectorConfig {
    fn default() -> Self {
        Self { confirm_after: Duration::from_secs(5), release_after: Duration::from_secs(15) }
    }
}

/// What the service should do after an observation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DetectorAction {
    /// Ask "Meeting detected, take notes?" about these programs.
    Prompt(Vec<MeetingApp>),
    /// The prompt is no longer relevant (the microphone was released); hide it.
    WithdrawPrompt,
    /// Recording, and the microphone has been free for a while: ask whether to stop.
    MeetingEnded,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Phase {
    Idle,
    /// The microphone is in use since `since`; not offered yet.
    Pending {
        since: Instant,
    },
    /// Offered; waiting for the user.
    Prompted {
        apps: Vec<MeetingApp>,
    },
    /// The user said "Not now" (or stopped a recording) during this meeting.
    Dismissed,
    Recording {
        has_reported_end: bool,
    },
}

/// The detection state machine. Pure: time comes in with each call.
#[derive(Debug, Clone)]
pub struct MeetingDetector {
    config: DetectorConfig,
    phase: Phase,
    /// Last observation with the microphone in use (for the release delay).
    last_in_use: Option<Instant>,
}

impl MeetingDetector {
    pub fn new(config: DetectorConfig) -> Self {
        Self { config, phase: Phase::Idle, last_in_use: None }
    }

    /// The programs of the open prompt, if any.
    pub fn prompted_apps(&self) -> Option<&[MeetingApp]> {
        match &self.phase {
            Phase::Prompted { apps } => Some(apps),
            _ => None,
        }
    }

    /// One observation: `apps` are the meeting candidates using the microphone now,
    /// `is_recording` whether the notetaker records.
    pub fn observe(&mut self, now: Instant, apps: &[MeetingApp], is_recording: bool) -> Option<DetectorAction> {
        let in_use = !apps.is_empty();
        if in_use || (is_recording && self.last_in_use.is_none()) {
            // A recording started by hand with nothing on the microphone counts from its
            // first observation, so it is not "over" at once.
            self.last_in_use = Some(now);
        }
        let released = !in_use && self.has_been_free_for_release(now);

        if is_recording && !matches!(self.phase, Phase::Recording { .. }) {
            // Started from the Meetings page (or the prompt): follow it.
            self.phase = Phase::Recording { has_reported_end: false };
        }
        if !is_recording && matches!(self.phase, Phase::Recording { .. }) {
            self.recording_stopped();
        }

        match &mut self.phase {
            Phase::Idle => {
                if in_use {
                    self.phase = Phase::Pending { since: now };
                }
                None
            }
            Phase::Pending { since } => {
                if !in_use {
                    self.phase = Phase::Idle;
                    None
                } else if now.saturating_duration_since(*since) >= self.config.confirm_after {
                    self.phase = Phase::Prompted { apps: apps.to_vec() };
                    Some(DetectorAction::Prompt(apps.to_vec()))
                } else {
                    None
                }
            }
            Phase::Prompted { .. } => {
                if released {
                    self.phase = Phase::Idle;
                    Some(DetectorAction::WithdrawPrompt)
                } else {
                    None
                }
            }
            Phase::Dismissed => {
                if released {
                    self.phase = Phase::Idle;
                }
                None
            }
            Phase::Recording { has_reported_end } => {
                if in_use {
                    *has_reported_end = false;
                    None
                } else if released && !*has_reported_end {
                    *has_reported_end = true;
                    Some(DetectorAction::MeetingEnded)
                } else {
                    None
                }
            }
        }
    }

    /// "Not now": stay quiet until the microphone is released.
    pub fn dismiss(&mut self) {
        if matches!(self.phase, Phase::Prompted { .. } | Phase::Pending { .. }) {
            self.phase = Phase::Dismissed;
        }
    }

    pub fn recording_started(&mut self) {
        self.phase = Phase::Recording { has_reported_end: false };
    }

    /// After Stop: a meeting still on the microphone is not offered again.
    pub fn recording_stopped(&mut self) {
        if matches!(self.phase, Phase::Recording { .. }) {
            self.phase = Phase::Dismissed;
        }
    }

    /// Detection turned off: forget everything.
    pub fn reset(&mut self) {
        self.phase = Phase::Idle;
        self.last_in_use = None;
    }

    fn has_been_free_for_release(&self, now: Instant) -> bool {
        match self.last_in_use {
            Some(last) => now.saturating_duration_since(last) >= self.config.release_after,
            None => true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meeting::apps::MeetingAppKind;

    fn zoom() -> Vec<MeetingApp> {
        vec![MeetingApp { kind: MeetingAppKind::Zoom, label: "Zoom".into(), stream_id: 7, pid: Some(42) }]
    }

    fn detector() -> (MeetingDetector, Instant) {
        let config = DetectorConfig { confirm_after: Duration::from_secs(5), release_after: Duration::from_secs(15) };
        (MeetingDetector::new(config), Instant::now())
    }

    fn at(start: Instant, seconds: u64) -> Instant {
        start + Duration::from_secs(seconds)
    }

    #[test]
    fn offers_once_after_the_microphone_stays_in_use() {
        let (mut detector, start) = detector();
        assert_eq!(detector.observe(at(start, 0), &zoom(), false), None);
        assert_eq!(detector.observe(at(start, 3), &zoom(), false), None);
        assert_eq!(detector.observe(at(start, 6), &zoom(), false), Some(DetectorAction::Prompt(zoom())));
        assert_eq!(detector.prompted_apps(), Some(zoom().as_slice()));
        assert_eq!(detector.observe(at(start, 9), &zoom(), false), None, "offered only once");
    }

    #[test]
    fn a_short_microphone_check_is_not_offered() {
        let (mut detector, start) = detector();
        detector.observe(at(start, 0), &zoom(), false);
        assert_eq!(detector.observe(at(start, 3), &[], false), None);
        assert_eq!(detector.observe(at(start, 6), &zoom(), false), None, "the timer starts again");
        assert_eq!(detector.observe(at(start, 11), &zoom(), false), Some(DetectorAction::Prompt(zoom())));
    }

    #[test]
    fn withdraws_the_prompt_when_the_microphone_is_released() {
        let (mut detector, start) = detector();
        detector.observe(at(start, 0), &zoom(), false);
        detector.observe(at(start, 5), &zoom(), false);
        assert_eq!(detector.observe(at(start, 10), &[], false), None, "a short gap keeps the prompt");
        assert_eq!(detector.observe(at(start, 21), &[], false), Some(DetectorAction::WithdrawPrompt));
        assert_eq!(detector.prompted_apps(), None);
    }

    #[test]
    fn not_now_stays_quiet_for_the_rest_of_the_meeting() {
        let (mut detector, start) = detector();
        detector.observe(at(start, 0), &zoom(), false);
        detector.observe(at(start, 5), &zoom(), false);
        detector.dismiss();
        for second in (10..60).step_by(5) {
            assert_eq!(detector.observe(at(start, second), &zoom(), false), None);
        }
        // Released long enough: the next meeting is offered again.
        detector.observe(at(start, 61), &[], false);
        detector.observe(at(start, 80), &[], false);
        detector.observe(at(start, 90), &zoom(), false);
        assert_eq!(detector.observe(at(start, 96), &zoom(), false), Some(DetectorAction::Prompt(zoom())));
    }

    #[test]
    fn reports_the_end_of_a_recorded_meeting_once() {
        let (mut detector, start) = detector();
        detector.observe(at(start, 0), &zoom(), false);
        detector.observe(at(start, 5), &zoom(), false);
        detector.recording_started();
        assert_eq!(detector.observe(at(start, 10), &zoom(), true), None);
        assert_eq!(detector.observe(at(start, 20), &[], true), None);
        assert_eq!(detector.observe(at(start, 26), &[], true), Some(DetectorAction::MeetingEnded));
        assert_eq!(detector.observe(at(start, 40), &[], true), None, "reported once");
    }

    #[test]
    fn a_recording_started_by_hand_is_followed() {
        let (mut detector, start) = detector();
        assert_eq!(detector.observe(at(start, 0), &[], true), None);
        assert_eq!(detector.observe(at(start, 20), &[], true), Some(DetectorAction::MeetingEnded));
    }

    #[test]
    fn after_stop_the_same_meeting_is_not_offered_again() {
        let (mut detector, start) = detector();
        detector.observe(at(start, 0), &zoom(), true);
        detector.recording_stopped();
        for second in (5..40).step_by(5) {
            assert_eq!(detector.observe(at(start, second), &zoom(), false), None);
        }
    }

    #[test]
    fn a_recording_stopped_elsewhere_is_noticed() {
        let (mut detector, start) = detector();
        detector.observe(at(start, 0), &zoom(), true);
        assert_eq!(detector.observe(at(start, 5), &zoom(), false), None);
        assert_eq!(detector.observe(at(start, 15), &zoom(), false), None, "dismissed, not offered");
    }
}
