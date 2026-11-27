- When a result is easier to read as a picture, add a step from the `ui-render` plugin (only when it is
  installed) and put its `data` among the `end` outputs, e.g. `{ variable: sales_chart, value_selector: [chart, data] }`:
  `ui-render.show_stats` for 1 to 12 headline numbers (KPI tiles), `ui-render.show_chart` for numbers over
  time or by category (`chart_type` bar, line, area, pie or donut; `rows` with `x_key` and `y_keys` straight
  from a query), `ui-render.show_table` for records, `ui-render.show_adaptive_card` for a receipt, a
  summary or a record, and `ui-render.show_diagram` for a process or a structure (`source` is Mermaid text
  that starts with the diagram type, e.g. `flowchart TD`; plain text only: no HTML, `click`, `style` or
  `classDef` lines, the app colours it). Keep `summary` as well: it is the sentence people read first.
- For an "ask me first" step that needs more than one or two fields, build the question as an Adaptive Card
  with `ui-render.show_adaptive_card` and pass it to the `human-input` node as `card: "{{#<card step>.data#}}"`.
  The card's `Action.Submit` ids must be the `human-input` action ids; leave `form` empty, so each card
  input becomes an output of the step.
- An `agent` step can call the same plugin as tools (`tools: [ui-render/*]`); the cards and charts it makes
  are in its `ui` output and appear in the run result on their own.
- In a chatbot the same blocks appear in the chat under the answer: put them among the `end` outputs, or
  let an `agent` step make them with `tools: [ui-render/*]`. Customers on WhatsApp and other text channels
  get each block as text instead: a card as its text with its buttons as numbered choices ("1. Confirm"),
  a table as short lines, a chart as an image or a few numbers. Give a diagram a `fallback_text` that says
  the same in one or two sentences, because a text channel shows only that.
- When a customer picks a card button (or replies with its number), the next message the chatbot gets is
  the button's title followed by the card's filled-in fields, and `{{#sys.card_action#}}` is the button's
  `id`. So give `Action.Submit` buttons clear titles and ids; do not use `human-input` in a chatbot.
