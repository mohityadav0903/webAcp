import { z } from 'zod';

export const textContentBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});
export type TextContentBlock = z.infer<typeof textContentBlockSchema>;

export const imageContentBlockSchema = z.object({
  type: z.literal('image'),
  mimeType: z.string(),
  /** Base64-encoded bytes (no data: URL prefix). */
  data: z.string().optional(),
  name: z.string().optional(),
  /** Workspace-relative path (e.g. `.webacp/uploads/…/file.md`). */
  path: z.string().optional(),
  /** @deprecated Legacy server upload ref. */
  uri: z.string().optional(),
  uploadId: z.string().optional(),
});
export type ImageContentBlock = z.infer<typeof imageContentBlockSchema>;

export const resourceContentBlockSchema = z.object({
  type: z.literal('resource'),
  name: z.string(),
  mimeType: z.string(),
  text: z.string().optional(),
  data: z.string().optional(),
  /** Workspace-relative path (e.g. `.webacp/uploads/…/file.md`). */
  path: z.string().optional(),
  /** @deprecated Legacy server upload ref. */
  uri: z.string().optional(),
  uploadId: z.string().optional(),
});
export type ResourceContentBlock = z.infer<typeof resourceContentBlockSchema>;

export const contentBlockSchema = z
  .discriminatedUnion('type', [
    textContentBlockSchema,
    imageContentBlockSchema,
    resourceContentBlockSchema,
  ])
  .superRefine((block, ctx) => {
    if (
      block.type === 'image' &&
      !block.data &&
      !block.path &&
      !block.uri &&
      !block.uploadId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'image block needs data or path',
      });
    }
    if (
      block.type === 'resource' &&
      block.text == null &&
      block.data == null &&
      !block.path &&
      !block.uri &&
      !block.uploadId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'resource block needs text, data, or path',
      });
    }
  });
export type ContentBlock = z.infer<typeof contentBlockSchema>;

const messageContentV1Schema = z.object({
  v: z.literal(1),
  blocks: z.array(contentBlockSchema).min(1),
});

const MESSAGE_CONTENT_PREFIX = '{"v":1';

export function isStructuredMessageContent(raw: string): boolean {
  return raw.startsWith(MESSAGE_CONTENT_PREFIX);
}

export function parseMessageContent(raw: string): ContentBlock[] {
  if (!isStructuredMessageContent(raw)) {
    return raw ? [{ type: 'text', text: raw }] : [];
  }
  try {
    const parsed = messageContentV1Schema.parse(JSON.parse(raw));
    return parsed.blocks;
  } catch {
    return [{ type: 'text', text: raw }];
  }
}

export function serializeMessageContent(blocks: ContentBlock[]): string {
  const normalized = contentBlockSchema.array().parse(blocks);
  if (normalized.length === 1 && normalized[0].type === 'text' && !normalized[0].text.includes('\n')) {
    return normalized[0].text;
  }
  return JSON.stringify({ v: 1 as const, blocks: normalized });
}

export function messagePreviewText(blocks: ContentBlock[], maxLen = 60): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text' && block.text.trim()) parts.push(block.text.trim());
    else if (block.type === 'image') {
      parts.push(`[image${block.path ? `: ${block.path}` : block.name ? `: ${block.name}` : ''}]`);
    } else if (block.type === 'resource') {
      parts.push(`[file: ${block.path ?? block.name}]`);
    }
  }
  const joined = parts.join(' ').trim() || 'Attachment';
  return joined.length > maxLen ? `${joined.slice(0, maxLen - 1)}…` : joined;
}

/** Plain-text preview of a stored message for history replay. */
export function storedContentToHistoryText(raw: string): string {
  const blocks = parseMessageContent(raw);
  return messagePreviewText(blocks, 8000);
}

/** ACP `session/prompt` content blocks. */
export type AcpPromptBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string; uri?: string | null }
  | {
      type: 'resource';
      resource: { uri: string; mimeType?: string | null; text?: string; blob?: string };
    };

