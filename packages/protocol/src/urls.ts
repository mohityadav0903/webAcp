import { DEFAULT_AGENT_PAIR_PORT, DEFAULT_WEB_PORT } from './constants.js';

export function defaultWebUrl(host = '127.0.0.1'): string {
  return `http://${host}:${DEFAULT_WEB_PORT}`;
}

export function defaultAgentPairUrl(host = '127.0.0.1'): string {
  return `http://${host}:${DEFAULT_AGENT_PAIR_PORT}`;
}
