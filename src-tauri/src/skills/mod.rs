//! Agent skills: reviewing, installing and managing them for the Skills screens.
//!
//! A skill is a `SKILL.md` package (instructions an agent loads when a task needs them).
//! The store, the safety check and every runtime rule live in `graphrt_skill`; this module
//! only brings a skill to the store and shows it in plain words:
//!
//! - **From the catalog** ([`SkillService::review_catalog_skill`], then
//!   [`SkillService::install_catalog_skill`]): the archive comes through
//!   `PluginService::download_catalog_skill`, so the signed index and its checksum are
//!   checked exactly as for a plugin.
//! - **Written in the app** ([`SkillService::review_authored_skill`], then
//!   [`SkillService::install_authored_skill`]): the runtime drafts a skill from plain
//!   words or an example conversation ([`SkillService::draft_skill`]), the person edits
//!   it, and the edited draft is checked again and takes the same path. A skill written
//!   here can be opened again ([`SkillService::authored_draft`]) and saved over itself.
//!
//! Rules this module keeps:
//! - An install is refused when the skill is not the one the person reviewed
//!   ([`SkillReview::review_id`]).
//! - A skill gets exactly the tools the person ticked on the screen, nothing else. An
//!   update never keeps what the installed copy was allowed: the person ticks again.
//! - A finding that blocks needs an explicit second confirmation.
//!
//! The name people see is the skill's own title ([`SkillEntry::title`]) and the catalog
//! version is [`SkillOrigin::version`]. Earlier versions of the app kept both in
//! `origin.detail`; [`SkillService::migrate_legacy_origins`] moves them once, and
//! [`legacy_detail`] reads what has not been moved.

mod active;
mod draft;
pub mod models;
#[cfg(test)]
mod tests;

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use graphrt_skill::{
    Finding, Grant, GrantMode, InstallOptions, OriginKind, Severity, SkillDetails, SkillEntry, SkillOrigin, SkillStore,
};

pub(crate) use self::active::skills_service;

/// Clears the store runs read skills from (tests that published one).
#[cfg(test)]
pub(crate) fn unpublish_for_tests() {
    active::publish(None);
}
use self::draft::CheckedDraft;
use self::models::{
    AuthoredSkillInput, CatalogSkillEntry, FindingSeverity, InstalledSkill, SkillCatalog, SkillDraftSource,
    SkillDraftView, SkillFinding, SkillReview, SkillSource, SkillToolRequest, SkillUpdateChanges, ToolPermission,
    ToolPermissionMode,
};
use crate::error::{AppError, AppResult};
use crate::plugins::display_name::{humanize_plugin_name, resolve_display_name};
use crate::plugins::models::CatalogSkill;
use crate::plugins::PluginService;

/// Folder of the skill store inside the app data folder.
pub const SKILLS_DIR_NAME: &str = "skills";
/// A tool request for every tool of a provider.
const EVERY_TOOL: &str = "*";
/// Tool providers the app always has.
const BUILT_IN_TOOL_PROVIDERS: &[&str] = &["agents"];

/// Where the model that drafts skills comes from: the app uses the person's default
/// model, tests a scripted one.
pub trait DraftModelSource: Send + Sync + std::fmt::Debug {
    /// The model to draft with.
    ///
    /// # Errors
    /// `MissingCredentials` when no model is connected; whatever building it reports.
    fn text_model(&self) -> AppResult<Arc<dyn graphrt_core::text_model::TextModel>>;
}

/// The person's default model (Connections > AI models), built from the keychain.
#[derive(Debug)]
pub struct DefaultDraftModel {
    pub db: Arc<crate::storage::Database>,
    pub credentials: Arc<crate::credentials::CredentialStore>,
}

