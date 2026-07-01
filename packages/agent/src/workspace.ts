import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { AcpProviderId } from '@webacp/protocol';
import { WEBACP_HOME } from './paths.js';

const CONFIG_DIR = join(WEBACP_HOME, 'agent');
const CONFIG_PATH = join(CONFIG_DIR, 'workspace.json');

export interface WorkspaceConfig {
  cwd: string | null;
  defaultProvider: AcpProviderId | null;
  recentCwds: string[];
}

const DEFAULT_CONFIG: WorkspaceConfig = {
  cwd: null,
  defaultProvider: null,
  recentCwds: [],
};

export async function loadWorkspaceConfig(): Promise<WorkspaceConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<WorkspaceConfig>;
    return {
      cwd: parsed.cwd ?? null,
      defaultProvider: parsed.defaultProvider ?? null,
      recentCwds: Array.isArray(parsed.recentCwds) ? parsed.recentCwds : [],
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveWorkspaceConfig(config: WorkspaceConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

export function workspaceName(cwd: string | null): string | null {
  if (!cwd) return null;
  return basename(cwd) || cwd;
}

export function validateWorkspacePath(cwd: string): { ok: true } | { ok: false; error: string } {
  if (!cwd.trim()) return { ok: false, error: 'Path is required' };
  if (!existsSync(cwd)) return { ok: false, error: 'Folder does not exist' };
  return { ok: true };
}

export async function setWorkspaceCwd(
  config: WorkspaceConfig,
  cwd: string,
): Promise<WorkspaceConfig> {
  const check = validateWorkspacePath(cwd);
  if (!check.ok) throw new Error(check.error);

  const recent = [cwd, ...config.recentCwds.filter((p) => p !== cwd)].slice(0, 8);
  const next: WorkspaceConfig = { ...config, cwd, recentCwds: recent };
  await saveWorkspaceConfig(next);
  return next;
}
