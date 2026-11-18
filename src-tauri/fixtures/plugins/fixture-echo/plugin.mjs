// Test fixture plugin for the graphrt desktop app: answers `initialize` and
// `node.run` over newline-delimited JSON-RPC on stdin/stdout. It reports which
// environment it received, so tests can check what the host passes to plugins.
import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");

lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    reply(message.id, { protocol_version: 1 });
  } else if (message.method === "node.run") {
    const config = message.params.config ?? {};
    reply(message.id, {
      outputs: {
        data: {
          echo: config.text ?? null,
          token_received: process.env.FIXTURE_ECHO_TOKEN ?? null,
          unrelated_env_visible: process.env.FIXTURE_ECHO_UNRELATED !== undefined,
        },
      },
    });
  } else if (message.method === "tool.call") {
    reply(message.id, { text: String(message.params.arguments?.text ?? ""), is_error: false });
  } else if (message.id !== undefined) {
    const error = { code: -32601, message: "method not found" };
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, error }) + "\n");
  }
});