impl DraftModelSource for DefaultDraftModel {
    fn text_model(&self) -> AppResult<Arc<dyn graphrt_core::text_model::TextModel>> {
        let choice = crate::credentials::default_model(&self.credentials, &self.db)?;
        let registry = crate::credentials::build_model_registry(&self.credentials, &self.db)?;
        let model = registry
            .get(choice.provider.registry_name())
            .map_err(|error| AppError::Model(format!("the default model is not available: {error}")))?;
        Ok(Arc::new(graphrt_llm::text_model::ChatTextModel::new(model, choice.name)))
    }
}

/// The Skills screens' backend.
#[derive(Debug)]
pub struct SkillService {
    store: Arc<SkillStore>,
    plugins: Arc<PluginService>,
    draft_model: Arc<dyn DraftModelSource>,
}

/// Who a skill being installed comes from.
struct Provenance {
    origin: SkillOrigin,
    display_name: String,
    instructions: Option<String>,
}

impl SkillService {
    /// A service over the store in `<app data>/skills`. Nothing is read or created yet.
    pub fn new(app_data_dir: &Path, plugins: Arc<PluginService>, draft_model: Arc<dyn DraftModelSource>) -> Self {
        Self { store: Arc::new(SkillStore::open(app_data_dir.join(SKILLS_DIR_NAME))), plugins, draft_model }
    }

    /// Makes this service's store the one runs read skills from (the app's service only).
    pub fn activate(&self) {
        active::publish(Some(self.store.clone()));
    }

    /// Installed skills, by name.
    ///
    /// # Errors
    /// `Internal` when the store cannot be read.
    pub fn list_installed(&self) -> AppResult<Vec<InstalledSkill>> {
        let labels = self.tool_labels();
        let catalog_names = self.known_catalog_display_names();
        let entries = self.store.list().map_err(skill_error)?;
        Ok(entries.iter().map(|entry| installed_view(entry, &labels, &catalog_names)).collect())
    }

    /// One installed skill.
    ///
    /// # Errors
    /// `NotFound` when it is not installed.
    pub fn installed(&self, name: &str) -> AppResult<InstalledSkill> {
        let entry = self.store.get(name).map_err(skill_error)?;
        Ok(installed_view(&entry, &self.tool_labels(), &self.known_catalog_display_names()))
    }

    /// The catalog's skills with their install state.
    ///
    /// # Errors
    /// The catalog's fetch error when there is no saved copy either; `Internal` when the
    /// store cannot be read.
    pub async fn catalog(&self, refresh: bool) -> AppResult<SkillCatalog> {
        let listed = self.plugins.catalog_skills(refresh).await?;
        let installed: HashMap<String, SkillEntry> =
            self.store.list().map_err(skill_error)?.into_iter().map(|entry| (entry.name.clone(), entry)).collect();
        let skills = listed
            .skills
            .iter()
            .map(|skill| {
                let installed_entry = installed.get(&skill.name);
                CatalogSkillEntry {
                    name: skill.name.clone(),
                    display_name: resolve_display_name(&skill.name, [skill.display_name.as_deref()]),
                    description: skill.description.clone(),
                    version: Some(skill.version.clone()).filter(|version| !version.is_empty()),
                    publisher: skill.publisher.clone(),
                    installed: installed_entry.is_some(),
                    update_available: installed_entry.is_some_and(|entry| catalog_has_newer(skill, entry)),
                }
            })
            .collect();
        Ok(SkillCatalog { skills, from_cache: listed.from_cache })
    }

    /// Downloads catalog skill `name` and returns what the confirmation screens show.
    /// Nothing is installed.
    ///
    /// # Errors
    /// As `PluginService::download_catalog_skill`; `InvalidInput` for an unsafe archive or
    /// a package that is not a valid skill.
    pub async fn review_catalog_skill(&self, name: &str) -> AppResult<SkillReview> {
        let (entry, archive) = self.plugins.download_catalog_skill(name).await?;
        let staged = stage_archive(name, &archive)?;
        self.review(&staged.skill_dir, catalog_provenance(&entry))
    }

