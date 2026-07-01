import type { AcpProviderId } from '@webacp/protocol';
import { isAcpProviderId } from '@webacp/protocol';
import { probeProvidersInProcess } from './probe-impl.js';

const arg = process.argv[2];
const providerId = arg && arg !== 'all' && isAcpProviderId(arg) ? (arg as AcpProviderId) : undefined;

const results = await probeProvidersInProcess(providerId);
process.stdout.write(JSON.stringify(results));
