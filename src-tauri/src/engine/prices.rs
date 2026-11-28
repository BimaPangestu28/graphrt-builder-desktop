//! Approximate list prices of the models people pick most, so an agent's "spending limit
//! per run" can be given in money (graphrt counts cost in millionths of a dollar here).
//!
//! graphrt ships no price list (prices change too often), so the app keeps this short one.
//! A model that is not listed costs nothing to the budget: graphrt then reports
//! `price_missing` and only the token limit applies, which the run view says. Models on
//! this computer (Ollama, local CLIs) cost nothing.

use graphrt_llm::registry::Price;
use graphrt_llm::ModelRegistry;

/// `(provider, model, USD per million input tokens, USD per million output tokens)`,
/// list prices as of 2026-11.
const LIST_PRICES: &[(&str, &str, f64, f64)] = &[
    ("openai", "gpt-4o-mini", 0.15, 0.60),
    ("openai", "gpt-4o", 2.50, 10.00),
    ("openai", "gpt-4.1", 2.00, 8.00),
    ("openai", "gpt-4.1-mini", 0.40, 1.60),
    ("openai", "gpt-4.1-nano", 0.10, 0.40),
    ("openai", "o4-mini", 1.10, 4.40),
    ("openai", "o3", 2.00, 8.00),
    ("openai", "gpt-5", 1.25, 10.00),
    ("openai", "gpt-5-mini", 0.25, 2.00),
    ("openai", "gpt-5-nano", 0.05, 0.40),
    ("anthropic", "claude-haiku-5-5", 0.10, 0.50),
    ("anthropic", "claude-sonnet-5-5", 2.00, 10.00),
    ("anthropic", "claude-opus-5-5", 4.00, 20.00),
    ("anthropic", "claude-fable-5-2", 8.00, 40.00),
    ("anthropic", "claude-haiku-4-5", 1.00, 5.00),
    ("gemini", "gemini-2.5-flash", 0.30, 2.50),
    ("gemini", "gemini-2.5-pro", 1.25, 10.00),
];

/// Providers that bill per token (the others run on this computer and cost nothing).
const PAID_PROVIDERS: [&str; 3] = ["openai", "anthropic", "gemini"];

/// Whether models of `provider` cost money (an API provider, not a model on this computer).
pub fn is_paid_provider(provider: &str) -> bool {
    PAID_PROVIDERS.contains(&provider)
}

/// Gives `registry` the list prices of the known models.
pub(crate) fn add_list_prices(registry: &mut ModelRegistry) {
    for (provider, model, input, output) in LIST_PRICES {
        match Price::new(*input, *output) {
            Ok(price) => {
                registry.set_price(*provider, *model, price);
            }
            Err(error) => log::warn!("ignoring the price of {provider}/{model}: {error}"),
        }
    }
}

/// Whether the app knows the price of `provider/model` (the run view and the spending card
/// say when a cost limit cannot count a model).
pub fn has_list_price(provider: &str, model: &str) -> bool {
    LIST_PRICES.iter().any(|(known_provider, known_model, _, _)| *known_provider == provider && *known_model == model)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_listed_price_is_accepted_and_counts_in_micro_dollars() {
        let mut registry = ModelRegistry::new();
        add_list_prices(&mut registry);
        for (provider, model, _, _) in LIST_PRICES {
            assert!(registry.price(provider, model).is_some(), "{provider}/{model}");
        }
        let price = registry.price("openai", "gpt-4o-mini").expect("listed");
        // 1 000 input and 1 000 output tokens: 0.00015 + 0.0006 dollars = 750 micro-dollars.
        let usage = graphrt_core::Usage { prompt_tokens: 1_000, completion_tokens: 1_000, total_tokens: 2_000 };
        assert_eq!(price.cost_micros(&usage), 750);
        assert!(has_list_price("anthropic", "claude-haiku-5-5"));
        assert!(!has_list_price("ollama", "llama3.2"));
    }
}
