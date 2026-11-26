//! Naming the program behind a microphone stream, and skipping the ones that are not
//! meetings (volume meters, audio tools).

use serde::Serialize;

use super::platform::MicUser;

/// The kind of program using the microphone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MeetingAppKind {
    Zoom,
    Teams,
    Slack,
    Discord,
    Webex,
    Skype,
    /// A browser: Google Meet, Teams or Zoom on the web, or anything else in a tab.
    Browser,
    /// Another program; still offered, since it captures the microphone.
    Other,
}

/// A mic user the notetaker cares about, with a name to show.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingApp {
    pub kind: MeetingAppKind,
    /// "Zoom", "Google Chrome", or the program's own name.
    pub label: String,
    pub stream_id: u32,
    pub pid: Option<u32>,
}

/// Programs that read the microphone without being a call (level meters, effects).
const IGNORED_PROGRAMS: &[&str] = &[
    "pavucontrol",
    "gnome-control-center",
    "gnome volume control",
    "gnome shell volume control",
    "easyeffects",
    "wireplumber",
    "pipewire",
    "pulseeffects",
    "helvum",
    "qpwgraph",
    "cava",
];

/// Known meeting apps: a lowercase fragment of the binary or app name, kind, label.
const KNOWN_APPS: &[(&str, MeetingAppKind, &str)] = &[
    ("zoom", MeetingAppKind::Zoom, "Zoom"),
    ("teams", MeetingAppKind::Teams, "Microsoft Teams"),
    ("slack", MeetingAppKind::Slack, "Slack"),
    ("discord", MeetingAppKind::Discord, "Discord"),
    ("webex", MeetingAppKind::Webex, "Webex"),
    ("skype", MeetingAppKind::Skype, "Skype"),
    ("google chrome", MeetingAppKind::Browser, "Google Chrome"),
    ("chrome", MeetingAppKind::Browser, "Google Chrome"),
    ("chromium", MeetingAppKind::Browser, "Chromium"),
    ("firefox", MeetingAppKind::Browser, "Firefox"),
    ("brave", MeetingAppKind::Browser, "Brave"),
    ("msedge", MeetingAppKind::Browser, "Microsoft Edge"),
    ("microsoft edge", MeetingAppKind::Browser, "Microsoft Edge"),
    ("vivaldi", MeetingAppKind::Browser, "Vivaldi"),
    ("opera", MeetingAppKind::Browser, "Opera"),
];

/// Names the program behind `user`, or `None` when it is not a meeting candidate.
pub fn classify(user: &MicUser) -> Option<MeetingApp> {
    let app_name = user.app_name.trim().to_lowercase();
    let binary = user.binary.as_deref().map(|binary| binary.trim().to_lowercase()).unwrap_or_default();
    if IGNORED_PROGRAMS.iter().any(|ignored| app_name == *ignored || binary == *ignored) {
        return None;
    }
    let known = KNOWN_APPS
        .iter()
        .find(|(fragment, _, _)| binary.contains(fragment))
        .or_else(|| KNOWN_APPS.iter().find(|(fragment, _, _)| app_name.contains(fragment)));
    let (kind, label) = match known {
        Some((_, kind, label)) => (*kind, (*label).to_owned()),
        None => (MeetingAppKind::Other, fallback_label(user)),
    };
    Some(MeetingApp { kind, label, stream_id: user.stream_id, pid: user.pid })
}

/// The meeting candidates among `users`, one per program (several streams of one app,
/// e.g. Chrome's two capture streams, show once). Known meeting apps come first.
pub fn meeting_apps(users: &[MicUser]) -> Vec<MeetingApp> {
    let mut apps: Vec<MeetingApp> = Vec::new();
    for app in users.iter().filter_map(classify) {
        let is_duplicate =
            apps.iter().any(|seen| seen.label == app.label && (seen.pid == app.pid || seen.pid.is_none()));
        if !is_duplicate {
            apps.push(app);
        }
    }
    apps.sort_by_key(|app| match app.kind {
        MeetingAppKind::Browser => 1,
        MeetingAppKind::Other => 2,
        _ => 0,
    });
    apps
}

