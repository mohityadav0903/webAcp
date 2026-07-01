import { useCallback, useEffect, useRef } from 'react';
import {
  agentStatusResponseSchema,
  casrConvertResponseSchema,
  casrStatusSchema,
  cliSessionsResponseSchema,
  createThreadResponseSchema,
  errorResponseSchema,
  DEFAULT_MAX_UPLOAD_BYTES,
  forkResponseSchema,
  healthResponseSchema,
  importCliSessionsBodySchema,
  importCliSessionsResponseSchema,
  isAcpProviderId,
  isSseEventName,
  isStructuredMessageContent,
  hasPromptContent,
  normalizePromptBlocks,
  pairingTokenResponseSchema,
  parseApiBody,
  parseMessageContent,
  parseSsePayload,
  providersResponseSchema,
  serializeMessageContent,
  setupStatusSchema,
  threadExportResponseSchema,
  threadMessagesResponseSchema,
  threadsResponseSchema,
  uploadResponseSchema,
  type AcpProviderId,
  type CasrConvertResponse,
  type CasrStatus,
  type CliSessionsResponse,
  type ContentBlock,
  type DiscoveredCliSession,
  type StoredMessageDto,
} from '@webacp/protocol';
import {
  useWebacpStore,
  type ChatMessage,
  type WebacpConfig,
} from './store.js';

export * from './store.js';
export type { DiscoveredCliSession, CliSessionsResponse } from '@webacp/protocol';

function getConfig(): WebacpConfig {
  return useWebacpStore.getState().config;
}

function notifyThreadChange(threadId: string | null): void {
  getConfig().onThreadChange?.(threadId);
}

function activateThread(threadId: string | null): void {
  useWebacpStore.getState().setCurrentThreadId(threadId);
  notifyThreadChange(threadId);
}

function storedToChatMessage(m: StoredMessageDto): ChatMessage {
  const blocks = isStructuredMessageContent(m.content) ? parseMessageContent(m.content) : undefined;
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    blocks,
    toolName: m.toolName ?? undefined,
  };
}

