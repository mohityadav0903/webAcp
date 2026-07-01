import type { CliSessionMessage } from '@webacp/protocol';

function blockText(content: unknown): string | null {
  if (typeof content === 'string') {
    if (content.startsWith('<')) return null;
    return content.trim() || null;
  }
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    const block = item as Record<string, unknown>;
    if (block.type === 'text' && typeof block.text === 'string') {
      const text = block.text;
      if (text && !text.startsWith('<')) parts.push(text);
    }
  }
  return parts.join('\n').trim() || null;
}

function stringifyToolContent(content: unknown): string {
  if (typeof content === 'string') return content;
  return JSON.stringify(content, null, 2);
}

/** Claude Code JSONL parse (claude-sessions / conversation-extractor style). */
export function parseClaudeJsonl(raw: string): CliSessionMessage[] {
  const messages: CliSessionMessage[] = [];

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (row.isMeta) continue;

    const type = row.type;
    const msg = row.message as { role?: string; content?: unknown } | undefined;
    if (!msg) continue;

    if (type === 'user' || type === 'assistant') {
      const content = msg.content;
      if (Array.isArray(content)) {
        for (const item of content) {
          if (!item || typeof item !== 'object') continue;
          const block = item as Record<string, unknown>;
          if (block.type === 'tool_use' && typeof block.name === 'string') {
            messages.push({
              role: 'tool',
              toolName: block.name,
              toolCallId: typeof block.id === 'string' ? block.id : undefined,
              text: stringifyToolContent(block.input),
            });
          } else if (block.type === 'tool_result') {
            messages.push({
              role: 'tool',
              toolCallId:
                typeof block.tool_use_id === 'string' ? block.tool_use_id : undefined,
              text: stringifyToolContent(block.content),
            });
          }
        }
      }
      const text = blockText(content);
      if (text) messages.push({ role: type, text });
      continue;
    }
  }

  return messages;
}
