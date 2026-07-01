import { randomUUID } from 'node:crypto';
import {
  parseAgentMessage,
  type ContentBlock,
  type HistoryTurn,
  type McpServerRef,
  type ToolResult,
} from '@webacp/protocol';
import type { AgentSecretStore } from './store.js';

export interface AgentSocket {
  send(data: string): void;
}

export interface ConnectedAgent {
  agentId: string;
  agentName?: string;
  ws: AgentSocket;
  connectedAt: number;
}

export type ChatBusEvent =
  | { type: 'acp.event'; sessionId: string; sseEvent: string; data: unknown }
  | { type: 'chat.done'; sessionId: string }
  | { type: 'chat.error'; sessionId: string; message: string }
  | {
      type: 'session.config';
      threadId: string;
      models: Array<{ id: string; name: string }>;
      currentModel?: string | null;
    }
  | {
      type: 'session.bound';
      threadId: string;
      provider: string;
      acpSessionId: string;
    };

export interface StartChatOptions {
  sessionId: string;
  threadId: string;
  message?: string;
  blocks?: ContentBlock[];
  mcpServers: McpServerRef[];
  provider?: string;
  model?: string;
  acpSessionId?: string | null;
  history?: HistoryTurn[];
}

export interface Registry {
  createPairingToken(): string;
  isAgentConnected(): boolean;
  routeToolCall(call: { tool: string; args: Record<string, unknown>; id?: string }): Promise<unknown>;
  materializeUpload(input: {
    name: string;
    mimeType: string;
    data: Buffer;
    threadId?: string | null;
  }): Promise<{ path: string }>;
  startChatSession(opts: StartChatOptions): void;
  setModel(threadId: string, value: string): void;
  handleAgentMessage(raw: unknown, ws: AgentSocket): void;
  bindSocketAgentId(raw: unknown): string | undefined;
  unregisterAgent(agentId: string): void;
  chatEvents: {
    subscribe(fn: (msg: ChatBusEvent) => void): () => void;
  };
}

export interface RegistryOptions {
  store: AgentSecretStore;
  publicUrl: string;
  toolCallTimeoutMs?: number;
}

