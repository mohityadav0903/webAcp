/**
 * Example: a custom WebACP server with your own server-side tool pack,
 * the built-in local fs pack, and SQLite persistence.
 *
 * Run from the repo root:
 *   bun run examples/custom-app/server.ts
 */
import { createWebacpServer, defineTool, defineToolPack } from '@webacp/server';
import { sqliteAdapter } from '@webacp/persistence';
import { fsPack } from '@webacp/tools-fs';
import { machinePack } from './shared-tools.js';
import { z } from 'zod';

// A server-runtime tool pack: these execute in THIS process.
const memoryPack = defineToolPack({
  name: 'memory',
  runtime: 'server',
  tools: [
    defineTool({
      name: 'search_memory',
      description: 'Search the app knowledge base',
      input: z.object({ q: z.string() }),
      handler: async ({ q }) => ({ hits: [`(stub) result for "${q}"`] }),
    }),
  ],
});

const port = Number(process.env.PORT ?? 4000);
const publicUrl = process.env.WEBACP_PUBLIC_URL ?? `http://127.0.0.1:${port}`;

const webacp = createWebacpServer({
  publicUrl,
  serverToolPacks: [memoryPack], // run on the server
  localToolPacks: [fsPack, machinePack], // schemas here, executed on the agent
  // externalMcp: [{ name: 'notion', type: 'http', url: 'https://...' }],
  persistence: sqliteAdapter('./example.db'),
});

Bun.serve({
  port,
  fetch: webacp.fetch,
  websocket: webacp.websocket,
} as unknown as Parameters<typeof Bun.serve>[0]);

console.log(`custom WebACP server on http://127.0.0.1:${port}`);
console.log(`  server MCP: ${publicUrl}/mcp/server`);
console.log(`  local  MCP: ${publicUrl}/mcp/local`);
