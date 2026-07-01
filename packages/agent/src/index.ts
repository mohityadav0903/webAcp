import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import {
  connectAcpAgent,
  disconnectAcpAgent,
  formatRpcError,
  getAcpConnectionStatus,
  promptAcpSession,
  resolveProvider,
  setSessionModel,
  type AcpConnectionState,
  type McpServerConfig,
} from '@webacp/core';
import {
  DEFAULT_AGENT_PAIR_PORT,
  blocksToAcpPrompt,
  parseWebMessage,
  type ChatStart,
  type ToolCall,
  type UploadMaterialize,
  type WebMessage,
} from '@webacp/protocol';
import { indexTools, type ToolPack } from '@webacp/tools';
import {
  fileCredentialStore,
  type AgentCredentials,
  type CredentialStore,
} from './credentials.js';
import { startPairServer, type PairRequestPayload } from './pair-server.js';
import { createSetupHandlers } from './setup-handlers.js';

export interface LocalAgentOptions {
  /** Local tool packs to execute on this machine. */
  toolPacks?: ToolPack[];
  webUrl?: string;
  agentId?: string;
  agentName?: string;
  pairPort?: number;
  pairToken?: string;
  credentials?: CredentialStore;
  systemPrompt?: string;
  cwd?: string;
}

export interface LocalAgentController {
  start(): Promise<void>;
  stop(): void;
}

const DEFAULT_SYSTEM_PROMPT = [
  'You are an assistant with access to the user filesystem and tools via MCP.',
  'Filesystem paths in tool calls are workspace-relative unless already absolute.',
  'Never ask the user for absolute paths — use the workspace-relative paths provided in messages.',
  'Use the provided MCP tools for file operations. Never guess file contents.',
  'Use shell/execute sparingly and only when necessary.',
].join('\n');

function workspacePacksExecutor(packs: ToolPack[], getWorkspace: () => string) {
  const index = indexTools(packs);
  return async (toolName: string, args: Record<string, unknown>) => {
    const entry = index.get(toolName);
    if (!entry) throw new Error(`Unknown tool: ${toolName}`);
    const parsed = entry.tool.input.parse(args);
    return entry.tool.handler(parsed, {
      pack: entry.pack.name,
      workspaceCwd: getWorkspace(),
    });
  };
}

