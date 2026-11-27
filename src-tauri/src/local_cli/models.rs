//! The model choices each CLI offers, without spending usage: "CLI default" first, then
//! what the adapter lists (help aliases, a local catalog command or the models its docs
//! name; see `adapters/*`).

use super::detect::Detection;
use super::{LocalCli, CLI_DEFAULT_MODEL};
use crate::model_catalog::AvailableModel;

/// The models `cli` offers, "CLI default" first.
pub fn list_models(cli: LocalCli, detection: &Detection) -> Vec<AvailableModel> {
    let mut models = vec![AvailableModel {
        id: CLI_DEFAULT_MODEL.to_owned(),
        display_name: Some("CLI default".to_owned()),
        parameter_millions: None,
    }];
    for model in cli.adapter().list_models(detection) {
        if model.id != CLI_DEFAULT_MODEL && !models.iter().any(|listed| listed.id == model.id) {
            models.push(model);
        }
    }
    models
}
