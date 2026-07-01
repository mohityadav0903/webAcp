import { z } from 'zod';
import { acpConnectionStatusSchema } from './auth.js';
import { storedChatRoles } from './roles.js';
import { acpProviderIds } from './schemas.js';

export const healthResponseSchema = z.object({
  ok: z.boolean().optional(),
  agentConnected: z.boolean(),
  webUrl: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const agentStatusResponseSchema = z.object({
  running: z.boolean().optional(),
  connected: z.boolean().optional(),
  paired: z.boolean().optional(),
  acp: acpConnectionStatusSchema.optional(),
});
export type AgentStatusResponse = z.infer<typeof agentStatusResponseSchema>;

export const pairingTokenResponseSchema = z.object({
  token: z.string(),
  expiresInSeconds: z.number().optional(),
});
export type PairingTokenResponse = z.infer<typeof pairingTokenResponseSchema>;

export const providerInfoSchema = z.object({
  id: z.enum(acpProviderIds),
  displayName: z.string(),
  setupHint: z.string(),
  /** ACP authenticate method id, when the agent requires explicit auth. */
  authMethodId: z.string().optional(),
  /** How the user should authenticate for this provider. */
  authKind: z.enum(['cli', 'acp_terminal', 'acp_env']).optional(),
});
export type ProviderInfo = z.infer<typeof providerInfoSchema> & {
  authKind?: 'cli' | 'acp_terminal' | 'acp_env';
};

export const providersResponseSchema = z.object({
  providers: z.array(providerInfoSchema),
});
export type ProvidersResponse = z.infer<typeof providersResponseSchema>;

export const threadSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  updatedAt: z.number(),
  workspaceCwd: z.string().nullable().optional(),
  sourceKey: z.string().nullable().optional(),
  imported: z.boolean().optional(),
});
export type ThreadSummary = z.infer<typeof threadSummarySchema>;

export const threadsResponseSchema = z.object({
  threads: z.array(threadSummarySchema),
});
export type ThreadsResponse = z.infer<typeof threadsResponseSchema>;

export const createThreadResponseSchema = z.object({
  thread: threadSummarySchema,
});
export type CreateThreadResponse = z.infer<typeof createThreadResponseSchema>;

export const storedMessageSchema = z.object({
  id: z.string(),
  role: z.enum(storedChatRoles),
  content: z.string(),
  toolName: z.string().nullable(),
});
export type StoredMessageDto = z.infer<typeof storedMessageSchema>;

export const threadMessagesResponseSchema = z.object({
  messages: z.array(storedMessageSchema),
});
export type ThreadMessagesResponse = z.infer<typeof threadMessagesResponseSchema>;

export const forkResponseSchema = z.object({
  thread: threadSummarySchema,
  messages: z.array(storedMessageSchema),
});
export type ForkResponse = z.infer<typeof forkResponseSchema>;

export const errorResponseSchema = z.object({
  error: z.string().optional(),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export function parseApiBody<T>(schema: z.ZodType<T>, raw: unknown): T | null {
  const result = schema.safeParse(raw);
  return result.success ? result.data : null;
}
