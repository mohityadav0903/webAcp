import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AcpProviderId } from '@webacp/protocol';

const execFileAsync = promisify(execFile);

const CASR_ALIAS: Record<AcpProviderId, string> = {
  claude: 'cc',
  codex: 'cod',
  gemini: 'gmi',
  cursor: 'cur',
  opencode: 'opc',
};

export async function getCasrStatus(): Promise<{ installed: boolean; version: string | null }> {
  try {
    const { stdout } = await execFileAsync('casr', ['--version']);
    return { installed: true, version: stdout.trim() || null };
  } catch {
    return { installed: false, version: null };
  }
}

export async function casrConvertSession(opts: {
  sessionId: string;
  targetProvider: AcpProviderId;
}): Promise<{
  ok: boolean;
  resumeCommand?: string;
  newSessionId?: string;
  message?: string;
  raw?: unknown;
}> {
  const alias = CASR_ALIAS[opts.targetProvider];
  try {
    const { stdout } = await execFileAsync('casr', [alias, 'resume', opts.sessionId, '--json'], {
      maxBuffer: 10 * 1024 * 1024,
    });
    const raw = JSON.parse(stdout) as Record<string, unknown>;
    const resumeCommand =
      typeof raw.resume_command === 'string'
        ? raw.resume_command
        : typeof raw.resumeCommand === 'string'
          ? raw.resumeCommand
          : undefined;
    const newSessionId =
      typeof raw.new_session_id === 'string'
        ? raw.new_session_id
        : typeof raw.newSessionId === 'string'
          ? raw.newSessionId
          : typeof raw.session_id === 'string'
            ? raw.session_id
            : undefined;
    return { ok: true, resumeCommand, newSessionId, raw };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ENOENT')) {
      return {
        ok: false,
        message: 'casr not installed. Install: curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/cross_agent_session_resumer/main/install.sh | bash',
      };
    }
    return { ok: false, message };
  }
}
