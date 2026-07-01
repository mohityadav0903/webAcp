import { defaultAgentPairUrl } from '@webacp/protocol';
import type { WebacpConfig } from '@webacp/react';

/** Typed client config — single source for URLs passed into WebacpChat. */
export const webConfig = {
  baseUrl: '',
  agentPairUrl: defaultAgentPairUrl(),
} satisfies WebacpConfig;
