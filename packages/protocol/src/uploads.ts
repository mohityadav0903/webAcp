import { z } from 'zod';

export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Relative dir under workspace cwd where composer uploads are materialized. */
export const WORKSPACE_UPLOADS_DIR = '.webacp/uploads';

/** @deprecated Legacy server-side upload refs. */
export const UPLOAD_URI_PREFIX = 'webacp://uploads/';

export function uploadUri(id: string): string {
  return `${UPLOAD_URI_PREFIX}${id}`;
}

export function uploadApiPath(id: string): string {
  return `/api/uploads/${id}`;
}

export function uploadIdFromUri(uri: string): string | null {
  if (uri.startsWith(UPLOAD_URI_PREFIX)) return uri.slice(UPLOAD_URI_PREFIX.length) || null;
  const apiMatch = uri.match(/\/api\/uploads\/([^/?#]+)/);
  return apiMatch?.[1] ?? null;
}

export function isTextLikeMime(mimeType: string): boolean {
  return mimeType.startsWith('text/');
}

export function resolveBlockPath(block: {
  type: string;
  path?: string;
  uri?: string;
  uploadId?: string;
}): string | null {
  if (block.path) return block.path;
  return null;
}

/** @deprecated Prefer `resolveBlockPath`. */
export function resolveUploadId(block: {
  type: string;
  uri?: string;
  uploadId?: string;
}): string | null {
  if (block.uploadId) return block.uploadId;
  if (block.uri) return uploadIdFromUri(block.uri);
  return null;
}

export const uploadResponseSchema = z.object({
  path: z.string(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number(),
});
export type UploadResponse = z.infer<typeof uploadResponseSchema>;

export const uploadMaterializeSchema = z.object({
  type: z.literal('upload.materialize'),
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  dataBase64: z.string(),
  threadId: z.string().nullish(),
});

export const uploadMaterializedSchema = z.object({
  type: z.literal('upload.materialized'),
  id: z.string(),
  ok: z.boolean(),
  path: z.string().optional(),
  error: z.string().optional(),
});

export type UploadMaterialize = z.infer<typeof uploadMaterializeSchema>;
export type UploadMaterialized = z.infer<typeof uploadMaterializedSchema>;
