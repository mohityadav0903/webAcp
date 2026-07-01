import { z } from 'zod';
import { acpProviderIds } from './schemas.js';

export const authMethodSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  type: z.enum(['agent', 'terminal', 'env_var']).optional(),
});
export type AuthMethodSummary = z.infer<typeof authMethodSummarySchema>;

export const acpConnectionStatusSchema = z.object({
  providerId: z.enum(acpProviderIds).nullable(),
  connected: z.boolean(),
  authenticated: z.boolean(),
  agentName: z.string().optional(),
  authMethods: z.array(authMethodSummarySchema).optional(),
  authError: z.string().nullable().optional(),
});
export type AcpConnectionStatus = z.infer<typeof acpConnectionStatusSchema>;

export const updateThreadBodySchema = z.object({
  title: z.string().optional(),
  provider: z.enum(acpProviderIds).nullable().optional(),
  model: z.string().nullable().optional(),
});
export type UpdateThreadBody = z.infer<typeof updateThreadBodySchema>;