/** Configure base URLs once (call early, e.g. in your root component). */
export function useWebacpConfig(config: Partial<WebacpConfig>) {
  const setConfig = useWebacpStore((s) => s.setConfig);
  const key = JSON.stringify(config);
  useEffect(() => {
    setConfig(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

// ---------------------------------------------------------------------------
// Auto-pairing with the local agent
// ---------------------------------------------------------------------------

async function triggerAgentUpdate(): Promise<void> {
  const { agentPairUrl } = getConfig();
  try {
    await fetch(`${agentPairUrl}/update`, { method: 'POST' });
  } catch {
    /* agent not running */
  }
}

async function tryAutoPair(): Promise<boolean> {
  const { baseUrl, agentPairUrl } = getConfig();
  try {
    const health = parseApiBody(
      healthResponseSchema,
      await (await fetch(`${baseUrl}/api/health`)).json(),
    );
    if (!health) return false;
    if (health.agentConnected) return true;

    const statusRes = await fetch(`${agentPairUrl}/status`);
    if (!statusRes.ok) return false;
    const status = parseApiBody(agentStatusResponseSchema, await statusRes.json());
    if (!status?.running || status.connected) return status?.connected === true;

    await triggerAgentUpdate();

    const tokenBody = parseApiBody(
      pairingTokenResponseSchema,
      await (await fetch(`${baseUrl}/api/pairing/token`)).json(),
    );
    if (!tokenBody) return false;

    const pairRes = await fetch(`${agentPairUrl}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tokenBody.token, webUrl: health.webUrl }),
    });
    if (!pairRes.ok) return false;

    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const data = parseApiBody(
        healthResponseSchema,
        await (await fetch(`${baseUrl}/api/health`)).json(),
      );
      if (data?.agentConnected) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function useAgentStatus(pollMs = 3000) {
  const setAgentConnected = useWebacpStore((s) => s.setAgentConnected);
  const setAgentPairing = useWebacpStore((s) => s.setAgentPairing);
  const setAgentDaemonRunning = useWebacpStore((s) => s.setAgentDaemonRunning);
  const setAcpStatus = useWebacpStore((s) => s.setAcpStatus);
  const pairingRef = useRef(false);

  const check = useCallback(async () => {
    const { baseUrl, agentPairUrl } = getConfig();
    try {
      const data = parseApiBody(
        healthResponseSchema,
        await (await fetch(`${baseUrl}/api/health`)).json(),
      );
      if (!data) {
        setAgentConnected(false);
        setAgentDaemonRunning(false);
        return;
      }
      setAgentConnected(data.agentConnected);
      if (data.agentConnected) {
        setAgentDaemonRunning(true);
        setAgentPairing(false);
        return;
      }
      try {
        const status = parseApiBody(
          agentStatusResponseSchema,
          await (await fetch(`${agentPairUrl}/status`)).json(),
        );
        setAgentDaemonRunning(!!status?.running);
        if (status?.acp) setAcpStatus(status.acp);
        if (status?.running && !status.connected && !pairingRef.current) {
          pairingRef.current = true;
          setAgentPairing(true);
          const ok = await tryAutoPair();
          pairingRef.current = false;
          setAgentPairing(false);
          if (ok) setAgentConnected(true);
        }
      } catch {
        setAgentDaemonRunning(false);
        setAcpStatus(null);
      }
    } catch {
      setAgentConnected(false);
      setAgentDaemonRunning(false);
      setAcpStatus(null);
    }
  }, [setAgentConnected, setAgentPairing, setAgentDaemonRunning, setAcpStatus]);

  useEffect(() => {
    void check();
    const id = setInterval(check, pollMs);
    return () => clearInterval(id);
  }, [check, pollMs]);
}

export async function connectLocalAgent(): Promise<boolean> {
  const store = useWebacpStore.getState();
  store.setAgentPairing(true);
  const ok = await tryAutoPair();
  store.setAgentPairing(false);
  if (ok) store.setAgentConnected(true);
  return ok;
}

// ---------------------------------------------------------------------------
// Setup (agent → workspace → CLI providers)
// ---------------------------------------------------------------------------

export async function fetchSetupStatus(): Promise<boolean> {
  const { agentPairUrl } = getConfig();
  try {
    const data = parseApiBody(
      setupStatusSchema,
      await (await fetch(`${agentPairUrl}/setup`)).json(),
    );
    if (!data) return false;
    const store = useWebacpStore.getState();
    store.setSetupStatus(data);
    if (data.defaultProvider && isAcpProviderId(data.defaultProvider)) {
      store.setProvider(data.defaultProvider);
    }
    return true;
  } catch {
    return false;
  }
}

export async function fetchCliSessions(cwd?: string): Promise<CliSessionsResponse | null> {
  const { agentPairUrl } = getConfig();
  const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : '';
  try {
    return parseApiBody(
      cliSessionsResponseSchema,
      await (await fetch(`${agentPairUrl}/setup/cli-sessions${qs}`)).json(),
    );
  } catch {
    return null;
  }
}

export async function importCliSessions(
  cwd: string,
  sessions: DiscoveredCliSession[],
): Promise<{ imported: number; skipped: number } | null> {
  const { baseUrl } = getConfig();
  const body = importCliSessionsBodySchema.parse({ cwd, sessions });
  const data = parseApiBody(
    importCliSessionsResponseSchema,
    await (
      await fetch(`${baseUrl}/api/threads/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    ).json(),
  );
  if (data) await loadThreads(cwd);
  return data;
}

export async function fetchCasrStatus(): Promise<CasrStatus | null> {
  const { agentPairUrl } = getConfig();
  try {
    return parseApiBody(
      casrStatusSchema,
      await (await fetch(`${agentPairUrl}/setup/casr/status`)).json(),
    );
  } catch {
    return null;
  }
}

export async function exportThread(
  threadId: string,
  format: 'markdown' | 'json' = 'markdown',
): Promise<{ filename: string; content: string } | null> {
  const { baseUrl } = getConfig();
  const data = parseApiBody(
    threadExportResponseSchema,
    await (await fetch(`${baseUrl}/api/threads/${threadId}/export?format=${format}`)).json(),
  );
  if (!data) return null;
  return { filename: data.filename, content: data.content };
}

export async function downloadThreadExport(
  threadId: string,
  format: 'markdown' | 'json' = 'markdown',
): Promise<void> {
  const file = await exportThread(threadId, format);
  if (!file) throw new Error('Export failed');
  const blob = new Blob([file.content], {
    type: format === 'json' ? 'application/json' : 'text/markdown',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function convertThreadViaCasr(
  sessionId: string,
  targetProvider: AcpProviderId,
): Promise<CasrConvertResponse | null> {
  const { agentPairUrl } = getConfig();
  const body = { sessionId, targetProvider };
  return parseApiBody(
    casrConvertResponseSchema,
    await (
      await fetch(`${agentPairUrl}/setup/casr/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    ).json(),
  );
}

export async function pickWorkspaceFolder(): Promise<{
  cwd: string | null;
  cliSessions: DiscoveredCliSession[];
}> {
  const { agentPairUrl } = getConfig();
  const res = await fetch(`${agentPairUrl}/setup/workspace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pick: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? 'Failed to pick folder');
  await fetchSetupStatus();
  const cwd = (body as { cwd?: string }).cwd ?? null;
  const cliSessions = Array.isArray((body as { cliSessions?: unknown }).cliSessions)
    ? ((body as { cliSessions: DiscoveredCliSession[] }).cliSessions ?? [])
    : (await fetchCliSessions(cwd ?? undefined))?.sessions ?? [];
  return { cwd, cliSessions };
}

export async function setWorkspacePath(path: string): Promise<DiscoveredCliSession[]> {
  const { agentPairUrl } = getConfig();
  const res = await fetch(`${agentPairUrl}/setup/workspace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? 'Invalid path');
  await fetchSetupStatus();
  const cliSessions = Array.isArray((body as { cliSessions?: unknown }).cliSessions)
    ? ((body as { cliSessions: DiscoveredCliSession[] }).cliSessions ?? [])
    : (await fetchCliSessions(path))?.sessions ?? [];
  return cliSessions;
}

export async function probeCliProviders(providerId?: AcpProviderId): Promise<void> {
  const { agentPairUrl } = getConfig();
  const res = await fetch(`${agentPairUrl}/setup/probe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(providerId ? { providerId } : {}),
  });
  const data = parseApiBody(setupStatusSchema, await res.json());
  if (data) useWebacpStore.getState().setSetupStatus(data);
}

export async function setDefaultCliProvider(providerId: AcpProviderId): Promise<void> {
  const { agentPairUrl } = getConfig();
  const store = useWebacpStore.getState();
  store.setProvider(providerId);
  await fetch(`${agentPairUrl}/setup/default-provider`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId }),
  });
  await fetchSetupStatus();
}

export function useSetup(pollMs = 4000) {
  const agentConnected = useWebacpStore((s) => s.agentConnected);
  const setupStatus = useWebacpStore((s) => s.setupStatus);
  const setSetupOpen = useWebacpStore((s) => s.setSetupOpen);
  const probedWorkspaceRef = useRef<string | null>(null);
  const probingRef = useRef(false);

  const refresh = useCallback(async () => {
    await fetchSetupStatus();
    const status = useWebacpStore.getState().setupStatus;
    if (!status?.agent.connected || !status.workspace.cwd) return;
    const shouldAutoProbe =
      probedWorkspaceRef.current !== status.workspace.cwd ||
      status.providers.every((p) => p.status === 'checking');
    if (!shouldAutoProbe || probingRef.current) return;
    probingRef.current = true;
    try {
      await probeCliProviders();
      probedWorkspaceRef.current = status.workspace.cwd;
    } finally {
      probingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs, agentConnected]);

  const ready = setupStatus?.ready ?? false;

  return {
    setupStatus,
    ready,
    refresh,
    openSetup: () => setSetupOpen(true),
    closeSetup: () => setSetupOpen(false),
    pickWorkspaceFolder,
    setWorkspacePath,
    probeCliProviders: async (providerId?: AcpProviderId) => {
      probingRef.current = true;
      try {
        await probeCliProviders(providerId);
        const cwd = useWebacpStore.getState().setupStatus?.workspace.cwd;
        if (cwd && !providerId) probedWorkspaceRef.current = cwd;
      } finally {
        probingRef.current = false;
      }
    },
    setDefaultCliProvider,
    connectAgent: connectLocalAgent,
    fetchCliSessions,
    importCliSessions,
    fetchCasrStatus,
    exportThread,
    downloadThreadExport,
    convertThreadViaCasr,
  };
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export function useProviders() {
  const setProviders = useWebacpStore((s) => s.setProviders);
  useEffect(() => {
    const { baseUrl } = getConfig();
    void fetch(`${baseUrl}/api/providers`)
      .then((r) => r.json())
      .then((raw) => {
        const data = parseApiBody(providersResponseSchema, raw);
        if (data) {
          setProviders(
            data.providers.map((p) => ({
              ...p,
              authKind: p.authKind ?? (p.authMethodId ? 'acp_terminal' : 'cli'),
            })),
          );
        }
      })
      .catch(() => {});
  }, [setProviders]);
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export async function loadThreads(workspaceCwd?: string | null): Promise<void> {
  const { baseUrl } = getConfig();
  const cwd = workspaceCwd ?? useWebacpStore.getState().setupStatus?.workspace.cwd;
  const url = cwd
    ? `${baseUrl}/api/threads?workspace=${encodeURIComponent(cwd)}`
    : `${baseUrl}/api/threads`;
  try {
    const data = parseApiBody(threadsResponseSchema, await (await fetch(url)).json());
    if (data) useWebacpStore.getState().setThreads(data.threads);
  } catch {
    /* ignore */
  }
}

export async function selectThread(threadId: string, opts?: { syncRoute?: boolean }): Promise<void> {
  const { baseUrl } = getConfig();
  const store = useWebacpStore.getState();
  store.setCurrentThreadId(threadId);
  if (opts?.syncRoute !== false) notifyThreadChange(threadId);
  store.setModels([], null);
  try {
    const data = parseApiBody(
      threadMessagesResponseSchema,
      await (await fetch(`${baseUrl}/api/threads/${threadId}/messages`)).json(),
    );
    if (data) store.setMessages(data.messages.map(storedToChatMessage));
    const thread = store.threads.find((t) => t.id === threadId);
    if (thread?.provider && isAcpProviderId(thread.provider)) {
      store.setProvider(thread.provider);
    }
    if (thread?.model && thread.provider === store.provider) {
      store.setCurrentModel(thread.model);
    } else {
      store.setCurrentModel(null);
    }
  } catch {
    /* ignore */
  }
}

export async function createThread(): Promise<string> {
  const { baseUrl } = getConfig();
  const store = useWebacpStore.getState();
  const data = parseApiBody(
    createThreadResponseSchema,
    await (
      await fetch(`${baseUrl}/api/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: store.provider }),
      })
    ).json(),
  );
  if (!data) throw new Error('Failed to create thread');
  activateThread(data.thread.id);
  store.clearMessages();
  store.setModels([], null);
  await loadThreads();
  return data.thread.id;
}

/** Clear UI state without creating a server thread (internal / legacy). */
export function newThread(): void {
  const store = useWebacpStore.getState();
  activateThread(null);
  store.clearMessages();
  store.setModels([], null);
}

export async function deleteThread(threadId: string): Promise<void> {
  const { baseUrl } = getConfig();
  await fetch(`${baseUrl}/api/threads/${threadId}`, { method: 'DELETE' });
  if (useWebacpStore.getState().currentThreadId === threadId) newThread();
  await loadThreads();
}

export async function setThreadProvider(provider: AcpProviderId): Promise<void> {
  const store = useWebacpStore.getState();
  if (store.provider === provider) return;
  store.setProvider(provider);
  store.setModels([], null);
  store.setCurrentModel(null);
  const threadId = store.currentThreadId;
  if (!threadId) return;
  const { baseUrl } = getConfig();
  await fetch(`${baseUrl}/api/threads/${threadId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, model: null }),
  }).catch(() => {});
  await loadThreads();
}

export function useThreads() {
  const threads = useWebacpStore((s) => s.threads);
  const currentThreadId = useWebacpStore((s) => s.currentThreadId);
  useEffect(() => {
    void loadThreads();
  }, []);
  return { threads, currentThreadId, selectThread, createThread, newThread, deleteThread, reload: loadThreads };
}

// ---------------------------------------------------------------------------
// Model selector
// ---------------------------------------------------------------------------

export function useModelSelector() {
  const models = useWebacpStore((s) => s.models);
  const currentModel = useWebacpStore((s) => s.currentModel);
  const currentThreadId = useWebacpStore((s) => s.currentThreadId);

  const setModel = useCallback(
    async (value: string) => {
      const { baseUrl } = getConfig();
      useWebacpStore.getState().setCurrentModel(value);
      if (!currentThreadId) return;
      await fetch(`${baseUrl}/api/threads/${currentThreadId}/model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      }).catch(() => {});
    },
    [currentThreadId],
  );

  return { models, currentModel, setModel };
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

interface RunOptions {
  addUserMessage?: boolean;
  userMessageId?: string;
  skipUserMessage?: boolean;
  blocks?: ContentBlock[];
}

async function runPrompt(
  messageOrBlocks: string | ContentBlock[],
  opts: RunOptions = {},
): Promise<void> {
  const { baseUrl } = getConfig();
  const store = useWebacpStore.getState();
  if (store.streaming) return;

  await triggerAgentUpdate();

  const blocks: ContentBlock[] = normalizePromptBlocks(
    opts.blocks ??
      (typeof messageOrBlocks === 'string'
        ? [{ type: 'text', text: messageOrBlocks }]
        : messageOrBlocks),
  );
  if (!hasPromptContent(blocks)) {
    store.addError('Type a message or attach a file before sending.');
    return;
  }
  const storedContent = serializeMessageContent(blocks);

  const userMessageId = opts.userMessageId ?? crypto.randomUUID();
  if (opts.addUserMessage) {
    store.addMessage({
      id: userMessageId,
      role: 'user',
      content: storedContent,
      blocks: isStructuredMessageContent(storedContent) ? blocks : undefined,
    });
  }
  store.setStreaming(true);

  let assistantId: string | null = null;
  let thoughtId: string | null = null;
  const closeBlocks = () => {
    assistantId = null;
    thoughtId = null;
  };

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blocks,
        provider: store.provider,
        threadId: store.currentThreadId ?? undefined,
        model: store.currentModel ?? undefined,
        userMessageId,
        skipUserMessage: opts.skipUserMessage ?? false,
      }),
    });
  } catch {
    store.addError('Network error — is the server running?');
    store.setStreaming(false);
    return;
  }

  if (!res.ok) {
    const err = parseApiBody(errorResponseSchema, await res.json().catch(() => ({})));
    store.addError(err?.error ?? `Request failed (${res.status})`);
    store.setStreaming(false);
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    store.setStreaming(false);
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let streamDone = false;

  const handle = (event: string, raw: unknown) => {
    if (!isSseEventName(event)) return;

    switch (event) {
      case 'thread': {
        const data = parseSsePayload('thread', raw);
        if (data) activateThread(data.threadId);
        return;
      }
      case 'config': {
        const data = parseSsePayload('config', raw);
        if (data) store.setModels(data.models, data.currentModel ?? null);
        return;
      }
      case 'text': {
        const data = parseSsePayload('text', raw);
        if (!data) return;
        thoughtId = null;
        if (!assistantId) {
          assistantId = store.addMessage({ role: 'assistant', content: data.content });
        } else {
          store.appendToMessage(assistantId, data.content);
        }
        return;
      }
      case 'thought': {
        const data = parseSsePayload('thought', raw);
        if (!data) return;
        assistantId = null;
        if (!thoughtId) {
          thoughtId = store.addMessage({ role: 'thought', content: data.content });
        } else {
          store.appendToMessage(thoughtId, data.content);
        }
        return;
      }
      case 'tool_call': {
        const data = parseSsePayload('tool_call', raw);
        if (!data) return;
        closeBlocks();
        store.addMessage({
          role: 'tool',
          toolCallId: data.id,
          toolName: data.name,
          toolStatus: 'pending',
          content: JSON.stringify(data.args, null, 2),
        });
        return;
      }
      case 'tool_result': {
        const data = parseSsePayload('tool_result', raw);
        if (!data) return;
        const ok = data.result?.success !== false && !data.result?.error;
        store.updateToolByCallId(data.id, {
          toolStatus: ok ? 'success' : 'failed',
          toolResult:
            data.result?.error ??
            (data.result?.data !== undefined
              ? JSON.stringify(data.result.data, null, 2)
              : undefined),
        });
        return;
      }
      case 'error': {
        const data = parseSsePayload('error', raw);
        store.addError(data?.message ?? 'Unknown error');
        streamDone = true;
        return;
      }
      case 'done':
        streamDone = true;
    }
  };

  try {
    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        let event = 'message';
        let data = '';
        for (const line of part.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data || event === 'ping') continue;
        try {
          handle(event, JSON.parse(data));
        } catch {
          /* ignore parse errors */
        }
      }
    }
  } finally {
    store.setStreaming(false);
    await loadThreads();
  }
}

export async function uploadAttachment(
  file: File,
  threadId?: string | null,
): Promise<ContentBlock> {
  const { baseUrl } = getConfig();
  const store = useWebacpStore.getState();
  if (file.size > DEFAULT_MAX_UPLOAD_BYTES) {
    throw new Error(
      `"${file.name}" exceeds ${Math.round(DEFAULT_MAX_UPLOAD_BYTES / 1024 / 1024)}MB limit`,
    );
  }
  const form = new FormData();
  form.append('file', file);
  const tid = threadId ?? store.currentThreadId;
  if (tid) form.append('threadId', tid);
  const res = await fetch(`${baseUrl}/api/uploads`, { method: 'POST', body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = parseApiBody(errorResponseSchema, json);
    throw new Error(err?.error ?? 'Upload failed');
  }
  const data = parseApiBody(uploadResponseSchema, json);
  if (!data) throw new Error('Invalid upload response');
  if (data.mimeType.startsWith('image/')) {
    return {
      type: 'image',
      mimeType: data.mimeType,
      path: data.path,
      name: data.name,
    };
  }
  return {
    type: 'resource',
    mimeType: data.mimeType,
    path: data.path,
    name: data.name,
  };
}

export async function sendChatMessage(
  message: string,
  attachments?: ContentBlock[],
): Promise<void> {
  const blocks: ContentBlock[] = [];
  const trimmed = message.trim();
  if (trimmed) blocks.push({ type: 'text', text: trimmed });
  if (attachments?.length) blocks.push(...attachments);
  const normalized = normalizePromptBlocks(blocks);
  if (!hasPromptContent(normalized)) return;
  return runPrompt(normalized, { addUserMessage: true });
}

export async function retryLast(): Promise<void> {
  const { baseUrl } = getConfig();
  const store = useWebacpStore.getState();
  const threadId = store.currentThreadId;
  if (!threadId || store.streaming) return;

  const msgs = store.messages;
  let lastUserIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) return;
  const userMsg = msgs[lastUserIdx];
  const blocks = normalizePromptBlocks(userMsg.blocks ?? parseMessageContent(userMsg.content));
  if (!hasPromptContent(blocks)) {
    store.addError('Cannot retry — last message has no text or attachments.');
    return;
  }

  store.setMessages(msgs.slice(0, lastUserIdx + 1));
  await fetch(`${baseUrl}/api/threads/${threadId}/truncate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageId: userMsg.id, inclusive: false }),
  }).catch(() => {});

  await runPrompt(blocks, { skipUserMessage: true, blocks });
}

export async function editMessage(messageId: string, newContent: string): Promise<void> {
  const { baseUrl } = getConfig();
  const store = useWebacpStore.getState();
  const threadId = store.currentThreadId;
  if (store.streaming) return;
  if (!newContent.trim()) return;

  const idx = store.messages.findIndex((m) => m.id === messageId);
  if (idx === -1) return;

  store.setMessages(store.messages.slice(0, idx));
  if (threadId) {
    await fetch(`${baseUrl}/api/threads/${threadId}/truncate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, inclusive: true }),
    }).catch(() => {});
  }
  await runPrompt(newContent, { addUserMessage: true });
}

export async function forkFrom(messageId: string): Promise<void> {
  const { baseUrl } = getConfig();
  const store = useWebacpStore.getState();
  const threadId = store.currentThreadId;
  if (!threadId) return;

  try {
    const res = await fetch(`${baseUrl}/api/threads/${threadId}/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId }),
    });
    const data = parseApiBody(forkResponseSchema, await res.json());
    if (!data) return;
    store.setCurrentThreadId(data.thread.id);
    store.setMessages(data.messages.map(storedToChatMessage));
    notifyThreadChange(data.thread.id);
    await loadThreads();
  } catch {
    /* ignore */
  }
}

export function useChat() {
  const messages = useWebacpStore((s) => s.messages);
  const streaming = useWebacpStore((s) => s.streaming);
  const provider = useWebacpStore((s) => s.provider);
  return {
    messages,
    streaming,
    provider,
    setProvider: setThreadProvider,
    send: sendChatMessage,
    retry: retryLast,
    edit: editMessage,
    fork: forkFrom,
  };
}
