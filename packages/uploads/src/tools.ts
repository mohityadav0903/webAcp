import { defineTool, defineToolPack, z, type ToolPack } from '@webacp/tools';
import type { UploadStore } from './types.js';

const readUploadInput = z.object({
  id: z.string().describe('Upload id from webacp://uploads/{id} or /api/uploads/{id}'),
  offset: z.number().int().min(1).optional().describe('Start line for text files (1-based)'),
  limit: z.number().int().min(1).optional().describe('Max lines for text files'),
});

const TEXT_EXT = /\.(txt|md|json|ts|tsx|js|jsx|css|html|csv|xml|yaml|yml|toml)$/i;

export function createUploadsToolPack(store: UploadStore): ToolPack {
  return defineToolPack({
    name: 'uploads',
    runtime: 'server',
    description: 'Read files uploaded to this chat thread via the WebACP composer.',
    tools: [
      defineTool({
        name: 'read_upload',
        description: 'Read a file the user attached in chat (by upload id)',
        input: readUploadInput,
        handler: async ({ id, offset, limit }) => {
          const meta = await store.getMeta(id);
          if (!meta) throw new Error(`Upload not found: ${id}`);
          const bytes = await store.read(id);
          if (!bytes) throw new Error(`Upload data missing: ${id}`);
          const isText =
            meta.mimeType.startsWith('text/') || TEXT_EXT.test(meta.name);
          if (isText) {
            const lines = bytes.toString('utf8').split('\n');
            const start = offset ? offset - 1 : 0;
            const end = limit ? start + limit : lines.length;
            const slice = lines.slice(start, end);
            return {
              id,
              name: meta.name,
              mimeType: meta.mimeType,
              size: meta.size,
              content: slice.join('\n'),
              startLine: start + 1,
              endLine: start + slice.length,
              totalLines: lines.length,
            };
          }
          return {
            id,
            name: meta.name,
            mimeType: meta.mimeType,
            size: meta.size,
            dataBase64: bytes.toString('base64'),
          };
        },
      }),
    ],
  });
}
