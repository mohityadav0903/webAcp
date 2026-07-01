import { defineTool, defineToolPack } from '@webacp/tools';
import { z } from 'zod';

/**
 * A custom LOCAL tool pack. Local packs must be declared in BOTH places:
 *  - the server (for tool schemas exposed over /mcp/local)
 *  - the agent (for the handlers that actually run on the user machine)
 */
export const machinePack = defineToolPack({
  name: 'machine',
  runtime: 'local',
  tools: [
    defineTool({
      name: 'whoami',
      description: 'Return basic info about the host machine',
      input: z.object({}),
      handler: async () => ({
        platform: process.platform,
        cwd: process.cwd(),
        node: process.version,
      }),
    }),
  ],
});
