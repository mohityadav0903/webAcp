import type { ThreadSummary } from '@webacp/protocol';
import type { DiscoveredCliSession } from '@webacp/protocol';
import type { PersistenceAdapter, Thread } from '@webacp/persistence';

export function threadToSummary(thread: Thread): ThreadSummary {
  return {
    id: thread.id,
    title: thread.title,
    provider: thread.provider,
    model: thread.model,
    updatedAt: thread.updatedAt,
    workspaceCwd: thread.workspaceCwd,
    sourceKey: thread.sourceKey,
    imported: Boolean(thread.sourceKey),
  };
}

export async function importCliSessions(
  persistence: PersistenceAdapter,
  cwd: string,
  sessions: DiscoveredCliSession[],
): Promise<{ imported: number; skipped: number; threadIds: string[] }> {
  let imported = 0;
  let skipped = 0;
  const threadIds: string[] = [];

  for (const session of sessions) {
    if (persistence.findThreadBySource) {
      const existing = await persistence.findThreadBySource(cwd, session.sourceKey);
      if (existing) {
        skipped++;
        continue;
      }
    }

    const resumeSession =
      session.storageKind === 'claude-jsonl' ||
      session.storageKind === 'cursor-acp' ||
      session.storageKind === 'codex-jsonl';

    const thread = await persistence.createThread({
      title: session.title ?? 'Imported chat',
      provider: session.provider,
      acpSessionId: resumeSession ? session.sessionId : null,
      workspaceCwd: cwd,
      sourceKey: session.sourceKey,
      createdAt: session.mtime,
      updatedAt: session.mtime,
    });

    let ts = session.mtime - session.messages.length * 1000;
    for (const message of session.messages) {
      await persistence.addMessage({
        threadId: thread.id,
        role: message.role,
        content: message.text,
        toolName: message.role === 'tool' ? (message.toolName ?? 'tool') : null,
        createdAt: Math.max(ts, 0),
      });
      ts += 1000;
    }

    imported++;
    threadIds.push(thread.id);
  }

  return { imported, skipped, threadIds };
}
