/** In-memory ACP session map key: one session per (thread, provider). */
export function acpSessionKey(threadId: string, providerId: string): string {
  return `${threadId}:${providerId}`;
}
