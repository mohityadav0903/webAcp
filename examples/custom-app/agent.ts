/**
 * Example: a custom local agent that ships the built-in fs pack plus a
 * custom local tool that runs on the user's machine.
 *
 * Run from the repo root (after the example server is up):
 *   WEBACP_PAIR_TOKEN=<token> WEBACP_WEB_URL=http://127.0.0.1:4000 \
 *     bun run examples/custom-app/agent.ts
 */
import { createLocalAgent } from '@webacp/agent';
import { fsPack } from '@webacp/tools-fs';
import { machinePack } from './shared-tools.js';

const agent = createLocalAgent({
  toolPacks: [fsPack, machinePack],
});

process.on('SIGINT', () => {
  agent.stop();
  process.exit(0);
});

void agent.start();
