import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface AgentSecretStore {
  issue(agentId: string, agentName?: string): Promise<string>;
  validate(agentId: string, secret: string): Promise<boolean>;
  revoke(agentId: string): Promise<void>;
}

interface StoredAgent {
  secret: string;
  agentName?: string;
  registeredAt: number;
}

interface AgentStoreFile {
  agents: Record<string, StoredAgent>;
}

/** File-backed agent secret store (default: ~/.webacp/server/agents.json). */
export function fileAgentStore(dir?: string): AgentSecretStore {
  const dataDir = dir ?? process.env.WEBACP_DATA_DIR ?? join(homedir(), '.webacp', 'server');
  const storePath = join(dataDir, 'agents.json');
  let cache: AgentStoreFile | null = null;

  async function load(): Promise<AgentStoreFile> {
    if (cache) return cache;
    try {
      cache = JSON.parse(await readFile(storePath, 'utf8')) as AgentStoreFile;
    } catch {
      cache = { agents: {} };
    }
    return cache;
  }

  async function save(store: AgentStoreFile): Promise<void> {
    cache = store;
    await mkdir(dataDir, { recursive: true });
    await writeFile(storePath, JSON.stringify(store, null, 2) + '\n', 'utf8');
  }

  return {
    async issue(agentId, agentName) {
      const store = await load();
      const secret = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
      store.agents[agentId] = { secret, agentName, registeredAt: Date.now() };
      await save(store);
      return secret;
    },
    async validate(agentId, secret) {
      const store = await load();
      return store.agents[agentId]?.secret === secret;
    },
    async revoke(agentId) {
      const store = await load();
      delete store.agents[agentId];
      await save(store);
    },
  };
}

/** In-memory agent secret store (lost on restart). */
export function memoryAgentStore(): AgentSecretStore {
  const agents = new Map<string, string>();
  return {
    async issue(agentId) {
      const secret = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
      agents.set(agentId, secret);
      return secret;
    },
    async validate(agentId, secret) {
      return agents.get(agentId) === secret;
    },
    async revoke(agentId) {
      agents.delete(agentId);
    },
  };
}