/// "Zoom is using the microphone" / "Google Chrome and Zoom are using the microphone".
pub fn describe_users(apps: &[MeetingApp]) -> String {
    let labels: Vec<&str> = apps.iter().map(|app| app.label.as_str()).collect();
    match labels.as_slice() {
        [] => "A program is using the microphone".to_owned(),
        [one] => format!("{one} is using the microphone"),
        [rest @ .., last] => format!("{} and {last} are using the microphone", rest.join(", ")),
    }
}

fn fallback_label(user: &MicUser) -> String {
    let name = user.app_name.trim();
    if !name.is_empty() {
        return name.to_owned();
    }
    user.binary.clone().unwrap_or_else(|| "A program".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(stream_id: u32, app_name: &str, binary: Option<&str>, pid: Option<u32>) -> MicUser {
        MicUser { stream_id, app_name: app_name.into(), binary: binary.map(Into::into), pid }
    }

    #[test]
    fn names_known_meeting_apps_by_binary_or_app_name() {
        let zoom = classify(&user(1, "ZOOM VoiceEngine", Some("zoom"), Some(10))).expect("zoom is a candidate");
        assert_eq!((zoom.kind, zoom.label.as_str()), (MeetingAppKind::Zoom, "Zoom"));

        let teams = classify(&user(2, "teams-for-linux", None, None)).expect("teams is a candidate");
        assert_eq!(teams.kind, MeetingAppKind::Teams);

        let chrome =
            classify(&user(3, "Google Chrome input", Some("chrome"), Some(11))).expect("chrome is a candidate");
        assert_eq!((chrome.kind, chrome.label.as_str()), (MeetingAppKind::Browser, "Google Chrome"));
    }

    #[test]
    fn skips_volume_meters_and_audio_tools() {
        assert_eq!(classify(&user(1, "pavucontrol", Some("pavucontrol"), None)), None);
        assert_eq!(classify(&user(2, "GNOME Volume Control", None, None)), None);
        assert_eq!(classify(&user(3, "EasyEffects", Some("easyeffects"), None)), None);
    }

    #[test]
    fn unknown_programs_are_still_offered_under_their_own_name() {
        let app = classify(&user(1, "obs", Some("obs"), Some(5))).expect("a candidate");
        assert_eq!((app.kind, app.label.as_str()), (MeetingAppKind::Other, "obs"));
        let unnamed = classify(&user(2, " ", Some("arecord"), None)).expect("a candidate");
        assert_eq!(unnamed.label, "arecord");
    }

    #[test]
    fn one_entry_per_program_with_meeting_apps_first() {
        let users = vec![
            user(1, "Google Chrome input", Some("chrome"), Some(11)),
            user(2, "Google Chrome input", Some("chrome"), Some(11)),
            user(3, "ZOOM VoiceEngine", Some("zoom"), Some(10)),
            user(4, "pavucontrol", None, None),
        ];
        let apps = meeting_apps(&users);
        let labels: Vec<&str> = apps.iter().map(|app| app.label.as_str()).collect();
        assert_eq!(labels, ["Zoom", "Google Chrome"]);
    }

    #[test]
    fn describes_who_uses_the_microphone() {
        let zoom = classify(&user(1, "zoom", None, None)).expect("candidate");
        let chrome = classify(&user(2, "chrome", None, None)).expect("candidate");
        assert_eq!(describe_users(&[]), "A program is using the microphone");
        assert_eq!(describe_users(std::slice::from_ref(&zoom)), "Zoom is using the microphone");
        assert_eq!(describe_users(&[zoom, chrome]), "Zoom and Google Chrome are using the microphone");
    }
}
