# WebACP wire protocol

JSON-only contract between the **web/server** and the **local agent** over a
single WebSocket. Language-neutral so non-TS agents (e.g. Python) can implement
the same messages. Source of truth: [`src/index.ts`](src/index.ts) (Zod schemas).

Transport: one WebSocket, text frames, each frame a single JSON object with a
`type` discriminator.

## Agent → Web

| `type` | Fields | Meaning |
|--------|--------|---------|
| `pair.request` | `token`, `agentId`, `agentName?`, `tools?` | First-time pairing with a one-time token. |
| `pair.reconnect` | `agentId`, `secret`, `agentName?`, `tools?` | Reconnect with a saved secret. |
| `ping` | — | Heartbeat. |
| `tool.result` | `id`, `ok`, `result?`, `error?` | Result of a routed local tool call. |
| `acp.event` | `sessionId`, `sseEvent`, `data` | Streamed chat event (`text`, `thought`, `tool_call`, `tool_result`). |
| `chat.done` | `sessionId` | Prompt finished. |
| `chat.error` | `sessionId`, `message` | Prompt failed. |
| `session.config` | `threadId`, `models[]`, `currentModel?` | Available models for a thread's session. |

## Web → Agent

| `type` | Fields | Meaning |
|--------|--------|---------|
| `pair.ok` | `agentId`, `webUrl`, `secret?` | Pairing accepted (`secret` only on first pair). |
| `pair.error` | `message` | Pairing rejected. |
| `pong` | — | Heartbeat reply. |
| `tool.call` | `id`, `tool`, `args` | Execute a local tool by name; reply with `tool.result` (same `id`). |
| `chat.start` | `sessionId`, `threadId`, `message`, `mcpServers[]`, `provider?`, `model?` | Start/continue a prompt on the thread's persistent ACP session. |
| `chat.abort` | `sessionId` | Cancel an in-flight prompt. |
| `session.set_model` | `threadId`, `value` | Change the active model for the thread. |

## Notes

- `mcpServers[]` items: `{ name, type: 'http'|'sse', url, headers? }`.
- A thread maps to a persistent ACP session on the agent — `chat.start` reuses
  the session for multi-turn memory; the first `chat.start` for a `threadId`
  creates it and emits `session.config`.
- Tool routing is name-based: the server exposes `localToolPacks` schemas at
  `/mcp/local`, and the agent resolves `tool.call.tool` against its own packs.
