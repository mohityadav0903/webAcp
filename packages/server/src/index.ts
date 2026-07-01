import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { randomUUID } from 'node:crypto';
import {
  ACP_PROVIDERS,
  type AcpProviderPreset,
} from '@webacp/core';
import {
  buildMcpServer,
  handleMcpHttpRequest,
  packsExecutor,
  type ToolPack,
} from '@webacp/tools';
import { memoryAdapter, type PersistenceAdapter } from '@webacp/persistence';
import type { HistoryTurn, McpServerRef } from '@webacp/protocol';
import {
  chatRequestBodySchema,
  defaultWebUrl,
  hasPromptContent,
  importCliSessionsBodySchema,
  messagePreviewText,
  resolveChatBlocks,
  serializeMessageContent,
  storedContentToHistoryText,
  threadExportFormatSchema,
  updateThreadBodySchema,
} from '@webacp/protocol';
import { createRegistry, type ChatBusEvent, type Registry } from './registry.js';
import { fileAgentStore, type AgentSecretStore } from './store.js';
import { importCliSessions, threadToSummary } from './import-cli-sessions.js';
import { exportThreadJson, exportThreadMarkdown } from './export-thread.js';

export interface WebacpServerOptions {
  /** Tools executed in this server process. */
  serverToolPacks?: ToolPack[];
  /** Tools whose schemas live here but execute on the local agent. */
  localToolPacks?: ToolPack[];
  /** External MCP servers passed straight through to the CLI agent. */
  externalMcp?: McpServerRef[];
  /** Storage for threads + messages. Defaults to in-memory. */
  persistence?: PersistenceAdapter;
  /** Agent credential store. Defaults to ~/.webacp/server/agents.json. */
  store?: AgentSecretStore;
  /** Public URL the CLI agent uses to reach this server's MCP endpoints. */
  publicUrl?: string;
  /** Provider presets exposed to the UI. */
  providers?: AcpProviderPreset[];
}

export interface WebacpServer {
  hono: Hono;
  registry: Registry;
  fetch: (req: Request, server: unknown) => Response | Promise<Response> | undefined;
  websocket: {
    open(ws: BunWS): void;
    message(ws: BunWS, message: string | Buffer): void;
    close(ws: BunWS): void;
  };
}

interface BunWS {
  data: { agentId?: string };
  send(data: string): void;
}

