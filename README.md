# WebACP

A TypeScript-first SDK for building MCP/ACP chat apps — bring your own CLI agent
(Claude, Cursor, Codex, Gemini, …), define your own tools, and route execution
between your server and the user's machine.

Think "LangChain for MCP + ACP": the [`@webacp/*`](https://www.npmjs.com/org/webacp) packages are the product; the
`apps/` are a reference implementation built on top of them.

```bash
npm i @webacp/server @webacp/agent @webacp/tools-fs @webacp/persistence
# CLI (global)
npm i -g @webacp/agent
```

## Packages

| Package | npm | Purpose |
|---------|-----|---------|
| [`@webacp/protocol`](https://www.npmjs.com/package/@webacp/protocol) | [0.1.2](https://www.npmjs.com/package/@webacp/protocol) | JSON wire contracts (pairing, chat events, generic `tool.call`/`tool.result`). Language-neutral. |
| [`@webacp/core`](https://www.npmjs.com/package/@webacp/core) | [0.1.2](https://www.npmjs.com/package/@webacp/core) | ACP engine: provider presets, connect/spawn, event adapter, persistent per-thread session manager + model selection. |
| [`@webacp/tools`](https://www.npmjs.com/package/@webacp/tools) | [0.1.2](https://www.npmjs.com/package/@webacp/tools) | Tool SDK: `defineTool` / `defineToolPack` (`runtime: 'server' \| 'local'`) + MCP exposer. |
| [`@webacp/tools-fs`](https://www.npmjs.com/package/@webacp/tools-fs) | [0.1.2](https://www.npmjs.com/package/@webacp/tools-fs) | Built-in `runtime: 'local'` filesystem + shell pack. |
| [`@webacp/uploads`](https://www.npmjs.com/package/@webacp/uploads) | [0.1.2](https://www.npmjs.com/package/@webacp/uploads) | Upload store and hydration helpers for attachments. |
| [`@webacp/server`](https://www.npmjs.com/package/@webacp/server) | [0.1.2](https://www.npmjs.com/package/@webacp/server) | Framework-agnostic server core: `createWebacpServer()`, dual MCP hosts, pairing, chat SSE, threads. Hono adapter. |
| [`@webacp/agent`](https://www.npmjs.com/package/@webacp/agent) | [0.1.2](https://www.npmjs.com/package/@webacp/agent) | Local daemon as a library: `createLocalAgent({ toolPacks })` + `webacp-agent` bin. |
| [`@webacp/persistence`](https://www.npmjs.com/package/@webacp/persistence) | [0.1.2](https://www.npmjs.com/package/@webacp/persistence) | Thread/message store interface + SQLite (`bun:sqlite`) and in-memory adapters. |
| [`@webacp/react`](https://www.npmjs.com/package/@webacp/react) | [0.1.2](https://www.npmjs.com/package/@webacp/react) | Headless hooks: `useChat`, `useThreads`, `useAgentStatus`, `useModelSelector`. |
| [`@webacp/ui`](https://www.npmjs.com/package/@webacp/ui) | [0.1.2](https://www.npmjs.com/package/@webacp/ui) | Themed chat UI on shadcn-compatible CSS variables + Tailwind. Drop-in `WebacpChat` or compose primitives. |

## Theming (rebrand with CSS variables)

`@webacp/react` = data. `@webacp/ui` = look. Consumers override tokens only:

```css
/* your-theme.css */
@import "@webacp/ui/theme/default.css"; /* or theme/light.css */

:root {
  --primary: oklch(0.58 0.22 300);
  --font-sans: "Geist", system-ui, sans-serif;
  --radius: 0.75rem;
}
```

```tsx
import { WebacpChat } from '@webacp/ui';

export function App() {
  return <WebacpChat brand={{ title: 'My App' }} />;
}
```

Compose your own layout with primitives: `ThreadSidebar`, `MessageList`, `Composer`, `ToolCard`, etc.


The CLI agent connects to two MCP endpoints. Each tool declares where it runs.

```
CLI agent ──> /mcp/server ──> server tools (context, RAG, connectors)  [run in your server]
          └─> /mcp/local  ──WS──> local agent ──> local tools (fs, shell) [run on user machine]
```

- `runtime: 'server'` tools execute in the web/server process.
- `runtime: 'local'` tools are routed over WebSocket to the local agent.

A local pack must be registered in **both** places: on the server (for tool
schemas exposed at `/mcp/local`) and on the agent (for the handlers that run).

## Consumer DX

```ts
// your server
import { createWebacpServer, defineTool, defineToolPack } from '@webacp/server';
import { sqliteAdapter } from '@webacp/persistence';
import { fsPack } from '@webacp/tools-fs';
import { z } from 'zod';

const memory = defineToolPack({
  name: 'memory', runtime: 'server',
  tools: [defineTool({
    name: 'search_memory', input: z.object({ q: z.string() }),
    handler: async ({ q }) => ({ hits: [q] }),
  })],
});

const wac = createWebacpServer({
  serverToolPacks: [memory],
  localToolPacks: [fsPack],
  persistence: sqliteAdapter('./webacp.db'),
  publicUrl: 'http://127.0.0.1:3000',
});

Bun.serve({ port: 3000, fetch: wac.fetch, websocket: wac.websocket });
```

```ts
// your local agent (or just run ours)
import { createLocalAgent } from '@webacp/agent';
import { fsPack } from '@webacp/tools-fs';
createLocalAgent({ toolPacks: [fsPack] }).start();
```

A complete runnable example lives in [`examples/custom-app`](examples/custom-app) (server + agent, no UI).

```bash
cd examples/custom-app
bun run server          # :4000
curl http://127.0.0.1:4000/api/pairing/token   # get pair token
WEBACP_WEB_URL=http://127.0.0.1:4000 WEBACP_PAIR_TOKEN=<token> bun run agent
```

## Reference app (dev)

```bash
bun install

# Terminal 1 — web (server :3000 + UI :5173)
bun run dev

# Terminal 2 — install agent as a background service (once)
bun run install:agent
# Or: webacp-agent install

# Check status / update later
webacp-agent status
webacp-agent update          # git pull (dev) or bun update -g (published)
webacp-agent update --check
webacp-agent uninstall
```

The agent auto-starts on login (launchd on macOS, systemd on Linux). Pairing creds live in `~/.webacp/credentials.json` — pair once, keep forever.

Updates run on **triggers** (not a background timer): when you pair, send a chat, or the web UI hits connect — the agent checks `git pull` (dev) or npm latest and restarts if needed. Disable with `WEBACP_UPDATE_ON_TRIGGER=0` in `~/.webacp/env`.

Open http://localhost:5173. The UI auto-pairs with the local agent (no token
copy/paste), persists threads, and lets you switch CLI provider + model.

Prerequisites: [Bun](https://bun.sh) ≥ 1.0, an ACP CLI agent, and its auth
(e.g. `claude login` or `agent login` for Cursor).

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Run the reference web app (server + Vite UI) |
| `bun run dev:agent` | Run the reference local agent |
| `bun run install:agent` | Install `webacp-agent` to `~/.webacp/bin` + background service |
| `webacp-agent status` | Service + pairing + update status |
| `webacp-agent update` | Pull latest and restart service |
| `bun run typecheck` | Typecheck every workspace package |
| `bun run build:libs` | Build all `@webacp/*` libraries to `dist/` |
| `bun run publish:libs` | Publish all `@webacp/*` packages to npm (uses `bun publish`) |

## Env

| Var | Default | Description |
|-----|---------|-------------|
| `WEBACP_PUBLIC_URL` | `http://127.0.0.1:3000` | URL the CLI agent uses to reach MCP endpoints |
| `WEBACP_WEB_URL` | `http://127.0.0.1:3000` | Web server URL the local agent connects to |
| `WEBACP_PAIR_TOKEN` | — | One-time pairing token (auto-handled by the UI) |
| `WEBACP_PAIR_PORT` | `9333` | Local agent's auto-pair HTTP port |
| `WEBACP_DB` | `./webacp.db` | SQLite path for the reference server |
| `WEBACP_CONFIG_DIR` | `~/.webacp` | Local agent credential dir |
| `WEBACP_UPDATE_ON_TRIGGER` | `1` (enabled) | Set `0` to disable trigger-based auto-updates |

## Status

Out of scope for now (protocol kept language-neutral to enable later): a Python
SDK/agent, richer event UI (plan/thought/tool-result cards), auth, and
multi-device sync.
