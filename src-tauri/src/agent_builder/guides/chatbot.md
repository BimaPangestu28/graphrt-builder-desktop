- Chatbot agents run once for every customer message. The `start` node declares one input,
  `message` (type `paragraph`, required). The same text is also `{{#sys.query#}}`, and the customer's
  address is `{{#sys.user_id#}}`.
- A chatbot replies with an `answer` node (`answer: "{{#write_reply.text#}}"`); the app sends that text to
  the customer. Every path should reach one `answer` node, then an `end` node.
- A chatbot remembers the chat through `conversation` variables declared at the top of the document, e.g.
  `conversation: [{ name: notes, type: string, value: "" }, { name: order, type: object }]`. Read them as
  `{{#conversation.notes#}}` in prompts and update them with an `assigner` node after the reply; the app keeps
  their values between messages. Never ask the customer again for something already stored there.
- When the chat needs the owner (an order is ready to confirm, the customer asks for a person, the answer is
  not in the knowledge, the customer sounds upset), still answer politely (for example that the owner will
  reply soon), then hand over. Use a `question-classifier` on `[start, message]` to pick the hand-off path.
  The hand-off is always these two `template-transform` steps and an `end` step reading them (keep the quotes:
  `"true"` is text, a bare `true` is rejected):
  ```yaml
  - { id: mark_handoff, type: template-transform, template: "true", variables: [] }
  - { id: handoff_reason, type: template-transform, template: "order_to_confirm", variables: [] }
  - id: handoff_done
    type: end
    outputs:
      - { variable: handoff, value_selector: [mark_handoff, output] }
      - { variable: handoff_reason, value_selector: [handoff_reason, output] }
  ```
  The reason is one of `order_to_confirm`, `asked_for_person`, `not_sure`, `sounds_upset`, or a few plain
  words joined by `_`. The app then stops the bot for that chat and asks the owner to reply.
- Each branch gets its own `answer` step right after the step that writes its text. `{{#…#}}` holds only a
  step id and output (`{{#write_answer.text#}}`): never a condition, comparison or default inside it.
- An `end` node may also output `summary` (one sentence about the customer and their order so far) and
  `suggested_reply` (a reply the owner could send as is), both read from an `llm` node.
- Every model step that writes to the customer ends its system prompt with this sentence, word for word
  (shorter wordings such as "in the customer's language" made gpt-4o-mini answer English questions in
  Spanish or Indonesian): "Write your reply in the same language as the customer's message: English if
  they write English, Indonesian if they write Indonesian, and so on."
- Chatbot flows never use `human-input`: nobody can approve a step in the middle of a chat. The hand-off
  outputs replace approvals.
