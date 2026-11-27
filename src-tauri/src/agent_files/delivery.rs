//! Showing and saving an agent's file: the small picture on a card, and a copy on disk.
//!
//! Both start from a `reference` the webview sends back, looked up inside one agent's
//! workspace ([`AgentFiles::locate`]). A reference cannot name a file of another agent or
//! a path outside the workspace: graphrt parses it as a workspace path (no `..`, no
//! absolute paths, no links) before any storage is touched.
//!
//! A preview exists for raster pictures only, and it is never the stored bytes: the
//! picture is decoded and a small copy is encoded again here, so nothing but pixels
//! reaches the webview. HTML, SVG, PDF and everything else is saved, never shown.

use std::path::Path;

use base64::Engine as _;
use graphrt_files::{MediaClass, StoredFile, Workspace, WorkspacePath};
use graphrt_image::{ImageLimits, Transform};
use serde::Serialize;

use super::cards::PREVIEWABLE_PICTURE_TYPES;
use super::AgentFiles;
use crate::error::{AppError, AppResult};

/// Longest side of the picture on a card, in pixels (cards are about 240 px wide, shown at up to 2x).
const PREVIEW_EDGE_PIXELS: u32 = 480;

/// What a card shows of a file's content. Keep `src/api/agentFileTypes.ts` in sync.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FilePreview {
    /// A small copy of a picture as a `data:image/jpeg` or `data:image/png` URL.
    #[serde(rename_all = "camelCase")]
    Picture { data_url: String, width: u32, height: u32 },
    /// Nothing is shown: the file is offered as a download.
    None,
}

fn no_such_file() -> AppError {
    AppError::NotFound("that file".into())
}

impl AgentFiles {
    /// The file `reference` names in the workspace of `agent_id`, in whichever
    /// conversation it lies.
    ///
    /// # Errors
    /// `NotFound` when the reference names nothing in that agent's workspace.
    pub async fn locate(&self, agent_id: &str, reference: &str) -> AppResult<(Workspace, WorkspacePath, StoredFile)> {
        let workspace = self.existing_agent_workspace(agent_id)?.ok_or_else(no_such_file)?;
        let (view, path) = workspace.locate_reference(reference).ok_or_else(no_such_file)?;
        let stored = view.inspect(&path).await.map_err(|_| no_such_file())?;
        Ok((view, path, stored))
    }

    /// What a card may show of the file. Anything but a raster picture is [`FilePreview::None`].
    ///
    /// # Errors
    /// `NotFound` when the reference names nothing in that agent's workspace.
    pub async fn preview(&self, agent_id: &str, reference: &str) -> AppResult<FilePreview> {
        let (view, path, stored) = self.locate(agent_id, reference).await?;
        let is_raster_picture =
            stored.media.class == MediaClass::Image && PREVIEWABLE_PICTURE_TYPES.contains(&stored.media.mime);
        if !is_raster_picture {
            return Ok(FilePreview::None);
        }
        let limits = ImageLimits::default();
        let Ok(bytes) = view.read_all(&path, limits.max_input_bytes).await else { return Ok(FilePreview::None) };
        let small = graphrt_image::blocking(move || {
            let bounds =
                Transform { max_width: Some(PREVIEW_EDGE_PIXELS), max_height: Some(PREVIEW_EDGE_PIXELS), format: None };
            graphrt_image::transform(&bytes, &limits, bounds)
        })
        .await;
        match small {
            Ok(Ok(picture)) => Ok(FilePreview::Picture {
                data_url: format!(
                    "data:{};base64,{}",
                    picture.format.mime(),
                    base64::engine::general_purpose::STANDARD.encode(&picture.bytes)
                ),
                width: picture.width,
                height: picture.height,
            }),
            // A picture the decoder refuses is still a file the person can save.
            _ => Ok(FilePreview::None),
        }
    }

    /// Writes a copy of the file to `destination` (a path from the system save dialog).
    /// The copy appears under its final name only when it is complete.
    ///
    /// # Errors
    /// `NotFound` when the reference names nothing in that agent's workspace; `Internal`
    /// when the copy cannot be written.
    pub async fn save_copy(&self, agent_id: &str, reference: &str, destination: &Path) -> AppResult<u64> {
        let (view, path, _) = self.locate(agent_id, reference).await?;
        let bytes = view
            .read_all(&path, view.limits().max_file_bytes)
            .await
            .map_err(|error| AppError::Internal(format!("could not read the file: {error}")))?;
        let size = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
        let destination = destination.to_path_buf();
        graphrt_files::blocking(move || write_complete(&destination, &bytes))
            .await
            .map_err(AppError::Internal)?
            .map_err(|error| AppError::Internal(format!("could not save the file: {error}")))?;
        Ok(size)
    }
}

/// Writes `bytes` next to `destination` and renames it into place, so a full disk or a
/// crash never leaves half a file under the name the person chose.
fn write_complete(destination: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let file_name = destination
        .file_name()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "no file name to save as"))?;
    let mut partial_name = file_name.to_os_string();
    partial_name.push(".part");
    let partial_path = destination.with_file_name(partial_name);
    let written = std::fs::write(&partial_path, bytes).and_then(|()| std::fs::rename(&partial_path, destination));
    if written.is_err() {
        // Best effort: the error below is what the person sees.
        let _ = std::fs::remove_file(&partial_path);
    }
    written
}
