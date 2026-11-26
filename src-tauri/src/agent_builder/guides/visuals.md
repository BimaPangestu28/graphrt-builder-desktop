- When a result is easier to read as a picture, add a step from the `ui-render` plugin (only when it is
  installed) and put its `data` among the `end` outputs, e.g. `{ variable: sales_chart, value_selector: [chart, data] }`:
  `ui-render.show_stats` for 1 to 12 headline numbers (KPI tiles), `ui-render.show_chart` for numbers over
  time or by category (`chart_type` bar, line, area, pie or donut; `rows` with `x_key` and `y_keys` straight
  from a query), `ui-render.show_table` for records, and `ui-render.show_adaptive_card` for a receipt, a
  summary or a record. Keep `summary` as well: it is the sentence people read first.
- For an "ask me first" step that needs more than one or two fields, build the question as an Adaptive Card
  with `ui-render.show_adaptive_card` and pass it to the `human-input` node as `card: "{{#<card step>.data#}}"`.
  The card's `Action.Submit` ids must be the `human-input` action ids; leave `form` empty, so each card
  input becomes an output of the step.
- An `agent` step can call the same plugin as tools (`tools: [ui-render/*]`); the cards and charts it makes
  are in its `ui` output and appear in the run result on their own.
