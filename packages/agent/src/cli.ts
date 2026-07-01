import type { ToolPack } from '@webacp/tools';
import {
  getServiceStatus,
  installBin,
  installService,
  linkToLocalBin,
  loadInstallMeta,
  uninstallService,
} from './service.js';
import { checkForUpdate, runUpdate } from './updater.js';
import { AGENT_VERSION } from './version.js';

export interface AgentCliOptions {
  toolPacks?: ToolPack[];
  /** Override entry script path for `install` (defaults to caller's index.ts). */
  entryScript?: string;
  /** Repo root for git-based updates. */
  webacpRoot?: string;
}

function usage(): void {
  console.log(`webacp-agent v${AGENT_VERSION}

Usage:
  webacp-agent [run]          Start the local agent (default)
  webacp-agent install        Install bin + background service (launchd/systemd)
  webacp-agent uninstall      Stop and remove background service
  webacp-agent status         Show service + pairing status
  webacp-agent update         Pull/install latest and restart service
  webacp-agent update --check Check for updates only
`);
}

async function pairStatus(): Promise<{ running: boolean; paired: boolean; connected: boolean }> {
  const port = process.env.WEBACP_PAIR_PORT ?? '9333';
  try {
    const res = await fetch(`http://127.0.0.1:${port}/status`);
    if (!res.ok) return { running: false, paired: false, connected: false };
    const data = (await res.json()) as { running?: boolean; paired?: boolean; connected?: boolean };
    return {
      running: !!data.running,
      paired: !!data.paired,
      connected: !!data.connected,
    };
  } catch {
    return { running: false, paired: false, connected: false };
  }
}

async function cmdInstall(opts: AgentCliOptions): Promise<void> {
  if (!opts.entryScript) {
    throw new Error('entryScript is required for install');
  }
  const bin = await installBin({ entryScript: opts.entryScript, webacpRoot: opts.webacpRoot });
  const link = await linkToLocalBin();
  await installService(bin);

  console.log(`Installed ${bin}`);
  if (link) console.log(`Linked ${link}`);
  console.log('Background service started. Agent will run on login.');
  console.log('Logs: ~/.webacp/agent.stdout.log  ~/.webacp/agent.stderr.log');
  console.log('Ensure ~/.local/bin and ~/.bun/bin are on your PATH.');
}

async function cmdStatus(): Promise<void> {
  const svc = await getServiceStatus();
  const meta = await loadInstallMeta();
  const pair = await pairStatus();
  const upd = await checkForUpdate();

  console.log(`Version:  ${AGENT_VERSION}`);
  console.log(`Bin:      ${meta?.binPath ?? '(not installed via install)'}`);
  if (meta?.webacpRoot) console.log(`Source:   ${meta.webacpRoot} (git)`);
  console.log(`Service:  ${svc.installed ? (svc.running ? 'running' : 'stopped') : 'not installed'} (${svc.platform})`);
  if (svc.detail) console.log(`          ${svc.detail}`);
  console.log(`Agent:    ${pair.running ? (pair.connected ? 'connected' : pair.paired ? 'paired' : 'running') : 'not running'}`);
  if (upd.updateAvailable) {
    console.log(`Update:   available (${upd.current} → ${upd.latest}, ${upd.source})`);
  } else {
    console.log(`Update:   up to date`);
  }
}

export async function runAgentCli(argv: string[], opts: AgentCliOptions = {}): Promise<void> {
  const [cmd = 'run', ...rest] = argv;
  const checkOnly = rest.includes('--check');

  switch (cmd) {
    case 'run':
    case 'start': {
      const { createLocalAgent } = await import('./index.js');
      const agent = createLocalAgent({ toolPacks: opts.toolPacks });
      process.on('SIGINT', () => {
        agent.stop();
        process.exit(0);
      });
      process.on('SIGTERM', () => {
        agent.stop();
        process.exit(0);
      });
      await agent.start();
      return;
    }
    case 'install':
      await cmdInstall(opts);
      return;
    case 'uninstall':
      await uninstallService();
      console.log('Service removed. Bin remains at ~/.webacp/bin/webacp-agent');
      return;
    case 'status':
      await cmdStatus();
      return;
    case 'update': {
      const result = await runUpdate({ checkOnly });
      console.log(result.message);
      process.exit(result.ok ? 0 : 1);
    }
    case 'help':
    case '--help':
    case '-h':
      usage();
      return;
    default:
      console.error(`Unknown command: ${cmd}\n`);
      usage();
      process.exit(1);
  }
}

export { AGENT_VERSION } from './version.js';