    /// Installs catalog skill `name` as reviewed, with exactly `permissions`.
    ///
    /// # Errors
    /// As [`SkillService::review_catalog_skill`]; `Conflict` when the skill is no longer
    /// the one reviewed or replaces a skill that did not come from the catalog;
    /// `InvalidInput` for a permission the skill does not ask for or a blocking finding
    /// that was not confirmed.
    pub async fn install_catalog_skill(
        &self,
        name: &str,
        review_id: &str,
        permissions: &[ToolPermission],
        accept_findings: bool,
    ) -> AppResult<InstalledSkill> {
        let (entry, archive) = self.plugins.download_catalog_skill(name).await?;
        let staged = stage_archive(name, &archive)?;
        let request = InstallRequest { review_id, permissions, accept_findings };
        self.install(&staged.skill_dir, catalog_provenance(&entry), &request)
    }

    /// Asks the person's model to draft a skill from plain words or an example
    /// conversation. Nothing is installed: the draft is for the person to read and edit.
    /// It may ask only for tools of the plugins installed here, and asking allows nothing.
    ///
    /// # Errors
    /// `MissingCredentials` when no model is connected; `InvalidInput` for an empty
    /// source; `Model` when the model fails or its answer is not a skill.
    pub async fn draft_skill(&self, source: &SkillDraftSource) -> AppResult<SkillDraftView> {
        let model = self.draft_model.text_model()?;
        draft::draft_from_source(model.as_ref(), source, self.available_tools()).await
    }

    /// Asks the person's model to write one skill from the notes `agent_id` learned
    /// about how to do its work (approved notes that apply to everyone). `None` when
    /// there are too few such notes. Nothing is installed: the draft is read and edited
    /// like any other.
    ///
    /// # Errors
    /// `MissingCredentials` when no model is connected; `Model` when the model fails or
    /// its answer is not a skill; `Internal` when the notes cannot be read.
    pub async fn draft_skill_from_notes(
        &self,
        notes: &graphrt_learn::LessonStore,
        agent_id: &str,
    ) -> AppResult<Option<SkillDraftView>> {
        let model = self.draft_model.text_model()?;
        let drafted = graphrt_learn::draft_skill_from_lessons(notes, agent_id, model.as_ref(), &self.available_tools())
            .await
            .map_err(|error| match error {
                graphrt_learn::Error::SkillDraft(message) => AppError::Model(message),
                other => {
                    log::error!("lesson store: {other}");
                    AppError::Internal("what this agent learned could not be read".into())
                }
            })?;
        Ok(drafted.map(|drafted| draft::draft_view(&drafted, None)))
    }

    /// A skill written in the app, as the editor shows it, so it can be changed and
    /// saved over itself.
    ///
    /// # Errors
    /// `NotFound` when it is not installed; `InvalidInput` when it was not written here.
    pub fn authored_draft(&self, name: &str) -> AppResult<SkillDraftView> {
        let entry = self.store.get(name).map_err(skill_error)?;
        if entry.origin.kind != OriginKind::Authored {
            return Err(AppError::InvalidInput("only a skill written in the app can be edited here".into()));
        }
        Ok(SkillDraftView {
            name: Some(entry.name.clone()),
            title: resolve_display_name(&entry.name, [display_title(&entry)]),
            description: entry.description.clone(),
            instructions: self.instructions_of(&entry)?,
            requested_tools: entry.requested_tools.clone(),
        })
    }

    /// Moves what earlier versions of the app kept in `origin.detail` (the name people
    /// see of a skill written here, the catalog version of a catalog skill) to where the
    /// runtime now keeps it. The same files are installed again with what the person
    /// allowed; nothing else changes. Returns how many skills were moved. A skill that
    /// cannot be moved is logged and keeps working ([`legacy_detail`]).
    pub fn migrate_legacy_origins(&self) -> usize {
        let entries = match self.store.list() {
            Ok(entries) => entries,
            Err(error) => {
                log::warn!("skills: could not read the installed skills to update how they are saved: {error}");
                return 0;
            }
        };
        let mut moved = 0;
        for entry in entries.iter().filter(|entry| legacy_detail(entry).is_some()) {
            match self.reinstall_without_legacy_detail(entry) {
                Ok(()) => moved += 1,
                Err(error) => log::warn!("skills: could not update how {} is saved: {error}", entry.name),
            }
        }
        moved
    }

