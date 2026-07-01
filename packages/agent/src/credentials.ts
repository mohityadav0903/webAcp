import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AgentCredentials {
  agentId: string;
  secret: string;
  webUrl: string;
  pairedAt: string;
}

export interface CredentialStore {
  load(): Promise<AgentCredentials | null>;
  save(creds: AgentCredentials): Promise<void>;
  clear(): Promise<void>;
}

export function fileCredentialStore(dir?: string): CredentialStore {
  const credDir = dir ?? process.env.WEBACP_CONFIG_DIR ?? join(homedir(), '.webacp');
  const credPath = join(credDir, 'credentials.json');

  return {
    async load() {
      try {
        const parsed = JSON.parse(await readFile(credPath, 'utf8')) as AgentCredentials;
        if (!parsed.agentId || !parsed.secret || !parsed.webUrl) return null;
        return parsed;
      } catch {
        return null;
      }
    },
    async save(creds) {
      await mkdir(credDir, { recursive: true });
      await writeFile(credPath, JSON.stringify(creds, null, 2) + '\n', 'utf8');
    },
    async clear() {
      try {
        await unlink(credPath);
      } catch {
        /* ignore */
      }
    },
  };
}
