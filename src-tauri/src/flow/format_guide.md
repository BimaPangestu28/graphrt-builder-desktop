# graphrt workflow format (desktop cheat-sheet)

Reply with ONE YAML document. Shape:

```yaml
version: "1"
name: short-kebab-name
description: One sentence.
env:                                   # secrets the user supplies; read as {{#env.NAME#}}
  - { name: API_TOKEN, type: secret }
graph:
  nodes: [ ... ]
  edges: [ ... ]
```

## Rules
- Node `id`: unique, no spaces, no dots; not `sys`, `env` or `conversation`.
- Every node has `id`, `type`, optional `title` (short, plain words, shown to the user).
- Exactly one `start` node. Every node must be reachable from it via edges.
- Values: template `"Hi {{#start.name#}}"` (paths walk keys/indexes: `{{#fetch.json.items.0.name#}}`)
  or selector `[node_id, output, key]`. Only reference node ids that exist.
- Booleans are only `true` / `false`.

## Edges
```yaml
- { source: a, target: b }                       # normal
- { source: review, target: send, handle: send } # branch: handle = action id / case id / class id
- { source: check, target: other, handle: "false" }  # if-else when no case matches
```
Edges never cross into or out of an iteration/loop body.

## Nodes

`start` - run inputs, output under `start`:
```yaml
variables:
  - { variable: area, type: text-input, required: true, label: Area to search }
  # types: text-input, paragraph, select (+ options), number, checkbox, json
```

`end` - run outputs:
```yaml
outputs: [{ variable: summary, value_selector: [writer, text] }]
```

`answer` - message to the user: `answer: "Done: {{#writer.text#}}"`

`llm` - ask a model. Outputs `text` (and `structured_output` when enabled):
```yaml
model: { provider: openai, name: gpt-4o-mini, completion_params: { temperature: 0.2 } }
prompt_template:
  - { role: system, text: "You are ..." }
  - { role: user, text: "{{#start.question#}}" }
structured_output_enabled: true          # optional
structured_output: { schema: { type: object, properties: { score: { type: number } } } }
```
Providers: `openai`, `anthropic`, `gemini`, `ollama`.

`agent` - model with tool loop. Outputs `text`:
```yaml
model: { provider: anthropic, name: claude-sonnet-4-5 }
instruction: "You are ..."
query: "{{#start.request#}}"
max_iterations: 10
require_approval: ["*"]                  # optional: ask the user before each tool call
```

`question-classifier` (branch) - outputs `class_id`; edges use the class id as handle:
```yaml
model: { provider: openai, name: gpt-4o-mini }
query_variable_selector: [start, message]
classes: [{ id: billing, name: Billing questions }, { id: other, name: Anything else }]
```

`parameter-extractor` - outputs each parameter:
```yaml
model: { provider: openai, name: gpt-4o-mini }
query: [start, message]
parameters: [{ name: city, type: string, description: Destination city, required: true }]
```

`http-request` - outputs `status_code`, `body`, `headers`, `json`:
```yaml
method: post                             # get | post | put | patch | delete
url: "https://api.example.com/items"
headers: "Accept: application/json"
params: [{ key: q, value: "{{#start.query#}}" }]
authorization: { type: api-key, config: { type: bearer, api_key: "{{#env.API_TOKEN#}}" } }
body: { type: json, data: '{"name": "{{#start.name#}}"}' }   # none | json | raw-text | form-data
timeout: { connect: 5, read: 30 }
```

`human-input` (branch, pauses until the user answers). Outputs `action` and field values;
edges use the action id as handle:
```yaml
prompt: "Send this message?\n\n{{#draft.text#}}"
form: { fields: [{ name: note, label: Note, type: text, required: false }] }
actions: [{ id: send, title: Send }, { id: skip, title: Skip }]
```

`if-else` (branch) - first matching `case_id`, else handle `false`:
```yaml
cases:
  - case_id: big
    logical_operator: and
    conditions: [{ variable_selector: [start, amount], comparison_operator: ">", value: "100" }]
```
Operators: contains, not contains, is, is not, empty, not empty, =, ≠, >, <, ≥, ≤.

`template-transform` - Jinja2; output `output`:
```yaml
template: "{% for c in cafes %}- {{ c.name }}\n{% endfor %}"
variables: [{ variable: cafes, value_selector: [find, json, results] }]
```

`list-operator` - outputs `result`, `first_record`:
```yaml
variable: [find, json, results]
filter_by: { enabled: true, conditions: [{ key: rating, comparison_operator: ">", value: "4" }] }
limit: { enabled: true, size: 10 }
```

`variable-aggregator` - first non-null: `variables: [[branch_a, text], [branch_b, text]]`

`iteration` (container) - runs its body once per item; output `output` (list):
```yaml
- { id: each, type: iteration, iterator_selector: [find, json, results],
    output_selector: [send, status_code], is_parallel: false }
- { id: each_start, type: iteration-start, parent: each }   # required body entry
- { id: draft, type: llm, parent: each, ... }               # reads {{#each.item.name#}}, {{#each.index#}}
```
Body edges start at the `iteration-start` node: `{ source: each_start, target: draft }`.
Use `is_parallel: false` when the body contains `human-input`.

`loop` (container) - repeats its body; body entry is `type: loop-start`:
```yaml
loop_count: 5
loop_variables: [{ label: draft, var_type: string, value_type: constant, value: "" }]
break_conditions: [{ variable_selector: [refine, draft], comparison_operator: contains, value: DONE }]
```

## Per-node options (any node)
`retry: { max_retries: 2, interval_ms: 1000, backoff: 2.0 }`, `timeout_ms: 30000`,
`on_error: { strategy: fail-branch }` (then an edge with `handle: fail-branch`).