    fn reinstall_without_legacy_detail(&self, entry: &SkillEntry) -> AppResult<()> {
        let legacy = legacy_detail(entry).map(str::to_owned);
        let folder = staging_folder()?;
        let skill_dir = match entry.origin.kind {
            // The title becomes part of the skill file.
            OriginKind::Authored => graphrt_skill::SkillDraft::new(
                &entry.name,
                &entry.description,
                &self.instructions_of(entry)?,
                &entry.requested_tools,
            )
            .and_then(|draft| draft.with_title(legacy.as_deref().unwrap_or_default()))
            .and_then(|draft| draft.write_to(folder.path()))
            .map_err(skill_error)?,
            // The same files, as pinned at install: only the origin is written anew.
            _ => {
                let skill_dir = folder.path().join(&entry.name);
                for (path, bytes) in self.store.export(&entry.name).map_err(skill_error)? {
                    let target = skill_dir.join(&path);
                    let parent = target.parent().unwrap_or(&skill_dir);
                    std::fs::create_dir_all(parent)
                        .and_then(|()| std::fs::write(&target, bytes))
                        .map_err(|error| AppError::Internal(format!("could not copy the skill: {error}")))?;
                }
                skill_dir
            }
        };
        let origin = SkillOrigin {
            detail: None,
            version: entry.origin.version.clone().or(legacy.filter(|_| is_catalog(&entry.origin))),
            ..entry.origin.clone()
        };
        let options = InstallOptions {
            grants: entry.grants.clone(),
            // The person confirmed these findings when they added the skill.
            accept_findings: true,
            replace: true,
            origin,
        };
        self.store.install(&skill_dir, options).map_err(skill_error)?;
        if !entry.enabled {
            self.store.set_enabled(&entry.name, false).map_err(skill_error)?;
        }
        Ok(())
    }

    /// The instructions of an installed skill, also of one that is turned off.
    fn instructions_of(&self, entry: &SkillEntry) -> AppResult<String> {
        let files = self.store.export(&entry.name).map_err(skill_error)?;
        let skill_file = files
            .iter()
            .find(|(path, _)| path == graphrt_skill::SKILL_FILE)
            .ok_or_else(|| AppError::Internal("the skill has no instructions file".into()))?;
        let text = String::from_utf8_lossy(&skill_file.1);
        Ok(graphrt_skill::parse_skill_file(&text).map_err(skill_error)?.body)
    }

    /// Every tool of the plugins installed here, as a draft may ask for it.
    fn available_tools(&self) -> Vec<String> {
        self.plugins
            .tool_specs()
            .into_iter()
            .flat_map(|(provider, specs)| specs.into_iter().map(move |spec| format!("{provider}/{}", spec.name)))
            .collect()
    }

    /// Checks the draft as the person left it and returns what the confirmation screens show.
    ///
    /// # Errors
    /// `InvalidInput` for a draft that cannot be a skill (see `draft::checked_draft`).
    pub fn review_authored_skill(&self, input: &AuthoredSkillInput) -> AppResult<SkillReview> {
        self.check_edited_skill(input)?;
        let draft = draft::checked_draft(input)?;
        let staged = stage_draft(&draft)?;
        self.review(&staged.skill_dir, authored_provenance(&draft))
    }

    /// Installs the draft as reviewed.
    ///
    /// # Errors
    /// As [`SkillService::install_catalog_skill`].
    pub fn install_authored_skill(
        &self,
        input: &AuthoredSkillInput,
        review_id: &str,
        permissions: &[ToolPermission],
        accept_findings: bool,
    ) -> AppResult<InstalledSkill> {
        self.check_edited_skill(input)?;
        let draft = draft::checked_draft(input)?;
        let staged = stage_draft(&draft)?;
        let request = InstallRequest { review_id, permissions, accept_findings };
        self.install(&staged.skill_dir, authored_provenance(&draft), &request)
    }