export function createWebacpServer(options: WebacpServerOptions = {}): WebacpServer {
  const serverPacks = options.serverToolPacks ?? [];
  const localPacks = options.localToolPacks ?? [];
  const externalMcp = options.externalMcp ?? [];
  const persistence = options.persistence ?? memoryAdapter();
  const store = options.store ?? fileAgentStore();
  const publicUrl = options.publicUrl ?? process.env.WEBACP_PUBLIC_URL ?? defaultWebUrl();
  const providers = options.providers ?? ACP_PROVIDERS;

  const registry = createRegistry({ store, publicUrl });

  const serverExecutor = packsExecutor(serverPacks);

  function mcpServersForChat(): McpServerRef[] {
    const list: McpServerRef[] = [];
    if (serverPacks.length > 0) {
      list.push({ name: 'webacp-server', type: 'http', url: `${publicUrl}/mcp/server` });
    }
    if (localPacks.length > 0) {
      list.push({ name: 'webacp-local', type: 'http', url: `${publicUrl}/mcp/local` });
    }
    return [...list, ...externalMcp];
  }

  const app = new Hono();
  app.use('/api/*', cors());
  app.use('/mcp/*', cors());

  app.get('/api/health', (c) =>
    c.json({ ok: true, agentConnected: registry.isAgentConnected(), webUrl: publicUrl }),
  );

  app.get('/api/pairing/token', (c) =>
    c.json({ token: registry.createPairingToken(), expiresInSeconds: 600 }),
  );

  app.get('/api/providers', (c) =>
    c.json({
      providers: providers.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        setupHint: p.setupHint,
        authMethodId: p.authMethodId,
        authKind: p.authMethodId ? 'acp_terminal' : 'cli',
      })),
    }),
  );

  // ---- Uploads (materialize to workspace via local agent) ----------------

  app.post('/api/uploads', async (c) => {
    if (!registry.isAgentConnected()) {
      return c.json({ error: 'Local agent not connected' }, 503);
    }
    const body = await c.req.parseBody();
    const file = body.file;
    if (!file || typeof file === 'string') {
      return c.json({ error: 'file required' }, 400);
    }
    const upload = file as Blob & { name?: string };
    const name = upload.name || 'upload';
    const mimeType = upload.type || 'application/octet-stream';
    const threadId = typeof body.threadId === 'string' ? body.threadId : null;
    const buffer = Buffer.from(await upload.arrayBuffer());
    try {
      const { path } = await registry.materializeUpload({
        name,
        mimeType,
        data: buffer,
        threadId,
      });
      return c.json({ path, name, mimeType, size: buffer.byteLength });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      return c.json({ error: message }, 400);
    }
  });

  // ---- Threads -----------------------------------------------------------

  app.get('/api/threads', async (c) => {
    const workspace = c.req.query('workspace');
    let threads = await persistence.listThreads();
    if (workspace) {
      threads = threads.filter((t) => t.workspaceCwd === workspace || !t.workspaceCwd);
    }
    return c.json({ threads: threads.map(threadToSummary) });
  });

  app.post('/api/threads', async (c) => {
    const body = await c.req.json<{ title?: string; provider?: string; model?: string }>().catch(
      () => ({}) as { title?: string; provider?: string; model?: string },
    );
    const thread = await persistence.createThread({
      title: body.title,
      provider: body.provider ?? null,
      model: body.model ?? null,
    });
    return c.json({ thread: threadToSummary(thread) });
  });

  app.post('/api/threads/import', async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = importCliSessionsBodySchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: 'Invalid body' }, 400);
    const result = await importCliSessions(
      persistence,
      parsed.data.cwd,
      parsed.data.sessions,
    );
    return c.json(result);
  });

  app.get('/api/threads/:id', async (c) => {
    const thread = await persistence.getThread(c.req.param('id'));
    if (!thread) return c.json({ error: 'Not found' }, 404);
    return c.json({ thread });
  });

  app.patch('/api/threads/:id', async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = updateThreadBodySchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: 'Invalid body' }, 400);
    const id = c.req.param('id');
    const existing = await persistence.getThread(id);
    const patch = { ...parsed.data };
    if (
      existing &&
      patch.provider !== undefined &&
      patch.provider !== existing.provider
    ) {
      patch.model = patch.model ?? null;
      await persistence.updateThread(id, { ...patch, acpSessionId: null });
    } else {
      await persistence.updateThread(id, patch);
    }
    const thread = await persistence.getThread(id);
    return c.json({ thread });
  });

  app.delete('/api/threads/:id', async (c) => {
    await persistence.deleteThread(c.req.param('id'));
    return c.json({ ok: true });
  });

  app.get('/api/threads/:id/messages', async (c) =>
    c.json({ messages: await persistence.listMessages(c.req.param('id')) }),
  );

  app.get('/api/threads/:id/export', async (c) => {
    const id = c.req.param('id');
    const thread = await persistence.getThread(id);
    if (!thread) return c.json({ error: 'Not found' }, 404);
    const format = threadExportFormatSchema.safeParse(c.req.query('format') ?? 'markdown');
    if (!format.success) return c.json({ error: 'Invalid format' }, 400);
    const messages = await persistence.listMessages(id);
    const content =
      format.data === 'json'
        ? exportThreadJson(thread, messages)
        : exportThreadMarkdown(thread, messages);
    const ext = format.data === 'json' ? 'json' : 'md';
    const filename = `${thread.title.replace(/[^\w.-]+/g, '-').slice(0, 48) || 'chat'}.${ext}`;
    return c.json({ format: format.data, filename, content });
  });

  // Truncate a thread at a message (used by retry / edit). `inclusive` removes
  // the referenced message too.
  app.post('/api/threads/:id/truncate', async (c) => {
    const body = await c.req.json<{ messageId: string; inclusive?: boolean }>();
    const messages = await persistence.truncateAfter(
      c.req.param('id'),
      body.messageId,
      body.inclusive ?? false,
    );
    return c.json({ messages });
  });

  // Fork a thread into a new thread, copying messages up to (not including) a
  // message. The new thread starts a fresh ACP session.
  app.post('/api/threads/:id/fork', async (c) => {
    const body = await c.req.json<{ messageId: string }>();
    const sourceId = c.req.param('id');
    const source = await persistence.getThread(sourceId);
    if (!source) return c.json({ error: 'Not found' }, 404);

    const all = await persistence.listMessages(sourceId);
    const idx = all.findIndex((m) => m.id === body.messageId);
    const kept = idx === -1 ? all : all.slice(0, idx);

    const forked = await persistence.createThread({
      title: source.title,
      provider: source.provider,
      model: source.model,
    });
    for (const m of kept) {
      await persistence.addMessage({
        threadId: forked.id,
        role: m.role,
        content: m.content,
        toolName: m.toolName,
      });
    }
    return c.json({ thread: forked, messages: await persistence.listMessages(forked.id) });
  });

  // ---- Model selection ---------------------------------------------------

  app.post('/api/threads/:id/model', async (c) => {
    const body = await c.req.json<{ value: string }>();
    const threadId = c.req.param('id');
    registry.setModel(threadId, body.value);
    await persistence.updateThread(threadId, { model: body.value });
    return c.json({ ok: true });
  });

  // ---- Chat (SSE) --------------------------------------------------------

  app.post('/api/chat', async (c) => {
    const raw = await c.req.json();
    const body = chatRequestBodySchema.safeParse(raw);
    if (!body.success) {
      const issue = body.error.issues[0];
      return c.json({ error: issue?.message ?? 'Invalid chat request' }, 400);
    }
    const req = body.data;
    const blocks = resolveChatBlocks(req);
    if (!hasPromptContent(blocks)) {
      return c.json({ error: 'message or blocks required' }, 400);
    }

    if (!registry.isAgentConnected()) return c.json({ error: 'Local agent not connected' }, 503);

    let thread = req.threadId ? await persistence.getThread(req.threadId) : null;
    if (!thread) {
      thread = await persistence.createThread({
        title: messagePreviewText(blocks, 60),
        provider: req.provider ?? null,
        model: req.model ?? null,
      });
    }
    const threadId = thread.id;

    const effectiveProvider = req.provider ?? thread.provider ?? undefined;
    if (req.provider && req.provider !== thread.provider) {
      await persistence.updateThread(threadId, {
        provider: req.provider,
        model: null,
        acpSessionId: null,
      });
      thread = { ...thread, provider: req.provider, model: null, acpSessionId: null };
    }

    const effectiveModel = req.model ?? thread.model ?? undefined;
    const storedContent = serializeMessageContent(blocks);

    if (!req.skipUserMessage) {
      await persistence.addMessage({
        id: req.userMessageId ?? randomUUID(),
        threadId,
        role: 'user',
        content: storedContent,
      });
    }

    const storedMessages = await persistence.listMessages(threadId);
    const historyMessages = req.skipUserMessage
      ? storedMessages
      : storedMessages.slice(0, -1);
    const history: HistoryTurn[] = historyMessages.flatMap((m) => {
      if (m.role !== 'user' && m.role !== 'assistant') return [];
      const content = storedContentToHistoryText(m.content).trim();
      if (!content) return [];
      return [{ role: m.role, content }];
    });

    const resumeAcpSessionId =
      effectiveProvider &&
      thread.provider === effectiveProvider &&
      thread.acpSessionId
        ? thread.acpSessionId
        : null;

    const sessionId = randomUUID();
    const mcpServers = mcpServersForChat();

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: 'thread', data: JSON.stringify({ threadId }) });

      let assistantText = '';

      await new Promise<void>((resolve) => {
        let closed = false;
        let keepAlive: ReturnType<typeof setInterval>;

        const finish = async () => {
          if (closed) return;
          closed = true;
          clearInterval(keepAlive);
          unsubscribe();
          if (assistantText.trim()) {
            await persistence.addMessage({
              threadId,
              role: 'assistant',
              content: assistantText,
            });
          }
          resolve();
        };

        const onEvent = async (msg: ChatBusEvent) => {
          if (msg.type === 'session.config' && msg.threadId === threadId) {
            await persistence.updateThread(threadId, { model: msg.currentModel ?? undefined });
            await stream.writeSSE({
              event: 'config',
              data: JSON.stringify({ models: msg.models, currentModel: msg.currentModel }),
            });
            return;
          }
          if (msg.type === 'session.bound' && msg.threadId === threadId) {
            await persistence.updateThread(threadId, { acpSessionId: msg.acpSessionId });
            return;
          }
          if (!('sessionId' in msg) || msg.sessionId !== sessionId) return;

          if (msg.type === 'acp.event') {
            if (msg.sseEvent === 'text') {
              const data = msg.data as { content?: string };
              if (typeof data?.content === 'string') assistantText += data.content;
            }
            await stream.writeSSE({ event: msg.sseEvent, data: JSON.stringify(msg.data) });
            return;
          }
          if (msg.type === 'chat.done') {
            await stream.writeSSE({ event: 'done', data: JSON.stringify({ type: 'done' }) });
            await finish();
            return;
          }
          if (msg.type === 'chat.error') {
            await stream.writeSSE({
              event: 'error',
              data: JSON.stringify({ type: 'error', message: msg.message }),
            });
            await finish();
          }
        };

        const unsubscribe = registry.chatEvents.subscribe((msg) => {
          void onEvent(msg);
        });

        keepAlive = setInterval(() => {
          if (!closed) void stream.writeSSE({ event: 'ping', data: '{}' });
        }, 15_000);

        registry.startChatSession({
          sessionId,
          threadId,
          message: messagePreviewText(blocks, 200),
          blocks,
          mcpServers,
          provider: effectiveProvider,
          model: effectiveModel,
          acpSessionId: resumeAcpSessionId,
          history: history.length ? history : undefined,
        });

        setTimeout(() => void finish(), 10 * 60_000);
      });
    });
  });

  // ---- MCP endpoints -----------------------------------------------------

  const serverMcpFactory = () =>
    buildMcpServer({
      name: 'webacp-server',
      packs: serverPacks,
      execute: serverExecutor,
    });

  const localMcpFactory = () =>
    buildMcpServer({
      name: 'webacp-local',
      packs: localPacks,
      execute: (tool, args) => registry.routeToolCall({ tool, args }),
    });

  const handleServerMcp = async (c: { req: { raw: Request } }) =>
    handleMcpHttpRequest(c.req.raw, serverMcpFactory);
  const handleLocalMcp = async (c: { req: { raw: Request } }) => {
    if (!registry.isAgentConnected()) {
      return new Response(JSON.stringify({ error: 'Local agent required' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return handleMcpHttpRequest(c.req.raw, localMcpFactory);
  };

  app.all('/mcp/server', (c) => handleServerMcp(c));
  app.all('/mcp/server/*', (c) => handleServerMcp(c));
  app.all('/mcp/local', (c) => handleLocalMcp(c));
  app.all('/mcp/local/*', (c) => handleLocalMcp(c));

  // ---- WebSocket (Bun adapter) ------------------------------------------

  const wsPath = '/api/agent/ws';

  return {
    hono: app,
    registry,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === wsPath) {
        const bunServer = server as { upgrade(req: Request, opts: { data: unknown }): boolean };
        if (bunServer.upgrade(req, { data: {} })) return undefined;
        return new Response('WebSocket upgrade failed', { status: 400 });
      }
      return app.fetch(req, server as never);
    },
    websocket: {
      open() {
        console.log('[ws] agent socket opened');
      },
      message(ws, message) {
        try {
          const raw = JSON.parse(message.toString());
          registry.handleAgentMessage(raw, ws);
          const boundId = registry.bindSocketAgentId(raw);
          if (boundId) ws.data.agentId = boundId;
        } catch (err) {
          console.error('[ws] message error:', err);
        }
      },
      close(ws) {
        if (ws.data.agentId) registry.unregisterAgent(ws.data.agentId);
      },
    },
  };
}

export { createRegistry, type Registry, type ChatBusEvent } from './registry.js';
export { fileAgentStore, memoryAgentStore, type AgentSecretStore } from './store.js';
export { defineTool, defineToolPack, type ToolPack, type ToolDef } from '@webacp/tools';
