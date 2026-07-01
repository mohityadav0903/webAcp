import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AcpProviderId, ProviderProbe } from '@webacp/protocol';

const WORKER = join(dirname(fileURLToPath(import.meta.url)), 'probe-worker.ts');
const PROBE_TIMEOUT_MS = 90_000;

function runProbeWorker(providerId?: AcpProviderId): Promise<ProviderProbe[]> {
  return new Promise((resolve, reject) => {
    const args = [WORKER, providerId ?? 'all'];
    const proc = spawn('bun', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Probe timed out after ${PROBE_TIMEOUT_MS}ms`));
    }, PROBE_TIMEOUT_MS);

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim() || `exit ${code}`;
        reject(new Error(`Probe worker failed: ${detail}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as unknown;
        if (!Array.isArray(parsed)) throw new Error('Invalid probe output');
        resolve(parsed as ProviderProbe[]);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

export async function probeProviders(providerId?: AcpProviderId): Promise<ProviderProbe[]> {
  try {
    return await runProbeWorker(providerId);
  } catch (err) {
    console.error('[agent] probe worker error:', err);
    throw err;
  }
}
