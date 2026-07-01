import { mkdir, readFile, writeFile, unlink, chmod } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { platform } from 'node:os';
import { promisify } from 'node:util';
import {
  LAUNCHD_PLIST,
  SERVICE_LABEL,
  SYSTEMD_UNIT,
  WEBACP_AGENT_BIN,
  WEBACP_BIN_DIR,
  WEBACP_INSTALL_META,
  type InstallMeta,
} from './paths.js';
import { AGENT_VERSION } from './version.js';

const exec = promisify(execFile);

function guiDomain(): string {
  return `gui/${process.getuid?.() ?? 501}`;
}

function shell(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return exec(cmd, args, { env: process.env }).catch((err: NodeJS.ErrnoException & { stdout?: string; stderr?: string }) => {
    const message = err.stderr?.trim() || err.stdout?.trim() || err.message;
    throw new Error(message);
  });
}

export function resolveBunPath(): string {
  return process.env.BUN_INSTALL_BIN
    ? `${process.env.BUN_INSTALL_BIN}/bun`
    : process.env.HOME
      ? `${process.env.HOME}/.bun/bin/bun`
      : 'bun';
}

export interface InstallOptions {
  /** Entry script the global bin should run (dev: repo apps/local-agent/src/index.ts). */
  entryScript: string;
  /** Repo root for git-based updates (optional). */
  webacpRoot?: string;
}

/** Write ~/.webacp/bin/webacp-agent wrapper and install metadata. */
export async function installBin(options: InstallOptions): Promise<string> {
  await mkdir(WEBACP_BIN_DIR, { recursive: true });
  const bun = resolveBunPath();
  const entry = options.entryScript;

  const wrapper = `#!/usr/bin/env bash
set -euo pipefail
export PATH="${process.env.HOME}/.bun/bin:${process.env.HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
[ -f "$HOME/.webacp/env" ] && set -a && source "$HOME/.webacp/env" && set +a
${options.webacpRoot ? `export WEBACP_ROOT="${options.webacpRoot}"` : ''}
exec "${bun}" run "${entry}" "$@"
`;

  await writeFile(WEBACP_AGENT_BIN, wrapper, { mode: 0o755 });
  await chmod(WEBACP_AGENT_BIN, 0o755);

  const meta: InstallMeta = {
    version: AGENT_VERSION,
    installedAt: new Date().toISOString(),
    webacpRoot: options.webacpRoot,
    binPath: WEBACP_AGENT_BIN,
  };
  await mkdir(dirname(WEBACP_INSTALL_META), { recursive: true });
  await writeFile(WEBACP_INSTALL_META, JSON.stringify(meta, null, 2) + '\n', 'utf8');

  return WEBACP_AGENT_BIN;
}

export async function loadInstallMeta(): Promise<InstallMeta | null> {
  try {
    return JSON.parse(await readFile(WEBACP_INSTALL_META, 'utf8')) as InstallMeta;
  } catch {
    return null;
  }
}

function launchdPlist(bin: string): string {
  const home = process.env.HOME ?? '';
  const bunDir = `${home}/.bun/bin`;
  const localBin = `${home}/.local/bin`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bin}</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${home}/.webacp/agent.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${home}/.webacp/agent.stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${bunDir}:${localBin}:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
`;
}

function systemdUnit(bin: string): string {
  return `[Unit]
Description=WebACP local agent
After=network.target