    /// When `input` changes an installed skill ([`AuthoredSkillInput::name`]): that skill
    /// must be installed and written here.
    fn check_edited_skill(&self, input: &AuthoredSkillInput) -> AppResult<()> {
        let Some(name) = input.name.as_deref() else { return Ok(()) };
        let entry = self.store.get(name).map_err(skill_error)?;
        if entry.origin.kind != OriginKind::Authored {
            return Err(AppError::InvalidInput("only a skill written in the app can be edited here".into()));
        }
        Ok(())
    }

    /// Replaces what an installed skill may use.
    ///
    /// # Errors
    /// `NotFound` when it is not installed; `InvalidInput` for a tool it does not ask for.
    pub fn set_permissions(&self, name: &str, permissions: &[ToolPermission]) -> AppResult<InstalledSkill> {
        self.store.set_grants(name, grants_of(permissions)).map_err(skill_error)?;
        self.installed(name)
    }

    /// Turns a skill on or off. A skill that is off is offered to no agent.
    ///
    /// # Errors
    /// `NotFound` when it is not installed.
    pub fn set_enabled(&self, name: &str, enabled: bool) -> AppResult<InstalledSkill> {
        self.store.set_enabled(name, enabled).map_err(skill_error)?;
        self.installed(name)
    }

    /// Removes a skill and its files. Agents that still list it stop with graphrt's
    /// "skill not installed" error until it is taken off them (see `agent_graph::skills`).
    ///
    /// # Errors
    /// `NotFound` when it is not installed.
    pub fn remove(&self, name: &str) -> AppResult<()> {
        self.store.remove(name).map_err(skill_error)
    }

    fn review(&self, skill_dir: &Path, provenance: Provenance) -> AppResult<SkillReview> {
        let details = self.store.inspect_dir(skill_dir).map_err(skill_error)?;
        let labels = self.tool_labels();
        let entry = &details.entry;
        Ok(SkillReview {
            name: entry.name.clone(),
            display_name: provenance.display_name,
            description: entry.description.clone(),
            source: provenance.origin.kind.into(),
            publisher: provenance.origin.publisher.clone(),
            version: entry.version.clone().or_else(|| provenance.origin.version.clone()),
            review_id: entry.digest.clone(),
            requested_tools: labels.requests(&entry.requested_tools),
            unsupported_tools: entry.unsupported_tools.clone(),
            has_scripts: entry.has_scripts,
            findings: entry.findings.iter().map(finding_view).collect(),
            needs_extra_confirmation: details.blocked,
            update: update_view(&details, &labels),
            instructions: provenance.instructions,
        })
    }

    fn install(
        &self,
        skill_dir: &Path,
        provenance: Provenance,
        request: &InstallRequest<'_>,
    ) -> AppResult<InstalledSkill> {
        let details = self.store.inspect_dir(skill_dir).map_err(skill_error)?;
        if details.entry.digest != request.review_id {
            return Err(AppError::Conflict(
                "this skill changed since you looked at it; nothing was installed. Review it again".into(),
            ));
        }
        // `details.installed` is the runtime's word on whether this replaces a skill.
        let replaced = if details.installed { self.store.get(&details.entry.name).ok() } else { None };
        if replaced.as_ref().is_some_and(|installed| installed.origin.kind != provenance.origin.kind) {
            return Err(AppError::Conflict(format!(
                "another skill named {} is already installed; remove it first",
                provenance.display_name
            )));
        }
        let options = InstallOptions {
            // Exactly what the person ticked now. Nothing is read from the installed copy,
            // so an update never keeps a tool the person did not allow again.
            grants: grants_of(request.permissions),
            accept_findings: request.accept_findings,
            replace: replaced.is_some(),
            origin: provenance.origin,
        };
        let mut entry = self.store.install(skill_dir, options).map_err(skill_error)?;
        // Installing turns a skill on. One the person had turned off stays off.
        if replaced.is_some_and(|installed| !installed.enabled) {
            entry = self.store.set_enabled(&entry.name, false).map_err(skill_error)?;
        }
        Ok(installed_view(&entry, &self.tool_labels(), &self.known_catalog_display_names()))
    }