export function blocksToAcpPrompt(
  blocks: ContentBlock[],
  options?: { workspaceCwd?: string | null },
): AcpPromptBlock[] {
  const out: AcpPromptBlock[] = [];
  const pathLines: string[] = [];
  for (const b of blocks) {
    if (b.type === 'text' || !b.path) continue;
    const label = b.type === 'image' ? 'image' : 'file';
    pathLines.push(`- ${label}: ${b.path}${b.name ? ` (${b.name})` : ''}`);
  }
  if (pathLines.length) {
    const workspaceNote = options?.workspaceCwd
      ? `Workspace root: ${options.workspaceCwd}\n`
      : '';
    out.push({
      type: 'text',
      text:
        `${workspaceNote}Attached files (paths are workspace-relative — use as-is with read_file / edit_file / write_file):\n` +
        pathLines.join('\n') +
        '\n\nDo not ask the user for absolute paths. These paths resolve under the active workspace.',
    });
  }

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        out.push({ type: 'text', text: block.text });
        break;
      case 'image':
        if (block.path) break;
        out.push({
          type: 'image',
          mimeType: block.mimeType,
          data: block.data ?? '',
          uri: block.uri ?? (block.name ? `file://${block.name}` : null),
        });
        break;
      case 'resource': {
        if (block.path) break;
        const uri = block.uri ?? `file://${block.name}`;
        if (block.text != null) {
          out.push({
            type: 'resource',
            resource: { uri, mimeType: block.mimeType, text: block.text },
          });
        } else if (block.data) {
          out.push({
            type: 'resource',
            resource: { uri, mimeType: block.mimeType, blob: block.data },
          });
        }
        break;
      }
    }
  }
  return out;
}

export function prependHistoryToPrompt(
  blocks: AcpPromptBlock[],
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): AcpPromptBlock[] {
  if (!history.length) return blocks;
  const transcript = history
    .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
    .join('\n\n');
  const header =
    '<thread_history>\n' +
    'Earlier messages in this chat thread (may be from another CLI agent). ' +
    'Use as established context.\n\n' +
    transcript +
    '\n</thread_history>\n\n';

  const out = [...blocks];
  const textIdx = out.findIndex((b) => b.type === 'text');
  if (textIdx >= 0 && out[textIdx].type === 'text') {
    out[textIdx] = { type: 'text', text: header + out[textIdx].text };
    return out;
  }
  return [{ type: 'text', text: header }, ...out];
}

export function blocksFromTextAndFiles(
  text: string,
  files: Array<{ name: string; mimeType: string; text?: string; data?: string }>,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const trimmed = text.trim();
  if (trimmed) blocks.push({ type: 'text', text: trimmed });
  for (const file of files) {
    if (file.mimeType.startsWith('image/') && file.data) {
      blocks.push({
        type: 'image',
        mimeType: file.mimeType,
        data: file.data,
        name: file.name,
      });
    } else if (file.text != null) {
      blocks.push({
        type: 'resource',
        name: file.name,
        mimeType: file.mimeType,
        text: file.text,
      });
    } else if (file.data) {
      blocks.push({
        type: 'resource',
        name: file.name,
        mimeType: file.mimeType,
        data: file.data,
      });
    }
  }
  return blocks;
}

/** True when a block carries sendable prompt content (non-empty text, image bytes, or file payload). */
export function blockHasPromptContent(block: ContentBlock): boolean {
  if (block.type === 'text') return Boolean(block.text.trim());
  if (block.type === 'image') {
    return Boolean(block.data || block.path || block.uri || block.uploadId);
  }
  if (block.type === 'resource') {
    return Boolean(block.text?.trim() || block.data || block.path || block.uri || block.uploadId);
  }
  return false;
}

export function hasPromptContent(blocks: ContentBlock[]): boolean {
  return blocks.some(blockHasPromptContent);
}

export function normalizePromptBlocks(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.filter(blockHasPromptContent);
}

export const chatRequestBodySchema = z
  .object({
    threadId: z.string().nullish(),
    message: z.string().nullish(),
    blocks: z.array(contentBlockSchema).optional(),
    provider: z.string().nullish(),
    model: z.string().nullish(),
    userMessageId: z.string().nullish(),
    skipUserMessage: z.boolean().optional(),
  })
  .refine(
    (b) => {
      if (b.blocks?.length) return hasPromptContent(b.blocks);
      return Boolean(b.message?.trim());
    },
    { message: 'message or blocks required' },
  );
export type ChatRequestBody = z.infer<typeof chatRequestBodySchema>;

export function resolveChatBlocks(body: ChatRequestBody): ContentBlock[] {
  const blocks = body.blocks?.length
    ? body.blocks
    : [{ type: 'text' as const, text: (body.message ?? '').trim() }];
  return normalizePromptBlocks(blocks);
}
