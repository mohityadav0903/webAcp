import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type SessionNotification,
} from '@agentclientprotocol/sdk';
import { prependHistoryToPrompt, type AcpPromptBlock, type SseChatEvent } from '@webacp/protocol';
import type { AuthMethodSummary } from '@webacp/protocol';
import type {
  AcpAgentConfig,
  AcpConnectionState,
  ManagedSession,
  McpServerConfig,
  ModelInfo,
} from './types.js';
import { acpSessionKey } from './sessions.js';

export function createAcpConnection(proc: ReturnType<typeof spawn>): AcpConnectionState {
  const input = Writable.toWeb(proc.stdin!) as WritableStream<Uint8Array>;
  const output = Readable.toWeb(proc.stdout!) as unknown as ReadableStream<Uint8Array>;
  const stream = ndJsonStream(input, output);

  const state: AcpConnectionState = {
    connection: null!,
    agentInfo: { name: 'unknown' },
    process: proc,
    sessionUpdateEmitter: null,
    providerId: null,
    capabilities: { loadSession: false },
    sessions: new Map(),
    authMethods: [],
    authenticated: false,
    authError: null,
  };

  state.connection = new ClientSideConnection(
    () => ({
      sessionUpdate: async (params: SessionNotification) => {
        state.sessionUpdateEmitter?.dispatchEvent(
          new CustomEvent('update', { detail: params }),
        );
      },
      requestPermission: async (params) => {
        const allowOption = params.options?.find(
          (o) =>
            o.kind === 'allow_once' ||
            o.kind === 'allow_always' ||
            o.optionId.startsWith('allow'),
        );
        return {
          outcome: {
            outcome: 'selected' as const,
            optionId: allowOption?.optionId ?? params.options?.[0]?.optionId ?? 'allow',
          },
        };
      },
      /** Cursor ACP extension methods — auto-approve so chat doesn't block. */
      extMethod: async (method, _params) => {
        switch (method) {
          case 'cursor/ask_question':
            return { outcome: { outcome: 'skipped', reason: 'webacp auto-skip' } };
          case 'cursor/create_plan':
          case 'cursor/update_todos':
          case 'cursor/task':
          case 'cursor/generate_image':
            return { outcome: { outcome: 'accepted' } };
          default:
            console.warn(`[acp:ext] unhandled method ${method}`);
            return {};
        }
      },
      extNotification: async (method, params) => {
        console.log(`[acp:ext] ${method}`, JSON.stringify(params).slice(0, 200));
      },
    }),
    stream,
  );

  return state;
}

