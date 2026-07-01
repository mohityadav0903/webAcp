import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { SetupStatus } from '@webacp/protocol';

export interface PairRequestPayload {
  token: string;
  webUrl?: string;
}

export interface PairServerHandlers {
  onPair: (payload: PairRequestPayload) => Promise<{ ok: true } | { ok: false; error: string }>;
  getStatus: () => { paired: boolean; connected: boolean; agentId?: string };
  /** Optional: check/apply updates when the web UI connects or pairs. */
  onUpdateTrigger?: (trigger: 'pair' | 'connect') => Promise<unknown>;
  getSetupStatus?: () => Promise<SetupStatus>;
  setWorkspace?: (body: { path?: string; pick?: boolean }) => Promise<{
    cwd: string | null;
    cliSessions?: unknown[];
  }>;
  getCliSessions?: (cwd?: string) => Promise<{ cwd: string; sessions: unknown[] }>;
  getCasrStatus?: () => Promise<{ installed: boolean; version: string | null }>;
  casrConvertSession?: (body: {
    sessionId: string;
    targetProvider: string;
  }) => Promise<unknown>;
  setDefaultProvider?: (providerId: string) => Promise<void>;
  probeProviders?: (providerId?: string) => Promise<SetupStatus>;
}

function corsHeaders(origin?: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown, origin?: string | null) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders(origin) });
  res.end(JSON.stringify(body));
}

export function startPairServer(handlers: PairServerHandlers, port: number): Server {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const origin = req.headers.origin ?? null;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(origin));
      res.end();
      return;
    }

    if (url.pathname === '/status' && req.method === 'GET') {
      json(res, 200, { running: true, ...handlers.getStatus() }, origin);
      return;
    }

    if (url.pathname === '/setup' && req.method === 'GET') {
      if (!handlers.getSetupStatus) {
        json(res, 501, { error: 'Setup not available' }, origin);
        return;
      }
      try {
        json(res, 200, await handlers.getSetupStatus(), origin);
      } catch (err) {
        json(
          res,
          500,
          { error: err instanceof Error ? err.message : String(err) },
          origin,
        );
      }
      return;
    }

    if (url.pathname === '/setup/casr/status' && req.method === 'GET') {
      if (!handlers.getCasrStatus) {
        json(res, 501, { error: 'CASR not available' }, origin);
        return;
      }
      try {
        json(res, 200, await handlers.getCasrStatus(), origin);
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) }, origin);
      }
      return;
    }

    if (url.pathname === '/setup/casr/convert' && req.method === 'POST') {
      if (!handlers.casrConvertSession) {
        json(res, 501, { error: 'CASR not available' }, origin);
        return;
      }
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { sessionId: string; targetProvider: string };
        json(res, 200, await handlers.casrConvertSession(body), origin);
      } catch (err) {
        json(res, 400, { error: err instanceof Error ? err.message : String(err) }, origin);
      }
      return;
    }

    if (url.pathname === '/setup/cli-sessions' && req.method === 'GET') {
      if (!handlers.getCliSessions) {
        json(res, 501, { error: 'CLI sessions not available' }, origin);
        return;
      }
      try {
        const cwd = url.searchParams.get('cwd') ?? undefined;
        json(res, 200, await handlers.getCliSessions(cwd), origin);
      } catch (err) {
        json(
          res,
          500,
          { error: err instanceof Error ? err.message : String(err) },
          origin,
        );
      }
      return;
    }

    if (url.pathname === '/setup/workspace' && req.method === 'POST') {
      if (!handlers.setWorkspace) {
        json(res, 501, { error: 'Workspace not available' }, origin);
        return;
      }
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { path?: string; pick?: boolean };
        const result = await handlers.setWorkspace(body);
        json(res, 200, result, origin);
      } catch (err) {
        json(
          res,
          400,
          { error: err instanceof Error ? err.message : String(err) },
          origin,
        );
      }
      return;
    }

    if (url.pathname === '/setup/default-provider' && req.method === 'POST') {
      if (!handlers.setDefaultProvider) {
        json(res, 501, { error: 'Not available' }, origin);
        return;
      }
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { providerId: string };
        await handlers.setDefaultProvider(body.providerId);
        json(res, 200, { ok: true }, origin);
      } catch (err) {
        json(
          res,
          400,
          { error: err instanceof Error ? err.message : String(err) },
          origin,
        );
      }
      return;
    }

    if (url.pathname === '/setup/probe' && req.method === 'POST') {
      if (!handlers.probeProviders) {
        json(res, 501, { error: 'Probe not available' }, origin);
        return;
      }
      try {
        const raw = await readBody(req);
        const body = raw ? (JSON.parse(raw) as { providerId?: string }) : {};
        json(res, 200, await handlers.probeProviders(body.providerId), origin);
      } catch (err) {
        json(
          res,
          500,
          { error: err instanceof Error ? err.message : String(err) },
          origin,
        );
      }
      return;
    }

    if (url.pathname === '/update' && req.method === 'POST') {
      try {
        const result = handlers.onUpdateTrigger
          ? await handlers.onUpdateTrigger('connect')
          : null;
        json(
          res,
          200,
          {
            ok: true,
            updated: result && typeof result === 'object' && 'applied' in result ? result.applied : false,
            message:
              result && typeof result === 'object' && 'message' in result
                ? String(result.message)
                : 'checked',
          },
          origin,
        );
      } catch (err) {
        json(
          res,
          500,
          { ok: false, error: err instanceof Error ? err.message : String(err) },
          origin,
        );
      }
      return;
    }

    if (url.pathname === '/pair' && req.method === 'POST') {
      try {
        if (handlers.onUpdateTrigger) await handlers.onUpdateTrigger('pair');
        const raw = await readBody(req);
        const body = JSON.parse(raw) as PairRequestPayload;
        const result = await handlers.onPair(body);
        if (result.ok) json(res, 200, { ok: true }, origin);
        else json(res, 400, { ok: false, error: result.error }, origin);
      } catch {
        json(res, 400, { ok: false, error: 'Invalid request' }, origin);
      }
      return;
    }

    json(res, 404, { error: 'Not found' }, origin);
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[agent] pair server http://127.0.0.1:${port}`);
  });

  return server;
}
