import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FsUploadStoreOptions, PutUploadInput, UploadMeta, UploadStore } from './types.js';
import { DEFAULT_MAX_UPLOAD_BYTES } from '@webacp/protocol';

export { DEFAULT_MAX_UPLOAD_BYTES };

function metaPath(rootDir: string, id: string): string {
  return join(rootDir, id, 'meta.json');
}

function dataPath(rootDir: string, id: string): string {
  return join(rootDir, id, 'data');
}

export function fsUploadStore(options: FsUploadStoreOptions): UploadStore {
  const rootDir = options.rootDir;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_UPLOAD_BYTES;

  return {
    async put(input: PutUploadInput): Promise<UploadMeta> {
      if (input.data.byteLength > maxBytes) {
        throw new Error(`File exceeds ${maxBytes} byte limit`);
      }
      const id = input.id ?? randomUUID();
      const dir = join(rootDir, id);
      await mkdir(dir, { recursive: true });
      const meta: UploadMeta = {
        id,
        threadId: input.threadId ?? null,
        name: input.name,
        mimeType: input.mimeType || 'application/octet-stream',
        size: input.data.byteLength,
        createdAt: Date.now(),
      };
      await writeFile(dataPath(rootDir, id), input.data);
      await writeFile(metaPath(rootDir, id), JSON.stringify(meta));
      return meta;
    },

    async getMeta(id: string): Promise<UploadMeta | null> {
      try {
        const raw = await readFile(metaPath(rootDir, id), 'utf8');
        return JSON.parse(raw) as UploadMeta;
      } catch {
        return null;
      }
    },

    async read(id: string): Promise<Buffer | null> {
      try {
        return await readFile(dataPath(rootDir, id));
      } catch {
        return null;
      }
    },
  };
}
