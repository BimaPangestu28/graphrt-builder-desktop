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
  reply soon), then end on an `end` node with outputs `handoff` (a `template-transform` whose template is
  `true`) and `handoff_reason` (a `template-transform` with one of `order_to_confirm`, `asked_for_person`,
  `not_sure`, or a few plain words). The app then stops the bot for that chat and asks the owner to reply.
  Use a `question-classifier` on `{{#sys.query#}}` to pick the hand-off path.
- An `end` node may also output `summary` (one sentence about the customer and their order so far) and
  `suggested_reply` (a reply the owner could send as is), both read from an `llm` node.
- Chatbot flows never use `human-input`: nobody can approve a step in the middle of a chat. The hand-off
  outputs replace approvals.
