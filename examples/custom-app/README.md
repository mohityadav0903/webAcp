# custom-app example

Minimal WebACP server + local agent using published-style SDK APIs.

- **Server** (`server.ts`) — custom `memory` server tool, `fs` + `whoami` local tools, SQLite
- **Agent** (`agent.ts`) — runs local tool handlers on the user's machine
- **shared-tools.ts** — local packs must be registered on **both** server and agent

## From monorepo (dev)

```bash
# repo root
bun install

# terminal 1
cd examples/custom-app && bun run server

# terminal 2 — pair to this server (not the default :3000 app)
TOKEN=$(curl -s http://127.0.0.1:4000/api/pairing/token | bun -e "console.log(JSON.parse(await Bun.stdin.text()).token)")
WEBACP_WEB_URL=http://127.0.0.1:4000 WEBACP_PAIR_TOKEN=$TOKEN bun run agent
```

Health: `curl http://127.0.0.1:4000/api/health`

MCP: `http://127.0.0.1:4000/mcp/server` and `/mcp/local`

## Standalone (npm packages)

Copy these files to a new project, then:

```bash
npm i @webacp/server@0.1.2 @webacp/agent@0.1.2 @webacp/tools-fs@0.1.2 @webacp/tools@0.1.2 @webacp/persistence@0.1.2 zod
bun run server.ts
```

Requires [Bun](https://bun.sh) (SQLite adapter uses `bun:sqlite`).