    /// Names for tool references: what plugins and MCP servers this computer has.
    fn tool_labels(&self) -> ToolLabels {
        let mut providers: HashSet<String> = BUILT_IN_TOOL_PROVIDERS.iter().map(|name| (*name).to_owned()).collect();
        let mut tools: HashSet<(String, String)> = HashSet::new();
        for (provider, specs) in self.plugins.tool_specs() {
            for spec in specs {
                tools.insert((provider.clone(), spec.name));
            }
            providers.insert(provider);
        }
        let mut open_providers: HashSet<String> =
            BUILT_IN_TOOL_PROVIDERS.iter().map(|name| (*name).to_owned()).collect();
        for server in crate::mcp::current().iter() {
            // An MCP server's tools are only known once it is connected.
            providers.insert(server.name.clone());
            open_providers.insert(server.name.clone());
        }
        ToolLabels { display_names: self.plugins.plugin_display_names(), providers, open_providers, tools }
    }

    /// Curated names of the catalog's skills, when a catalog is known without fetching.
    fn known_catalog_display_names(&self) -> HashMap<String, String> {
        // Asked from this app's plugin service, not from the process-wide published copy:
        // that one is only there once start-up has published it.
        self.plugins
            .known_catalog_skills()
            .into_iter()
            .filter_map(|skill| Some((skill.name, skill.display_name?)))
            .collect()
    }
}

/// What the person decided on the confirmation screens.
struct InstallRequest<'request> {
    review_id: &'request str,
    permissions: &'request [ToolPermission],
    accept_findings: bool,
}

/// A skill unpacked into a temporary folder that is removed when this is dropped.
struct StagedSkill {
    _folder: tempfile::TempDir,
    skill_dir: std::path::PathBuf,
}

fn staging_folder() -> AppResult<tempfile::TempDir> {
    tempfile::Builder::new()
        .prefix("graphrt-skill-")
        .tempdir()
        .map_err(|error| AppError::Internal(format!("could not create a temporary folder for the skill: {error}")))
}

/// Unpacks a checksum-verified skill archive (its single top-level folder is `name`) with
/// the plugin extractor: no links, no paths outside the folder, bounded size.
fn stage_archive(name: &str, archive: &[u8]) -> AppResult<StagedSkill> {
    let folder = staging_folder()?;
    let skill_dir =
        crate::plugins::archive::extract_plugin_tarball(archive, name, folder.path()).map_err(|error| match error {
            AppError::InvalidInput(message) => {
                AppError::InvalidInput(message.replace("plugin archive", "skill archive"))
            }
            other => other,
        })?;
    Ok(StagedSkill { _folder: folder, skill_dir })
}

/// Writes a checked draft as a one-file skill folder, so it is reviewed and installed
/// through the same calls as a downloaded skill.
fn stage_draft(checked: &CheckedDraft) -> AppResult<StagedSkill> {
    let folder = staging_folder()?;
    // The draft carries the name people see, so it is saved with the skill itself.
    let skill_dir = checked.draft.write_to(folder.path()).map_err(skill_error)?;
    Ok(StagedSkill { _folder: folder, skill_dir })
}

fn catalog_provenance(entry: &CatalogSkill) -> Provenance {
    Provenance {
        origin: SkillOrigin {
            kind: OriginKind::Catalog,
            // The catalog version installed, compared with the catalog's to offer updates.
            version: Some(entry.version.clone()).filter(|version| !version.is_empty()),
            publisher: entry.publisher.clone(),
            // Set only here: the archive matched the checksum of the signed index.
            verified: true,
            ..SkillOrigin::default()
        },
        display_name: resolve_display_name(&entry.name, [entry.display_name.as_deref()]),
        instructions: None,
    }
}

