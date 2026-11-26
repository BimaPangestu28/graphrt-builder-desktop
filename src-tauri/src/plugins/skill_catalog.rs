//! Agent skills of the plugin catalog: the list, and downloading one skill's archive.
//!
//! Skills are entries of the same signed index as plugins, so they go through the same
//! checks and nothing looser: the index must verify against a trusted key before it is
//! parsed, an archive link must be `https://` and under the catalog's release assets, and
//! the downloaded bytes must match the sha256 the signed index gives. What happens with
//! the archive afterwards (reading, checking and installing the skill) is `crate::skills`.

use super::archive;
use super::download::require_https;
use super::models::CatalogSkill;
use super::{PluginService, TARBALL_TIMEOUT};
use crate::error::{AppError, AppResult};

/// Largest skill archive downloaded. A skill is text (instructions and reference files).
pub(crate) const MAX_SKILL_ARCHIVE_BYTES: u64 = 8 * 1024 * 1024;

/// The skills of the catalog, and how the catalog was obtained.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CatalogSkills {
    pub skills: Vec<CatalogSkill>,
    /// The catalog could not be fetched; these come from the last saved (and verified) copy.
    pub from_cache: bool,
}

impl PluginService {
    /// The skills the catalog offers. Uses the catalog fetched earlier in this session
    /// unless `refresh`; when fetching fails, the last saved copy.
    ///
    /// # Errors
    /// The fetch error when there is no saved copy either.
    pub(crate) async fn catalog_skills(&self, refresh: bool) -> AppResult<CatalogSkills> {
        let in_session = if refresh { None } else { self.session_catalog() };
        match in_session {
            Some(fetched) => Ok(CatalogSkills { skills: fetched.index.skills, from_cache: false }),
            None => {
                let (index, from_cache) = self.fetch_catalog().await?;
                Ok(CatalogSkills { skills: index.skills, from_cache })
            }
        }
    }

    /// Downloads the archive of catalog skill `name` and checks it against the checksum of
    /// the signed index. Returns the catalog entry and the verified bytes.
    ///
    /// # Errors
    /// `NotFound` when the catalog lists no such skill; `InvalidInput` when the archive is
    /// too large or does not match the checksum; `Internal` for download errors.
    pub(crate) async fn download_catalog_skill(&self, name: &str) -> AppResult<(CatalogSkill, Vec<u8>)> {
        let listed = self.catalog_skills(false).await?;
        let entry = listed
            .skills
            .into_iter()
            .find(|skill| skill.name == name)
            .ok_or_else(|| AppError::NotFound(format!("skill {name} in the catalog")))?;
        require_https(&entry.tarball_url)?;
        if entry.size_bytes > MAX_SKILL_ARCHIVE_BYTES {
            return Err(AppError::InvalidInput(format!("skill {name} is larger than the download limit")));
        }
        let max_bytes = if entry.size_bytes > 0 { entry.size_bytes } else { MAX_SKILL_ARCHIVE_BYTES };
        let bytes = self.downloader.fetch(&entry.tarball_url, max_bytes, TARBALL_TIMEOUT, None).await?;
        archive::verify_sha256(&bytes, &entry.sha256)?;
        Ok((entry, bytes))
    }
}
