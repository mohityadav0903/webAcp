import pkg from '../package.json' with { type: 'json' };

/** Used for update checks and CLI --help. */
export const AGENT_VERSION = pkg.version;

export const UPDATE_PACKAGE = process.env.WEBACP_UPDATE_PACKAGE ?? '@webacp/agent';
