import { randomBytes } from 'node:crypto';
import { createServer, request as requestHttp } from 'node:http';
import { mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

import { build } from 'esbuild';

const nextAuthPath = /^\/api\/auth\/(?:providers|session|csrf|signin(?:\/[^/?]+)?|callback\/[^/?]+|signout|error)(?:[/?]|$)/;

function bodyBuffer(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.once('end', () => resolveBody(Buffer.concat(chunks)));
    request.once('error', reject);
  });
}

async function webRequest(request, origin) {
  const body = await bodyBuffer(request);
  return new Request(new URL(request.url ?? '/', origin), {
    method: request.method,
    headers: request.headers,
    body: body.length ? body : undefined,
  });
}

async function sendWebResponse(response, nodeResponse) {
  for (const [name, value] of response.headers) {
    if (name !== 'set-cookie') nodeResponse.setHeader(name, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length) nodeResponse.setHeader('set-cookie', cookies);
  nodeResponse.statusCode = response.status;
  nodeResponse.end(Buffer.from(await response.arrayBuffer()));
}

function json(nodeResponse, status, value) {
  nodeResponse.writeHead(status, { 'content-type': 'application/json' });
  nodeResponse.end(JSON.stringify(value));
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function providerPage(url) {
  const redirectUri = url.searchParams.get('redirect_uri') ?? '';
  const state = url.searchParams.get('state') ?? '';
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Local OAuth provider</title></head>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
  <main>
    <p>Test infrastructure · not Google-hosted</p>
    <h1>Local OAuth provider</h1>
    <form method="post">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}">
      <input type="hidden" name="state" value="${escapeHtml(state)}">
      <p><label>Provider email<br><input name="email" type="email" required></label></p>
      <p><label>Provider subject<br><input name="subject" required></label></p>
      <p><label><input name="email_verified" type="checkbox" checked> Verified email</label></p>
      <button name="action" value="authorize">Authorize</button>
      <button formnovalidate name="action" value="provider-error">Return provider error</button>
    </form>
  </main>
</body>
</html>`;
}

async function compileLocalNextAuth(projectRoot, supportDirectory) {
  await rm(supportDirectory, { recursive: true, force: true });
  await mkdir(supportDirectory, { recursive: true });
  const outfile = join(supportDirectory, 'local-nextauth.cjs');
  await build({
    absWorkingDir: projectRoot,
    bundle: true,
    entryPoints: [join(projectRoot, 'test-support/local-nextauth.ts')],
    external: ['@node-rs/argon2', '@prisma/client'],
    format: 'cjs',
    logLevel: 'silent',
    outfile,
    platform: 'node',
    sourcemap: false,
    target: 'node20',
    tsconfig: join(projectRoot, 'tsconfig.json'),
  });
  const localNextAuthModule = createRequire(import.meta.url)(outfile);
  return localNextAuthModule.handleLocalNextAuth;
}

function proxyToApplication(request, response, upstreamPort) {
  const upstream = requestHttp(
    {
      hostname: '127.0.0.1',
      port: upstreamPort,
      method: request.method,
      path: request.url,
      headers: request.headers,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.once('error', () => {
    if (!response.headersSent) json(response, 502, { error: 'Application is starting.' });
    else response.destroy();
  });
  request.pipe(upstream);
}

export async function startAuthGateway({
  admin,
  appPort,
  gatewayPort,
  liveGoogle,
  projectRoot,
  supportDirectory,
}) {
  const origin = `http://127.0.0.1:${gatewayPort}`;
  const authorizationCodes = new Map();
  const accessTokens = new Map();
  const handleLocalNextAuth = liveGoogle
    ? null
    : await compileLocalNextAuth(resolve(projectRoot), supportDirectory);

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', origin);
    try {
      if (!liveGoogle && nextAuthPath.test(url.pathname)) {
        const authResponse = await handleLocalNextAuth(
          await webRequest(request, origin),
        );
        await sendWebResponse(authResponse, response);
        return;
      }

      if (url.pathname === '/__test/oauth/authorize' && request.method === 'GET') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(providerPage(url));
        return;
      }

      if (url.pathname === '/__test/oauth/authorize' && request.method === 'POST') {
        const fields = new URLSearchParams((await bodyBuffer(request)).toString('utf8'));
        const callback = new URL(fields.get('redirect_uri') ?? origin);
        callback.port = String(gatewayPort);
        callback.searchParams.set('state', fields.get('state') ?? '');
        if (fields.get('action') === 'provider-error') {
          callback.searchParams.set('error', 'server_error');
          callback.searchParams.set('error_description', 'Local provider unavailable');
        } else {
          const code = randomBytes(24).toString('hex');
          authorizationCodes.set(code, {
            sub: fields.get('subject') ?? '',
            name: 'Local OAuth User',
            email: fields.get('email') ?? '',
            email_verified: fields.get('email_verified') === 'on',
            picture: null,
          });
          callback.searchParams.set('code', code);
        }
        response.writeHead(302, { location: callback.toString() });
        response.end();
        return;
      }

      if (url.pathname === '/__test/oauth/token' && request.method === 'POST') {
        const fields = new URLSearchParams((await bodyBuffer(request)).toString('utf8'));
        const profile = authorizationCodes.get(fields.get('code'));
        if (!profile) {
          json(response, 400, { error: 'invalid_grant' });
          return;
        }
        authorizationCodes.delete(fields.get('code'));
        const token = randomBytes(24).toString('hex');
        accessTokens.set(token, profile);
        json(response, 200, {
          access_token: token,
          token_type: 'Bearer',
          expires_in: 300,
          scope: 'openid email profile',
        });
        return;
      }

      if (url.pathname === '/__test/oauth/userinfo' && request.method === 'GET') {
        const token = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
        const profile = accessTokens.get(token);
        if (!profile) {
          json(response, 401, { error: 'invalid_token' });
          return;
        }
        json(response, 200, profile);
        return;
      }

      if (url.pathname === '/__test/database/identity-lookup' && request.method === 'POST') {
        const body = JSON.parse((await bodyBuffer(request)).toString('utf8'));
        const privilege = body.available ? 'GRANT' : 'REVOKE';
        const recipient = body.available ? 'TO' : 'FROM';
        await admin.$executeRawUnsafe(
          `${privilege} EXECUTE ON FUNCTION autorfp_private.autorfp_auth_identity_by_provider(TEXT, TEXT) ${recipient} autorfp_app`,
        );
        response.writeHead(204).end();
        return;
      }

      if (url.pathname === '/__test/database/user-active' && request.method === 'POST') {
        const body = JSON.parse((await bodyBuffer(request)).toString('utf8'));
        const changed = await admin.$executeRawUnsafe(
          'UPDATE public."User" SET "isActive" = $1 WHERE "email" = $2',
          body.active === true,
          String(body.email ?? '').trim().toLowerCase(),
        );
        if (changed !== 1) {
          json(response, 404, { error: 'User fixture was not found.' });
          return;
        }
        response.writeHead(204).end();
        return;
      }

      proxyToApplication(request, response, appPort);
    } catch (error) {
      console.error(error);
      if (!response.headersSent) json(response, 500, { error: 'Test gateway failed.' });
      else response.destroy();
    }
  });

  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(gatewayPort, '127.0.0.1', resolveListen);
  });
  return server;
}
