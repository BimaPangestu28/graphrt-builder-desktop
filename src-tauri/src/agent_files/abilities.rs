//! What an agent's workflow can do with files, read from its steps.
//!
//! This is the switch of the whole feature: nothing in [`super`] is set up for a workflow
//! that asks for none of it.
//!
//! | In the workflow | Gives |
//! | --- | --- |
//! | an `agent` step with `files/...` tools, or a `tool` step of `files` | reading, searching and writing files |
//! | ... with `documents/...` | PDF, Word and Excel files |
//! | ... with `image/...` | looking at and resizing pictures |
//! | a step with `vision: { enabled: true }` | pictures a person attached, shown to the model |

use graphrt_core::Workflow;
use serde::Serialize;
use serde_json::{Map, Value as Json};

/// Tool provider of the file tools.
pub const FILES_PROVIDER: &str = graphrt_files::PROVIDER;
/// Tool provider of the document writers.
pub const DOCUMENTS_PROVIDER: &str = "documents";
/// Tool provider of the image tools.
pub const IMAGE_PROVIDER: &str = "image";

/// Whether `provider` is one of the tool providers that only touch the agent's own files.
pub fn is_file_tool_provider(provider: &str) -> bool {
    matches!(provider.trim(), FILES_PROVIDER | DOCUMENTS_PROVIDER | IMAGE_PROVIDER)
}

/// Which file features a workflow uses.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FlowFileUse {
    pub file_tools: bool,
    pub document_tools: bool,
    pub image_tools: bool,
    pub vision: bool,
}

impl FlowFileUse {
    /// Reads the steps of `flow_yaml`. A document that cannot be read uses nothing.
    pub fn of(flow_yaml: &str) -> Self {
        // Most agents use none of this: skip parsing when no step can ask for it.
        let might_use = [FILES_PROVIDER, DOCUMENTS_PROVIDER, IMAGE_PROVIDER, "vision"]
            .iter()
            .any(|needle| flow_yaml.contains(needle));
        if !might_use {
            return Self::default();
        }
        let Ok(workflow) = Workflow::parse(flow_yaml) else { return Self::default() };
        let mut file_use = Self::default();
        for node in &workflow.graph.nodes {
            for provider in tool_providers(node.kind.as_str(), &node.config) {
                match provider.trim() {
                    FILES_PROVIDER => file_use.file_tools = true,
                    DOCUMENTS_PROVIDER => file_use.document_tools = true,
                    IMAGE_PROVIDER => file_use.image_tools = true,
                    _ => {}
                }
            }
            file_use.vision |= has_vision(&node.config);
        }
        file_use
    }

    /// Whether the workflow needs the agent's workspace at all.
    pub fn needs_workspace(self) -> bool {
        self.file_tools || self.document_tools || self.image_tools
    }

    /// Whether anything of this module is set up for the workflow.
    pub fn any(self) -> bool {
        self.needs_workspace() || self.vision
    }

    /// What a person can do with this agent, in the terms the screens use.
    pub fn abilities(self) -> FileAbilities {
        FileAbilities {
            reads_files: self.file_tools,
            sees_pictures: self.vision || self.image_tools,
            makes_files: self.needs_workspace(),
        }
    }
}

/// What a person can do with an agent. Keep `src/api/agentFileTypes.ts` in sync.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAbilities {
    /// Documents and text files can be attached: the agent reads them.
    pub reads_files: bool,
    /// Pictures can be attached: the agent looks at them.
    pub sees_pictures: bool,
    /// The agent can hand files back.
    pub makes_files: bool,
}

impl FileAbilities {
    /// Whether anything can be attached.
    pub fn takes_attachments(self) -> bool {
        self.reads_files || self.sees_pictures
    }
}

/// The tool providers a step uses: `tools` of an `agent` step, `provider_id` of a `tool` step.
fn tool_providers<'a>(kind: &str, config: &'a Map<String, Json>) -> Vec<&'a str> {
    match kind {
        "agent" => config
            .get("tools")
            .and_then(Json::as_array)
            .into_iter()
            .flatten()
            .filter_map(|entry| match entry {
                Json::String(reference) => reference.split_once('/').map(|(provider, _)| provider),
                Json::Object(fields) => fields.get("provider").and_then(Json::as_str),
                _ => None,
            })
            .collect(),
        "tool" => config.get("provider_id").and_then(Json::as_str).into_iter().collect(),
        _ => Vec::new(),
    }
}

fn has_vision(config: &Map<String, Json>) -> bool {
    config.get("vision").and_then(|vision| vision.get("enabled")).and_then(Json::as_bool).unwrap_or(false)
}