fn authored_provenance(checked: &CheckedDraft) -> Provenance {
    Provenance {
        origin: SkillOrigin { kind: OriginKind::Authored, ..SkillOrigin::default() },
        display_name: checked.title.clone(),
        instructions: Some(checked.draft.body.clone()),
    }
}

fn is_catalog(origin: &SkillOrigin) -> bool {
    origin.kind == OriginKind::Catalog
}

/// Whether the catalog offers a newer version than the installed catalog copy.
fn catalog_has_newer(skill: &CatalogSkill, installed: &SkillEntry) -> bool {
    if !is_catalog(&installed.origin) || skill.version.is_empty() {
        return false;
    }
    match catalog_version(installed) {
        Some(installed_version) => crate::plugins::is_newer_version(&skill.version, installed_version),
        None => true,
    }
}

/// What an earlier version of the app kept in `origin.detail` and has not been moved yet
/// (see [`SkillService::migrate_legacy_origins`]): the name people see of a skill written
/// here, or the catalog version of a catalog skill.
fn legacy_detail(entry: &SkillEntry) -> Option<&str> {
    let already_moved = match entry.origin.kind {
        OriginKind::Authored => entry.title.is_some(),
        OriginKind::Catalog => entry.origin.version.is_some(),
        OriginKind::Local | OriginKind::Learned => true,
    };
    entry.origin.detail.as_deref().filter(|detail| !already_moved && !detail.trim().is_empty())
}

/// The catalog version an installed catalog skill came as.
fn catalog_version(entry: &SkillEntry) -> Option<&str> {
    if !is_catalog(&entry.origin) {
        return None;
    }
    entry.origin.version.as_deref().or_else(|| legacy_detail(entry))
}

/// The name the skill gives itself for people, when it has one.
fn display_title(entry: &SkillEntry) -> Option<&str> {
    let legacy = legacy_detail(entry).filter(|_| entry.origin.kind == OriginKind::Authored);
    entry.title.as_deref().or(legacy)
}

fn grants_of(permissions: &[ToolPermission]) -> Vec<Grant> {
    permissions
        .iter()
        .map(|permission| match permission.mode {
            ToolPermissionMode::Ask => Grant::ask(permission.tool.clone()),
            ToolPermissionMode::Allow => Grant::allow(permission.tool.clone()),
        })
        .collect()
}

fn permission_view(grant: &Grant) -> ToolPermission {
    let mode = match grant.mode {
        GrantMode::Ask => ToolPermissionMode::Ask,
        GrantMode::Allow => ToolPermissionMode::Allow,
    };
    ToolPermission { tool: grant.tool.clone(), mode }
}

fn finding_view(finding: &Finding) -> SkillFinding {
    let severity = match finding.severity {
        Severity::Info => FindingSeverity::Info,
        Severity::Warning => FindingSeverity::Warning,
        Severity::Blocking => FindingSeverity::Blocking,
    };
    SkillFinding {
        severity,
        code: finding.code.clone(),
        message: finding.message.clone(),
        file: finding.file.clone(),
        line: finding.line,
        details: finding.params.clone(),
    }
}

fn update_view(details: &SkillDetails, labels: &ToolLabels) -> Option<SkillUpdateChanges> {
    let changes = details.changes.as_ref()?;
    Some(SkillUpdateChanges {
        added_tools: labels.requests(&changes.added_tools),
        removed_tools: labels.requests(&changes.removed_tools),
        changed_files: changes.changed_files.clone(),
        added_files: changes.added_files.clone(),
        removed_files: changes.removed_files.clone(),
        nothing_changed: changes.is_empty(),
    })
}

