import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runAgentCli } from '@webacp/agent/cli';
import { fsPack } from '@webacp/tools-fs';

const entry = fileURLToPath(import.meta.url);
const webacpRoot = resolve(entry, '../../..');

void runAgentCli(process.argv.slice(2), {
  toolPacks: [fsPack],
  entryScript: entry,
  webacpRoot,
});
