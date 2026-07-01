import { existsSync } from 'node:fs';
import { ACP_PROVIDERS } from '@webacp/core';
import {
  isAcpProviderId,
  type AcpProviderId,
  type ProviderProbe,
  type SetupStatus,
} from '@webacp/protocol';
import { pickFolderNative } from './folder-picker.js';
import { probeProviders } from './probe.js';
import { probeCliSessions } from './cli-sessions.js';
import { casrConvertSession, getCasrStatus } from './casr-bridge.js';
import {
  loadWorkspaceConfig,
  saveWorkspaceConfig,
  setWorkspaceCwd,
  validateWorkspacePath,
  workspaceName,
  type WorkspaceConfig,
} from './workspace.js';

export interface SetupRuntimeState {
  paired: boolean;
  connected: boolean;
  agentId?: string;
}

export function createSetupHandlers(getAgent: () => SetupRuntimeState) {
  let workspaceConfig: WorkspaceConfig = { cwd: null, defaultProvider: null, recentCwds: [] };
  let cachedProbes: ProviderProbe[] | null = null;

  void loadWorkspaceConfig().then((c) => {
    workspaceConfig = c;
  });

  function defaultProbes(): ProviderProbe[] {
    return ACP_PROVIDERS.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      status: 'checking' as const,
      installed: false,
      authenticated: false,
      error: null,
      version: null,
    }));
  }

  async function buildSetupStatus(providers: ProviderProbe[]): Promise<SetupStatus> {
    const agent = getAgent();
    const cwd = workspaceConfig.cwd;
    const pathOk = cwd ? validateWorkspacePath(cwd).ok : false;
    const ready =
      agent.connected &&
      Boolean(cwd && pathOk) &&
      providers.some((p) => p.status === 'ready');

    return {
      workspace: {
        cwd,
        exists: cwd ? existsSync(cwd) : undefined,
        name: workspaceName(cwd),
      },
      agent: {
        running: true,
        paired: agent.paired,
        connected: agent.connected,
        agentId: agent.agentId,
      },
      defaultProvider: workspaceConfig.defaultProvider,
      providers,
      ready,
    };
  }

  return {
    getWorkspaceCwd: () => workspaceConfig.cwd ?? undefined,
    getDefaultProvider: () => workspaceConfig.defaultProvider,

    async getSetupStatus(): Promise<SetupStatus> {
      return buildSetupStatus(cachedProbes ?? defaultProbes());
    },

    async setWorkspace(body: { path?: string; pick?: boolean }): Promise<{
      cwd: string | null;
      cliSessions?: Awaited<ReturnType<typeof probeCliSessions>>;
    }> {
      let nextPath = body.path?.trim();
      if (body.pick) {
        const picked = await pickFolderNative();
        if (!picked) throw new Error('Folder selection cancelled');
        nextPath = picked;
      }
      if (!nextPath) throw new Error('path or pick required');
      workspaceConfig = await setWorkspaceCwd(workspaceConfig, nextPath);
      const cwd = workspaceConfig.cwd;
      const cliSessions = cwd ? await probeCliSessions(cwd) : [];
      return { cwd, cliSessions };
    },

    async getCliSessions(cwd?: string) {
      const target = cwd ?? workspaceConfig.cwd;
      if (!target) return { cwd: '', sessions: [] };
      const sessions = await probeCliSessions(target);
      return { cwd: target, sessions };
    },

    getCasrStatus,
    casrConvertSession,

    async setDefaultProvider(providerId: string): Promise<void> {
      if (!isAcpProviderId(providerId)) throw new Error('Invalid provider');
      workspaceConfig = { ...workspaceConfig, defaultProvider: providerId };
      await saveWorkspaceConfig(workspaceConfig);
    },

    async probeProviders(providerId?: string): Promise<SetupStatus> {
      try {
        const probed = await probeProviders(providerId as AcpProviderId | undefined);
        if (providerId) {
          const base = cachedProbes ?? defaultProbes();
          cachedProbes = base.map((p) => probed.find((x) => x.id === p.id) ?? p);
        } else {
          cachedProbes = probed;
        }
      } catch (err) {
        console.error('[agent] probe failed:', err);
        if (!cachedProbes) cachedProbes = defaultProbes();
      }
      return buildSetupStatus(cachedProbes ?? defaultProbes());
    },
  };
}

export type SetupHandlers = ReturnType<typeof createSetupHandlers>;
