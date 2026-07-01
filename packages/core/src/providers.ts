import type { AcpProviderId } from '@webacp/protocol';
import type { AcpAgentConfig } from './types.js';

export type { AcpProviderId };

export interface AcpProviderPreset {
  id: AcpProviderId;
  displayName: string;
  config: AcpAgentConfig;
  authMethodId?: string;
  setupHint: string;
}

export const ACP_PROVIDERS: AcpProviderPreset[] = [
  {
    id: 'claude',
    displayName: 'Claude Code',
    config: {
      command: 'npx',
      args: ['-y', '@zed-industries/claude-agent-acp'],
    },
    setupHint: 'Run `claude login` before chatting.',
  },
  {
    id: 'cursor',
    displayName: 'Cursor',
    config: {
      command:
        process.env.WEBACP_CURSOR_COMMAND ??
        `${process.env.HOME ?? '~'}/.local/bin/agent`,
      args: ['acp'],
    },
    authMethodId: 'cursor_login',
    setupHint: 'Install Cursor CLI and run `agent login`. Binary: ~/.local/bin/agent',
  },
  {
    id: 'codex',
    displayName: 'Codex CLI',
    config: {
      command: 'npx',
      args: ['-y', '@agentclientprotocol/codex-acp'],
    },
    setupHint: 'Install Codex CLI and set OPENAI_API_KEY or run `codex login`.',
  },
  {
    id: 'gemini',
    displayName: 'Gemini CLI',
    config: {
      command: 'gemini',
      args: ['--acp'],
    },
    setupHint: 'Install Gemini CLI (`npm i -g @google/gemini-cli`) and run `gemini auth login`.',
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    config: {
      command: 'opencode',
      args: ['acp'],
    },
    setupHint: 'Install OpenCode CLI and authenticate.',
  },
];

export function resolveProvider(id?: string): AcpProviderPreset {
  const found = ACP_PROVIDERS.find((p) => p.id === id);
  return found ?? ACP_PROVIDERS[0]!;
}

export function getDefaultAcpConfig(providerId?: string): AcpAgentConfig {
  return resolveProvider(providerId).config;
}
