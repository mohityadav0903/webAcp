import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  ACP_PROVIDERS,
  connectAcpAgent,
  safeDisconnectAcpAgent,
  resolveProvider,
  type AcpAgentConfig,
  type AcpConnectionState,
} from '@webacp/core';
import type { AcpProviderId, ProviderProbe, ProviderProbeStatus } from '@webacp/protocol';

const execFileAsync = promisify(execFile);
const PROBE_INIT_TIMEOUT_MS = 20_000;

function expandHome(path: string): string {
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
}

async function pathExecutable(path: string): Promise<boolean> {
  try {
    await access(expandHome(path), constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function commandOnPath(command: string): Promise<boolean> {
  if (command.includes('/')) return pathExecutable(command);
  try {
    await execFileAsync('which', [command]);
    return true;
  } catch {
    return false;
  }
}

async function isConfigRunnable(config: AcpAgentConfig): Promise<boolean> {
  if (config.command === 'npx') return commandOnPath('npx');
  return commandOnPath(config.command);
}

function classifyProbeError(message: string): ProviderProbeStatus {
  const lower = message.toLowerCase();
  if (
    lower.includes('enoent') ||
    lower.includes('not found') ||
    lower.includes('failed to start') ||
    lower.includes('e404') ||
    lower.includes('404 not found') ||
    lower.includes('could not be found')
  ) {
    return 'not_installed';
  }
  if (
    lower.includes('auth') ||
    lower.includes('login') ||
    lower.includes('sign in') ||
    lower.includes('api key')
  ) {
    return 'login_required';
  }
  if (lower.includes('process exited') || lower.includes('connection closed')) {
    return 'login_required';
  }
  return 'error';
}

async function probeOne(providerId: AcpProviderId): Promise<ProviderProbe> {
  const preset = resolveProvider(providerId);
  const base = {
    id: preset.id,
    displayName: preset.displayName,
    installed: false,
    authenticated: false,
    version: null as string | null,
    error: null as string | null,
  };

  const runnable = await isConfigRunnable(preset.config);
  if (!runnable) {
    return {
      ...base,
      status: 'not_installed',
      error: `Not found on PATH: ${preset.config.command}`,
    };
  }

  let state: AcpConnectionState | undefined;
  try {
    state = await connectAcpAgent({
      config: preset.config,
      providerId: preset.id,
      authMethodId: preset.authMethodId,
      initTimeoutMs: PROBE_INIT_TIMEOUT_MS,
    });
    const authenticated = state.authenticated;
    const version = state.agentInfo.version ?? null;
    const authError = state.authError;
    safeDisconnectAcpAgent(state);
    state = undefined;

    let status: ProviderProbeStatus = 'ready';
    if (!authenticated) status = 'login_required';

    return {
      ...base,
      installed: true,
      authenticated,
      version,
      status,
      error: authenticated ? null : authError ?? 'Sign in required',
    };
  } catch (err) {
    if (state) safeDisconnectAcpAgent(state);
    const message = err instanceof Error ? err.message : String(err);
    const status = classifyProbeError(message);
    return {
      ...base,
      installed: status !== 'not_installed',
      status,
      error: message,
    };
  }
}

export async function probeProvidersInProcess(
  providerId?: AcpProviderId,
): Promise<ProviderProbe[]> {
  if (providerId) return [await probeOne(providerId)];
  const results: ProviderProbe[] = [];
  for (const p of ACP_PROVIDERS) {
    results.push(await probeOne(p.id));
  }
  return results;
}
