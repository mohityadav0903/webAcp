import type { ModelInfo } from '@webacp/protocol';
import type { AuthMethodSummary } from '@webacp/protocol';
import type { ChildProcess } from 'node:child_process';
import type { ClientSideConnection } from '@agentclientprotocol/sdk';

export type { ModelInfo };

export interface AcpAgentConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** A persistent ACP session bound to a WebACP thread + provider. */
export interface ManagedSession {
  threadId: string;
  providerId: string;
  acpSessionId: string;
  modelConfigId: string | null;
  models: ModelInfo[];
  currentModel: string | null;
  /** True when the ACP session already holds prior turns (memory or loadSession). */
  hasNativeContext?: boolean;
}

export interface AcpConnectionState {
  connection: ClientSideConnection;
  agentInfo: { name: string; title?: string; version?: string };
  process: ChildProcess;
  sessionUpdateEmitter: EventTarget | null;
  providerId: string | null;
  capabilities: { loadSession: boolean };
  sessions: Map<string, ManagedSession>;
  authMethods: AuthMethodSummary[];
  authenticated: boolean;
  authError: string | null;
}

export interface McpServerConfig {
  name: string;
  type: 'http' | 'sse';
  url: string;
  headers?: Array<{ name: string; value: string }>;
}