export function createLocalAgent(options: LocalAgentOptions = {}): LocalAgentController {
  const toolPacks = options.toolPacks ?? [];
  const credentialStore = options.credentials ?? fileCredentialStore();
  const pairPort = options.pairPort ?? Number(process.env.WEBACP_PAIR_PORT ?? DEFAULT_AGENT_PAIR_PORT);
  const envToken = options.pairToken ?? process.env.WEBACP_PAIR_TOKEN ?? '';
  const agentName = options.agentName ?? 'webacp-local-agent';
  const systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const defaultCwd = options.cwd ?? process.cwd();

  let ws: WebSocket | null = null;
  let acpState: AcpConnectionState | null = null;
  const activeSessions = new Set<string>();

  let credentials: AgentCredentials | null = null;
  let agentId = options.agentId ?? process.env.WEBACP_AGENT_ID ?? `agent-${randomUUID().slice(0, 8)}`;
  let webUrl = options.webUrl ?? process.env.WEBACP_WEB_URL ?? 'http://127.0.0.1:3000';
  let wsConnected = false;
  let paired = false;
  let pendingPairToken: string | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const setupHandlers = createSetupHandlers(() => ({
    paired: paired || !!credentials,
    connected: wsConnected && paired,
    agentId,
  }));

  const getWorkspace = () => setupHandlers.getWorkspaceCwd() ?? defaultCwd;
  const execute = workspacePacksExecutor(toolPacks, getWorkspace);

  function wsUrl(): string {
    return process.env.WEBACP_WS_URL ?? webUrl.replace(/^http/, 'ws') + '/api/agent/ws';
  }

  function send(msg: Record<string, unknown>) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function isAcpAlive(state: AcpConnectionState): boolean {
    return state.process.exitCode === null && !state.process.killed;
  }

  async function ensureAcp(providerId?: string): Promise<AcpConnectionState> {
    const preset = resolveProvider(providerId);
    if (acpState && acpState.providerId === preset.id && isAcpAlive(acpState)) return acpState;
    if (acpState) {
      disconnectAcpAgent(acpState);
      acpState = null;
    }
    const connected = await connectAcpAgent({
      config: preset.config,
      providerId: preset.id,
      authMethodId: preset.authMethodId,
    });
    acpState = connected;
    connected.process.on('exit', (code) => {
      console.log(`[agent] ACP process exited (code=${code ?? 'signal'})`);
      if (acpState === connected) acpState = null;
    });
    console.log(`[agent] ACP connected: ${connected.agentInfo.name} (${preset.displayName})`);
    return connected;
  }

  async function handleToolCall(msg: ToolCall) {
    try {
      const result = await execute(msg.tool, msg.args);
      send({ type: 'tool.result', id: msg.id, ok: true, result });
    } catch (err) {
      send({
        type: 'tool.result',
        id: msg.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleUploadMaterialize(msg: UploadMaterialize) {
    const cwd = setupHandlers.getWorkspaceCwd();
    if (!cwd) {
      send({
        type: 'upload.materialized',
        id: msg.id,
        ok: false,
        error: 'Workspace not set — complete setup first',
      });
      return;
    }
    try {
      const data = Buffer.from(msg.dataBase64, 'base64');
      const { path } = await import('./materialize-upload.js').then((m) =>
        m.materializeUpload({
          cwd,
          name: msg.name,
          mimeType: msg.mimeType,
          data,
          threadId: msg.threadId,
        }),
      );
      send({ type: 'upload.materialized', id: msg.id, ok: true, path });
    } catch (err) {
      send({
        type: 'upload.materialized',
        id: msg.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleChatStart(msg: ChatStart) {
    if (activeSessions.has(msg.sessionId)) {
      send({ type: 'chat.error', sessionId: msg.sessionId, message: 'Session already running' });
      return;
    }

    await import('./updater.js').then(({ maybeUpdateOnTrigger }) => maybeUpdateOnTrigger('chat'));

    activeSessions.add(msg.sessionId);

    try {
      const preset = resolveProvider(msg.provider);
      const state = await ensureAcp(msg.provider);
      if (!state.authenticated) {
        send({
          type: 'chat.error',
          sessionId: msg.sessionId,
          message: state.authError ?? `${preset.displayName}: authentication required`,
        });
        return;
      }
      const cwd = setupHandlers.getWorkspaceCwd() ?? defaultCwd;
      const blocks =
        msg.blocks?.length
          ? blocksToAcpPrompt(msg.blocks, { workspaceCwd: cwd })
          : msg.message
            ? [{ type: 'text' as const, text: msg.message }]
            : [];
      if (!blocks.length) {
        send({ type: 'chat.error', sessionId: msg.sessionId, message: 'Empty prompt' });
        return;
      }
      await promptAcpSession({
        state,
        threadId: msg.threadId,
        providerId: preset.id,
        cwd: setupHandlers.getWorkspaceCwd() ?? defaultCwd,
        mcpServers: msg.mcpServers as McpServerConfig[],
        systemPrompt,
        blocks,
        model: msg.model,
        resumeSessionId: msg.acpSessionId,
        history: msg.history,
        onEvent: ({ event, data }) => {
          send({ type: 'acp.event', sessionId: msg.sessionId, sseEvent: event, data });
        },
        onConfig: ({ models, currentModel }) => {
          send({ type: 'session.config', threadId: msg.threadId, models, currentModel });
        },
        onSessionBound: (session) => {
          send({
            type: 'session.bound',
            threadId: msg.threadId,
            provider: preset.id,
            acpSessionId: session.acpSessionId,
          });
        },
      });
      send({ type: 'chat.done', sessionId: msg.sessionId });
    } catch (err) {
      const preset = resolveProvider(msg.provider);
      const message = `${preset.displayName}: ${formatRpcError(err)}`;
      console.error('[agent] chat error:', message);
      if (acpState && !isAcpAlive(acpState)) acpState = null;
      send({ type: 'chat.error', sessionId: msg.sessionId, message });
    } finally {
      activeSessions.delete(msg.sessionId);
    }
  }

  function sendPairMessage() {
    if (credentials) {
      send({
        type: 'pair.reconnect',
        agentId: credentials.agentId,
        secret: credentials.secret,
        agentName,
      });
      return;
    }
    const token = pendingPairToken ?? envToken;
    if (!token) return;
    send({ type: 'pair.request', token, agentId, agentName });
  }

  async function handlePairOk(raw: Extract<WebMessage, { type: 'pair.ok' }>) {
    paired = true;
    pendingPairToken = null;
    agentId = raw.agentId;
    webUrl = raw.webUrl;
    if (raw.secret) {
      credentials = {
        agentId: raw.agentId,
        secret: raw.secret,
        webUrl: raw.webUrl,
        pairedAt: new Date().toISOString(),
      };
      await credentialStore.save(credentials);
      console.log(`[agent] paired and saved credentials (${credentials.agentId})`);
    } else {
      console.log(`[agent] reconnected as ${raw.agentId}`);
    }
  }

  function handleWebMessage(raw: WebMessage) {
    switch (raw.type) {
      case 'pong':
        return;
      case 'tool.call':
        void handleToolCall(raw);
        return;
      case 'upload.materialize':
        void handleUploadMaterialize(raw);
        return;
      case 'chat.start':
        void handleChatStart(raw);
        return;
      case 'chat.abort':
        activeSessions.delete(raw.sessionId);
        return;
      case 'session.set_model':
        if (acpState?.providerId) {
          void setSessionModel(acpState, raw.threadId, acpState.providerId, raw.value);
        }
        return;
      case 'pair.ok':
        void handlePairOk(raw);
        return;
      case 'pair.error':
        console.error(`[agent] pair failed: ${raw.message}`);
        paired = false;
        if (credentials) {
          console.log('[agent] clearing stale credentials — re-pair from web UI');
          credentials = null;
          void credentialStore.clear();
        }
        return;
    }
  }

  function connect() {
    if (stopped) return;
    console.log(`[agent] connecting to ${wsUrl()}`);
    wsConnected = false;
    paired = false;
    ws = new WebSocket(wsUrl());

    ws.on('open', () => {
      wsConnected = true;
      sendPairMessage();
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = setInterval(() => send({ type: 'ping' }), 30_000);
      void import('./updater.js').then(({ maybeUpdateOnTrigger }) => maybeUpdateOnTrigger('connect'));
    });

    ws.on('message', (data) => {
      try {
        const msg = parseWebMessage(JSON.parse(data.toString()));
        handleWebMessage(msg);
      } catch (err) {
        console.error('[agent] bad message:', err);
      }
    });

    ws.on('close', () => {
      wsConnected = false;
      paired = false;
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      if (acpState) {
        disconnectAcpAgent(acpState);
        acpState = null;
      }
      if (!stopped) {
        console.log('[agent] disconnected, reconnecting in 3s...');
        setTimeout(connect, 3000);
      }
    });

    ws.on('error', (err) => console.error('[agent] ws error:', err.message));
  }

  async function pairWithToken(payload: PairRequestPayload) {
    if (payload.webUrl) webUrl = payload.webUrl;
    pendingPairToken = payload.token;

    if (wsConnected) {
      sendPairMessage();
      await new Promise((r) => setTimeout(r, 1500));
      return paired
        ? { ok: true as const }
        : { ok: false as const, error: 'Pairing failed — is the web server running?' };
    }

    connect();
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 300));
      if (paired) return { ok: true as const };
    }
    return { ok: false as const, error: 'Timed out waiting for web server' };
  }

  return {
    async start() {
      stopped = false;
      credentials = await credentialStore.load();
      if (credentials) {
        agentId = credentials.agentId;
        webUrl = credentials.webUrl;
        console.log(`[agent] loaded credentials for ${agentId}`);
      }

      startPairServer(
        {
          getStatus: () => ({
            paired: paired || !!credentials,
            connected: wsConnected && paired,
            agentId,
            acp: getAcpConnectionStatus(acpState),
          }),
          onPair: pairWithToken,
          onUpdateTrigger: (trigger) =>
            import('./updater.js').then(({ maybeUpdateOnTrigger }) => maybeUpdateOnTrigger(trigger)),
          getSetupStatus: () => setupHandlers.getSetupStatus(),
          setWorkspace: (body) => setupHandlers.setWorkspace(body),
          getCliSessions: (cwd) => setupHandlers.getCliSessions(cwd),
          getCasrStatus: () => setupHandlers.getCasrStatus(),
          casrConvertSession: (body) =>
            setupHandlers.casrConvertSession({
              sessionId: body.sessionId,
              targetProvider: body.targetProvider as import('@webacp/protocol').AcpProviderId,
            }),
          setDefaultProvider: (id) => setupHandlers.setDefaultProvider(id),
          probeProviders: (id) => setupHandlers.probeProviders(id),
        },
        pairPort,
      );

      console.log('[agent] webacp local agent starting');
      connect();
    },
    stop() {
      stopped = true;
      if (acpState) disconnectAcpAgent(acpState);
      ws?.close();
    },
  };
}

export { startPairServer, type PairRequestPayload } from './pair-server.js';
export { fileCredentialStore, type AgentCredentials, type CredentialStore } from './credentials.js';
