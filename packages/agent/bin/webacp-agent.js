#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runAgentCli } from '../dist/cli.js';
import { fsPack } from '@webacp/tools-fs';

const entry = fileURLToPath(import.meta.url);
const pkgRoot = resolve(dirname(entry), '..');

void runAgentCli(process.argv.slice(2), {
  toolPacks: [fsPack],
  entryScript: resolve(pkgRoot, 'dist/index.js'),
  webacpRoot: pkgRoot,
});
