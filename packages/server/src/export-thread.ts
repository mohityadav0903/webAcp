import type { StoredMessage, Thread } from '@webacp/persistence';

export function exportThreadMarkdown(thread: Thread, messages: StoredMessage[]): string {
  const lines: string[] = [
    `# ${thread.title}`,
    '',
    `- **Provider:** ${thread.provider ?? '—'}`,
    `- **Workspace:** ${thread.workspaceCwd ?? '—'}`,
    `- **Imported:** ${thread.sourceKey ? 'yes' : 'no'}`,
    thread.acpSessionId ? `- **Native session:** \`${thread.acpSessionId}\`` : '',
    '',
    '---',
    '',
  ].filter(Boolean);

  for (const m of messages) {
    if (m.role === 'tool') {
      lines.push(`### Tool: ${m.toolName ?? 'tool'}`, '', '```', m.content, '```', '');
      continue;
    }
    const heading = m.role === 'user' ? '## User' : m.role === 'assistant' ? '## Assistant' : `## ${m.role}`;
    lines.push(heading, '', m.content, '');
  }

  return lines.join('\n');
}

export function exportThreadJson(thread: Thread, messages: StoredMessage[]): string {
  return JSON.stringify(
    {
      thread: {
        id: thread.id,
        title: thread.title,
        provider: thread.provider,
        model: thread.model,
        workspaceCwd: thread.workspaceCwd,
        sourceKey: thread.sourceKey,
        acpSessionId: thread.acpSessionId,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
      },
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        toolName: m.toolName,
        createdAt: m.createdAt,
      })),
    },
    null,
    2,
  );
}
