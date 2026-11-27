//! Checks a setting's value before it is saved, by its kind (see `setting_spec.rs`): a folder
//! is made absolute and created when missing, a file must exist, a number must be one.
//! Text and secrets are saved as typed.

use std::path::{Path, PathBuf};

use super::setting_spec::{SettingKind, SettingProfile};
use crate::error::{AppError, AppResult};

/// Separates the entries of a `multiple` setting (the plugins split on commas).
const LIST_SEPARATOR: char = ',';

/// The value to store for a setting of `profile`, from what the user typed or picked.
/// `home_dir` replaces a leading `~`.
///
/// # Errors
/// `InvalidInput` (a sentence for the user) when the value is empty, a path is not absolute,
/// a folder cannot be created, a file does not exist or a number is not a number.
pub(crate) fn prepare_value(profile: &SettingProfile, raw: &str, home_dir: Option<&Path>) -> AppResult<String> {
    let value = raw.trim();
    if value.is_empty() {
        return Err(AppError::InvalidInput("the value is empty".into()));
    }
    match profile.kind {
        SettingKind::Text | SettingKind::Secret => Ok(value.to_owned()),
        SettingKind::Number => match value.parse::<f64>() {
            Ok(number) if number.is_finite() => Ok(value.to_owned()),
            _ => Err(AppError::InvalidInput(format!("`{value}` is not a number"))),
        },
        SettingKind::Folder => each_path(profile, value, home_dir, ensure_folder),
        SettingKind::File => each_path(profile, value, home_dir, require_file),
    }
}

/// Runs `check` on the path (or on each path of a `multiple` setting) and joins the results.
fn each_path(
    profile: &SettingProfile,
    value: &str,
    home_dir: Option<&Path>,
    check: fn(&Path) -> AppResult<()>,
) -> AppResult<String> {
    let entries: Vec<&str> = if profile.multiple {
        value.split(LIST_SEPARATOR).map(str::trim).filter(|entry| !entry.is_empty()).collect()
    } else {
        vec![value]
    };
    if entries.is_empty() {
        return Err(AppError::InvalidInput("the value is empty".into()));
    }
    let mut paths = Vec::with_capacity(entries.len());
    for entry in entries {
        let path = absolute_path(entry, home_dir)?;
        check(&path)?;
        paths.push(path.to_string_lossy().into_owned());
    }
    Ok(paths.join(&LIST_SEPARATOR.to_string()))
}

/// `entry` with a leading `~` replaced by the home folder; refuses a relative path, which
/// would depend on where the app happened to start.
fn absolute_path(entry: &str, home_dir: Option<&Path>) -> AppResult<PathBuf> {
    let expanded = match (entry.strip_prefix('~'), home_dir) {
        (Some(rest), Some(home)) if rest.is_empty() || rest.starts_with(['/', '\\']) => {
            home.join(rest.trim_start_matches(['/', '\\']))
        }
        _ => PathBuf::from(entry),
    };
    if expanded.is_absolute() {
        Ok(expanded)
    } else {
        Err(AppError::InvalidInput(format!("`{entry}` is not a full path (it should start at the top folder)")))
    }
}

fn ensure_folder(path: &Path) -> AppResult<()> {
    if path.is_dir() {
        return Ok(());
    }
    if path.exists() {
        return Err(AppError::InvalidInput(format!("{} is a file, not a folder", path.display())));
    }
    std::fs::create_dir_all(path)
        .map_err(|error| AppError::InvalidInput(format!("could not create the folder {}: {error}", path.display())))
}

fn require_file(path: &Path) -> AppResult<()> {
    if path.is_file() {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!("there is no file at {}", path.display())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(kind: SettingKind, multiple: bool) -> SettingProfile {
        SettingProfile { label: None, help: None, kind, required: false, default_value: None, multiple }
    }

    #[test]
    fn a_folder_that_does_not_exist_is_created() {
        let root = tempfile::tempdir().unwrap();
        let wanted = root.path().join("Invoices").join("2026");
        let saved = prepare_value(&profile(SettingKind::Folder, false), &format!("  {}  ", wanted.display()), None);
        assert_eq!(saved.unwrap(), wanted.to_string_lossy());
        assert!(wanted.is_dir());
    }

    #[test]
    fn a_folder_under_the_home_sign_is_made_absolute() {
        let home = tempfile::tempdir().unwrap();
        let saved = prepare_value(&profile(SettingKind::Folder, false), "~/Documents/Invoices", Some(home.path()));
        let expected = home.path().join("Documents").join("Invoices");
        assert_eq!(saved.unwrap(), expected.to_string_lossy());
        assert!(expected.is_dir());
    }

    #[test]
    fn relative_folders_and_files_in_the_way_are_refused() {
        let root = tempfile::tempdir().unwrap();
        let folder = profile(SettingKind::Folder, false);
        assert!(prepare_value(&folder, "invoices", None).is_err());
        let file = root.path().join("notes.txt");
        std::fs::write(&file, "x").unwrap();
        assert!(prepare_value(&folder, &file.to_string_lossy(), None).is_err());
        assert!(prepare_value(&folder, "   ", None).is_err());
    }

    #[test]
    fn several_folders_are_each_checked_and_joined() {
        let root = tempfile::tempdir().unwrap();
        let (first, second) = (root.path().join("a"), root.path().join("b"));
        let typed = format!("{} , {},", first.display(), second.display());
        let saved = prepare_value(&profile(SettingKind::Folder, true), &typed, None).unwrap();
        assert_eq!(saved, format!("{},{}", first.display(), second.display()));
        assert!(first.is_dir() && second.is_dir());
    }

    #[test]
    fn a_file_must_exist_and_a_number_must_be_one() {
        let root = tempfile::tempdir().unwrap();
        let font = root.path().join("font.ttf");
        let file = profile(SettingKind::File, false);
        assert!(prepare_value(&file, &font.to_string_lossy(), None).is_err());
        std::fs::write(&font, "x").unwrap();
        assert_eq!(prepare_value(&file, &font.to_string_lossy(), None).unwrap(), font.to_string_lossy());

        let number = profile(SettingKind::Number, false);
        assert_eq!(prepare_value(&number, " 200 ", None).unwrap(), "200");
        assert!(prepare_value(&number, "two hundred", None).is_err());
        assert!(prepare_value(&number, "NaN", None).is_err());
    }

    #[test]
    fn text_and_secrets_are_kept_as_typed() {
        assert_eq!(prepare_value(&profile(SettingKind::Secret, false), " abc,def ", None).unwrap(), "abc,def");
        assert_eq!(prepare_value(&profile(SettingKind::Text, false), "v21.0", None).unwrap(), "v21.0");
    }
}
