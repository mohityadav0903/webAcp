import { homedir } from 'node:os';
import { join } from 'node:path';

export const WEBACP_HOME = process.env.WEBACP_HOME ?? join(homedir(), '.webacp');
export const WEBACP_BIN_DIR = process.env.WEBACP_BIN_DIR ?? join(WEBACP_HOME, 'bin');
export const WEBACP_AGENT_BIN = join(WEBACP_BIN_DIR, 'webacp-agent');
export const WEBACP_INSTALL_META = join(WEBACP_HOME, 'install.json');

export const SERVICE_LABEL = 'com.webacp.agent';
export const LAUNCHD_PLIST = join(
  homedir(),
  'Library',
  'LaunchAgents',
  `${SERVICE_LABEL}.plist`,
);
export const SYSTEMD_UNIT = join(
  homedir(),
  '.config',
  'systemd',
  'user',
  'webacp-agent.service',
);

export interface InstallMeta {
  version: string;
  installedAt: string;
  /** Repo root when installed from a git checkout. */
  webacpRoot?: string;
  /** Resolved path of the webacp-agent executable. */
  binPath: string;
}
