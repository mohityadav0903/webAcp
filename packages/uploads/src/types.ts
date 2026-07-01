import { z } from 'zod';
import { DEFAULT_MAX_UPLOAD_BYTES } from '@webacp/protocol';

export { DEFAULT_MAX_UPLOAD_BYTES };

export const uploadMetaSchema = z.object({
  id: z.string(),
  threadId: z.string().nullable(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  createdAt: z.number(),
});
export type UploadMeta = z.infer<typeof uploadMetaSchema>;

export interface PutUploadInput {
  id?: string;
  threadId?: string | null;
  name: string;
  mimeType: string;
  data: Buffer;
}

export interface UploadStore {
  put(input: PutUploadInput): Promise<UploadMeta>;
  getMeta(id: string): Promise<UploadMeta | null>;
  read(id: string): Promise<Buffer | null>;
}

export interface FsUploadStoreOptions {
  rootDir: string;
  maxBytes?: number;
}
