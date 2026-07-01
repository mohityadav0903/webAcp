import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadInstallMeta, restartService, getServiceStatus } from './service.js';
import { AGENT_VERSION, UPDATE_PACKAGE } from './version.js';

const exec = promisify(execFile);

export interface UpdateCheckResult {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  source: 'npm' | 'git' | 'none';
}

function parseVersion(v: string): number[] {
  return v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
}

export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

async function fetchNpmLatest(pkg: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const meta = await loadInstallMeta();
  const current = AGENT_VERSION;

  if (meta?.webacpRoot) {
    try {
      const { stdout } = await exec('git', ['-C', meta.webacpRoot, 'fetch', '--quiet', 'origin'], {
        timeout: 30_000,
      }).catch(() => ({ stdout: '', stderr: '' }));
      void stdout;
      const { stdout: behindOut } = await exec(
        'git',
        ['-C', meta.webacpRoot, 'rev-list', '--count', 'HEAD..@{u}'],
        { timeout: 10_000 },
      ).catch(() => ({ stdout: '0' }));
      const behind = parseInt(behindOut.trim(), 10) || 0;
      return {
        current,
        latest: behind > 0 ? `${behind} commit(s) behind origin` : current,
        updateAvailable: behind > 0,
        source: 'git',
      };
    } catch {
      return { current, latest: null, updateAvailable: false, source: 'git' };
    }
  }

  const latest = await fetchNpmLatest(UPDATE_PACKAGE);
  if (!latest) {
    return { current, latest: null, updateAvailable: false, source: 'npm' };
  }
  return {
    current,
    latest,
    updateAvailable: isNewerVersion(latest, current),
    source: 'npm',
  };
}

export interface UpdateResult {
  ok: boolean;
  message: string;
  restarted: boolean;
  applied: boolean;
}

/** Real-time triggers — not polled on a timer. */
export type UpdateTrigger = 'pair' | 'chat' | 'connect';

const triggerLastAt: Partial<Record<UpdateTrigger | '_any', number>> = {};
let updateInFlight = false;

const COOLDOWN_MS: Record<UpdateTrigger, number> = {
  pair: 0,
  chat: 2 * 60 * 1000,
  connect: 15 * 60 * 1000,
};

function updatesEnabled(): boolean {
  return process.env.WEBACP_UPDATE_ON_TRIGGER !== '0';
}

/** Check + apply when behind. Debounced per trigger. Fire-and-forget safe. */
export async function maybeUpdateOnTrigger(trigger: UpdateTrigger): Promise<UpdateResult | null> {
  if (!updatesEnabled() || updateInFlight) return null;

  const now = Date.now();
  const cooldown = COOLDOWN_MS[trigger];
  if (triggerLastAt[trigger] && now - triggerLastAt[trigger]! < cooldown) return null;
  if (triggerLastAt._any && now - triggerLastAt._any < 30_000) return null;

  triggerLastAt[trigger] = now;
  triggerLastAt._any = now;
  updateInFlight = true;

  try {
    const check = await checkForUpdate();
    if (!check.updateAvailable) return { ok: true, message: 'Up to date', restarted: false, applied: false };

    console.log(`[agent] update triggered by "${trigger}" (${check.current} → ${check.latest})`);
    const result = await runUpdate();
    if (result.applied) {
      const status = await getServiceStatus();
      if (status.installed) {
        setTimeout(() => process.exit(0), 250);
      }
    }
    return result;
  } catch (err) {
    console.warn('[agent] update failed:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    updateInFlight = false;
  }
}

export async function runUpdate(opts: { checkOnly?: boolean } = {}): Promise<UpdateResult> {
  const check = await checkForUpdate();
  if (opts.checkOnly) {
    if (!check.updateAvailable) {
      return { ok: true, message: `Up to date (${check.current}).`, restarted: false, applied: false };
    }
    return {
      ok: true,
      message: `Update available: ${check.current} → ${check.latest} (${check.source})`,
      restarted: false,
      applied: false,
    };
  }

  if (!check.updateAvailable) {
    return { ok: true, message: `Already on latest (${check.current}).`, restarted: false, applied: false };
  }

  const meta = await loadInstallMeta();
  let message = '';

  if (check.source === 'git' && meta?.webacpRoot) {
    await exec('git', ['-C', meta.webacpRoot, 'pull', '--ff-only'], { timeout: 120_000 });
    message = 'Pulled latest from git.';
  } else {
    const bun = process.env.HOME ? `${process.env.HOME}/.bun/bin/bun` : 'bun';
    await exec(bun, ['update', '-g', UPDATE_PACKAGE], { timeout: 120_000, env: process.env });
    message = `Updated ${UPDATE_PACKAGE} via bun.`;
  }

  const status = await getServiceStatus();
  if (status.installed) {
    await restartService();
    return { ok: true, message: `${message} Service restarted.`, restarted: true, applied: true };
  }

  return {
    ok: true,
    message: `${message} Restart \`webacp-agent\` to apply.`,
    restarted: false,
    applied: true,
  };
}