export function createRegistry(options: RegistryOptions): Registry {
  const { store, publicUrl } = options;
  const toolTimeout = options.toolCallTimeoutMs ?? 60_000;

  const agents = new Map<string, ConnectedAgent>();
  let primaryAgentId: string | null = null;
  const pairingTokens = new Map<string, { expiresAt: number }>();
  const pendingToolCalls = new Map<
    string,
    { resolve: (r: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  const pendingUploads = new Map<
    string,
    { resolve: (r: { path: string }) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  const listeners = new Set<(msg: ChatBusEvent) => void>();

  function dispatch(msg: ChatBusEvent) {
    for (const fn of listeners) fn(msg);
  }

  function getPrimaryAgent(): ConnectedAgent | null {
    if (!primaryAgentId) return null;
    return agents.get(primaryAgentId) ?? null;
  }

  function registerAgent(ws: AgentSocket, agentId: string, agentName?: string) {
    agents.set(agentId, { agentId, agentName, ws, connectedAt: Date.now() });
    if (!primaryAgentId) primaryAgentId = agentId;
    console.log(`[registry] agent connected: ${agentId} (total: ${agents.size})`);
  }

  function unregisterAgent(agentId: string) {
    agents.delete(agentId);
    if (primaryAgentId === agentId) {
      primaryAgentId = agents.keys().next().value ?? null;
    }
    console.log(`[registry] agent disconnected: ${agentId}`);
  }

  function consumePairingToken(token: string): boolean {
    const entry = pairingTokens.get(token);
    if (!entry || entry.expiresAt < Date.now()) {
      pairingTokens.delete(token);
      return false;
    }
    pairingTokens.delete(token);
    return true;
  }

  async function handlePairRequest(
    ws: AgentSocket,
    agentId: string,
    agentName: string | undefined,
    token: string,
  ) {
    if (!consumePairingToken(token)) {
      ws.send(JSON.stringify({ type: 'pair.error', message: 'Invalid or expired token' }));
      return;
    }
    const secret = await store.issue(agentId, agentName);
    registerAgent(ws, agentId, agentName);
    ws.send(JSON.stringify({ type: 'pair.ok', agentId, secret, webUrl: publicUrl }));
  }

  async function handlePairReconnect(
    ws: AgentSocket,
    agentId: string,
    agentName: string | undefined,
    secret: string,
  ) {
    if (!(await store.validate(agentId, secret))) {
      ws.send(JSON.stringify({ type: 'pair.error', message: 'Invalid credentials' }));
      return;
    }
    registerAgent(ws, agentId, agentName);
    ws.send(JSON.stringify({ type: 'pair.ok', agentId, webUrl: publicUrl }));
  }

  function resolveToolResult(msg: ToolResult) {
    const pending = pendingToolCalls.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingToolCalls.delete(msg.id);
    if (msg.ok) pending.resolve(msg.result);
    else pending.reject(new Error(msg.error ?? 'Tool call failed'));
  }

  function resolveUploadMaterialized(msg: {
    id: string;
    ok: boolean;
    path?: string;
    error?: string;
  }) {
    const pending = pendingUploads.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingUploads.delete(msg.id);
    if (msg.ok && msg.path) pending.resolve({ path: msg.path });
    else pending.reject(new Error(msg.error ?? 'Upload materialize failed'));
  }

  return {
    createPairingToken() {
      const token = randomUUID().replace(/-/g, '').slice(0, 12);
      pairingTokens.set(token, { expiresAt: Date.now() + 10 * 60_000 });
      return token;
    },

    isAgentConnected() {
      return getPrimaryAgent() !== null;
    },

    routeToolCall(call) {
      const agent = getPrimaryAgent();
      if (!agent) {
        return Promise.reject(new Error('Local agent not connected.'));
      }
      const id = call.id || randomUUID();
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingToolCalls.delete(id);
          reject(new Error('Tool call timed out'));
        }, toolTimeout);
        pendingToolCalls.set(id, { resolve, reject, timer });
        agent.ws.send(JSON.stringify({ type: 'tool.call', id, tool: call.tool, args: call.args }));
      });
    },

    materializeUpload(input) {
      const agent = getPrimaryAgent();
      if (!agent) {
        return Promise.reject(new Error('Local agent not connected.'));
      }
      const id = randomUUID();
      return new Promise<{ path: string }>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingUploads.delete(id);
          reject(new Error('Upload materialize timed out'));
        }, toolTimeout);
        pendingUploads.set(id, { resolve, reject, timer });
        agent.ws.send(
          JSON.stringify({
            type: 'upload.materialize',
            id,
            name: input.name,
            mimeType: input.mimeType,
            dataBase64: input.data.toString('base64'),
            threadId: input.threadId ?? undefined,
          }),
        );
      });
    },

    startChatSession(opts) {
      const agent = getPrimaryAgent();
      if (!agent) {
        dispatch({
          type: 'chat.error',
          sessionId: opts.sessionId,
          message: 'Local agent not connected',
        });
        return;
      }
      agent.ws.send(
        JSON.stringify({
          type: 'chat.start',
          sessionId: opts.sessionId,
          threadId: opts.threadId,
          message: opts.message,
          blocks: opts.blocks,
          mcpServers: opts.mcpServers,
          provider: opts.provider,
          model: opts.model,
          acpSessionId: opts.acpSessionId ?? undefined,
          history: opts.history,
        }),
      );
    },

    setModel(threadId, value) {
      const agent = getPrimaryAgent();
      if (!agent) return;
      agent.ws.send(JSON.stringify({ type: 'session.set_model', threadId, value }));
    },

    handleAgentMessage(raw, ws) {
      const msg = parseAgentMessage(raw);
      switch (msg.type) {
        case 'pair.request':
          void handlePairRequest(ws, msg.agentId, msg.agentName, msg.token);
          return;
        case 'pair.reconnect':
          void handlePairReconnect(ws, msg.agentId, msg.agentName, msg.secret);
          return;
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        case 'tool.result':
          resolveToolResult(msg);
          return;
        case 'upload.materialized':
          resolveUploadMaterialized(msg);
          return;
        case 'acp.event':
          dispatch({
            type: 'acp.event',
            sessionId: msg.sessionId,
            sseEvent: msg.sseEvent,
            data: msg.data,
          });
          return;
        case 'chat.done':
          dispatch({ type: 'chat.done', sessionId: msg.sessionId });
          return;
        case 'chat.error':
          dispatch({ type: 'chat.error', sessionId: msg.sessionId, message: msg.message });
          return;
        case 'session.config':
          dispatch({
            type: 'session.config',
            threadId: msg.threadId,
            models: msg.models,
            currentModel: msg.currentModel,
          });
          return;
        case 'session.bound':
          dispatch({
            type: 'session.bound',
            threadId: msg.threadId,
            provider: msg.provider,
            acpSessionId: msg.acpSessionId,
          });
          return;
      }
    },

    bindSocketAgentId(raw) {
      if (raw && typeof raw === 'object' && 'agentId' in raw) {
        const id = (raw as { agentId?: unknown }).agentId;
        return typeof id === 'string' ? id : undefined;
      }
      return undefined;
    },

    unregisterAgent,

    chatEvents: {
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
  };
}