fn installed_view(entry: &SkillEntry, labels: &ToolLabels, catalog_names: &HashMap<String, String>) -> InstalledSkill {
    // The catalog's own name for a catalog skill, then the name the skill gives itself.
    let catalog_name = catalog_names.get(&entry.name).map(String::as_str).filter(|_| is_catalog(&entry.origin));
    let catalog_version = catalog_version(entry).map(str::to_owned);
    let source = SkillSource::from(entry.origin.kind);
    InstalledSkill {
        name: entry.name.clone(),
        display_name: resolve_display_name(&entry.name, [catalog_name, display_title(entry)]),
        description: entry.description.clone(),
        enabled: entry.enabled,
        source,
        can_edit: source == SkillSource::Authored,
        publisher: entry.origin.publisher.clone(),
        verified: is_catalog(&entry.origin) && entry.origin.verified,
        version: entry.version.clone().or(catalog_version),
        installed_at: installed_at(entry.installed_at_ms),
        requested_tools: labels.requests(&entry.requested_tools),
        permissions: entry.grants.iter().map(permission_view).collect(),
        unsupported_tools: entry.unsupported_tools.clone(),
        has_scripts: entry.has_scripts,
        findings: entry.findings.iter().map(finding_view).collect(),
    }
}

fn installed_at(installed_at_ms: u64) -> Option<String> {
    let milliseconds = i64::try_from(installed_at_ms).ok().filter(|milliseconds| *milliseconds > 0)?;
    DateTime::<Utc>::from_timestamp_millis(milliseconds).map(|time| time.to_rfc3339())
}

/// What this computer knows about tool providers, for naming tool references.
struct ToolLabels {
    /// Plugin name to the name people see.
    display_names: HashMap<String, String>,
    /// Providers that exist here.
    providers: HashSet<String>,
    /// Providers whose tools are not listed up front (any tool name may exist).
    open_providers: HashSet<String>,
    /// `(provider, tool)` pairs known to exist.
    tools: HashSet<(String, String)>,
}

impl ToolLabels {
    fn requests(&self, references: &[String]) -> Vec<SkillToolRequest> {
        references.iter().map(|reference| self.request(reference)).collect()
    }

    fn request(&self, reference: &str) -> SkillToolRequest {
        let (provider, tool) = reference.split_once('/').unwrap_or((reference, EVERY_TOOL));
        let covers_everything = tool == EVERY_TOOL;
        let provider_known = self.providers.contains(provider);
        let available = provider_known
            && (covers_everything
                || self.open_providers.contains(provider)
                || self.tools.contains(&(provider.to_owned(), tool.to_owned())));
        SkillToolRequest {
            tool: reference.to_owned(),
            provider_label: self.display_names.get(provider).cloned().unwrap_or_else(|| humanize_plugin_name(provider)),
            action_label: if covers_everything { String::new() } else { humanize_action(tool) },
            covers_everything,
            available,
        }
    }
}

/// `send_message` as "Send message".
fn humanize_action(tool: &str) -> String {
    let words = tool.split(['_', '-', '.']).filter(|word| !word.is_empty()).collect::<Vec<_>>().join(" ");
    let mut characters = words.chars();
    match characters.next() {
        Some(first) => first.to_uppercase().chain(characters).collect(),
        None => words,
    }
}

/// A `graphrt_skill` error for the UI: not found and conflicts keep their codes, anything
/// about the skill's content is `InvalidInput`, and store failures are `Internal`.
fn skill_error(error: graphrt_skill::Error) -> AppError {
    use graphrt_skill::Error;
    match error {
        Error::NotFound(name) => AppError::NotFound(format!("skill {name}")),
        Error::AlreadyInstalled(_) => AppError::Conflict(error.to_string()),
        Error::Io { .. } | Error::Index(_) => {
            log::error!("skill store: {error}");
            AppError::Internal("the skills on this computer could not be read or saved".into())
        }
        other => AppError::InvalidInput(other.to_string()),
    }
}
