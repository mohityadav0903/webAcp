import { z } from 'zod';

export const acpProviderIds = ['claude', 'cursor', 'codex', 'gemini', 'opencode'] as const;
export type AcpProviderId = (typeof acpProviderIds)[number];

export function isAcpProviderId(value: string): value is AcpProviderId {
  return (acpProviderIds as readonly string[]).includes(value);
}

export const modelInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const historyTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});
export type HistoryTurn = z.infer<typeof historyTurnSchema>;
