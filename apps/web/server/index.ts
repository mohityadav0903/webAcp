import { DEFAULT_WEB_PORT, defaultWebUrl } from '@webacp/protocol';
import { createWebacpServer, defineTool, defineToolPack } from '@webacp/server';
import { sqliteAdapter } from '@webacp/persistence';
import { fsPack } from '@webacp/tools-fs';
import { z } from 'zod';

const serverPack = defineToolPack({
  name: 'server',
  runtime: 'server',
  description: 'Tools that execute on the web server.',
  tools: [
    defineTool({
      name: 'server_time',
      description: 'Return the current server time (ISO 8601)',
      input: z.object({}),
      handler: async () => ({ now: new Date().toISOString() }),
    }),
  ],
});

const publicUrl = process.env.WEBACP_PUBLIC_URL ?? defaultWebUrl();

const webacp = createWebacpServer({
  publicUrl,
  serverToolPacks: [serverPack],
  localToolPacks: [fsPack],
  persistence: sqliteAdapter(process.env.WEBACP_DB ?? './webacp.db'),
});

export function startServer(port = Number(process.env.PORT ?? DEFAULT_WEB_PORT)) {
  const server = Bun.serve({
    port,
    idleTimeout: 255,
    fetch: webacp.fetch,
    websocket: webacp.websocket,
  } as unknown as Parameters<typeof Bun.serve>[0]);
  console.log(`[web] server http://127.0.0.1:${port}`);
  return server;
}

if (import.meta.main) {
  startServer();
}

export { webacp };
