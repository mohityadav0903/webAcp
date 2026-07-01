import { create } from 'zustand';
import {
  defaultAgentPairUrl,
  type AcpConnectionStatus,
  type AcpProviderId,
  type ContentBlock,
  type ModelInfo,
  type ProviderInfo,
  type SetupStatus,
  type ThreadSummary,
  type ToolStatus,
  type UiChatRole,
} from '@webacp/protocol';

export type {
  AcpConnectionStatus,
  AcpProviderId,
  ContentBlock,
  ModelInfo,
  ProviderInfo,
  SetupStatus,
  ThreadSummary,
  ToolStatus,
  UiChatRole,
};
/** @deprecated Use `UiChatRole` from `@webacp/protocol`. */
export type ChatRole = UiChatRole;

export interface ChatMessage {
  id: string;
  role: UiChatRole;
  /** Serialized content (plain text or JSON blocks). */
  content: string;
  /** Parsed multimodal blocks when `content` is structured. */
  blocks?: ContentBlock[];
  toolName?: string;
  toolCallId?: string;
  toolStatus?: ToolStatus;
  toolResult?: string;
}

export interface WebacpConfig {
  baseUrl: string;
  agentPairUrl: string;
  /** Called when the active thread changes (new chat, select, fork, delete, first message). */
  onThreadChange?: (threadId: string | null) => void;
}

interface WebacpStore {
  config: WebacpConfig;
  messages: ChatMessage[];
  streaming: boolean;
  agentConnected: boolean;
  agentPairing: boolean;
  agentDaemonRunning: boolean;
  provider: AcpProviderId;
  providers: ProviderInfo[];
  acpStatus: AcpConnectionStatus | null;
  threads: ThreadSummary[];
  currentThreadId: string | null;
  models: ModelInfo[];
  currentModel: string | null;
  setupStatus: SetupStatus | null;
  setupOpen: boolean;

  setConfig: (config: Partial<WebacpConfig>) => void;
  addMessage: (msg: Omit<ChatMessage, 'id'> & { id?: string }) => string;
  appendToMessage: (id: string, text: string) => void;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  updateToolByCallId: (callId: string, patch: Partial<ChatMessage>) => void;
  removeMessage: (id: string) => void;
  setMessages: (messages: ChatMessage[]) => void;
  setStreaming: (v: boolean) => void;
  setAgentConnected: (v: boolean) => void;
  setAgentPairing: (v: boolean) => void;
  setAgentDaemonRunning: (v: boolean) => void;
  setProvider: (p: AcpProviderId) => void;
  setProviders: (p: ProviderInfo[]) => void;
  setAcpStatus: (s: AcpConnectionStatus | null) => void;
  setThreads: (t: ThreadSummary[]) => void;
  setCurrentThreadId: (id: string | null) => void;
  setModels: (models: ModelInfo[], current: string | null) => void;
  setCurrentModel: (value: string | null) => void;
  setSetupStatus: (s: SetupStatus | null) => void;
  setSetupOpen: (v: boolean) => void;
  clearMessages: () => void;
  addError: (message: string) => string;
}

function uuid(): string {
  return crypto.randomUUID();
}

export const useWebacpStore = create<WebacpStore>((set, get) => ({
  config: { baseUrl: '', agentPairUrl: defaultAgentPairUrl() },
  messages: [],
  streaming: false,
  agentConnected: false,
  agentPairing: false,
  agentDaemonRunning: false,
  provider: 'claude',
  providers: [],
  acpStatus: null,
  threads: [],
  currentThreadId: null,
  models: [],
  currentModel: null,
  setupStatus: null,
  setupOpen: false,

  setConfig: (config) => set({ config: { ...get().config, ...config } }),
  addMessage: (msg) => {
    const id = msg.id ?? uuid();
    set({ messages: [...get().messages, { ...msg, id }] });
    return id;
  },
  appendToMessage: (id, text) =>
    set({
      messages: get().messages.map((m) =>
        m.id === id ? { ...m, content: m.content + text } : m,
      ),
    }),
  updateMessage: (id, patch) =>
    set({ messages: get().messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) }),
  updateToolByCallId: (callId, patch) =>
    set({
      messages: get().messages.map((m) =>
        m.toolCallId === callId ? { ...m, ...patch } : m,
      ),
    }),
  removeMessage: (id) => set({ messages: get().messages.filter((m) => m.id !== id) }),
  setMessages: (messages) => set({ messages }),
  setStreaming: (streaming) => set({ streaming }),
  setAgentConnected: (agentConnected) => set({ agentConnected }),
  setAgentPairing: (agentPairing) => set({ agentPairing }),
  setAgentDaemonRunning: (agentDaemonRunning) => set({ agentDaemonRunning }),
  setProvider: (provider) => set({ provider }),
  setProviders: (providers) => set({ providers }),
  setAcpStatus: (acpStatus) => set({ acpStatus }),
  setThreads: (threads) => set({ threads }),
  setCurrentThreadId: (currentThreadId) => set({ currentThreadId }),
  setModels: (models, currentModel) => set({ models, currentModel }),
  setCurrentModel: (currentModel) => set({ currentModel }),
  setSetupStatus: (setupStatus) => set({ setupStatus }),
  setSetupOpen: (setupOpen) => set({ setupOpen }),
  clearMessages: () => set({ messages: [] }),
  addError: (message) => {
    const id = uuid();
    set({ messages: [...get().messages, { id, role: 'error', content: message }] });
    return id;
  },
}));
