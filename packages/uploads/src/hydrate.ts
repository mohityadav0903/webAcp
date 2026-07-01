import type { ContentBlock } from '@webacp/protocol';
import {
  isTextLikeMime,
  resolveUploadId,
  uploadApiPath,
} from '@webacp/protocol';
import type { UploadStore } from './types.js';

const TEXT_EXT = /\.(txt|md|json|ts|tsx|js|jsx|css|html|csv|xml|yaml|yml|toml)$/i;

function isTextUpload(mimeType: string, name: string): boolean {
  return isTextLikeMime(mimeType) || TEXT_EXT.test(name);
}

/** Resolve upload refs to inline data/text for ACP prompts. */
export async function hydrateContentBlocks(
  blocks: ContentBlock[],
  store: UploadStore,
): Promise<ContentBlock[]> {
  const out: ContentBlock[] = [];
  for (const block of blocks) {
    const uploadId = resolveUploadId(block);
    if (!uploadId) {
      out.push(block);
      continue;
    }
    const meta = await store.getMeta(uploadId);
    if (!meta) {
      out.push(block);
      continue;
    }
    const bytes = await store.read(uploadId);
    if (!bytes) {
      out.push(block);
      continue;
    }
    if (block.type === 'image') {
      out.push({
        type: 'image',
        mimeType: meta.mimeType,
        data: bytes.toString('base64'),
        name: meta.name,
        uri: block.uri ?? uploadApiPath(uploadId),
        uploadId,
      });
      continue;
    }
    if (block.type === 'resource') {
      if (isTextUpload(meta.mimeType, meta.name)) {
        out.push({
          type: 'resource',
          name: meta.name,
          mimeType: meta.mimeType,
          text: bytes.toString('utf8'),
          uri: block.uri ?? uploadApiPath(uploadId),
          uploadId,
        });
      } else {
        out.push({
          type: 'resource',
          name: meta.name,
          mimeType: meta.mimeType,
          data: bytes.toString('base64'),
          uri: block.uri ?? uploadApiPath(uploadId),
          uploadId,
        });
      }
      continue;
    }
    out.push(block);
  }
  return out;
}
