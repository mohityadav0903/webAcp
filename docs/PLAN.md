# WebACP roadmap

Close phases in order. No parallel “big vision” work until **Phase 3** ships.

---

## Done (baseline)

- [x] ACP providers: Claude, Cursor, Codex, Gemini, OpenCode
- [x] Setup: agent pairing, workspace folder, provider probe
- [x] Chat UI (shadcn), threads, routing, composer
- [x] Session persistence: `acpSessionId`, `loadSession`, in-memory session reuse
- [x] Cross-provider fallback: `prependHistoryToPrompt` (text-only, lossy)
- [x] CLI session import from native stores (Claude JSONL, Cursor ACP `store.db`, IDE transcripts, Codex rollout)
- [x] Export thread MD/JSON; optional `casr` bridge (if installed)
- [x] Client attachments → inline `ContentBlock` in prompt (no server upload yet)

---

## Phase 1 — File uploads (close first)

**Goal:** Uploads are durable, not inlined in every prompt. Agents can re-read files via MCP.

### 1.1 `@webacp/uploads` package
- [x] Types: `UploadedFile`, `UploadMeta`, MIME/size limits
- [x] Local FS adapter: `uploads/{id}/...`
- [ ] Optional S3 adapter stub (interface only for v0.1)

### 1.2 Server
- [x] `POST /api/uploads` (multipart) + `GET /api/uploads/:id`
- [x] Wire into `createWebacpServer({ uploads })`
- [x] Persist upload refs on messages (not full base64 in SQLite)
- [x] MCP tool `read_upload`

### 1.3 UI / protocol
- [x] Composer: upload → server → attach ref block
- [x] Message list: show attachment chips / image preview from server URL
- [x] Size/type validation + error states

### 1.4 Agent path
- [x] Uploaded files readable via server MCP `read_upload`

**Done when:** PDF/image/text upload survives refresh, appears in thread history, and active CLI can read it via MCP without re-pasting.

---

## Phase 2 — CLI switch mid-chat (close second)

**Goal:** User changes provider on same thread; context carries over reliably.

### 2.1 Per-provider session map
- [ ] Thread schema: `providerSessions: Record<providerId, { acpSessionId, storageKind? }>` (JSON column)
- [ ] Migration in `@webacp/persistence` sqlite adapter
- [ ] On `session.bound`: store id under current provider key (not single `acpSessionId` only)
- [ ] Import: map `sourceKey` → correct provider entry

### 2.2 Switch behavior
- [ ] **Same provider return:** `loadSession` / `session/resume` with stored id
- [ ] **Cross-provider:** keep thread messages + send structured handoff (v0.1: improved history blocks; v0.2: WorkContext)
- [ ] Stop clearing `acpSessionId` on PATCH provider — update map instead
- [ ] UI: provider dropdown switches thread provider without new thread; banner “switched to X”

### 2.3 Verification
- [ ] Cursor → Claude → Cursor on same thread (imported or live)
- [ ] New message after switch sees prior user/assistant text
- [ ] Returning to original provider resumes native session when id exists

**Done when:** Provider switch on an active thread works in dev app without manual import/export; no silent context loss for text turns.

---

## Phase 3 — Publish v0.1 packages (close third)

**Goal:** Installable npm packages + agent binary for early adopters.

### 3.1 Build & release
- [ ] `tsc` dist for all `packages/*` (verify `exports` → `dist`)
- [ ] Align versions `0.1.0` across `@webacp/*`
- [ ] Publish order: `protocol` → `persistence` → `core` → `tools` → `tools-fs` → `agent` → `server` → `react` → `ui`
- [ ] `webacp-agent` bin via `@webacp/local-agent` or `@webacp/agent` publish config
- [ ] Minimal README per package (install + one example)

### 3.2 Reference app
- [ ] `apps/web` consumes published versions (or workspace publish dry-run)
- [ ] `examples/custom-app` documents embed pattern

### 3.3 CI (minimal)
- [ ] `bun run typecheck` + build on PR
- [ ] Optional: changesets or manual version bump doc

**Done when:** `npm install @webacp/ui @webacp/server …` works; `npx webacp-agent run` documented.

---

## Phase 4+ — Context OS & multi-CLI (after v0.1)

Not in scope until Phases 1–3 are closed.

### 4.1 WorkContext layer
- [ ] `.webacp/` repo-local: decisions, specs, handoff checkpoints
- [ ] MCP resources/tools for context (not transcript replay)
- [ ] Replace `prependHistoryToPrompt` for cross-provider handoff

### 4.2 Orchestrator MCP (`delegate_acp`)
- [ ] Child ACP session pool on local agent
- [ ] Tools: `delegate_acp`, `poll_delegate`, `cancel_delegate`
- [ ] Background jobs + UI status
- [ ] Pass WorkContext into child `session/new`

### 4.3 Native bridge
- [ ] casr / native writers on handoff (optional)
- [ ] Deeper import (tool fidelity, blob ordering)

### 4.4 E2E product
- [ ] User picks starter CLI; agent delegates to another via MCP
- [ ] PM/designer connectors, update pipelines (original vision)

---

## Architecture note (multi-CLI)

```
User thread (WebACP)
  ├── WorkContext (Phase 4) — shared truth
  ├── Primary ACP session (active provider)
  └── Orchestrator MCP (Phase 4) — spawn other ACP CLIs as subagents
```

ACP = talk to each CLI. MCP = parent agent invokes delegate tools. WebACP = client + orchestrator + storage.

Prior art: [Mastra ACP](https://mastra.ai/docs/agents/acp), [subagent-mcp](https://github.com/Heretyc/subagent-mcp), [sub-agents-mcp](https://github.com/shinpr/sub-agents-mcp), [casr](https://github.com/Dicklesworthstone/cross_agent_session_resumer).

---

## Current focus

| Order | Phase              | Status      |
|-------|--------------------|-------------|
| 1     | File uploads       | **Done** (S3 stub deferred) |
| 2     | CLI switch in chat | **Next**    |
| 3     | Publish v0.1       | Pending     |
| 4+    | Context OS / MCP orchestrator | Later |