export async function connectAcpAgent(options: {
  config: AcpAgentConfig;
  providerId?: string;
  authMethodId?: string;
  initTimeoutMs?: number;
}): Promise<AcpConnectionState> {
  const { config, providerId, authMethodId, initTimeoutMs = 60_000 } = options;

  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawn(config.command, config.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...config.env },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to start ${config.command}: ${msg}`);
  }

  proc.stderr?.on('data', (chunk: Buffer) => {
    console.error('[acp:stderr]', chunk.toString().trim());
  });

  const state = createAcpConnection(proc);
  state.providerId = providerId ?? null;

  const exitPromise = new Promise<never>((_, reject) => {
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(new Error(`ACP process exited (code=${code ?? 'null'}, signal=${signal ?? 'none'})`));
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      proc.off('exit', onExit);
      proc.off('error', onError);
    };
    proc.once('exit', onExit);
    proc.once('error', onError);
  });

  const initPromise = state.connection.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {},
    clientInfo: { name: 'webacp', version: '0.0.1' },
  });

  const initResult = await Promise.race([
    initPromise,
    exitPromise,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`ACP initialize timed out after ${initTimeoutMs}ms`)),
        initTimeoutMs,
      );
      initPromise.finally(() => clearTimeout(timer));
    }),
  ]).catch((err) => {
    safeDisconnectAcpAgent(state);
    throw err;
  });

  state.agentInfo = {
    name: initResult.agentInfo?.name ?? config.command,
    title: initResult.agentInfo?.title ?? undefined,
    version: initResult.agentInfo?.version ?? undefined,
  };
  state.capabilities.loadSession = Boolean(
    (initResult as { agentCapabilities?: { loadSession?: boolean } }).agentCapabilities
      ?.loadSession,
  );
  state.authMethods = parseAuthMethods(
    (initResult as { authMethods?: unknown }).authMethods,
  );

  if (authMethodId) {
    try {
      await state.connection.authenticate({ methodId: authMethodId });
      state.authenticated = true;
      state.authError = null;
    } catch (err) {
      state.authenticated = false;
      state.authError = formatRpcError(err);
      console.warn('[acp] authenticate failed:', state.authError);
    }
  } else {
    // CLI-managed auth (claude login, etc.) — assume OK until prompt fails.
    state.authenticated = true;
    state.authError = null;
  }

  return state;
}

function parseAuthMethods(raw: unknown): AuthMethodSummary[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const o = item as Record<string, unknown>;
    const id =
      typeof o.id === 'string' ? o.id : typeof o.methodId === 'string' ? o.methodId : null;
    if (!id) return [];
    const name = typeof o.name === 'string' ? o.name : id;
    const type = o.type;
    return [
      {
        id,
        name,
        description: typeof o.description === 'string' ? o.description : undefined,
        type:
          type === 'terminal' || type === 'env_var' || type === 'agent' ? type : undefined,
      },
    ];
  });
}

export function getAcpConnectionStatus(state: AcpConnectionState | null): {
  providerId: string | null;
  connected: boolean;
  authenticated: boolean;
  agentName?: string;
  authMethods: AuthMethodSummary[];
  authError: string | null;
} {
  if (!state || state.process.exitCode !== null || state.process.killed) {
    return {
      providerId: null,
      connected: false,
      authenticated: false,
      authMethods: [],
      authError: null,
    };
  }
  return {
    providerId: state.providerId,
    connected: true,
    authenticated: state.authenticated,
    agentName: state.agentInfo.name,
    authMethods: state.authMethods,
    authError: state.authError,
  };
}

export function invalidateAcpSession(
  state: AcpConnectionState,
  threadId: string,
  providerId?: string,
): void {
  if (providerId) {
    state.sessions.delete(acpSessionKey(threadId, providerId));
    return;
  }
  for (const key of state.sessions.keys()) {
    if (key.startsWith(`${threadId}:`)) state.sessions.delete(key);
  }
}

export function disconnectAcpAgent(state: AcpConnectionState): void {
  safeDisconnectAcpAgent(state);
}

/** Tear down ACP child process without surfacing SDK read-loop errors. */
export function safeDisconnectAcpAgent(state: AcpConnectionState): void {
  state.sessions.clear();
  state.sessionUpdateEmitter = null;
  const proc = state.process;
  if (proc.exitCode !== null || proc.killed) return;
  try {
    proc.stdin?.end();
    proc.stdin?.destroy();
  } catch {
    /* ignore */
  }
  try {
    proc.stdout?.destroy();
    proc.stderr?.destroy();
  } catch {
    /* ignore */
  }
  try {
    proc.kill('SIGTERM');
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Event adapter: ACP session updates -> SSE-style events
// ---------------------------------------------------------------------------

export function acpUpdateToSSE(notification: SessionNotification): SseChatEvent | null {
  const update = notification.update;
  if (!update) return null;

  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const content = update.content;
      if (content && 'text' in content && content.type === 'text') {
        return { event: 'text', data: { type: 'text', content: content.text } };
      }
      return null;
    }
    case 'agent_thought_chunk': {
      const content = update.content;
      if (content && 'text' in content && content.type === 'text') {
        return { event: 'thought', data: { type: 'thought', content: content.text } };
      }
      return null;
    }
    case 'tool_call':
      return {
        event: 'tool_call',
        data: {
          type: 'tool_call',
          id: update.toolCallId,
          name: update.title ?? 'unknown',
          args: (update.rawInput ?? {}) as Record<string, unknown>,
        },
      };
    case 'tool_call_update':
      if (update.status === 'completed' || update.status === 'failed') {
        let errorMsg: string | undefined;
        if (update.status === 'failed') {
          const content = (update as { content?: Array<{ content?: unknown }> }).content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (
                block?.content &&
                typeof block.content === 'object' &&
                'text' in block.content
              ) {
                errorMsg = (block.content as { text?: string }).text ?? errorMsg;
              }
            }
          }
        }
        return {
          event: 'tool_result',
          data: {
            type: 'tool_result',
            id: update.toolCallId,
            name: '',
            result: {
              success: update.status === 'completed',
              data: update.rawOutput,
              error: errorMsg,
            },
          },
        };
      }
      return null;
    default:
      return null;
  }
}

export function formatRpcError(err: unknown): string {
  if (err instanceof Error) {
    const rpc = err as Error & { code?: number; data?: unknown };
    let msg = err.message;
    if (err.message.includes('stream is closing or closed')) {
      return 'ACP agent disconnected. Retry — if this persists, run CLI login (claude login / agent login).';
    }
    if (rpc.data !== undefined && rpc.data !== null) {
      const detail =
        typeof rpc.data === 'string'
          ? rpc.data
          : (() => {
              try {
                return JSON.stringify(rpc.data, null, 2);
              } catch {
                return String(rpc.data);
              }
            })();
      if (detail && !msg.includes(detail)) {
        msg = `${msg}\n\n${detail}`;
      }
    }
    if (typeof rpc.code === 'number' && !msg.includes(String(rpc.code))) {
      msg = `${msg} (code ${rpc.code})`;
    }
    return msg;
  }
  if (typeof err === 'object' && err !== null) {
    const o = err as { message?: unknown; code?: unknown };
    if (typeof o.message === 'string') {
      const code = typeof o.code === 'number' ? ` (${o.code})` : '';
      return `${o.message}${code}`;
    }
    try {
      return JSON.stringify(err, null, 2);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

// ---------------------------------------------------------------------------
// Session manager: persistent ACP session per thread + model selection
// ---------------------------------------------------------------------------

type AnyOption = {
  value?: string;
  name?: string;
  options?: AnyOption[];
};

function extractModelConfig(configOptions: unknown): {
  modelConfigId: string | null;
  models: ModelInfo[];
  currentModel: string | null;
} {
  const list = Array.isArray(configOptions) ? configOptions : [];
  const opt = list.find(
    (o) =>
      o && typeof o === 'object' && (o as { category?: string }).category === 'model' &&
      (o as { type?: string }).type === 'select',
  ) as
    | { id?: string; currentValue?: string; options?: AnyOption[] }
    | undefined;
  if (!opt) return { modelConfigId: null, models: [], currentModel: null };

  const models: ModelInfo[] = [];
  const walk = (arr?: AnyOption[]) => {
    for (const item of arr ?? []) {
      if (item && typeof item.value === 'string') {
        models.push({ id: item.value, name: item.name ?? item.value });
      } else if (item && Array.isArray(item.options)) {
        walk(item.options);
      }
    }
  };
  walk(opt.options);

  return {
    modelConfigId: opt.id ?? null,
    models,
    currentModel: opt.currentValue ?? null,
  };
}

export interface EnsureSessionOptions {
  cwd: string;
  mcpServers: McpServerConfig[];
  systemPrompt?: string;
  resumeSessionId?: string | null;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

async function registerManagedSession(
  state: AcpConnectionState,
  threadId: string,
  providerId: string,
  acpSessionId: string,
  configOptions: unknown,
  hasNativeContext: boolean,
): Promise<ManagedSession> {
  const cfg = extractModelConfig(configOptions);
  const managed: ManagedSession = {
    threadId,
    providerId,
    acpSessionId,
    hasNativeContext,
    ...cfg,
  };
  state.sessions.set(acpSessionKey(threadId, providerId), managed);
  return managed;
}

export async function ensureAcpSession(
  state: AcpConnectionState,
  threadId: string,
  providerId: string,
  opts: EnsureSessionOptions,
): Promise<ManagedSession> {
  const key = acpSessionKey(threadId, providerId);
  const existing = state.sessions.get(key);
  if (existing) return { ...existing, hasNativeContext: true };

  const normalizedMcp = opts.mcpServers.map((s) => ({ ...s, headers: s.headers ?? [] }));

  if (opts.resumeSessionId && state.capabilities.loadSession) {
    try {
      const res = await state.connection.loadSession({
        sessionId: opts.resumeSessionId,
        cwd: opts.cwd,
        mcpServers: normalizedMcp,
      } as Parameters<NonNullable<typeof state.connection.loadSession>>[0]);
      return registerManagedSession(
        state,
        threadId,
        providerId,
        opts.resumeSessionId,
        (res as { configOptions?: unknown }).configOptions,
        true,
      );
    } catch (err) {
      console.warn('[acp] loadSession failed, creating new session:', formatRpcError(err));
    }
  }

  const res = await state.connection.newSession({
    cwd: opts.cwd,
    mcpServers: normalizedMcp,
    ...(opts.systemPrompt ? { _meta: { systemPrompt: opts.systemPrompt } } : {}),
  } as Parameters<typeof state.connection.newSession>[0]);

  return registerManagedSession(
    state,
    threadId,
    providerId,
    res.sessionId,
    (res as { configOptions?: unknown }).configOptions,
    false,
  );
}

export async function setSessionModel(
  state: AcpConnectionState,
  threadId: string,
  providerId: string,
  value: string,
): Promise<void> {
  const session = state.sessions.get(acpSessionKey(threadId, providerId));
  if (!session || !session.modelConfigId) return;
  await state.connection.setSessionConfigOption({
    sessionId: session.acpSessionId,
    configId: session.modelConfigId,
    value,
  } as Parameters<typeof state.connection.setSessionConfigOption>[0]);
  session.currentModel = value;
}

export function getSessionModels(
  state: AcpConnectionState,
  threadId: string,
  providerId: string,
): { models: ModelInfo[]; currentModel: string | null } {
  const session = state.sessions.get(acpSessionKey(threadId, providerId));
  if (!session) return { models: [], currentModel: null };
  return { models: session.models, currentModel: session.currentModel };
}

export async function promptAcpSession(options: {
  state: AcpConnectionState;
  threadId: string;
  providerId: string;
  cwd: string;
  mcpServers: McpServerConfig[];
  systemPrompt?: string;
  blocks: AcpPromptBlock[];
  model?: string;
  resumeSessionId?: string | null;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  onEvent: (payload: { event: string; data: unknown }) => void;
  onConfig?: (config: { models: ModelInfo[]; currentModel: string | null }) => void;
  onSessionBound?: (session: ManagedSession) => void;
}): Promise<ManagedSession> {
  const {
    state,
    threadId,
    providerId,
    cwd,
    mcpServers,
    systemPrompt,
    blocks,
    model,
    resumeSessionId,
    history,
    onEvent,
    onConfig,
    onSessionBound,
  } = options;

  const updateTarget = new EventTarget();
  state.sessionUpdateEmitter = updateTarget;

  const onUpdate = (e: Event) => {
    const notification = (e as CustomEvent<SessionNotification>).detail;
    const sse = acpUpdateToSSE(notification);
    if (sse) onEvent(sse);
  };
  updateTarget.addEventListener('update', onUpdate);

  try {
    const session = await ensureAcpSession(state, threadId, providerId, {
      cwd,
      mcpServers,
      systemPrompt,
      resumeSessionId,
      history,
    });
    onSessionBound?.(session);
    onConfig?.({ models: session.models, currentModel: session.currentModel });

    if (model && session.modelConfigId && model !== session.currentModel) {
      const known =
        session.models.length === 0 || session.models.some((m) => m.id === model);
      if (known) {
        await setSessionModel(state, threadId, providerId, model);
      }
    }

    const promptBlocks =
      !session.hasNativeContext && history?.length
        ? prependHistoryToPrompt(blocks, history)
        : blocks;

    await state.connection.prompt({
      sessionId: session.acpSessionId,
      prompt: promptBlocks as Parameters<typeof state.connection.prompt>[0]['prompt'],
    });
    return session;
  } catch (err) {
    throw new Error(formatRpcError(err));
  } finally {
    updateTarget.removeEventListener('update', onUpdate);
    state.sessionUpdateEmitter = null;
  }
}

export type {
  AcpAgentConfig,
  AcpConnectionState,
  ManagedSession,
  McpServerConfig,
  ModelInfo,
} from './types.js';
export { acpSessionKey } from './sessions.js';
export {
  ACP_PROVIDERS,
  getDefaultAcpConfig,
  resolveProvider,
  type AcpProviderId,
  type AcpProviderPreset,
} from './providers.js';