[Service]
Type=simple
ExecStart=${bin} run
Restart=always
RestartSec=3
Environment=PATH=${process.env.HOME}/.bun/bin:${process.env.HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
`;
}

export async function installService(bin = WEBACP_AGENT_BIN): Promise<void> {
  const os = platform();
  if (os === 'darwin') {
    await mkdir(dirname(LAUNCHD_PLIST), { recursive: true });
    await writeFile(LAUNCHD_PLIST, launchdPlist(bin), 'utf8');
    try {
      await shell('launchctl', ['bootout', guiDomain(), LAUNCHD_PLIST]);
    } catch {
      /* not loaded yet */
    }
    await shell('launchctl', ['bootstrap', guiDomain(), LAUNCHD_PLIST]);
    await shell('launchctl', ['enable', `${guiDomain()}/${SERVICE_LABEL}`]);
    return;
  }

  if (os === 'linux') {
    await mkdir(dirname(SYSTEMD_UNIT), { recursive: true });
    await writeFile(SYSTEMD_UNIT, systemdUnit(bin), 'utf8');
    await shell('systemctl', ['--user', 'daemon-reload']);
    await shell('systemctl', ['--user', 'enable', '--now', 'webacp-agent.service']);
    return;
  }

  throw new Error(`Service install not supported on ${os}. Run manually: ${bin} run`);
}

export async function uninstallService(): Promise<void> {
  const os = platform();
  if (os === 'darwin') {
    try {
      await shell('launchctl', ['bootout', guiDomain(), LAUNCHD_PLIST]);
    } catch {
      /* ignore */
    }
    try {
      await unlink(LAUNCHD_PLIST);
    } catch {
      /* ignore */
    }
    return;
  }

  if (os === 'linux') {
    try {
      await shell('systemctl', ['--user', 'disable', '--now', 'webacp-agent.service']);
    } catch {
      /* ignore */
    }
    try {
      await unlink(SYSTEMD_UNIT);
    } catch {
      /* ignore */
    }
    await shell('systemctl', ['--user', 'daemon-reload']).catch(() => {});
    return;
  }

  throw new Error(`Service uninstall not supported on ${platform()}`);
}

export interface ServiceStatus {
  installed: boolean;
  running: boolean;
  platform: string;
  binPath: string;
  detail?: string;
}

export async function getServiceStatus(): Promise<ServiceStatus> {
  const meta = await loadInstallMeta();
  const binPath = meta?.binPath ?? WEBACP_AGENT_BIN;
  const os = platform();

  if (os === 'darwin') {
    try {
      const { stdout } = await shell('launchctl', ['print', `${guiDomain()}/${SERVICE_LABEL}`]);
      const running = stdout.includes('state = running') || stdout.includes('pid =');
      return {
        installed: true,
        running,
        platform: os,
        binPath,
        detail: stdout.split('\n').find((l) => l.includes('state ='))?.trim(),
      };
    } catch {
      return { installed: false, running: false, platform: os, binPath };
    }
  }

  if (os === 'linux') {
    try {
      const { stdout } = await shell('systemctl', ['--user', 'is-active', 'webacp-agent.service']);
      const running = stdout.trim() === 'active';
      return { installed: true, running, platform: os, binPath, detail: stdout.trim() };
    } catch {
      return { installed: false, running: false, platform: os, binPath };
    }
  }

  return { installed: false, running: false, platform: os, binPath };
}

export async function restartService(): Promise<void> {
  const os = platform();
  if (os === 'darwin') {
    await shell('launchctl', ['kickstart', '-k', `${guiDomain()}/${SERVICE_LABEL}`]);
    return;
  }
  if (os === 'linux') {
    await shell('systemctl', ['--user', 'restart', 'webacp-agent.service']);
    return;
  }
  throw new Error(`Cannot restart service on ${os}`);
}

/** Symlink ~/.local/bin/webacp-agent → ~/.webacp/bin/webacp-agent */
export async function linkToLocalBin(): Promise<string | null> {
  const localBin = `${process.env.HOME}/.local/bin`;
  const target = `${localBin}/webacp-agent`;
  await mkdir(localBin, { recursive: true });
  try {
    await unlink(target);
  } catch {
    /* ignore */
  }
  await shell('ln', ['-sf', WEBACP_AGENT_BIN, target]);
  return target;
}

export function spawnDetachedAgent(): void {
  const bin = WEBACP_AGENT_BIN;
  const child = spawn(bin, ['run'], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
}
