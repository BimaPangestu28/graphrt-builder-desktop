//! The two judges of a check (graphrt workflows, scored by graphrt's `judge` assertion),
//! run on the app's default model.

use std::path::Path;
use std::sync::Arc;

use graphrt_eval::assertion::AssertionRegistry;
use graphrt_eval::{EngineTarget, EvalError, Target};

use super::suite::{ANSWERS_QUESTION_JUDGE, GOOD_ANSWER_JUDGE};
use super::target::CheckDependencies;
use crate::credentials::ModelChoice;

const GOOD_ANSWER_YAML: &str = include_str!("judges/good-answer.yaml");
const ANSWERS_QUESTION_YAML: &str = include_str!("judges/answers-question.yaml");

/// The judge workflow named `path` (as the suite writes it), on `model`.
/// `None` for any other path.
pub fn judge_document(path: &Path, model: &ModelChoice) -> Option<String> {
    let template = [(GOOD_ANSWER_JUDGE, GOOD_ANSWER_YAML), (ANSWERS_QUESTION_JUDGE, ANSWERS_QUESTION_YAML)]
        .into_iter()
        .find(|(name, _)| path.ends_with(name))
        .map(|(_, yaml)| yaml)?;
    // JSON strings are valid YAML scalars, so a model name can never change the document's shape.
    let quoted = |text: &str| serde_json::Value::String(text.to_owned()).to_string();
    Some(
        template
            .replace("MODEL_PROVIDER", &quoted(model.provider.registry_name()))
            .replace("MODEL_NAME", &quoted(&model.name)),
    )
}

/// graphrt's assertion types plus `judge`, its judges compiled on `model` (once each).
pub fn registry(dependencies: CheckDependencies, model: ModelChoice) -> AssertionRegistry {
    let mut registry = AssertionRegistry::with_builtins();
    let loader = move |path: &Path| -> Result<Arc<dyn Target>, EvalError> {
        let document = judge_document(path, &model)
            .ok_or_else(|| EvalError::Invalid(format!("unknown judge {}", path.display())))?;
        let engine = dependencies
            .plain_engine(&document)
            .map_err(|error| EvalError::Invalid(format!("the judge could not be prepared: {error}")))?;
        Ok(Arc::new(EngineTarget::new(engine)))
    };
    graphrt_eval::judge::register(&mut registry, "", loader);
    registry
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::credentials::ModelProvider;

    #[test]
    fn judges_compile_with_the_chosen_model() {
        let model = ModelChoice { provider: ModelProvider::Openai, name: "gpt-4o-mini\"\nx: 1".into() };
        for name in [GOOD_ANSWER_JUDGE, ANSWERS_QUESTION_JUDGE] {
            let document = judge_document(Path::new(name), &model).unwrap();
            let summary = crate::flow::summarize_flow(&document).unwrap();
            assert_eq!(summary.model_providers, ["openai"]);
            assert!(!document.contains("MODEL_NAME"));
        }
        assert!(judge_document(Path::new("judges/other.yaml"), &model).is_none());
    }
}
