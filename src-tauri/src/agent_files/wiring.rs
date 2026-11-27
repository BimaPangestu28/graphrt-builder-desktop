//! The file tools, file resolver and image gate of one run.
//!
//! [`FileAccess::wire`] is called once per engine (`engine::preparation::build_engine`).
//! It reads which file features the workflow uses and sets up exactly those:
//! - `files` tools over the scope's part of the workspace, without `delete`;
//! - `documents` tools (PDF, Word, Excel) and `image` tools (no image generator);
//! - every tool behind `lenient::LenientArguments`, so `"400"` for a number is read as 400;
//! - the workspace as a place other steps read files from (document extractor, vision),
//!   also for a workflow that has `vision` and no file tools: attached pictures live there.
//!
//! The image gate ([`image_gate`]) is separate because it wraps the run's whole file
//! resolver: an attached picture and a picture chosen on the Test form pass the same checks.

use std::sync::Arc;

use graphrt_core::file::{FileResolver, ImagePreparer};
use graphrt_core::tool::ToolRegistry;
use graphrt_docgen::DocumentTools;
use graphrt_files::{FileTools, FileToolsConfig, Workspace, WorkspaceResolver};
use graphrt_image::{ImageLimits, ImageTools, VisionPreparer};

use super::abilities::{FlowFileUse, DOCUMENTS_PROVIDER, FILES_PROVIDER, IMAGE_PROVIDER};
use super::lenient::LenientArguments;
use super::{AgentFiles, FileScope};
use crate::error::AppResult;

/// The workspaces, and whose files the engine being built may touch.
#[derive(Debug, Clone)]
pub(crate) struct FileAccess {
    pub files: Arc<AgentFiles>,
    pub scope: FileScope,
}

/// What [`FileAccess::wire`] set up for one engine.
#[derive(Debug, Default)]
pub(crate) struct FileWiring {
    /// Reads `workspace:` file references; `None` when the workflow has no workspace.
    pub resolver: Option<Arc<dyn FileResolver>>,
    /// The workflow shows pictures to a model, so the run needs [`image_gate`].
    pub vision: bool,
}

impl FileAccess {
    /// Adds the tool providers `flow_yaml` uses to `tools` and returns what else the
    /// engine needs. A workflow that uses no file feature changes nothing.
    ///
    /// # Errors
    /// `Internal` when the agent's folder cannot be created.
    pub(crate) fn wire(&self, flow_yaml: &str, tools: &mut ToolRegistry) -> AppResult<FileWiring> {
        let file_use = FlowFileUse::of(flow_yaml);
        if !file_use.any() {
            return Ok(FileWiring::default());
        }
        // A workflow that only looks at pictures (`vision`, no tools) still needs the
        // workspace: the pictures a person attaches are stored there, and the image gate
        // reads them through this resolver.
        let view = self.files.view(&self.scope)?;
        if file_use.file_tools {
            tools.add(
                FILES_PROVIDER,
                LenientArguments::around(Arc::new(FileTools::with_config(view.clone(), file_tools_config()))),
            );
        }
        if file_use.document_tools {
            tools.add(DOCUMENTS_PROVIDER, LenientArguments::around(Arc::new(DocumentTools::new(view.clone()))));
        }
        if file_use.image_tools {
            tools.add(IMAGE_PROVIDER, LenientArguments::around(Arc::new(ImageTools::new(view.clone()))));
        }
        Ok(FileWiring { resolver: Some(workspace_resolver(view)), vision: file_use.vision })
    }
}

/// The file tools an agent gets: graphrt's defaults, without `delete` (an agent has no
/// reason to remove what a person gave it, and nobody is asked first in a chat).
fn file_tools_config() -> FileToolsConfig {
    FileToolsConfig { allow_delete: false, ..FileToolsConfig::default() }
}

fn workspace_resolver(view: Workspace) -> Arc<dyn FileResolver> {
    Arc::new(WorkspaceResolver::new(view))
}

/// The gate every picture passes before a model sees it: type from its first bytes, size
/// from its header, metadata (EXIF, GPS position, comments) removed, downscaled to what
/// models take. A picture it refuses fails the step; it is never sent as it was.
pub(crate) fn image_gate(resolver: Arc<dyn FileResolver>) -> Arc<dyn ImagePreparer> {
    Arc::new(VisionPreparer::new(resolver, ImageLimits::default()))
}
