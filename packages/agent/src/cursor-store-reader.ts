import { Database } from 'bun:sqlite';
import { findSessionStorePath } from 'cursor-acp-enriched';
import type { CliSessionMessage } from '@webacp/protocol';

function extractTextContent(content: unknown): string | null {
  if (typeof content === 'string') {
    const userQuery = content.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/);
    if (userQuery) return userQuery[1]!.trim() || null;
    if (content.startsWith('<')) return null;
    return content.trim() || null;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      if (rec.type === 'text' && typeof rec.text === 'string') {
        const text = rec.text;
        if (text && !text.startsWith('<')) parts.push(text);
      }
    }
    return parts.join('\n').trim() || null;
  }
  return null;
}

function extractResultString(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((item) =>
        item && typeof item === 'object' && 'text' in item
          ? String((item as { text?: string }).text ?? '')
          : '',
      )
      .join('');
  }
  return JSON.stringify(raw, null, 2);
}

function blobToUtf8(data: unknown): string | null {
  if (data instanceof Uint8Array) return new TextDecoder().decode(data);
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return null;
}

/** Full Cursor ACP store.db parse (uses cursor-acp-enriched path discovery). */
export function readCursorAcpStoreMessages(sessionId: string): CliSessionMessage[] {
  const dbPath = findSessionStorePath(sessionId);
  const db = new Database(dbPath, { readonly: true });
  const messages: CliSessionMessage[] = [];
  const seenTool = new Set<string>();

  try {
    const rows = db.query('SELECT data FROM blobs').all() as { data: unknown }[];
    for (const row of rows) {
      const text = blobToUtf8(row.data);
      if (!text) continue;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(text) as Record<string, unknown>;
      } catch {
        continue;
      }

      const role = payload.role;
      if (role === 'user' || role === 'assistant') {
        const line = extractTextContent(payload.content);
        if (line) messages.push({ role, text: line });
      }

      const content = payload.content;
      if (!Array.isArray(content)) continue;

      for (const item of content) {
        if (!item || typeof item !== 'object') continue;
        const block = item as Record<string, unknown>;
        const toolCallId =
          typeof block.toolCallId === 'string' ? block.toolCallId : undefined;

        if (block.type === 'tool-call' && typeof block.toolName === 'string') {
          const key = `call:${toolCallId ?? block.toolName}`;
          if (seenTool.has(key)) continue;
          seenTool.add(key);
          messages.push({
            role: 'tool',
            toolName: block.toolName,
            toolCallId,
            text: JSON.stringify(block.args ?? {}, null, 2),
          });
        }

        if (block.type === 'tool-result' && block.result !== undefined) {
          const key = `result:${toolCallId ?? 'unknown'}`;
          if (seenTool.has(key)) continue;
          seenTool.add(key);
          messages.push({
            role: 'tool',
            toolName: typeof block.toolName === 'string' ? block.toolName : 'tool',
            toolCallId,
            text: extractResultString(block.result),
          });
        }
      }
    }
  } finally {
    db.close();
  }

  return messages;
}
