- Finish every workflow with an `end` node whose outputs follow "Run outputs" in the format guide: always
  `summary` (one plain sentence about what happened); `items` when the run handles several things (one object
  per thing with a `name` or `title` and a `status` such as `sent`, `skipped` or `failed`); and plain-number
  counters with snake_case names such as `messages_sent` or `places_found`.
- When the flow loops over things, add a last `llm` step titled "Write the run report" with `structured_output`
  that returns `summary`, `items` and the counters, and point the `end` outputs at its fields.
