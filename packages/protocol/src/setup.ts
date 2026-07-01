import { z } from 'zod';
import type { AcpProviderId } from './schemas.js';
import { acpProviderIds } from './schemas.js';

export const providerProbeStatusSchema = z.enum([
  'checking',
  'not_installed',
  'login_required',
  'ready',
  'error',
]);
export type ProviderProbeStatus = z.infer<typeof providerProbeStatusSchema>;

export const providerProbeSchema = z.object({
  id: z.enum(acpProviderIds),
  displayName: z.string(),
  status: providerProbeStatusSchema,
  installed: z.boolean(),
  authenticated: z.boolean(),
  error: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
});
export type ProviderProbe = z.infer<typeof providerProbeSchema>;

export const workspaceInfoSchema = z.object({
  cwd: z.string().nullable(),
  exists: z.boolean().optional(),
  name: z.string().nullable().optional(),
});
export type WorkspaceInfo = z.infer<typeof workspaceInfoSchema>;

export const setupStatusSchema = z.object({
  workspace: workspaceInfoSchema,
  agent: z.object({
    running: z.boolean(),
    paired: z.boolean(),
    connected: z.boolean(),
    agentId: z.string().optional(),
  }),
  defaultProvider: z.enum(acpProviderIds).nullable(),
  providers: z.array(providerProbeSchema),
  ready: z.boolean(),
});
export type SetupStatus = z.infer<typeof setupStatusSchema>;

export const setWorkspaceBodySchema = z.object({
  path: z.string().min(1).optional(),
  pick: z.boolean().optional(),
});
export type SetWorkspaceBody = z.infer<typeof setWorkspaceBodySchema>;

export const setDefaultProviderBodySchema = z.object({
  providerId: z.enum(acpProviderIds),
});
export type SetDefaultProviderBody = z.infer<typeof setDefaultProviderBodySchema>;

export const probeProvidersBodySchema = z.object({
  providerId: z.enum(acpProviderIds).optional(),
});
export type ProbeProvidersBody = z.infer<typeof probeProvidersBodySchema>;

export interface ProviderSetupGuide {
  installLabel: string;
  installCommand?: string;
  loginCommand?: string;
  docsUrl: string;
  docsLabel: string;
  webacpNote: string;
}

export const PROVIDER_SETUP_GUIDES: Record<AcpProviderId, ProviderSetupGuide> = {
  claude: {
    installLabel: 'Install Claude Code',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    loginCommand: 'claude login',
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code',
    docsLabel: 'Claude Code docs',
    webacpNote: 'WebACP spawns `@zed-industries/claude-agent-acp` via npx — Claude Code must be installed and logged in.',
  },
  cursor: {
    installLabel: 'Install Cursor CLI',
    installCommand: 'curl https://cursor.com/install -fsS | bash',
    loginCommand: 'agent login',
    docsUrl: 'https://cursor.com/docs/cli/acp',
    docsLabel: 'Cursor ACP docs',
    webacpNote: 'WebACP runs `agent acp` from ~/.local/bin/agent after login.',
  },
  codex: {
    installLabel: 'Install Codex ACP adapter',
    installCommand: 'npm install -g @agentclientprotocol/codex-acp',
    loginCommand: 'codex login',
    docsUrl: 'https://github.com/agentclientprotocol/codex-acp',
    docsLabel: 'Codex ACP docs',
    webacpNote: 'WebACP spawns `@agentclientprotocol/codex-acp` via npx.',
  },
  gemini: {
    installLabel: 'Install Gemini CLI',
    installCommand: 'npm install -g @google/gemini-cli',
    loginCommand: 'gemini auth login',
    docsUrl: 'https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md',
    docsLabel: 'Gemini ACP mode',
    webacpNote: 'WebACP runs `gemini --acp` (native ACP mode).',
  },
  opencode: {
    installLabel: 'Install OpenCode CLI',
    installCommand: 'See opencode.ai install instructions',
    loginCommand: 'opencode auth',
    docsUrl: 'https://opencode.ai',
    docsLabel: 'OpenCode',
    webacpNote: 'WebACP runs `opencode acp` when installed on PATH.',
  },
};
